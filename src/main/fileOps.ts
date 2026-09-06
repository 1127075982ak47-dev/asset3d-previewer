import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { sha1 } from './util'
import { checkDependencies } from './scanner'
import type { ModelEntry } from '../shared/types'

/**
 * 文件操作：重命名 / 移动。
 * 不碰 electron（回收站要 shell.trashItem，放在 index.ts 里），方便单测。
 */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 校验新文件名（不含扩展名）。返回错误文案，合法返回 null */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return '文件名不能为空'
  if (/[\\/:*?"<>|]/.test(n)) return '文件名不能包含 \\ / : * ? " < > |'
  if (/[\x00-\x1f]/.test(n)) return '文件名包含控制字符'
  if (n.endsWith('.') || n.endsWith(' ')) return '文件名不能以点或空格结尾'
  if (RESERVED.test(n)) return `${n} 是 Windows 保留名`
  if (n.length > 200) return '文件名太长'
  return null
}

/**
 * 模型的伴生文件：移动 / 改名时要一起带走，否则贴图和 .bin 就断了。
 *  - .fbx：同名 .fbm 目录（FBX 内嵌媒体解出来的贴图）
 *  - .gltf：buffers / images 引用的相对路径
 *  - .obj：mtllib 与 map_* 引用的贴图
 * 只返回真实存在、且位于模型所在目录之下的路径（绝对路径）。
 */
export async function companionsOf(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const stem = path.basename(filePath, path.extname(filePath))
  const out = new Set<string>()

  if (ext === '.fbx') {
    const fbm = path.join(dir, `${stem}.fbm`)
    if (await isDir(fbm)) out.add(fbm)
  }
  if (ext === '.gltf' || ext === '.obj') {
    const dep = await checkDependencies(filePath)
    for (const r of dep.required) {
      let decoded = r
      try {
        decoded = decodeURIComponent(r)
      } catch {
        /* 保持原样 */
      }
      const abs = path.resolve(dir, decoded)
      const rel = path.relative(dir, abs)
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue
      if (await exists(abs)) out.add(abs)
    }
  }
  return [...out]
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** 跨盘符 rename 会 EXDEV，退回复制 + 删除 */
async function moveAny(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw e
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false })
    await fsp.rm(src, { recursive: true, force: true })
  }
}

/** 把一个 ModelEntry 按新路径重算（id 是路径 sha1，rel 按给定根目录） */
export function relocateEntry(entry: ModelEntry, newPath: string, root: string): ModelEntry {
  const name = path.basename(newPath)
  const ext = path.extname(name).toLowerCase()
  return {
    ...entry,
    id: sha1(newPath),
    path: newPath,
    name: name.slice(0, name.length - ext.length),
    ext,
    dir: path.dirname(newPath),
    rel: path.relative(root, newPath) || name
  }
}

export interface RenameOutcome {
  ok: boolean
  newPath?: string
  companions?: string[]
  error?: string
}

/**
 * 改名（扩展名保持不变）。
 * .fbx 的同名 .fbm 目录跟着改；.gltf / .obj 引用的文件名写在文件内部，改模型名不影响它们。
 */
export async function renameModel(filePath: string, newStem: string): Promise<RenameOutcome> {
  const err = validateName(newStem)
  if (err) return { ok: false, error: err }
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const oldStem = path.basename(filePath, ext)
  const stem = newStem.trim()
  if (stem === oldStem) return { ok: true, newPath: filePath, companions: [] }

  const newPath = path.join(dir, `${stem}${ext}`)
  // 只改大小写也算改名；其它情况目标存在就拒绝
  if (stem.toLowerCase() !== oldStem.toLowerCase() && (await exists(newPath))) {
    return { ok: false, error: `已存在同名文件：${path.basename(newPath)}` }
  }
  try {
    await fsp.rename(filePath, newPath)
  } catch (e) {
    return { ok: false, error: `改名失败：${e instanceof Error ? e.message : String(e)}` }
  }
  const companions: string[] = []
  if (ext.toLowerCase() === '.fbx') {
    const fbm = path.join(dir, `${oldStem}.fbm`)
    const fbmNew = path.join(dir, `${stem}.fbm`)
    if ((await isDir(fbm)) && !(await exists(fbmNew))) {
      try {
        await fsp.rename(fbm, fbmNew)
        companions.push(fbmNew)
      } catch {
        /* 贴图目录改不了名就留着，贴图兜底查找还能找到 */
      }
    }
  }
  return { ok: true, newPath, companions }
}

export interface MoveOutcome {
  moved: { from: string; to: string }[]
  failed: string[]
}

/**
 * 把一批模型（连同伴生文件）移到目标目录。同名不覆盖，直接记为失败。
 * 伴生文件按相对模型的目录结构放置（textures/a.png 仍然在 textures/ 下）。
 */
export async function moveModels(paths: string[], destDir: string): Promise<MoveOutcome> {
  const out: MoveOutcome = { moved: [], failed: [] }
  await fsp.mkdir(destDir, { recursive: true })
  for (const src of paths) {
    const name = path.basename(src)
    const dest = path.join(destDir, name)
    if (path.resolve(path.dirname(src)).toLowerCase() === path.resolve(destDir).toLowerCase()) {
      continue // 已经在目标目录里
    }
    if (await exists(dest)) {
      out.failed.push(`${name}: 目标目录已有同名文件`)
      continue
    }
    try {
      const companions = await companionsOf(src)
      await moveAny(src, dest)
      out.moved.push({ from: src, to: dest })
      const srcDir = path.dirname(src)
      for (const c of companions) {
        const rel = path.relative(srcDir, c)
        const cDest = path.join(destDir, rel)
        if (await exists(cDest)) continue
        try {
          await fsp.mkdir(path.dirname(cDest), { recursive: true })
          await moveAny(c, cDest)
        } catch {
          /* 伴生文件搬不动就留在原地 */
        }
      }
    } catch (e) {
      out.failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

export function fileExistsSync(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}
