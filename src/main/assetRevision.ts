import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { checkDependencies } from './dependencies'
import { TEXTURE_EXTS } from '../shared/formats'
import type { ModelEntry } from '../shared/types'

const snapshots = new Map<string, string>()
const candidates = new Map<string, { at: number; files: string[] }>()
const resourceDirs = /^(textures?|maps?|materials?|images?|tex|.*\.fbm)$/i
const signature = (s: { size: number; mtimeMs: number; ctimeMs: number }): string => `${s.size}|${s.mtimeMs}|${s.ctimeMs}`
const normalized = (p: string): string => path.resolve(p).toLowerCase()

export function clearAssetRevisions(): void { candidates.clear() }

export async function rememberAssetFile(file: string): Promise<string> {
  try {
    const s = await fsp.stat(file)
    const value = signature(s)
    snapshots.set(normalized(file), value)
    return value
  } catch { return 'missing' }
}

export async function assetFileChanged(file: string, watchStarted = 0): Promise<boolean> {
  const key = normalized(file)
  const previous = snapshots.get(key)
  const current = await rememberAssetFile(file)
  // 访问时间变化不影响签名，避免出图本身触发变动提示。
  let changed = previous !== current
  if (previous === undefined && watchStarted && current !== 'missing') {
    // 未读取过的老文件/目录首次触发访问事件时不提示；新修改仍按 mtime 判断。
    try { changed = (await fsp.stat(file)).mtimeMs >= watchStarted } catch { changed = true }
  }
  if (changed) clearAssetRevisions()
  return changed
}

async function siblingResources(dir: string): Promise<string[]> {
  const old = candidates.get(dir)
  if (old && Date.now() - old.at < 1500) return old.files
  const files: string[] = []
  async function walk(folder: string, depth: number): Promise<void> {
    if (depth > 8) return
    let items
    try { items = await fsp.readdir(folder, { withFileTypes: true }) } catch { return }
    for (const item of items) {
      const p = path.join(folder, item.name)
      if (item.isDirectory() && (depth > 0 || resourceDirs.test(item.name))) await walk(p, depth + 1)
      else if (item.isFile() && (TEXTURE_EXTS.has(path.extname(p).toLowerCase()) || /\.(mtl|bin)$/i.test(p))) files.push(p)
    }
  }
  await walk(dir, 0)
  candidates.set(dir, { at: Date.now(), files })
  return files
}

/** 源文件位置和内容版本、外部依赖共同决定缓存，避免同名素材串图。 */
export async function prepareAsset(entry: ModelEntry): Promise<ModelEntry> {
  const stat = await fsp.stat(entry.path)
  const dir = path.dirname(entry.path)
  const deps = await checkDependencies(entry.path)
  const resources = new Set(deps.required.map(r => path.resolve(dir, r)))
  // FBX 等格式把贴图引用藏在二进制里；同时纳入常见资源目录与贴图兜底候选。
  if (!['.glb', '.stl', '.ply', '.drc', '.bvh'].includes(entry.ext)) {
    for (const p of await siblingResources(dir)) resources.add(p)
  }
  const hash = createHash('sha256').update(normalized(entry.path)).update(signature(stat))
  snapshots.set(normalized(entry.path), signature(stat))
  for (const resource of [...resources].sort()) {
    hash.update(normalized(resource)).update(await rememberAssetFile(resource))
  }
  return { ...entry, size: stat.size, mtimeMs: stat.mtimeMs, cacheRevision: hash.digest('hex') }
}
