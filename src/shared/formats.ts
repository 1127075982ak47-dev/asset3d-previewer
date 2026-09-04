/** 主进程与渲染进程共用的格式表 */

/** 能直接在 three.js 里加载几何体的网格格式 */
export const MESH_EXTS = [
  '.glb',
  '.gltf',
  '.fbx',
  '.obj',
  '.stl',
  '.ply',
  '.dae',
  '.3ds',
  '.3mf',
  '.wrl',
  '.vrm'
] as const

/** 需要 Blender 参与的格式 */
export const BLEND_EXTS = ['.blend'] as const

export const MODEL_EXTS: string[] = [...MESH_EXTS, ...BLEND_EXTS]

/**
 * 永远不该单独作为模型卡片出现的伴生文件。
 * .bin 是 glTF 的外部 buffer，.mtl 是 obj 的材质库 —— 用户截图里
 * 35 个模型混着 35 个 .bin，正是这个表要解决的噪音。
 */
export const COMPANION_EXTS = new Set([
  '.bin',
  '.mtl',
  '.gltf-buffer',
  '.blend1',
  '.blend2',
  '.blend3'
])

export const TEXTURE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.tga',
  '.bmp',
  '.tif',
  '.tiff',
  '.webp',
  '.ktx2',
  '.basis',
  '.dds',
  '.exr',
  '.hdr'
])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export function isModelExt(ext: string): boolean {
  return MODEL_EXTS.includes(ext)
}

export function isBlend(ext: string): boolean {
  return ext === '.blend'
}
