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
  '.vrm',
  '.usdz',
  '.amf',
  '.pcd',
  '.vtk',
  '.vtp',
  '.drc',
  '.xyz',
  '.lwo',
  '.vox',
  '.kmz',
  '.md2',
  '.pmx',
  '.pmd',
  '.3dm',
  '.gcode',
  '.bvh'
] as const

/** 需要 Blender 参与的格式 */
export const BLEND_EXTS = ['.blend'] as const

export const MODEL_EXTS: string[] = [...MESH_EXTS, ...BLEND_EXTS]

/**
 * 能认出来是 3D 文件、但没有任何开源 JS 库能解析的私有格式。
 * 这些仍然会作为卡片列出来（可拖出、用默认程序打开、收藏打标），
 * 只是缩略图位置显示「不支持预览」。素材目录里混着几个 .max 的情况太常见，
 * 静默隐藏会让用户以为文件丢了。
 */
export const UNSUPPORTED_EXTS = new Set([
  '.max',
  '.ma',
  '.mb',
  '.c4d',
  '.skp',
  '.ztl',
  '.zpr',
  '.abc',
  '.usd',
  '.usda',
  '.usdc',
  '.x',
  '.lws',
  '.step',
  '.stp',
  '.iges',
  '.igs',
  '.dxf',
  '.spp',
  '.sbs',
  '.sbsar',
  '.hip',
  '.hiplc',
  '.uasset',
  '.unitypackage'
])

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
  '.blend3',
  '.fbm',
  '.meta',
  '.import'
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
  '.hdr',
  '.psd',
  '.gif'
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

export function isUnsupportedModelExt(ext: string): boolean {
  return UNSUPPORTED_EXTS.has(ext)
}

export type ExtKind = 'mesh' | 'blend' | 'unsupported' | 'companion' | 'texture' | 'other'

export function classifyExt(ext: string): ExtKind {
  if ((MESH_EXTS as readonly string[]).includes(ext)) return 'mesh'
  if (isBlend(ext)) return 'blend'
  if (UNSUPPORTED_EXTS.has(ext)) return 'unsupported'
  if (COMPANION_EXTS.has(ext)) return 'companion'
  if (TEXTURE_EXTS.has(ext)) return 'texture'
  return 'other'
}
