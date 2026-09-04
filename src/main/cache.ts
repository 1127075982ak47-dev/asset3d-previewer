import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { sha1 } from './util'
import type { LightingPreset, ThumbBackground } from '../shared/types'

export { sha1 }

/**
 * 渲染配方版本号。改动出图逻辑（光照/构图/尺寸/贴图解码）时 +1，
 * 让所有旧缓存自动失效，不用手动清缓存。
 *
 * v5：ASCII FBX 缩进修复、TGA/DDS 贴图、空白检测、缓存键去掉绝对路径。
 */
export const RENDER_VERSION = 5

let cacheRoot: string | null = null
let portable = false

function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    // 真正写一个探针文件，仅靠 mkdir 成功判断不了只读介质
    const probe = path.join(dir, '.write-probe')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * 必须在 app ready 之前调用。
 *
 * 绿色版关键：把 userData 整个重定向到 exe 同级的 data/ 目录。
 * 只改自己的缓存目录是不够的 —— Chromium 自己的 Cache、GPUCache、
 * Local Storage 等仍然会写进 %APPDATA%，那就算不上"绿色"了。
 * 改 userData 之后，整个文件夹拷到 U 盘或别的机器，状态完整跟着走。
 *
 * 目录不可写时（只读介质、装在 Program Files 且无权限）自动放弃重定向，
 * 退回系统默认位置，保证程序照常能用。
 */
export function initPortablePaths(): void {
  if (!app.isPackaged) {
    // 以构建产物位置（out/main）为基准回推项目根，而不是用 app.getAppPath()——
    // 后者返回入口脚本所在目录，用不同方式启动会落到不同地方
    const devDir = path.join(__dirname, '..', '..', '.dev-data')
    if (isWritable(devDir)) app.setPath('userData', devDir)
    return
  }
  const portableDir = path.join(path.dirname(process.execPath), 'data')
  if (isWritable(portableDir)) {
    app.setPath('userData', portableDir)
    app.setPath('sessionData', portableDir)
  }
}

export function initCache(): { dir: string; portable: boolean } {
  if (cacheRoot) return { dir: cacheRoot, portable }

  const userData = app.getPath('userData')
  cacheRoot = isWritable(userData) ? userData : app.getPath('temp')
  // 目录落在 exe 同级就说明重定向成功了
  portable = path
    .resolve(cacheRoot)
    .toLowerCase()
    .startsWith(path.dirname(process.execPath).toLowerCase())

  fs.mkdirSync(path.join(cacheRoot, 'thumbs'), { recursive: true })
  fs.mkdirSync(path.join(cacheRoot, 'glb'), { recursive: true })
  return { dir: cacheRoot, portable }
}

export function cacheDir(): string {
  if (!cacheRoot) initCache()
  return cacheRoot!
}

export function isPortable(): boolean {
  if (!cacheRoot) initCache()
  return portable
}

export function logsDir(): string {
  return path.join(cacheDir(), 'logs')
}

export interface FileIdentity {
  path: string
  mtimeMs: number
  size: number
}

/**
 * 文件身份：文件名 + 大小 + 修改时间，不含所在目录。
 *
 * 1.0 把绝对路径也放进键里，结果"绿色版拷到别的机器/换个盘符"缓存就全部失效，
 * 和 README 承诺的可移植性矛盾。去掉路径之后同一个文件的多份副本还能共享一次渲染。
 * 同名同大小同 mtime 却内容不同的文件几乎不存在，就算撞上也只是缩略图张冠李戴。
 */
function identity(f: FileIdentity): string {
  return `${path.basename(f.path).toLowerCase()}|${Math.round(f.mtimeMs)}|${f.size}`
}

/** 缓存键含 mtime+size，源文件一改就自动失效 */
export function thumbKey(
  f: FileIdentity,
  px: number,
  lighting: LightingPreset,
  background: ThumbBackground
): string {
  return sha1(`${identity(f)}|${px}|${lighting}|${background}|v${RENDER_VERSION}`)
}

/** .blend 内嵌预览图用另一个键，和真渲染图分开 */
export function embeddedThumbKey(f: FileIdentity): string {
  return sha1(`${identity(f)}|embedded|v${RENDER_VERSION}`)
}

export function thumbPathFor(key: string): string {
  // 两级分片，避免单目录塞几万个文件拖慢文件系统
  return path.join(cacheDir(), 'thumbs', key.slice(0, 2), `${key}.png`)
}

export async function readThumb(key: string): Promise<string | null> {
  const p = thumbPathFor(key)
  try {
    await fsp.access(p)
    return p
  } catch {
    return null
  }
}

export async function writeThumb(key: string, data: Buffer): Promise<string> {
  const p = thumbPathFor(key)
  await fsp.mkdir(path.dirname(p), { recursive: true })
  // 先写临时文件再 rename，避免进程被杀时留下半张损坏的 PNG
  const tmp = `${p}.${process.pid}.tmp`
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, p)
  return p
}

export async function deleteThumb(key: string): Promise<void> {
  await fsp.rm(thumbPathFor(key), { force: true }).catch(() => {})
  await fsp.rm(metaPathFor(key), { force: true }).catch(() => {})
}

/**
 * 模型统计信息缓存。
 *
 * 和缩略图放同一个 key 下（只是扩展名不同），生命周期天然一致：
 * 源文件一改，缩略图和统计一起失效。
 */
function metaPathFor(key: string): string {
  return path.join(cacheDir(), 'thumbs', key.slice(0, 2), `${key}.json`)
}

export async function readMeta<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(metaPathFor(key), 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeMeta(key: string, data: unknown): Promise<void> {
  const p = metaPathFor(key)
  try {
    await fsp.mkdir(path.dirname(p), { recursive: true })
    await fsp.writeFile(p, JSON.stringify(data), 'utf8')
  } catch {
    /* 统计信息丢了不影响主流程 */
  }
}

/** Blender 转换出的 GLB 缓存路径 */
export function glbCachePath(f: FileIdentity): string {
  const key = sha1(`${identity(f)}|glb-v2`)
  return path.join(cacheDir(), 'glb', `${key}.glb`)
}

export async function clearCache(): Promise<void> {
  const root = cacheDir()
  await fsp.rm(path.join(root, 'thumbs'), { recursive: true, force: true })
  await fsp.rm(path.join(root, 'glb'), { recursive: true, force: true })
  await fsp.mkdir(path.join(root, 'thumbs'), { recursive: true })
  await fsp.mkdir(path.join(root, 'glb'), { recursive: true })
}

export interface CacheFile {
  path: string
  bytes: number
  mtimeMs: number
}

/** 列出缓存里的所有文件（thumbs + glb），供统计与淘汰用 */
export async function listCacheFiles(): Promise<CacheFile[]> {
  const out: CacheFile[] = []
  async function walk(dir: string): Promise<void> {
    let items: fs.Dirent[]
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const p = path.join(dir, it.name)
      if (it.isDirectory()) await walk(p)
      else {
        try {
          const st = await fsp.stat(p)
          out.push({ path: p, bytes: st.size, mtimeMs: st.mtimeMs })
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  await walk(path.join(cacheDir(), 'thumbs'))
  await walk(path.join(cacheDir(), 'glb'))
  return out
}

export async function cacheStats(): Promise<{ files: number; bytes: number }> {
  const files = await listCacheFiles()
  return { files: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) }
}
