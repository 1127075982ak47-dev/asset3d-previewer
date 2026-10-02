import { app, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { cacheDir } from './cache'
import { resolveHdriFile } from './hdri'
import { log } from './log'
import { rememberAssetFile } from './assetRevision'
import {
  AccessPolicy,
  isRealWithin,
  SCHEME,
  assetPathFromUrlRest,
  decodeSegments,
  isTexturePath,
  resolveTextureFallback,
  splitAssetUrl
} from './pathPolicy'

export { SCHEME, pathToAssetUrl, thumbUrl, decoderUrl } from './pathPolicy'

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
        corsEnabled: true
      }
    }
  ])
}

/**
 * 只允许读用户主动打开过的目录，防止一个恶意 .gltf 通过
 * "uri": "../../../../Windows/System32/config/SAM" 把任意系统文件读出来。
 * 缓存目录（Blender 转换出的 GLB 在那里）永远放行。
 */
const policy = new AccessPolicy(() => [cacheDir()])

export function allowRoot(dir: string): void {
  policy.allow(dir)
}

export function isAllowedPath(p: string): boolean {
  return policy.isAllowed(p)
}

/** 解析结果做记忆：一个 35 个模型共用同一张图集的素材包否则要查 35 遍 */
const textureResolveCache = new Map<string, string | null>()

/** 每次重新扫描时清掉，否则用户后补的贴图要重启才生效 */
export function clearTextureCache(): void {
  textureResolveCache.clear()
}

/**
 * 解码器根目录。打包后由 extraResources 放到 resources/decoders；
 * 开发时直接用 three 自带的那份。不能只信 app.getAppPath()，
 * 以构建产物位置为基准逐个试。
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
  cachedDecoderRoot = candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
  return cachedDecoderRoot
}

async function fileResponse(p: string): Promise<Response> {
  await rememberAssetFile(p)
  const response = await net.fetch(pathToFileURL(p).toString())
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, headers })
}

export function registerHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    const parsed = splitAssetUrl(request.url)
    if (!parsed) return new Response('bad request', { status: 400 })
    const { host, rest } = parsed

    try {
      if (host === 'local') {
        const target = assetPathFromUrlRest(rest)
        if (!policy.isAllowed(target)) {
          log.warn('protocol', `拒绝越权读取: ${target}`)
          return new Response('forbidden', { status: 403 })
        }
        if (fs.existsSync(target)) return await fileResponse(target)

        // 只给贴图兜底。缺 .bin 这类必需数据应该老老实实报错，
        // 让用户知道模型确实不完整，而不是悄悄加载出个半成品。
        if (isTexturePath(target)) {
          const alt = resolveTextureFallback(
            target,
            (p) => policy.isAllowed(p),
            textureResolveCache
          )
          if (alt) {
            log.debug('protocol', `贴图兜底 ${path.basename(target)} -> ${alt}`)
            return await fileResponse(alt)
          }
        }
        return new Response('not found', { status: 404 })
      }

      if (host === 'thumb') {
        const key = path.basename(decodeSegments(rest), '.png')
        if (!/^[a-f0-9]{40}$/.test(key)) {
          return new Response('bad key', { status: 400 })
        }
        const p = path.join(cacheDir(), 'thumbs', key.slice(0, 2), `${key}.png`)
        return await fileResponse(p)
      }

      if (host === 'hdri') {
        const [kind, ...restSegs] = decodeSegments(rest).split('/')
        const target = resolveHdriFile(kind, restSegs.join('/'))
        if (!target) return new Response('bad request', { status: 400 })
        return await fileResponse(target)
      }

      if (host === 'decoder') {
        const root = decoderRoot()
        const target = path.normalize(path.join(root, decodeSegments(rest)))
        if (!isRealWithin(root, target)) {
          return new Response('forbidden', { status: 403 })
        }
        return await fileResponse(target)
      }
    } catch (e) {
      log.debug('protocol', `读取失败 ${request.url}`, e)
      return new Response('not found', { status: 404 })
    }

    return new Response('not found', { status: 404 })
  })
}
