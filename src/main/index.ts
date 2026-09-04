import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { PNG } from 'pngjs'
import {
  cacheDir,
  cacheStats,
  clearCache,
  initCache,
  initPortablePaths,
  isPortable,
  logsDir,
  thumbPathFor
} from './cache'
import { evictCache } from './cacheEvict'
import { allowRoot, clearTextureCache, decoderUrl, registerHandler, registerScheme } from './protocol'
import { ScanError, checkDependencies, scanFolder } from './scanner'
import {
  getRecentFolders,
  getSettings,
  pushRecentFolder,
  removeRecentFolder,
  saveSettings
} from './settings'
import { detectBlender, getBlenderInfo, openInBlender } from './blenderService'
import { importHdri, listHdri, removeHdri, userHdriDir } from './hdri'
import { loadWindowState, trackWindowState } from './windowState'
import {
  addTagTo,
  allTags,
  getLibrary,
  removeTagFrom,
  setFavorites,
  setTags,
  toggleFavorite
} from './library'
import {
  bumpEpoch,
  createWorkers,
  destroyWorkers,
  invalidateThumb,
  requestGlbExport,
  requestThumb,
  resolveViewableUrl,
  setProgressListener,
  setVisible
} from './thumbnailer'
import { initLog, installGlobalHandlers, log, logDirectory } from './log'
import { parseLaunchArgs } from './argv'
import { installMenu } from './menu'
import type {
  AppInfo,
  AppSettings,
  ExportBatchResult,
  MenuAction,
  ModelEntry,
  ScanOptions,
  ScanResult,
  ThumbRequest
} from '../shared/types'

// 这几件事必须赶在 app ready 之前做：
// userData 重定向要早于 Chromium 建缓存目录，自定义协议要早于任何页面加载，
// 关 GPU 加速要早于 GPU 进程启动
initPortablePaths()
initLog(logsDir())
installGlobalHandlers()
registerScheme()
app.setAppUserModelId('com.asset3d.previewer')

if (getSettings().disableGpu) {
  app.disableHardwareAcceleration()
  log.info('app', '已按设置关闭 GPU 加速')
}

let mainWindow: BrowserWindow | null = null

/**
 * 单实例：第二次启动（比如又拖了一个文件夹到 exe 上）只是让已开的窗口
 * 打开那个目录。两个实例共用同一个 data/ 目录会互相踩缓存和配置。
 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    const dir = parseLaunchArgs(argv, { isPackaged: app.isPackaged })
    if (dir) mainWindow.webContents.send('app:openFolder', dir)
  })
  boot()
}

/** 开发时任务栏图标；打包后由 electron-builder 写进 exe 资源 */
function devIconPath(): string | undefined {
  const p = path.join(__dirname, '..', '..', 'build', 'icon.png')
  return fs.existsSync(p) ? p : undefined
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function refreshMenu(): void {
  installMenu({
    getWindow: () => mainWindow,
    recent: () => getRecentFolders(),
    send: (action: MenuAction) => send('menu:action', action),
    openFolder: (dir) => send('app:openFolder', dir),
    openLogs: () => void shell.openPath(logDirectory() ?? logsDir()),
    openData: () => void shell.openPath(cacheDir())
  })
}

function createMainWindow(): void {
  const state = loadWindowState()

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#14161a',
    title: '3D 资源预览器',
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : devIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  if (state.maximized) mainWindow.maximize()
  trackWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 渲染进程崩了就重载，别留一个空白窗口
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('app', `主窗口渲染进程退出: ${details.reason}`)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
    }, 500)
  })
  mainWindow.webContents.on('unresponsive', () => log.warn('app', '主窗口无响应'))
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log.warn('renderer', message)
  })

  // 1.0 的一个真实 bug：隐藏的 worker 窗口一直开着，window-all-closed 永远不触发，
  // 关掉主窗口后进程还活着。主窗口就是应用的生命线，它关了就退出。
  mainWindow.on('closed', () => {
    mainWindow = null
    stopWatcher()
    destroyWorkers()
    app.quit()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function boot(): void {
  app.whenReady().then(() => {
    initCache()
    registerHandler()
    log.info('app', `启动 v${app.getVersion()} electron ${process.versions.electron}，数据目录 ${cacheDir()}`)

    const settings = getSettings()
    createWorkers(settings.concurrency)

    setProgressListener((r) => send('thumb:progress', r))

    // 后台探测 Blender，别卡住启动
    void detectBlender(settings.blenderPath)

    refreshMenu()
    createMainWindow()

    // 启动几秒后再做缓存淘汰，别和首屏抢磁盘
    setTimeout(() => {
      void evictCache(getSettings().cacheLimitMB).catch((e) => log.warn('cache', '淘汰失败', e))
    }, 3000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('child-process-gone', (_e, details) => {
    log.error('app', `子进程退出: ${details.type} ${details.reason} (${details.name ?? ''})`)
  })

  app.on('window-all-closed', () => {
    destroyWorkers()
    app.quit()
  })

  app.on('before-quit', () => {
    stopWatcher()
    destroyWorkers()
  })
}

/* --------------------------- 文件夹变动监视 --------------------------- */

let watcher: fs.FSWatcher | null = null
let watchTimer: ReturnType<typeof setTimeout> | null = null

function stopWatcher(): void {
  if (watchTimer) clearTimeout(watchTimer)
  watchTimer = null
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* 忽略 */
    }
  }
  watcher = null
}

/** 目录有增删改就提示用户重新扫描，不自动打断 */
function startWatcher(root: string): void {
  stopWatcher()
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(() => send('folder:changed', root), 800)
    })
    watcher.on('error', (e) => {
      log.debug('watch', '监视出错，停止', e)
      stopWatcher()
    })
  } catch (e) {
    // 网络盘/某些文件系统不支持递归监视，没有就没有
    log.debug('watch', '无法监视目录', e)
  }
}

