import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from './cache'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'
import { readJsonRecover, writeJsonAtomic } from './jsonStore'

let current: AppSettings | null = null

function file(): string {
  return path.join(cacheDir(), 'settings.json')
}

const THUMB_SIZES = new Set([256, 512, 768, 1024])
const LIGHTINGS = new Set(['studio', 'outdoor', 'neutral'])
const BACKGROUNDS = new Set(['transparent', 'dark', 'light', 'white'])
const ANGLES = new Set(['iso', 'iso-left', 'front', 'top', 'side'])
const SHADINGS = new Set(['material', 'clay', 'matcap'])
const SORT_KEYS = new Set(['name', 'size', 'date', 'ext', 'tris', 'rating'])

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function oneOf<T extends string>(v: unknown, set: Set<string>, fallback: T): T {
  return set.has(String(v)) ? (v as T) : fallback
}

/**
 * 把外来的设置对象（磁盘上的旧文件、渲染进程传来的 patch）清洗成合法值。
 * 手改 settings.json 写个 concurrency: 99 不该把机器拖死。
 */
export function sanitizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const thumbSize = clampInt(r['thumbSize'], 128, 2048, d.thumbSize)
  const pinned = Array.isArray(r['pinnedFolders'])
    ? [...new Set((r['pinnedFolders'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
    : d.pinnedFolders
  return {
    thumbSize: THUMB_SIZES.has(thumbSize) ? thumbSize : d.thumbSize,
    concurrency: clampInt(r['concurrency'], 1, 6, d.concurrency),
    recursive: bool(r['recursive'], d.recursive),
    maxDepth: clampInt(r['maxDepth'], 1, 32, d.maxDepth),
    blenderPath:
      typeof r['blenderPath'] === 'string' && r['blenderPath'].trim()
        ? r['blenderPath'].trim()
        : null,
    blendAutoConvert: bool(r['blendAutoConvert'], d.blendAutoConvert),
    background: oneOf(r['background'], BACKGROUNDS, d.background),
    lighting: oneOf(r['lighting'], LIGHTINGS, d.lighting),
    thumbAngle: oneOf(r['thumbAngle'], ANGLES, d.thumbAngle),
    thumbShading: oneOf(r['thumbShading'], SHADINGS, d.thumbShading),
    sidebarVisible: bool(r['sidebarVisible'], d.sidebarVisible),
    showUnsupported: bool(r['showUnsupported'], d.showUnsupported),
    cacheLimitMB: clampInt(r['cacheLimitMB'], 0, 1024 * 1024, d.cacheLimitMB),
    disableGpu: bool(r['disableGpu'], d.disableGpu),
    reopenLast: bool(r['reopenLast'], d.reopenLast),
    lastFolder: typeof r['lastFolder'] === 'string' && r['lastFolder'].trim() ? r['lastFolder'] : null,
    pinnedFolders: pinned.slice(0, 50),
    cardSize: clampInt(r['cardSize'], 110, 360, d.cardSize),
    sortKey: oneOf(r['sortKey'], SORT_KEYS, d.sortKey),
    sortDir: r['sortDir'] === 'desc' ? 'desc' : 'asc',
    viewMode: r['viewMode'] === 'list' ? 'list' : 'grid',
    theme: r['theme'] === 'dark' ? 'dark' : 'light'
  }
}

export function getSettings(): AppSettings {
  if (current) return current
  let loaded: AppSettings
  try {
    loaded = sanitizeSettings(readJsonRecover(file(), () => ({})))
  } catch {
    loaded = { ...DEFAULT_SETTINGS }
  }
  current = loaded
  return loaded
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitizeSettings({ ...getSettings(), ...patch })
  try {
    writeJsonAtomic(file(), next)
  } catch (err) {
    throw new Error(`设置未能保存：${err instanceof Error ? err.message : String(err)}`)
  }
  current = next
  return next
}

/** 最近打开过的文件夹，方便下次一键回到上次的素材库 */
export function getRecentFolders(): string[] {
  try {
    const list = readJsonRecover<unknown>(path.join(cacheDir(), 'recent.json'), () => [])
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]): void {
  try {
    writeJsonAtomic(path.join(cacheDir(), 'recent.json'), list)
  } catch {
    /* 忽略 */
  }
}

export function pushRecentFolder(dir: string): string[] {
  const list = getRecentFolders().filter((d) => d.toLowerCase() !== dir.toLowerCase())
  list.unshift(dir)
  const trimmed = list.slice(0, 12)
  writeRecent(trimmed)
  return trimmed
}

export function removeRecentFolder(dir: string): string[] {
  const list = getRecentFolders().filter((d) => d.toLowerCase() !== dir.toLowerCase())
  writeRecent(list)
  return list
}
