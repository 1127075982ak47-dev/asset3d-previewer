export type ThumbState =
  | 'pending' // 排队中
  | 'rendering' // 正在出图
  | 'ready' // 已有完整渲染缩略图
  | 'embedded' // .blend 内嵌预览图（静态，未转 GLB）
  | 'failed' // 出图失败
  | 'unsupported' // 格式无法预览（但仍然列出来，可拖出/打开/打标）

export interface ModelEntry {
  /** 绝对路径的 sha1，作为稳定 id */
  id: string
  path: string
  /** 不含扩展名的文件名 */
  name: string
  /** 小写扩展名，含点 */
  ext: string
  /** 所在目录绝对路径 */
  dir: string
  /** 相对于扫描根目录的路径，用于分组显示 */
  rel: string
  size: number
  mtimeMs: number
  /** 主进程计算的源文件与外部资源版本，不信任渲染进程提供的值。 */
  cacheRevision?: string
  /** .blend 需要 Blender 转换才能交互 */
  needsBlender: boolean
  /** false 表示只是识别出来是 3D 文件，本软件无法渲染它 */
  previewable: boolean
}

export interface ScanOptions {
  recursive: boolean
  maxDepth: number
  /** 是否把 .max / .c4d 这类无法预览的格式也列出来 */
  includeUnsupported?: boolean
}

export interface ScanProgress {
  scannedFiles: number
  found: number
  /** 当前正在扫的目录（相对根目录） */
  dir: string
}

export interface ScanResult {
  root: string
  entries: ModelEntry[]
  /** 被识别为伴生文件而隐藏的数量，用于 UI 提示 */
  hiddenCount: number
  scannedFiles: number
  elapsedMs: number
  /** 用户中途取消，entries 是部分结果 */
  cancelled?: boolean
  /** 根目录不存在等错误 */
  error?: string
}

export interface ThumbResult {
  id: string
  state: ThumbState
  /** asset3d://thumb/<key>.png */
  url?: string
  error?: string
  /**
   * 出图时顺便统计的模型信息。
   * 反正 worker 已经把模型完整加载进来了，统计几乎零成本，
   * 缓存下来之后「按面数筛选」「只看带动画的」就不用再解析一遍文件。
   */
  stats?: ModelStats
}

export interface ModelStats {
  vertices: number
  triangles: number
  meshes: number
  materials: number
  textures: number
  animations: string[]
  /** 包围盒尺寸 x/y/z */
  dimensions: [number, number, number]
}

export interface BlenderInfo {
  available: boolean
  /** 已探测到的所有安装，按版本升序 */
  installs: { version: string; major: number; minor: number; exe: string }[]
}

export type LightingPreset = 'studio' | 'outdoor' | 'neutral'
export type ThumbBackground = 'transparent' | 'dark' | 'light' | 'white'
/** 缩略图相机角度预设 */
export type ThumbAngle = 'iso' | 'iso-left' | 'front' | 'top' | 'side'
/** 缩略图着色预设 */
export type ThumbShading = 'material' | 'clay' | 'matcap'

export const THUMB_ANGLES: { key: ThumbAngle; label: string }[] = [
  { key: 'iso', label: '3/4 视角（默认）' },
  { key: 'iso-left', label: '3/4 视角（左）' },
  { key: 'front', label: '正前方' },
  { key: 'side', label: '正侧面' },
  { key: 'top', label: '俯视' }
]

export const THUMB_SHADINGS: { key: ThumbShading; label: string }[] = [
  { key: 'material', label: '材质（默认）' },
  { key: 'clay', label: '白膜' },
  { key: 'matcap', label: '雕塑（Matcap）' }
]

export type SortKey = 'name' | 'size' | 'date' | 'ext' | 'tris' | 'rating'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'grid' | 'list'
export type Theme = 'light' | 'dark'