/* ------------------------------- IPC ------------------------------- */

ipcMain.handle('dialog:selectFolder', async () => {
  if (!mainWindow) return null
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择要预览的 3D 资源文件夹'
  })
  if (r.canceled || r.filePaths.length === 0) return null
  return r.filePaths[0]
})

ipcMain.handle('dialog:pickFolder', async (_e, title?: string) => {
  if (!mainWindow) return null
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title ?? '选择文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  if (r.canceled || r.filePaths.length === 0) return null
  return r.filePaths[0]
})

let scanToken = 0

ipcMain.handle('scan:folder', async (_e, root: string, opts: ScanOptions): Promise<ScanResult> => {
  const token = ++scanToken
  // 每次换文件夹先清空旧队列，否则上一个目录的几百个任务会拖慢新目录首屏
  bumpEpoch()
  clearTextureCache()
  allowRoot(root)
  const s = getSettings()
  try {
    const result = await scanFolder(
      root,
      { ...opts, includeUnsupported: s.showUnsupported },
      {
        onProgress: (p) => {
          if (token === scanToken) send('scan:progress', p)
        },
        isCancelled: () => token !== scanToken
      }
    )
    if (token !== scanToken) {
      result.cancelled = true
      return result
    }
    pushRecentFolder(root)
    refreshMenu()
    startWatcher(root)
    log.info('scan', `${root}: ${result.entries.length} 个模型 / ${result.scannedFiles} 个文件 / ${result.elapsedMs}ms`)
    return result
  } catch (err) {
    const msg = err instanceof ScanError ? err.message : `扫描失败: ${String(err)}`
    log.warn('scan', msg)
    return { root, entries: [], hiddenCount: 0, scannedFiles: 0, elapsedMs: 0, error: msg }
  }
})

ipcMain.handle('scan:cancel', () => {
  scanToken++
  return true
})

ipcMain.handle('scan:validateFolder', async (_e, root: string) => {
  try {
    const st = await fsp.stat(root)
    return st.isDirectory()
  } catch {
    return false
  }
})

ipcMain.handle('thumb:request', async (_e, entry: ModelEntry, req: ThumbRequest) => {
  const s = getSettings()
  return await requestThumb(entry, req, s.blendAutoConvert, s.blenderPath)
})

