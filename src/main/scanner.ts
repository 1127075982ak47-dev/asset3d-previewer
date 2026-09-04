import type { Dirent } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { sha1 } from './util'
import { classifyExt, extOf, isBlend } from '../shared/formats'
import type { ModelEntry, ScanOptions, ScanProgress, ScanResult } from '../shared/types'

/** 扫描时直接跳过的目录，省时间也避免噪音 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$RECYCLE.BIN',
  'System Volume Information',
  '__MACOSX'
])

/** 一次并行 stat 多少个文件。网络盘上串行 stat 是扫描慢的主因 */
const STAT_BATCH = 32

export interface ScanHooks {
  onProgress?: (p: ScanProgress) => void
  isCancelled?: () => boolean
}

export class ScanError extends Error {}

export async function scanFolder(
  root: string,
  opts: ScanOptions,
  hooks: ScanHooks = {}
): Promise<ScanResult> {
  const started = Date.now()

  // 根目录不存在要明确报错，而不是返回一个空结果让用户以为文件夹是空的
  let rootStat
  try {
    rootStat = await fsp.stat(root)
  } catch {
    throw new ScanError(`目录不存在或无法访问：${root}`)
  }
  if (!rootStat.isDirectory()) throw new ScanError(`不是文件夹：${root}`)

  const includeUnsupported = opts.includeUnsupported !== false
  const entries: ModelEntry[] = []
  let hiddenCount = 0
  let scannedFiles = 0
  let cancelled = false
  let lastReport = 0

  const report = (dir: string, force = false): void => {
    if (!hooks.onProgress) return
    const now = Date.now()
    if (!force && now - lastReport < 150) return
    lastReport = now
    hooks.onProgress({ scannedFiles, found: entries.length, dir: path.relative(root, dir) || '.' })
  }

  // 解析 realpath 做软链环路保护，否则遇到循环软链会无限递归
  const seenDirs = new Set<string>()

  async function walk(dir: string, depth: number): Promise<void> {
    if (cancelled) return
    if (depth > opts.maxDepth) return

    let real: string
    try {
      real = await fsp.realpath(dir)
    } catch {
      return
    }
    if (seenDirs.has(real.toLowerCase())) return
    seenDirs.add(real.toLowerCase())

    let items: Dirent[]
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      // 权限不足的目录静默跳过，不要让整次扫描失败
      return
    }

    const subdirs: string[] = []
    const candidates: { full: string; name: string; ext: string }[] = []

    for (const it of items) {
      const full = path.join(dir, it.name)

      if (it.isDirectory()) {
        if (!SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) subdirs.push(full)
        continue
      }

      // 符号链接 / junction：Dirent 里既不是目录也不是文件，得 stat 一下才知道
      if (it.isSymbolicLink()) {
        try {
          const st = await fsp.stat(full)
          if (st.isDirectory()) {
            if (!SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) subdirs.push(full)
            continue
          }
          if (!st.isFile()) continue
        } catch {
          continue
        }
      } else if (!it.isFile()) {
        continue
      }

      scannedFiles++
      const ext = extOf(it.name)
      const kind = classifyExt(ext)

      if (kind === 'mesh' || kind === 'blend') {
        candidates.push({ full, name: it.name, ext })
      } else if (kind === 'unsupported') {
        if (includeUnsupported) candidates.push({ full, name: it.name, ext })
        else hiddenCount++
      } else if (kind === 'companion' || kind === 'texture') {
        hiddenCount++
      }
    }

    // 目录内并行 stat，网络盘上串行是扫描慢的主因
    for (let i = 0; i < candidates.length; i += STAT_BATCH) {
      if (cancelled) return
      const chunk = candidates.slice(i, i + STAT_BATCH)
      const stats = await Promise.all(
        chunk.map((c) => fsp.stat(c.full).catch(() => null))
      )
      chunk.forEach((c, j) => {
        const st = stats[j]
        if (!st) return
        const kind = classifyExt(c.ext)
        entries.push({
          id: sha1(c.full),
          path: c.full,
          name: c.name.slice(0, c.name.length - c.ext.length),
          ext: c.ext,
          dir,
          rel: path.relative(root, c.full) || c.name,
          size: st.size,
          mtimeMs: st.mtimeMs,
          needsBlender: isBlend(c.ext),
          previewable: kind !== 'unsupported'
        })
      })
    }

    report(dir)
    if (hooks.isCancelled?.()) {
      cancelled = true
      return
    }

    if (opts.recursive) {
      for (const sd of subdirs) {
        await walk(sd, depth + 1)
        if (cancelled) return
      }
    }
  }

  await walk(root, 0)
  report(root, true)

  // 默认按相对路径自然排序，同目录的模型挨在一起
  entries.sort((a, b) =>
    a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true, sensitivity: 'base' })
  )

  return {
    root,
    entries,
    hiddenCount,
    scannedFiles,
    elapsedMs: Date.now() - started,
    cancelled: cancelled || undefined
  }
}

/**
 * 检查模型的外部依赖是否齐全。
 * 只在加载失败时按需调用 —— 扫描阶段不做，避免拖慢首屏。
 *
 * 针对 Barrel.gltf 这种引用 "Barrel.bin" + "textures/ColorAtlas.png" 的情况，
 * 能明确告诉用户到底缺了哪个文件，而不是只报一句 "加载失败"。
 */
export async function checkDependencies(
  filePath: string
): Promise<{ missing: string[]; required: string[] }> {
  const ext = extOf(filePath)
  const dir = path.dirname(filePath)
  const required: string[] = []

  try {
    if (ext === '.gltf') {
      const stat = await fsp.stat(filePath)
      // .gltf 正常都是几 KB，超过 64MB 的多半是内嵌 base64，没有外部依赖可查
      if (stat.size > 64 * 1024 * 1024) return { missing: [], required: [] }

      const json = JSON.parse(await fsp.readFile(filePath, 'utf8'))
      for (const b of json.buffers ?? []) {
        if (typeof b.uri === 'string' && !b.uri.startsWith('data:')) required.push(b.uri)
      }
      for (const im of json.images ?? []) {
        if (typeof im.uri === 'string' && !im.uri.startsWith('data:')) required.push(im.uri)
      }
    } else if (ext === '.obj') {
      const text = await fsp.readFile(filePath, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*mtllib\s+(.+)\s*$/i.exec(line)
        if (m) required.push(m[1].trim())
      }
      // 再进一层，把 .mtl 里引用的贴图也算上
      for (const mtl of [...required]) {
        try {
          const mtlText = await fsp.readFile(path.resolve(dir, mtl), 'utf8')
          for (const line of mtlText.split(/\r?\n/)) {
            const m = /^\s*map_\w+\s+(?:.*\s)?([^\s]+)\s*$/i.exec(line)
            if (m) required.push(m[1].trim())
          }
        } catch {
          /* mtl 本身就缺失，上面已经记在 required 里了 */
        }
      }
    }
  } catch {
    return { missing: [], required }
  }

  const missing: string[] = []
  for (const r of required) {
    // glTF 的 uri 是 URI 编码的，磁盘路径要先解码
    let decoded = r
    try {
      decoded = decodeURIComponent(r)
    } catch {
      /* 保持原样 */
    }
    try {
      await fsp.access(path.resolve(dir, decoded))
    } catch {
      missing.push(r)
    }
  }
  return { missing, required }
}
