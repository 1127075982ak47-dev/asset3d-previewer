import fsp from 'node:fs/promises'
import { listCacheFiles, type CacheFile } from './cache'
import { log } from './log'

/**
 * 算出为了把缓存压到上限以下需要删哪些文件：最旧的先删。
 * 纯函数，方便单测。protect 里的文件（正在使用的）不删。
 */
export function planEviction(
  files: CacheFile[],
  limitBytes: number,
  protect: Set<string> = new Set()
): CacheFile[] {
  if (limitBytes <= 0) return []
  let total = files.reduce((s, f) => s + f.bytes, 0)
  if (total <= limitBytes) return []

  const candidates = files
    .filter((f) => !protect.has(f.path.toLowerCase()))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)

  const victims: CacheFile[] = []
  for (const f of candidates) {
    if (total <= limitBytes) break
    victims.push(f)
    total -= f.bytes
  }
  return victims
}

/** 真正执行淘汰。返回删掉的文件数与字节数 */
export async function evictCache(
  limitMB: number,
  protect: Set<string> = new Set()
): Promise<{ files: number; bytes: number }> {
  if (limitMB <= 0) return { files: 0, bytes: 0 }
  const files = await listCacheFiles()
  const victims = planEviction(files, limitMB * 1024 * 1024, protect)
  let bytes = 0
  for (const v of victims) {
    try {
      await fsp.rm(v.path, { force: true })
      bytes += v.bytes
    } catch {
      /* 忽略 */
    }
  }
  if (victims.length) {
    log.info('cache', `淘汰 ${victims.length} 个旧缓存文件，释放 ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  }
  return { files: victims.length, bytes }
}
