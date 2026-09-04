import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from './cache'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'

let current: AppSettings | null = null

function file(): string {
  return path.join(cacheDir(), 'settings.json')
}

const THUMB_SIZES = new Set([256, 512, 768, 1024])
const LIGHTINGS = new Set(['studio', 'outdoor', 'neutral'])
const BACKGROUNDS = new Set(['transparent', 'dark', 'light', 'white'])

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * 把外来的设置对象（磁盘上的旧文件、渲染进程传来的 patch）清洗成合法值。
 * 手改 settings.json 写个 concurrency: 99 不该把机器拖死。
 */
export function sanitizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const thumbSize = clampInt(r['thumbSize'], 128, 2048, d.thumbSize)
  return {
    thumbSize: THUMB_SIZES.has(thumbSize) ? thumbSize : d.thumbSize,
    concurrency: clampInt(r['concurrency'], 1, 6, d.concurrency),
    recursive: typeof r['recursive'] === 'boolean' ? r['recursive'] : d.recursive,
    maxDepth: clampInt(r['maxDepth'], 1, 32, d.maxDepth),
    blenderPath:
      typeof r['blenderPath'] === 'string' && r['blenderPath'].trim()
        ? r['blenderPath'].trim()
        : null,
    blendAutoConvert:
      typeof r['blendAutoConvert'] === 'boolean' ? r['blendAutoConvert'] : d.blendAutoConvert,
    background: BACKGROUNDS.has(String(r['background']))
      ? (r['background'] as AppSettings['background'])
      : d.background,
    lighting: LIGHTINGS.has(String(r['lighting']))
      ? (r['lighting'] as AppSettings['lighting'])
      : d.lighting,
    sidebarVisible:
      typeof r['sidebarVisible'] === 'boolean' ? r['sidebarVisible'] : d.sidebarVisible,
    showUnsupported:
      typeof r['showUnsupported'] === 'boolean' ? r['showUnsupported'] : d.showUnsupported,
    cacheLimitMB: clampInt(r['cacheLimitMB'], 0, 1024 * 1024, d.cacheLimitMB),
    disableGpu: typeof r['disableGpu'] === 'boolean' ? r['disableGpu'] : d.disableGpu
  }
}

export function getSettings(): AppSettings {
  if (current) return current
  let loaded: AppSettings
  try {
    const raw = fs.readFileSync(file(), 'utf8')
    loaded = sanitizeSettings(JSON.parse(raw))
  } catch {
    loaded = { ...DEFAULT_SETTINGS }
  }
  current = loaded
  return loaded
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitizeSettings({ ...getSettings(), ...patch })
  current = next
  try {
    fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // 只读介质上跑绿色版时写不了配置，不该因此崩溃
  }
  return next
}

/** 最近打开过的文件夹，方便下次一键回到上次的素材库 */
export function getRecentFolders(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(cacheDir(), 'recent.json'), 'utf8'))
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]): void {
  try {
    fs.writeFileSync(
      path.join(cacheDir(), 'recent.json'),
      JSON.stringify(list, null, 2),
      'utf8'
    )
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
