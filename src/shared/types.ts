export type ThumbState =
  | 'pending' // 排队中
  | 'rendering' // 正在出图
  | 'ready' // 已有完整渲染缩略图
  | 'embedded' // .blend 内嵌预览图（静态，未转 GLB）
  | 'failed' // 出图失败
  | 'unsupported' // 格式不支持

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
  /** .blend 需要 Blender 转换才能交互 */
  needsBlender: boolean
}

export interface ScanOptions {
  recursive: boolean
  maxDepth: number
}

export interface ScanResult {
  root: string
  entries: ModelEntry[]
  /** 被识别为伴生文件而隐藏的数量，用于 UI 提示 */
  hiddenCount: number
  scannedFiles: number
  elapsedMs: number
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

export interface AppSettings {
  thumbSize: number
  concurrency: number
  recursive: boolean
  maxDepth: number
  /** 用户手动指定的 blender.exe 路径，优先于自动探测 */
  blenderPath: string | null
  /** 是否允许后台调用 Blender 把 .blend 转成 GLB */
  blendAutoConvert: boolean
  background: string
  lighting: 'studio' | 'outdoor' | 'neutral'
}

export const DEFAULT_SETTINGS: AppSettings = {
  thumbSize: 512,
  concurrency: 3,
  recursive: true,
  maxDepth: 8,
  blenderPath: null,
  blendAutoConvert: true,
  background: 'transparent',
  lighting: 'studio'
}

/** 收藏与标签库。路径统一小写化后作为键（Windows 路径不区分大小写） */
export interface LibraryPayload {
  favorites: string[]
  tags: Record<string, string[]>
  /** 库里出现过的全部标签，供筛选下拉用 */
  allTags: string[]
}
