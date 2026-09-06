import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { DupeGroup, DupeProgress, DupeResult } from '../shared/types'

/**
 * 重复文件查找。
 *
 * 先按大小分组 —— 大小不同的文件不可能重复，绝大多数文件在这一步就被排除；
 * 只对大小相同的那几组算完整 sha1。几千个模型的库通常只需要哈希几十个文件。
 */
export interface DupeHooks {
  onProgress?: (p: DupeProgress) => void
  isCancelled?: () => boolean
}

async function hashFile(p: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const h = createHash('sha1')
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024 })
    s.on('data', (chunk) => h.update(chunk))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export async function findDuplicates(
  files: { path: string; size: number }[],
  hooks: DupeHooks = {}
): Promise<DupeResult> {
  const bySize = new Map<number, string[]>()
  for (const f of files) {
    if (f.size <= 0) continue
    const list = bySize.get(f.size)
    if (list) list.push(f.path)
    else bySize.set(f.size, [f.path])
  }

  const candidates: { size: number; paths: string[] }[] = []
  for (const [size, paths] of bySize) {
    // 同一路径重复出现（大小写不同）不算
    const uniq = [...new Map(paths.map((p) => [p.toLowerCase(), p])).values()]
    if (uniq.length > 1) candidates.push({ size, paths: uniq })
  }

  const total = candidates.reduce((n, c) => n + c.paths.length, 0)
  let done = 0
  let lastReport = 0
  const report = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastReport < 120) return
    lastReport = now
    hooks.onProgress?.({ done, total })
  }
  report(true)

  const groups: DupeGroup[] = []
  let cancelled = false
  for (const c of candidates) {
    const byHash = new Map<string, string[]>()
    for (const p of c.paths) {
      if (hooks.isCancelled?.()) {
        cancelled = true
        break
      }
      try {
        // 先确认文件还在（用户可能刚删了）
        await fsp.access(p)
        const h = await hashFile(p)
        const list = byHash.get(h)
        if (list) list.push(p)
        else byHash.set(h, [p])
      } catch {
        /* 读不了的跳过 */
      }
      done++
      report()
    }
    if (cancelled) break
    for (const [hash, paths] of byHash) {
      if (paths.length > 1) {
        groups.push({ size: c.size, hash, paths: paths.sort((a, b) => a.localeCompare(b, 'zh-CN')) })
      }
    }
  }
  report(true)
  // 大的重复文件排前面，最值得清理
  groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1))
  return { groups, scanned: files.length, cancelled: cancelled || undefined }
}
