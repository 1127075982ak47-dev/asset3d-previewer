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
  initPortablePaths
} from './cache'
import { allowRoot, decoderUrl, pathToAssetUrl, registerHandler, registerScheme } from './protocol'
import { checkDependencies, scanFolder } from './scanner'
import { getRecentFolders, getSettings, pushRecentFolder, saveSettings } from './settings'
import { spawn } from 'node:child_process'
import { detectBlender, getBlenderInfo, pickBlenderFor } from './blenderService'
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
  requestThumb,
  resolveViewableUrl,
  setProgressListener
} from './thumbnailer'
import type { AppSettings, ModelEntry, ScanOptions } from '../shared/types'

// 这两件事必须赶在 app ready 之前做：
// userData 重定向要早于 Chromium 建缓存目录，自定义协议要早于任何页面加载
initPortablePaths()
registerScheme()

let mainWindow: BrowserWindow | null = null

/** 开发时任务栏图标；打包后由 electron-builder 写进 exe 资源 */
function devIconPath(): string | undefined {
  const p = path.join(__dirname, '..', '..', 'build', 'icon.png')
  return fs.existsSync(p) ? p : undefined
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

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  initCache()
  registerHandler()

  const settings = getSettings()
  createWorkers(Math.max(1, Math.min(6, settings.concurrency)))

  setProgressListener((r) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('thumb:progress', r)
    }
  })

  // 后台探测 Blender，别卡住启动
  void detectBlender(settings.blenderPath)

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  destroyWorkers()
  if (process.platform !== 'darwin') app.quit()
})

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

ipcMain.handle(
  'scan:folder',
  async (_e, root: string, opts: ScanOptions) => {
    // 每次换文件夹先清空旧队列，否则上一个目录的几百个任务会拖慢新目录首屏
    bumpEpoch()
    allowRoot(root)
    pushRecentFolder(root)
    return await scanFolder(root, opts)
  }
)

ipcMain.handle('scan:validateFolder', async (_e, root: string) => {
  try {
    const st = await fsp.stat(root)
    return st.isDirectory()
  } catch {
    return false
  }
})

ipcMain.handle(
  'thumb:request',
  async (_e, entry: ModelEntry, px: number, priority: number) => {
    const s = getSettings()
    return await requestThumb(entry, px, priority, s.blendAutoConvert, s.blenderPath)
  }
)

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

ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
  const next = saveSettings(patch)
  if (patch.concurrency !== undefined) {
    createWorkers(Math.max(1, Math.min(6, next.concurrency)))
  }
  return next
})

ipcMain.handle('settings:recent', () => getRecentFolders())

/**
 * 支持 3D资源预览器.exe --folder="D:\素材" 直接打开某个目录。
 * 用渲染进程主动来取而不是主进程推送 —— did-finish-load 早于 React 挂载，
 * 推送过去时还没人监听，事件就丢了。
 */
ipcMain.handle('app:initialFolder', () => {
  const arg = process.argv.find((a) => a.startsWith('--folder='))
  if (!arg) return null
  return arg.slice('--folder='.length).replace(/^"|"$/g, '')
})

ipcMain.handle('blender:info', async () => {
  const s = getSettings()
  return await getBlenderInfo(s.blenderPath)
})

ipcMain.handle('blender:redetect', async () => {
  const s = getSettings()
  await detectBlender(s.blenderPath)
  return await getBlenderInfo(s.blenderPath)
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

/**
 * 把选中的模型批量导出到一个目录。
 * .blend 会先转成 GLB（复用已有的批量转换），其它格式直接复制。
 */
ipcMain.handle('export:batch', async (_e, entries: ModelEntry[]) => {
  if (!mainWindow) return { ok: false, error: '窗口不存在' }
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出到哪个文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  if (r.canceled || r.filePaths.length === 0) return { ok: false }

  const destDir = r.filePaths[0]
  const s = getSettings()
  let done = 0
  const failed: string[] = []

  for (const entry of entries) {
    try {
      const resolved = await resolveViewableUrl(entry, s.blenderPath)
      if (!resolved.path) {
        failed.push(`${entry.name}: ${resolved.error ?? '无法解析'}`)
        continue
      }
      const ext = entry.ext === '.blend' ? '.glb' : entry.ext
      let dest = path.join(destDir, `${entry.name}${ext}`)
      // 同名不覆盖，自动加序号
      let n = 1
      while (fs.existsSync(dest)) {
        dest = path.join(destDir, `${entry.name}_${n++}${ext}`)
      }
      await fsp.copyFile(resolved.path, dest)
      done++
      mainWindow?.webContents.send('export:progress', {
        done,
        total: entries.length,
        name: entry.name
      })
    } catch (err) {
      failed.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { ok: true, dir: destDir, done, total: entries.length, failed }
})

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
      const p = path.join(
        cacheDir(),
        'thumbs',
        payload.thumbKey.slice(0, 2),
        `${payload.thumbKey}.png`
      )
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) icon = img.resize({ width: 96, height: 96 })
    }
    if (!icon || icon.isEmpty()) icon = getFallbackDragIcon()

    try {
      // 类型上 file 是必填的，多选时 files 才是真正生效的那个字段
      e.sender.startDrag({ file: files[0], files, icon })
    } catch (err) {
      console.error('startDrag 失败:', err)
    }
  }
)

ipcMain.handle('app:decoderUrl', (_e, sub: string) => decoderUrl(sub))

/** 用检测到的 Blender 打开文件：.blend 直接打开，其它格式交给 Blender 的导入器 */
ipcMain.handle('blender:open', async (_e, filePath: string) => {
  const s = getSettings()
  const install = await pickBlenderFor(filePath, s.blenderPath)
  if (!install) return { ok: false, error: '未检测到 Blender 安装' }
  try {
    // detached + unref：让 Blender 独立活着，关掉预览器不会把它一起带走
    const child = spawn(install.exe, [filePath], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

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

/** 把 .blend 转出来的 GLB 另存一份 */
ipcMain.handle('export:glb', async (_e, entry: ModelEntry) => {
  if (!mainWindow) return null
  const s = getSettings()
  const resolved = await resolveViewableUrl(entry, s.blenderPath)
  if (!resolved.url) return { ok: false, error: resolved.error }

  const r = await dialog.showSaveDialog(mainWindow, {
    title: '导出 GLB',
    defaultPath: `${entry.name}.glb`,
    filters: [{ name: 'glTF 二进制', extensions: ['glb'] }]
  })
  if (r.canceled || !r.filePath) return { ok: false }

  await fsp.copyFile(resolved.path, r.filePath)
  return { ok: true, path: r.filePath }
})
