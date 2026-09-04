import { app, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { cacheDir } from './cache'
import { TEXTURE_EXTS, extOf } from '../shared/formats'

export const SCHEME = 'asset3d'

/**
 * 必须在 app ready 之前注册。
 *
 * standard:true 是关键 —— 它让 Chromium 把这个 scheme 当标准 URL 处理，
 * 相对路径解析才会正常工作；supportFetchAPI 让 three.js 的 FileLoader 能 fetch。
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true
      }
    }
  ])
}

/**
 * 只允许读用户主动打开过的目录，防止一个恶意 .gltf 通过
 * "uri": "../../../../Windows/System32/config/SAM" 把任意系统文件读出来。
 */
const allowedRoots = new Set<string>()

export function allowRoot(dir: string): void {
  allowedRoots.add(path.resolve(dir).toLowerCase())
}

function isAllowed(target: string): boolean {
  const t = path.resolve(target).toLowerCase()
  // 缓存目录里的 GLB（Blender 转换产物）也要能读
  const cache = path.resolve(cacheDir()).toLowerCase()
  if (t.startsWith(cache + path.sep) || t === cache) return true
  for (const root of allowedRoots) {
    if (t === root || t.startsWith(root + path.sep)) return true
  }
  return false
}

/**
 * 把绝对路径编成 URL。逐段 encodeURIComponent：
 *   E:\Desktop\8月\...\Barrel.gltf
 *   -> asset3d://local/E%3A/Desktop/8%E6%9C%88/.../Barrel.gltf
 *
 * 盘符冒号被编码掉，中文目录也安全；而 three.js 的 LoaderUtils
 * 是按字符串拼接解析相对路径的，所以 "Barrel.bin" 和
 * "textures/ColorAtlas.png" 会自然拼成同目录/子目录的正确 URL。
 */
export function pathToAssetUrl(abs: string): string {
  const segs = abs.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent)
  return `${SCHEME}://local/${segs.join('/')}`
}

export function thumbUrl(key: string): string {
  return `${SCHEME}://thumb/${key}.png`
}

export function decoderUrl(sub: string): string {
  return `${SCHEME}://decoder/${sub}`
}

/**
 * 解码器根目录。打包后由 extraResources 放到 resources/decoders；
 * 开发时直接用 three 自带的那份。和导出脚本同理，
 * 不能只信 app.getAppPath()，以构建产物位置为基准逐个试。
 */
let cachedDecoderRoot: string | null = null
function decoderRoot(): string {
  if (cachedDecoderRoot) return cachedDecoderRoot
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'decoders')]
    : [
        path.join(__dirname, '..', '..', 'node_modules', 'three', 'examples', 'jsm', 'libs'),
        path.join(app.getAppPath(), 'node_modules', 'three', 'examples', 'jsm', 'libs'),
        path.join(process.cwd(), 'node_modules', 'three', 'examples', 'jsm', 'libs')
      ]
  cachedDecoderRoot =
    candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
  return cachedDecoderRoot
}

function decodeSegments(pathname: string): string {
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

/** 解析结果做记忆：一个 35 个模型共用同一张图集的素材包否则要查 35 遍 */
const textureResolveCache = new Map<string, string | null>()

/**
 * 贴图找不到时的兜底查找。
 *
 * 现实中的 FBX 经常引用一个根本不存在的路径 —— 比如本机这套素材里
 * Barrel.fbx 写的是 "Barrel.fbm/ColorAtlas.png"（FBX 提取内嵌媒体用的
 * .fbm 目录，导出后往往不会一起带上），而真正的 ColorAtlas.png
 * 就平铺在 fbx 旁边。不兜底的话贴图 404，材质带着一张空贴图渲染成全黑。
 *
 * 策略：从请求路径逐级往上找同名文件，每级再试几个常见贴图子目录，
 * 一旦走出用户打开的根目录就停手。
 */
function resolveTextureFallback(requested: string): string | null {
  const cached = textureResolveCache.get(requested.toLowerCase())
  if (cached !== undefined) return cached

  const base = path.basename(requested)
  let dir = path.dirname(requested)
  let found: string | null = null

  for (let level = 0; level < 6 && dir; level++) {
    for (const sub of TEXTURE_SUBDIRS) {
      const candidate = path.join(dir, sub, base)
      if (candidate === requested) continue
      try {
        if (fs.statSync(candidate).isFile() && isAllowed(candidate)) {
          found = candidate
          break
        }
      } catch {
        /* 试下一个 */
      }
    }
    if (found) break

    const parent = path.dirname(dir)
    if (parent === dir) break
    // 已经爬到用户打开的根目录之外就不要再往上了
    if (!isAllowed(parent)) break
    dir = parent
  }

  textureResolveCache.set(requested.toLowerCase(), found)
  return found
}

export function registerHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    // 不用 new URL 解析：asset3d 在 Node 侧是非特殊 scheme，
    // 按字符串切更可预期
    const raw = request.url.split('#')[0].split('?')[0]
    const m = /^asset3d:\/\/([^/]+)\/(.*)$/i.exec(raw)
    if (!m) return new Response('bad request', { status: 400 })

    const host = m[1].toLowerCase()
    const rest = decodeSegments(m[2])

    try {
      if (host === 'local') {
        const target = path.normalize(rest)
        if (!isAllowed(target)) {
          return new Response('forbidden', { status: 403 })
        }
        if (fs.existsSync(target)) {
          return await net.fetch(pathToFileURL(target).toString())
        }
        // 只给贴图兜底。缺 .bin 这类必需数据应该老老实实报错，
        // 让用户知道模型确实不完整，而不是悄悄加载出个半成品。
        if (TEXTURE_EXTS.has(extOf(target))) {
          const alt = resolveTextureFallback(target)
          if (alt) return await net.fetch(pathToFileURL(alt).toString())
        }
        return new Response('not found', { status: 404 })
      }

      if (host === 'thumb') {
        const key = path.basename(rest, '.png')
        if (!/^[a-f0-9]{40}$/.test(key)) {
          return new Response('bad key', { status: 400 })
        }
        const p = path.join(cacheDir(), 'thumbs', key.slice(0, 2), `${key}.png`)
        return await net.fetch(pathToFileURL(p).toString())
      }

      if (host === 'decoder') {
        const target = path.normalize(path.join(decoderRoot(), rest))
        if (!target.startsWith(decoderRoot())) {
          return new Response('forbidden', { status: 403 })
        }
        return await net.fetch(pathToFileURL(target).toString())
      }
    } catch {
      return new Response('not found', { status: 404 })
    }

    return new Response('not found', { status: 404 })
  })
}
