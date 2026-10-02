import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from './cache'
import { clampRating, isColorLabel } from '../shared/labels'
import type { LibraryPayload } from '../shared/types'
import { readJsonRecover, writeJsonAtomic } from './jsonStore'

/**
 * 收藏、标签、评分、颜色标签。
 *
 * 按绝对路径存，不按缓存 key —— 缓存 key 含 mtime，
 * 文件一改动收藏就没了，那显然不是用户想要的。
 * Windows 路径不区分大小写，统一小写化再当键。
 */
export interface LibraryData {
  favorites: string[]
  /** 路径 -> 标签数组 */
  tags: Record<string, string[]>
  /** 路径 -> 1–5 */
  ratings: Record<string, number>
  /** 路径 -> 颜色标签 key */
  colors: Record<string, string>
}

let cached: LibraryData | null = null
let fileOverride: string | null = null

/** 单测用：把库文件指到临时位置 */
export function setLibraryFile(p: string | null): void {
  fileOverride = p
  cached = null
}

function file(): string {
  return fileOverride ?? path.join(cacheDir(), 'library.json')
}

export function normalizeLibKey(p: string): string {
  return path.resolve(p).toLowerCase()
}

function cleanRecord<T>(raw: unknown, ok: (v: unknown) => v is T): Record<string, T> {
  const out: Record<string, T> = Object.create(null)
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (ok(v)) out[k] = v
  }
  return out
}

export function getLibrary(): LibraryData {
  if (cached) return cached
  try {
    const raw = readJsonRecover<Partial<LibraryData>>(file(), () => ({}))
    cached = {
      favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x) => typeof x === 'string') : [],
      tags: cleanRecord(raw.tags, (v): v is string[] => Array.isArray(v) && v.every(t => typeof t === 'string')),
      ratings: cleanRecord(raw.ratings, (v): v is number => typeof v === 'number' && v >= 1 && v <= 5),
      colors: cleanRecord(raw.colors, (v): v is string => isColorLabel(v))
    }
  } catch {
    cached = { favorites: [], tags: {}, ratings: {}, colors: {} }
  }
  return cached
}

function persist(): void {
  if (!cached) return
  try {
    writeJsonAtomic(file(), cached)
  } catch (err) {
    cached = null
    throw new Error(`资源库未能保存，请检查数据目录权限和剩余空间：${err instanceof Error ? err.message : String(err)}`)
  }
}

export function libraryPayload(): LibraryPayload {
  const lib = getLibrary()
  return {
    favorites: lib.favorites,
    tags: lib.tags,
    ratings: lib.ratings,
    colors: lib.colors,
    allTags: allTags()
  }
}

/** 导入资源库备份时合并有效记录；现有数据由原子保存保留上一版本。 */
export function mergeLibraryBackup(value: unknown): LibraryPayload {
  if (!value || typeof value !== 'object') throw new Error('备份文件不是有效的资源库')
  const raw = value as Partial<LibraryData>
  if (!Array.isArray(raw.favorites) || !raw.tags || typeof raw.tags !== 'object') throw new Error('备份缺少收藏或标签数据')
  const next = getLibrary()
  next.favorites = [...new Set([...next.favorites, ...raw.favorites.filter((v): v is string => typeof v === 'string' && path.isAbsolute(v)).map(normalizeLibKey)])]
  for (const [target, source] of [
    [next.tags, cleanRecord(raw.tags, (v): v is string[] => Array.isArray(v) && v.every(t => typeof t === 'string'))],
    [next.ratings, cleanRecord(raw.ratings, (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)],
    [next.colors, cleanRecord(raw.colors, (v): v is string => isColorLabel(v))]
  ] as [Record<string, unknown>, Record<string, unknown>][]) {
    for (const [p, data] of Object.entries(source)) if (path.isAbsolute(p)) target[normalizeLibKey(p)] = data
  }
  persist()
  return libraryPayload()
}

export function toggleFavorite(filePath: string): boolean {
  const lib = getLibrary()
  const key = normalizeLibKey(filePath)
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
    if (value) set.add(normalizeLibKey(p))
    else set.delete(normalizeLibKey(p))
  }
  lib.favorites = [...set]
  persist()
}

export function setTags(filePath: string, tags: string[]): void {
  const lib = getLibrary()
  const key = normalizeLibKey(filePath)
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
    const key = normalizeLibKey(p)
    const cur = new Set(lib.tags[key] ?? [])
    cur.add(t)
    lib.tags[key] = [...cur]
  }
  persist()
}

export function removeTagFrom(paths: string[], tag: string): void {
  const lib = getLibrary()
  for (const p of paths) {
    const key = normalizeLibKey(p)
    const cur = (lib.tags[key] ?? []).filter((x) => x !== tag)
    if (cur.length === 0) delete lib.tags[key]
    else lib.tags[key] = cur
  }
  persist()
}

/** 评分 1–5；0 清除 */
export function setRating(paths: string[], rating: number): void {
  const lib = getLibrary()
  const r = clampRating(rating)
  for (const p of paths) {
    const key = normalizeLibKey(p)
    if (r === 0) delete lib.ratings[key]
    else lib.ratings[key] = r
  }
  persist()
}

/** 颜色标签；null 清除 */
export function setColor(paths: string[], color: string | null): void {
  const lib = getLibrary()
  for (const p of paths) {
    const key = normalizeLibKey(p)
    if (!color || !isColorLabel(color)) delete lib.colors[key]
    else lib.colors[key] = color
  }
  persist()
}

/**
 * 文件改名 / 移动后把收藏、标签、评分、颜色一起搬到新路径，
 * 否则用户一改名就"丢"了收藏。
 */
export function rekey(oldPath: string, newPath: string): void {
  const lib = getLibrary()
  const from = normalizeLibKey(oldPath)
  const to = normalizeLibKey(newPath)
  if (from === to) return
  const fi = lib.favorites.indexOf(from)
  if (fi >= 0) {
    lib.favorites.splice(fi, 1)
    if (!lib.favorites.includes(to)) lib.favorites.push(to)
  }
  for (const rec of [lib.tags, lib.ratings, lib.colors] as Record<string, unknown>[]) {
    if (from in rec) {
      rec[to] = rec[from]
      delete rec[from]
    }
  }
  persist()
}

/** 删除文件后清掉它的记录 */
export function forget(paths: string[]): void {
  const lib = getLibrary()
  const set = new Set(paths.map(normalizeLibKey))
  lib.favorites = lib.favorites.filter((f) => !set.has(f))
  for (const rec of [lib.tags, lib.ratings, lib.colors] as Record<string, unknown>[]) {
    for (const k of set) delete rec[k]
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
