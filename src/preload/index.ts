import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppInfo,
  AppSettings,
  BlenderInfo,
  DupeProgress,
  DupeResult,
  ExportBatchResult,
  HdriEntry,
  LibraryPayload,
  MenuAction,
  ModelEntry,
  MoveResult,
  RenameResult,
  ScanOptions,
  ScanProgress,
  ScanResult,
  ThumbRequest,
  ThumbResult,
  TrashResult
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const h = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

/** 白名单 API，渲染进程拿不到任何裸的 Node 能力 */
const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  pickFolder: (title?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder', title),

  /** Electron 32+ 已移除 File.path，拖拽取路径必须走 webUtils */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  validateFolder: (root: string): Promise<boolean> =>
    ipcRenderer.invoke('scan:validateFolder', root),

  scanFolder: (root: string, opts: ScanOptions): Promise<ScanResult> =>
    ipcRenderer.invoke('scan:folder', root, opts),
  cancelScan: (): Promise<boolean> => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => on('scan:progress', cb),

  requestThumb: (entry: ModelEntry, req: ThumbRequest): Promise<ThumbResult> =>
    ipcRenderer.invoke('thumb:request', entry, req),
  setVisibleThumbs: (ids: string[]): Promise<boolean> =>
    ipcRenderer.invoke('thumb:setVisible', ids),
  invalidateThumb: (entry: ModelEntry, req: ThumbRequest): Promise<boolean> =>
    ipcRenderer.invoke('thumb:invalidate', entry, req),
  cancelPendingThumbs: (): Promise<boolean> => ipcRenderer.invoke('thumb:cancelPending'),
  /** 查看器打开时暂停后台出图，别和查看器抢 GPU */
  pauseThumbs: (p: boolean): Promise<boolean> => ipcRenderer.invoke('thumb:pause', p),
  onThumbProgress: (cb: (r: ThumbResult) => void): (() => void) => on('thumb:progress', cb),

  viewableUrl: (
    entry: ModelEntry
  ): Promise<{ url: string; path: string; converted: boolean; error?: string }> =>
    ipcRenderer.invoke('model:viewableUrl', entry),

  dependencies: (filePath: string): Promise<{ missing: string[]; required: string[] }> =>
    ipcRenderer.invoke('model:dependencies', filePath),

  showItem: (p: string): Promise<boolean> => ipcRenderer.invoke('shell:showItem', p),
  /** 用系统默认程序打开 */
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
  /** 用检测到的 Blender 打开（.blend 直接开，其它格式导入） */
  openInBlender: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('blender:open', p),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', patch),
  recentFolders: (): Promise<{ dir: string; exists: boolean }[]> =>
    ipcRenderer.invoke('settings:recent'),
  removeRecent: (dir: string): Promise<string[]> => ipcRenderer.invoke('settings:removeRecent', dir),

  blenderInfo: (): Promise<BlenderInfo> => ipcRenderer.invoke('blender:info'),
  blenderRedetect: (userPath?: string | null): Promise<BlenderInfo> =>
    ipcRenderer.invoke('blender:redetect', userPath),

  /* ---- 收藏与标签 ---- */
  library: (): Promise<LibraryPayload> => ipcRenderer.invoke('library:get'),
  backupLibrary: (): Promise<string | null> => ipcRenderer.invoke('library:backup'),
  restoreLibrary: (): Promise<boolean | null> => ipcRenderer.invoke('library:restore'),
  onLibraryChanged: (cb: (lib: LibraryPayload) => void): (() => void) => on('library:changed', cb),
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
  setRating: (paths: string[], rating: number): Promise<LibraryPayload> =>
    ipcRenderer.invoke('library:setRating', paths, rating),
  setColor: (paths: string[], color: string | null): Promise<LibraryPayload> =>
    ipcRenderer.invoke('library:setColor', paths, color),

  /* ---- 文件操作 ---- */
  renameModel: (entry: ModelEntry, newName: string, root: string, req: ThumbRequest): Promise<RenameResult> =>
    ipcRenderer.invoke('fs:rename', entry, newName, root, req),
  moveModels: (entries: ModelEntry[], destDir: string): Promise<MoveResult> =>
    ipcRenderer.invoke('fs:move', entries, destDir),
  trashModels: (paths: string[]): Promise<TrashResult> => ipcRenderer.invoke('fs:trash', paths),

  /* ---- 重复文件 ---- */
  findDuplicates: (files: { path: string; size: number }[]): Promise<DupeResult> =>
    ipcRenderer.invoke('dupes:find', files),
  cancelDuplicates: (): Promise<boolean> => ipcRenderer.invoke('dupes:cancel'),
  onDupeProgress: (cb: (p: DupeProgress) => void): (() => void) => on('dupes:progress', cb),

  /** 查看器当前视角写成这个模型的缩略图 */
  setCustomThumb: (entry: ModelEntry, req: ThumbRequest, dataUrl: string): Promise<ThumbResult> =>
    ipcRenderer.invoke('thumb:setCustom', entry, req, dataUrl),
  /** 保存任意文本文件（CSV 清单等），弹保存框 */
  exportText: (name: string, content: string, filterName: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke('export:text', name, content, filterName, ext),
  /** 把一串 PNG dataURL 写进选定目录（转盘序列） */
  exportFrames: (
    dirTitle: string,
    baseName: string,
    frames: string[]
  ): Promise<{ ok: boolean; dir?: string; error?: string }> =>
    ipcRenderer.invoke('export:frames', dirTitle, baseName, frames),

  /* ---- 导出 ---- */
  exportBatchTo: (
    entries: ModelEntry[],
    destDir: string,
    opts?: { toGlb?: boolean }
  ): Promise<ExportBatchResult> => ipcRenderer.invoke('export:batchTo', entries, destDir, opts ?? {}),
  exportContactSheet: (dataUrl: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('export:contactSheet', dataUrl, name),
  onExportProgress: (
    cb: (p: { done: number; total: number; name: string }) => void
  ): (() => void) => on('export:progress', cb),
  exportPng: (name: string, dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('export:png', name, dataUrl),
  exportGlb: (entry: ModelEntry): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:glb', entry),

  cacheInfo: (): Promise<{ dir: string; files: number; bytes: number }> =>
    ipcRenderer.invoke('cache:info'),
  clearCache: (): Promise<boolean> => ipcRenderer.invoke('cache:clear'),

  decoderUrl: (sub: string): Promise<string> => ipcRenderer.invoke('app:decoderUrl', sub),

  /** 命令行 / 拖到 exe 上指定的目录，没有则返回 null */
  initialFolder: (): Promise<string | null> => ipcRenderer.invoke('app:initialFolder'),
  /** 第二个实例或菜单"最近打开"要求打开某目录 */
  onOpenFolder: (cb: (dir: string) => void): (() => void) => on('app:openFolder', cb),
  onMenuAction: (cb: (action: MenuAction) => void): (() => void) => on('menu:action', cb),
  onFolderChanged: (cb: (root: string) => void): (() => void) => on('folder:changed', cb),
  onNotice: (cb: (message: string) => void): (() => void) => on('app:notice', cb),

  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  /* ---- HDRI 环境光 ---- */
  hdriList: (): Promise<HdriEntry[]> => ipcRenderer.invoke('hdri:list'),
  hdriImport: (): Promise<HdriEntry[]> => ipcRenderer.invoke('hdri:import'),
  hdriRemove: (id: string): Promise<HdriEntry[]> => ipcRenderer.invoke('hdri:remove', id),
  hdriOpenDir: (): Promise<string> => ipcRenderer.invoke('hdri:openDir'),
  openLogs: (): Promise<string> => ipcRenderer.invoke('app:openLogs'),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:openData'),

  /**
   * 把文件拖到外部程序。必须用 send 而不是 invoke —— 拖拽要在
   * dragstart 事件内同步发起，await 一圈回来系统就不认了。
   */
  startDrag: (paths: string[], thumbKey?: string | null): void =>
    ipcRenderer.send('drag:start', { paths, thumbKey })
}

export interface WorkerJob {
  jobId: number
  kind: 'thumb' | 'export'
  url: string
  ext: string
  px: number
  lighting: AppSettings['lighting']
  background: AppSettings['background']
  angle?: AppSettings['thumbAngle']
  shading?: AppSettings['thumbShading']
  diag?: boolean
}

/** 离屏 worker 窗口专用通道 */
const workerApi = {
  ready: (): void => ipcRenderer.send('worker:ready'),
  contextLost: (): void => ipcRenderer.send('worker:contextlost'),
  onRender: (cb: (job: WorkerJob) => void): void => {
    ipcRenderer.on('worker:render', (_e, job) => cb(job))
  },
  result: (payload: {
    jobId: number
    ok: boolean
    png?: Uint8Array
    glb?: Uint8Array
    error?: string
    stats?: unknown
    diag?: unknown
  }): void => ipcRenderer.send('worker:result', payload)
}

if (process.argv.includes('--asset3d-worker')) {
  contextBridge.exposeInMainWorld('api', { decoderUrl: api.decoderUrl })
  contextBridge.exposeInMainWorld('workerApi', workerApi)
} else {
  contextBridge.exposeInMainWorld('api', api)
}

export type Api = typeof api
export type WorkerApi = typeof workerApi
