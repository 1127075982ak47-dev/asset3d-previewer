import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from './cache'

/**
 * 收藏与标签。
 *
 * 按绝对路径存，不按缓存 key —— 缓存 key 含 mtime，
 * 文件一改动收藏就没了，那显然不是用户想要的。
 * Windows 路径不区分大小写，统一小写化再当键。
 */
export interface LibraryData {
  favorites: string[]
  /** 路径 -> 标签数组 */
  tags: Record<string, string[]>
}

const EMPTY: LibraryData = { favorites: [], tags: {} }

let cached: LibraryData | null = null

function file(): string {
  return path.join(cacheDir(), 'library.json')
}

function normalize(p: string): string {
  return path.resolve(p).toLowerCase()
}

export function getLibrary(): LibraryData {
  if (cached) return cached
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<LibraryData>
    cached = {
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      tags: raw.tags && typeof raw.tags === 'object' ? raw.tags : {}
    }
  } catch {
    cached = { ...EMPTY, favorites: [], tags: {} }
  }
  return cached
}

function persist(): void {
  if (!cached) return
  try {
    fs.writeFileSync(file(), JSON.stringify(cached, null, 2), 'utf8')
  } catch {
    // 只读介质上跑绿色版时写不了，不该因此崩溃
  }
}

export function toggleFavorite(filePath: string): boolean {
  const lib = getLibrary()
  const key = normalize(filePath)
  const i = lib.favorites.indexOf(key)
  let now: boolean
  if (i >= 0) {
    lib.favorites.splice(i, 1)
    now = false
  } else {
    lib.favorites.push(key)
    now = true
  }
  persist()
  return now
}

export function setFavorites(paths: string[], value: boolean): void {
  const lib = getLibrary()
  const set = new Set(lib.favorites)
  for (const p of paths) {
    if (value) set.add(normalize(p))
    else set.delete(normalize(p))
  }
  lib.favorites = [...set]
  persist()
}

export function setTags(filePath: string, tags: string[]): void {
  const lib = getLibrary()
  const key = normalize(filePath)
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  if (clean.length === 0) delete lib.tags[key]
  else lib.tags[key] = clean
  persist()
}

/** 加标签到一批文件（批量打标） */
export function addTagTo(paths: string[], tag: string): void {
  const t = tag.trim()
  if (!t) return
  const lib = getLibrary()
  for (const p of paths) {
    const key = normalize(p)
    const cur = new Set(lib.tags[key] ?? [])
    cur.add(t)
    lib.tags[key] = [...cur]
  }
  persist()
}

export function removeTagFrom(paths: string[], tag: string): void {
  const lib = getLibrary()
  for (const p of paths) {
    const key = normalize(p)
    const cur = (lib.tags[key] ?? []).filter((x) => x !== tag)
    if (cur.length === 0) delete lib.tags[key]
    else lib.tags[key] = cur
  }
  persist()
}

/** 当前库里出现过的所有标签，供筛选下拉用 */
export function allTags(): string[] {
  const lib = getLibrary()
  const set = new Set<string>()
  for (const list of Object.values(lib.tags)) for (const t of list) set.add(t)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