ipcMain.handle('thumb:setVisible', (_e, ids: string[]) => {
  setVisible(Array.isArray(ids) ? ids : [])
  return true
})

ipcMain.handle('thumb:invalidate', async (_e, entry: ModelEntry, req: ThumbRequest) => {
  await invalidateThumb(entry, req)
  return true
})

ipcMain.handle('thumb:cancelPending', () => {
  bumpEpoch()
  return true
})

ipcMain.handle('model:viewableUrl', async (_e, entry: ModelEntry) => {
  const s = getSettings()
  return await resolveViewableUrl(entry, s.blenderPath)
})

ipcMain.handle('model:dependencies', async (_e, filePath: string) => {
  return await checkDependencies(filePath)
})

ipcMain.handle('shell:showItem', (_e, p: string) => {
  shell.showItemInFolder(p)
  return true
})

ipcMain.handle('shell:openPath', async (_e, p: string) => {
  return await shell.openPath(p)
})

ipcMain.handle('settings:get', () => getSettings())

ipcMain.handle('settings:save', async (_e, patch: Partial<AppSettings>) => {
  const prev = getSettings()
  const next = saveSettings(patch)
  if (next.concurrency !== prev.concurrency) createWorkers(next.concurrency)
  if (next.blenderPath !== prev.blenderPath) await detectBlender(next.blenderPath)
  if (next.cacheLimitMB !== prev.cacheLimitMB) void evictCache(next.cacheLimitMB)
  log.info('settings', '已保存', patch)
  return next
})

ipcMain.handle('settings:recent', async () => {
  const list = getRecentFolders()
  const out: { dir: string; exists: boolean }[] = []
  for (const dir of list) {
    let exists = false
    try {
      exists = (await fsp.stat(dir)).isDirectory()
    } catch {
      exists = false
    }
    out.push({ dir, exists })
  }
  return out
})

ipcMain.handle('settings:removeRecent', (_e, dir: string) => {
  const list = removeRecentFolder(dir)
  refreshMenu()
  return list
})

/**
 * 支持 3D资源预览器.exe --folder="D:\素材" 或直接把文件夹拖到 exe 上。
 * 用渲染进程主动来取而不是主进程推送 —— did-finish-load 早于 React 挂载，
 * 推送过去时还没人监听，事件就丢了。
 */
ipcMain.handle('app:initialFolder', () => {
  return parseLaunchArgs(process.argv, { isPackaged: app.isPackaged })
})

ipcMain.handle('app:info', (): AppInfo => ({
  version: app.getVersion(),
  electron: process.versions.electron ?? '',
  chrome: process.versions.chrome ?? '',
  node: process.versions.node ?? '',
  dataDir: cacheDir(),
  logDir: logDirectory(),
  portable: isPortable()
}))

ipcMain.handle('app:openLogs', () => shell.openPath(logDirectory() ?? logsDir()))
ipcMain.handle('app:openData', () => shell.openPath(cacheDir()))

ipcMain.handle('blender:info', async () => {
  const s = getSettings()
  return await getBlenderInfo(s.blenderPath)
})

ipcMain.handle('blender:redetect', async (_e, userPath?: string | null) => {
  const s = getSettings()
  await detectBlender(userPath !== undefined ? userPath : s.blenderPath)
  return await getBlenderInfo(s.blenderPath)
})

/** 用检测到的 Blender 打开文件：.blend 直接打开，其它格式交给 Blender 的导入器 */
ipcMain.handle('blender:open', async (_e, filePath: string) => {
  const s = getSettings()
  return await openInBlender(filePath, s.blenderPath)
})

/* --------------------- 收藏与标签 --------------------- */

ipcMain.handle('library:get', () => ({ ...getLibrary(), allTags: allTags() }))

ipcMain.handle('library:toggleFavorite', (_e, p: string) => toggleFavorite(p))

ipcMain.handle('library:setFavorites', (_e, paths: string[], value: boolean) => {
  setFavorites(paths, value)
  return getLibrary().favorites
})

