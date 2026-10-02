import fs from 'node:fs'
import path from 'node:path'
import { TEXTURE_EXTS, extOf } from '../shared/formats'

/**
 * asset3d:// 协议的路径策略。故意不依赖 electron：
 * 越权判断、URL 编解码、贴图兜底都是纯逻辑，单测和验收脚本都能直接用。
 */

export const SCHEME = 'asset3d'

function norm(p: string): string {
  return path.resolve(p).toLowerCase()
}

/**
 * target 是否位于 root 之内（含 root 本身）。
 * 用 path.relative 而不是字符串前缀拼接：盘符根目录 "E:\" 拼上分隔符
 * 会变成两个反斜杠，永远匹配不上 —— 这是 1.0 的一个真实 bug，
 * 表现为打开 U 盘根目录时所有文件 403。
 */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

export function isRealWithin(root: string, target: string): boolean {
  try { return isWithin(fs.realpathSync(root), fs.realpathSync(target)) } catch { return false }
}

export class AccessPolicy {
  private roots = new Set<string>()

  constructor(private readonly extraRoots: () => string[] = () => []) {}

  allow(dir: string): void {
    this.roots.add(norm(dir))
  }

  isAllowed(target: string): boolean {
    const allowed = (r: string): boolean => isWithin(r, target) && (!fs.existsSync(target) || isRealWithin(r, target))
    for (const r of this.extraRoots()) if (allowed(r)) return true
    for (const r of this.roots) if (allowed(r)) return true
    return false
  }

  list(): string[] {
    return [...this.roots]
  }
}

/**
 * 把绝对路径编成 URL，逐段 encodeURIComponent：
 *   E:\Desktop\8月\Barrel.gltf   -> asset3d://local/E%3A/Desktop/8%E6%9C%88/Barrel.gltf
 *   \\nas\share\Barrel.gltf      -> asset3d://local/UNC/nas/share/Barrel.gltf
 *
 * three.js 的 LoaderUtils 按字符串拼接解析相对路径，"Barrel.bin" 和
 * "textures/ColorAtlas.png" 会自然拼成同目录/子目录的正确 URL。
 * UNC 的前导双反斜杠必须显式保留成 UNC 段，否则解回来就成了相对路径。
 */
export function pathToAssetUrl(abs: string): string {
  const fwd = abs.replace(/\\/g, '/')
  const unc = fwd.startsWith('//')
  const segs = fwd.split('/').filter(Boolean).map(encodeURIComponent)
  if (unc) segs.unshift('UNC')
  return `${SCHEME}://local/${segs.join('/')}`
}

export function decodeSegments(pathname: string): string {
  return pathname
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .join('/')
}

/** pathToAssetUrl 的逆运算，输入是 host 之后的部分（可能仍是编码状态） */
export function assetPathFromUrlRest(rest: string): string {
  const decoded = decodeSegments(rest)
  if (/^UNC\//i.test(decoded)) {
    return '\\\\' + decoded.slice(4).replace(/\//g, '\\')
  }
  return path.normalize(decoded)
}

export function thumbUrl(key: string): string {
  return `${SCHEME}://thumb/${key}.png`
}

export function decoderUrl(sub: string): string {
  return `${SCHEME}://decoder/${sub}`
}

/** 解析一个 asset3d:// URL，返回 host 与剩余部分（去掉 ?query 和 #hash） */
export function splitAssetUrl(url: string): { host: string; rest: string } | null {
  const raw = url.split('#')[0].split('?')[0]
  const m = /^asset3d:\/\/([^/]+)\/(.*)$/i.exec(raw)
  if (!m) return null
  return { host: m[1].toLowerCase(), rest: m[2] }
}

/** 贴图常见的存放子目录 */
const TEXTURE_SUBDIRS = [
  '',
  'textures',
  'Textures',
  'texture',
  'Texture',
  'tex',
  'maps',
  'Maps',
  'materials',
  'Materials',
  'images',
  'Images'
]

export function isTexturePath(p: string): boolean {
  return TEXTURE_EXTS.has(extOf(p))
}

/**
 * 贴图找不到时的兜底查找。
 *
 * 现实中的 FBX 经常引用一个根本不存在的路径 —— 比如 "Barrel.fbm/ColorAtlas.png"
 * （FBX 提取内嵌媒体用的 .fbm 目录，导出后往往不会一起带上），而真正的
 * ColorAtlas.png 就平铺在 fbx 旁边。不兜底的话贴图 404，材质带着空贴图渲染成全黑。
 *
 * 策略：从请求路径逐级往上找同名文件，每级再试几个常见贴图子目录，
 * 一旦走出允许的根目录就停手。结果按请求路径记忆（cache 由调用方持有，
 * 每次重新扫描时清掉，否则后补的贴图要重启才生效）。
 */
export function resolveTextureFallback(
  requested: string,
  isAllowed: (p: string) => boolean,
  cache: Map<string, string | null>,
  fileExists: (p: string) => boolean = defaultFileExists
): string | null {
  const ck = requested.toLowerCase()
  const cached = cache.get(ck)
  if (cached !== undefined) return cached

  const base = path.basename(requested)
  let dir = path.dirname(requested)
  let found: string | null = null

  for (let level = 0; level < 6 && dir; level++) {
    for (const sub of TEXTURE_SUBDIRS) {
      const candidate = path.join(dir, sub, base)
      if (candidate === requested) continue
      if (fileExists(candidate) && isAllowed(candidate)) {
        found = candidate
        break
      }
    }
    if (found) break

    const parent = path.dirname(dir)
    if (parent === dir) break
    if (!isAllowed(parent)) break
    dir = parent
  }

  cache.set(ck, found)
  return found
}

function defaultFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