export interface AppSettings {
  thumbSize: number
  concurrency: number
  recursive: boolean
  maxDepth: number
  /** 用户手动指定的 blender.exe 路径，优先于自动探测 */
  blenderPath: string | null
  /** 是否允许后台调用 Blender 把 .blend 转成 GLB */
  blendAutoConvert: boolean
  /** 缩略图背景 */
  background: ThumbBackground
  /** 缩略图与查看器默认光照 */
  lighting: LightingPreset
  /** 缩略图相机角度 */
  thumbAngle: ThumbAngle
  /** 缩略图着色 */
  thumbShading: ThumbShading
  /** 左侧文件夹树是否显示 */
  sidebarVisible: boolean
  /** 是否列出无法预览的 3D 格式 */
  showUnsupported: boolean
  /** 缓存上限（MB），0 = 不限 */
  cacheLimitMB: number
  /** 关闭 GPU 加速（显卡驱动有问题时的兜底），改动后需重启 */
  disableGpu: boolean
  /** 启动时自动打开上次的文件夹 */
  reopenLast: boolean
  /** 上次打开的文件夹 */
  lastFolder: string | null
  /** 固定在侧栏「资源库」里的文件夹 */
  pinnedFolders: string[]
  /** 记住的界面状态 */
  cardSize: number
  sortKey: SortKey
  sortDir: SortDir
  viewMode: ViewMode
  theme: Theme
}

export const DEFAULT_SETTINGS: AppSettings = {
  thumbSize: 512,
  concurrency: 3,
  recursive: true,
  maxDepth: 8,
  blenderPath: null,
  blendAutoConvert: true,
  background: 'transparent',
  lighting: 'studio',
  thumbAngle: 'iso',
  thumbShading: 'material',
  sidebarVisible: true,
  showUnsupported: true,
  cacheLimitMB: 2048,
  disableGpu: false,
  reopenLast: true,
  lastFolder: null,
  pinnedFolders: [],
  cardSize: 176,
  sortKey: 'name',
  sortDir: 'asc',
  viewMode: 'grid',
  theme: 'light'
}

/** 收藏与标签库。路径统一小写化后作为键（Windows 路径不区分大小写） */
export interface LibraryPayload {
  favorites: string[]
  tags: Record<string, string[]>
  /** 库里出现过的全部标签，供筛选下拉用 */
  allTags: string[]
  /** 评分 1–5，没评分的不出现 */
  ratings: Record<string, number>
  /** 颜色标签（见 labels.ts） */
  colors: Record<string, string>
}

export interface ThumbRequest {
  px: number
  priority: number
  lighting: LightingPreset
  background: ThumbBackground
  angle?: ThumbAngle
  shading?: ThumbShading
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  dataDir: string
  logDir: string | null
  portable: boolean
}

export interface ExportBatchResult {
  ok: boolean
  dir?: string
  done?: number
  total?: number
  failed?: string[]
  error?: string
}

export interface HdriEntry {
  /** builtin/<file> 或 user/<file> */
  id: string
  name: string
  /** asset3d://hdri/... */
  url: string
  builtin: boolean
}

/** 主进程菜单发给渲染进程的动作 */
export type MenuAction =
  | 'open-folder'
  | 'rescan'
  | 'settings'
  | 'zoom-in'
  | 'zoom-out'
  | 'toggle-sidebar'
  | 'toggle-view'
  | 'find-dupes'
  | 'export-csv'
  | 'shortcuts'
  | 'about'

/* ---------------- 文件操作 ---------------- */

export interface RenameResult {
  ok: boolean
  entry?: ModelEntry
  error?: string
  /** 一起改名的伴生文件（.fbm 目录等） */
  companions?: string[]
  /** 搬到新键的缩略图（有缓存时） */
  thumb?: ThumbResult
}

export interface MoveResult {
  ok: boolean
  moved: number
  failed: string[]
  /** 目标目录 */
  dir?: string
}

export interface TrashResult {
  ok: boolean
  done: number
  failed: string[]
  removedPaths: string[]
}

/* ---------------- 重复文件 ---------------- */

export interface DupeGroup {
  size: number
  hash: string
  paths: string[]
}

export interface DupeProgress {
  /** 已算完哈希的文件数 */
  done: number
  /** 需要算哈希的文件数 */
  total: number
}

export interface DupeResult {
  groups: DupeGroup[]
  /** 参与比对的文件数 */
  scanned: number
  cancelled?: boolean
}