ipcMain.handle('library:addTag', (_e, paths: string[], tag: string) => {
  addTagTo(paths, tag)
  return { ...getLibrary(), allTags: allTags() }
})

ipcMain.handle('library:removeTag', (_e, paths: string[], tag: string) => {
  removeTagFrom(paths, tag)
  return { ...getLibrary(), allTags: allTags() }
})

ipcMain.handle('library:setTags', (_e, p: string, tags: string[]) => {
  setTags(p, tags)
  return { ...getLibrary(), allTags: allTags() }
})

/* --------------------- 批量导出 --------------------- */

/** 同名不覆盖，自动加序号 */
function uniqueDest(dir: string, name: string, ext: string): string {
  let dest = path.join(dir, `${name}${ext}`)
  let n = 1
  while (fs.existsSync(dest)) dest = path.join(dir, `${name}_${n++}${ext}`)
  return dest
}

/**
 * 把一个模型变成 GLB 字节或可复制的路径。
 * .blend 走 Blender 转换缓存；其它格式用 worker 里的 GLTFExporter。
 */
async function toGlbFile(
  entry: ModelEntry,
  blenderPath: string | null
): Promise<{ ok: boolean; path?: string; data?: Buffer; error?: string }> {
  if (entry.ext === '.blend') {
    const r = await resolveViewableUrl(entry, blenderPath)
    return r.path ? { ok: true, path: r.path } : { ok: false, error: r.error }
  }
  if (!entry.previewable) return { ok: false, error: `${entry.ext} 无法转换` }
  const r = await requestGlbExport(entry, entry.path, entry.ext)
  return r.ok && r.data ? { ok: true, data: r.data } : { ok: false, error: r.error }
}

/**
 * 把选中的模型批量导出到一个目录。
 * 「选目录」和「执行」拆开：界面走对话框，验收脚本直接调这个。
 */
ipcMain.handle(
  'export:batchTo',
  async (
    _e,
    entries: ModelEntry[],
    destDir: string,
    opts: { toGlb?: boolean } = {}
  ): Promise<ExportBatchResult> => {
    const s = getSettings()
    let done = 0
    const failed: string[] = []
    try {
      await fsp.mkdir(destDir, { recursive: true })
    } catch (e) {
      return { ok: false, error: `无法创建目录: ${String(e)}` }
    }

    for (const entry of entries) {
      try {
        const wantGlb = opts.toGlb || entry.ext === '.blend'
        if (wantGlb) {
          const r = await toGlbFile(entry, s.blenderPath)
          if (!r.ok) {
            failed.push(`${entry.name}${entry.ext}: ${r.error ?? '无法转换'}`)
          } else {
            const dest = uniqueDest(destDir, entry.name, '.glb')
            if (r.data) await fsp.writeFile(dest, r.data)
            else if (r.path) await fsp.copyFile(r.path, dest)
            done++
          }
        } else {
          const dest = uniqueDest(destDir, entry.name, entry.ext)
          await fsp.copyFile(entry.path, dest)
          done++
        }
      } catch (err) {
        failed.push(`${entry.name}${entry.ext}: ${err instanceof Error ? err.message : String(err)}`)
      }
      send('export:progress', { done: done + failed.length, total: entries.length, name: entry.name })
    }

    log.info('export', `导出到 ${destDir}: 成功 ${done} / ${entries.length}`)
    return { ok: true, dir: destDir, done, total: entries.length, failed }
  }
)

/** 保存渲染进程合成好的接触表 PNG */
ipcMain.handle('export:contactSheet', async (_e, dataUrl: string, name: string) => {
  if (!mainWindow) return null
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '导出接触表',
    defaultPath: name,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  })
  if (r.canceled || !r.filePath) return null
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  await fsp.writeFile(r.filePath, Buffer.from(b64, 'base64'))
  return r.filePath
})

ipcMain.handle('cache:info', async () => {
  const stats = await cacheStats()
  return { dir: cacheDir(), ...stats }
})

ipcMain.handle('cache:clear', async () => {
  await clearCache()
  log.info('cache', '已清空缓存')
  return true
})

