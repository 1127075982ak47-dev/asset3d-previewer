import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  BlenderInfo,
  ModelEntry,
  ScanOptions,
  ScanResult,
  LibraryPayload,
  ThumbResult
} from '../shared/types'

/** 白名单 API，渲染进程拿不到任何裸的 Node 能力 */
const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),

  /** Electron 32+ 已移除 File.path，拖拽取路径必须走 webUtils */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  validateFolder: (root: string): Promise<boolean> =>
    ipcRenderer.invoke('scan:validateFolder', root),

  scanFolder: (root: string, opts: ScanOptions): Promise<ScanResult> =>
    ipcRenderer.invoke('scan:folder', root, opts),

  requestThumb: (entry: ModelEntry, px: number, priority: number): Promise<ThumbResult> =>
    ipcRenderer.invoke('thumb:request', entry, px, priority),

  cancelPendingThumbs: (): Promise<boolean> => ipcRenderer.invoke('thumb:cancelPending'),

  viewableUrl: (
    entry: ModelEntry
  ): Promise<{ url: string; path: string; converted: boolean; error?: string }> =>
    ipcRenderer.invoke('model:viewableUrl', entry),

  dependencies: (
    filePath: string
  ): Promise<{ missing: string[]; required: string[] }> =>
    ipcRenderer.invoke('model:dependencies', filePath),

  showItem: (p: string): Promise<boolean> => ipcRenderer.invoke('shell:showItem', p),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', patch),
  recentFolders: (): Promise<string[]> => ipcRenderer.invoke('settings:recent'),

  blenderInfo: (): Promise<BlenderInfo> => ipcRenderer.invoke('blender:info'),
  blenderRedetect: (): Promise<BlenderInfo> => ipcRenderer.invoke('blender:redetect'),

  /* ---- 收藏与标签 ---- */
  library: (): Promise<LibraryPayload> => ipcRenderer.invoke('library:get'),
  toggleFavorite: (p: string): Promise<boolean> =>
    ipcRenderer.invoke('library:toggleFavorite', p),
  setFavorites: (paths: string[], value: boolean): Promise<string[]> =>
    ipcRenderer.invoke('library:setFavorites', paths, value),
  addTag: (paths: string[], tag: string): Promise<LibraryPayload> =>
    ipcRenderer.invoke('library:addTag', paths, tag),
  removeTag: (paths: string[], tag: string): Promise<LibraryPayload> =>
    ipcRenderer.invoke('library:removeTag', paths, tag),
  setTags: (p: string, tags: string[]): Promise<LibraryPayload> =>
    ipcRenderer.invoke('library:setTags', p, tags),

  /* ---- 批量导出 ---- */
  exportBatch: (
    entries: ModelEntry[]
  ): Promise<{
    ok: boolean
    dir?: string
    done?: number
    total?: number
    failed?: string[]
    error?: string
  }> => ipcRenderer.invoke('export:batch', entries),
  exportContactSheet: (dataUrl: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('export:contactSheet', dataUrl, name),
  onExportProgress: (
    cb: (p: { done: number; total: number; name: string }) => void
  ): (() => void) => {
    const h = (_e: unknown, p: { done: number; total: number; name: string }): void => cb(p)
    ipcRenderer.on('export:progress', h)
    return () => ipcRenderer.removeListener('export:progress', h)
  },

  cacheInfo: (): Promise<{ dir: string; files: number; bytes: number }> =>
    ipcRenderer.invoke('cache:info'),
  clearCache: (): Promise<boolean> => ipcRenderer.invoke('cache:clear'),

  decoderUrl: (sub: string): Promise<string> => ipcRenderer.invoke('app:decoderUrl', sub),

  /** 用系统默认程序打开 */
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
  /** 用检测到的 Blender 打开（.blend 直接开，其它格式导入） */
  openInBlender: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('blender:open', p),

  exportPng: (name: string, dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('export:png', name, dataUrl),
  exportGlb: (
    entry: ModelEntry
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:glb', entry),

  onThumbProgress: (cb: (r: ThumbResult) => void): (() => void) => {
    const h = (_e: unknown, r: ThumbResult): void => cb(r)
    ipcRenderer.on('thumb:progress', h)
    return () => ipcRenderer.removeListener('thumb:progress', h)
  },

  /** 命令行 --folder=<路径> 指定的目录，没有则返回 null */
  initialFolder: (): Promise<string | null> => ipcRenderer.invoke('app:initialFolder'),

  /**
   * 把文件拖到外部程序。必须用 send 而不是 invoke —— 拖拽要在
   * dragstart 事件内同步发起，await 一圈回来系统就不认了。
   */
  startDrag: (paths: string[], thumbKey?: string | null): void =>
    ipcRenderer.send('drag:start', { paths, thumbKey })
}

/** 离屏 worker 窗口专用通道 */
const workerApi = {
  ready: (): void => ipcRenderer.send('worker:ready'),
  onRender: (
    cb: (job: {
      jobId: number
      url: string
      ext: string
      px: number
      diag?: boolean
      diagMode?: string
    }) => void
  ): void => {
    ipcRenderer.on('worker:render', (_e, job) => cb(job))
  },
  result: (payload: {
    jobId: number
    ok: boolean
    png?: Uint8Array
    error?: string
    stats?: unknown
    diag?: unknown
  }): void => ipcRenderer.send('worker:result', payload)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('workerApi', workerApi)

export type Api = typeof api
export type WorkerApi = typeof workerApi
