import type { Dirent } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { sha1 } from './util'
import {
  COMPANION_EXTS,
  TEXTURE_EXTS,
  extOf,
  isBlend,
  isModelExt
} from '../shared/formats'
import type { ModelEntry, ScanOptions, ScanResult } from '../shared/types'

/** 扫描时直接跳过的目录，省时间也避免噪音 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$RECYCLE.BIN',
  'System Volume Information',
  '__MACOSX'
])

/**
 * 判断一个文件是否是“伴生文件”——它属于某个模型，不该单独占一张卡片。
 *
 * 这是用户截图里那 70 个噪音图标的解药：GLTF 目录下 35 个 .bin 和
 * textures/ColorAtlas.png 全部归到这里，只留 35 个 .gltf 成卡。
 */
function isCompanion(ext: string): boolean {
  return COMPANION_EXTS.has(ext) || TEXTURE_EXTS.has(ext)
}

export async function scanFolder(
  root: string,
  opts: ScanOptions
): Promise<ScanResult> {
  const started = Date.now()
  const entries: ModelEntry[] = []
  let hiddenCount = 0
  let scannedFiles = 0

  // 解析 realpath 做软链环路保护，否则遇到循环软链会无限递归
  const seenDirs = new Set<string>()

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > opts.maxDepth) return

    let real: string
    try {
      real = await fsp.realpath(dir)
    } catch {
      return
    }
    if (seenDirs.has(real)) return
    seenDirs.add(real)

    let items: Dirent[]
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      // 权限不足的目录静默跳过，不要让整次扫描失败
      return
    }

    const subdirs: string[] = []

    for (const it of items) {
      const full = path.join(dir, it.name)

      if (it.isDirectory()) {
        if (!SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) {
          subdirs.push(full)
        }
        continue
      }
      if (!it.isFile()) continue

      scannedFiles++
      const ext = extOf(it.name)

      if (!isModelExt(ext)) {
        if (isCompanion(ext)) hiddenCount++
        continue
      }

      let st: Awaited<ReturnType<typeof fsp.stat>>
      try {
        st = await fsp.stat(full)
      } catch {
        continue
      }

      entries.push({
        id: sha1(full),
        path: full,
        name: it.name.slice(0, it.name.length - ext.length),
        ext,
        dir,
        rel: path.relative(root, full) || it.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        needsBlender: isBlend(ext)
      })
    }

    if (opts.recursive) {
      for (const sd of subdirs) await walk(sd, depth + 1)
    }
  }

  await walk(root, 0)

  // 默认按相对路径自然排序，同目录的模型挨在一起
  entries.sort((a, b) =>
    a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true, sensitivity: 'base' })
  )

  return {
    root,
    entries,
    hiddenCount,
    scannedFiles,
    elapsedMs: Date.now() - started
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