/* --------------------- 拖拽到外部程序 --------------------- */

let fallbackDragIcon: Electron.NativeImage | null = null

/**
 * startDrag 的 icon 是必填项，传空图会直接抛异常。
 * 缩略图还没生成好时用这张兜底，省得拖拽整个失效。
 */
function getFallbackDragIcon(): Electron.NativeImage {
  if (fallbackDragIcon) return fallbackDragIcon
  const size = 96
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) << 2
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2
      png.data[i] = edge ? 0x4c : 0x22
      png.data[i + 1] = edge ? 0x9a : 0x26
      png.data[i + 2] = edge ? 0xff : 0x2e
      png.data[i + 3] = 255
    }
  }
  fallbackDragIcon = nativeImage.createFromBuffer(PNG.sync.write(png))
  return fallbackDragIcon
}

/**
 * 把模型文件拖到 Blender / Unity / 资源管理器等外部程序。
 *
 * 必须用 ipcRenderer.send 这种同步派发的通道：渲染进程要在 dragstart
 * 事件里立刻发出来，晚了系统就不认这次拖拽了。
 *
 * 只拖模型文件本身，不带 .bin 和贴图 —— Blender 的导入器会自己按
 * 相对路径找这些伴生文件，多拖反而会让它当成多个独立文件重复导入。
 */
ipcMain.on(
  'drag:start',
  (e, payload: { paths: string[]; thumbKey?: string | null }) => {
    const files = (payload.paths ?? []).filter((p) => {
      try {
        return fs.statSync(p).isFile()
      } catch {
        return false
      }
    })
    if (files.length === 0) return

    let icon: Electron.NativeImage | null = null
    if (payload.thumbKey && /^[a-f0-9]{40}$/.test(payload.thumbKey)) {
      const img = nativeImage.createFromPath(thumbPathFor(payload.thumbKey))
      if (!img.isEmpty()) icon = img.resize({ width: 96, height: 96 })
    }
    if (!icon || icon.isEmpty()) icon = getFallbackDragIcon()

    try {
      // 类型上 file 是必填的，多选时 files 才是真正生效的那个字段
      e.sender.startDrag({ file: files[0], files, icon })
    } catch (err) {
      log.error('drag', 'startDrag 失败', err)
    }
  }
)

ipcMain.handle('app:decoderUrl', (_e, sub: string) => decoderUrl(sub))

/* --------------------- HDRI 环境光 --------------------- */

ipcMain.handle('hdri:list', () => listHdri())
ipcMain.handle('hdri:import', () => importHdri(mainWindow))
ipcMain.handle('hdri:remove', (_e, id: string) => removeHdri(id))
ipcMain.handle('hdri:openDir', () => shell.openPath(userHdriDir()))

/** 导出当前视角截图 */
ipcMain.handle(
  'export:png',
  async (_e, suggestedName: string, dataUrl: string) => {
    if (!mainWindow) return null
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出截图',
      defaultPath: suggestedName,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (r.canceled || !r.filePath) return null
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    await fsp.writeFile(r.filePath, Buffer.from(b64, 'base64'))
    return r.filePath
  }
)

/** 把单个模型另存为 GLB：.blend 用 Blender 转换结果，其它格式用 three.js 导出 */
ipcMain.handle('export:glb', async (_e, entry: ModelEntry) => {
  if (!mainWindow) return null
  const s = getSettings()

  const r = await dialog.showSaveDialog(mainWindow, {
    title: '导出 GLB',
    defaultPath: `${entry.name}.glb`,
    filters: [{ name: 'glTF 二进制', extensions: ['glb'] }]
  })
  if (r.canceled || !r.filePath) return { ok: false }

  const conv = await toGlbFile(entry, s.blenderPath)
  if (!conv.ok) return { ok: false, error: conv.error }
  if (conv.data) await fsp.writeFile(r.filePath, conv.data)
  else if (conv.path) await fsp.copyFile(conv.path, r.filePath)
  return { ok: true, path: r.filePath }
})
