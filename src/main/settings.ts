import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from './cache'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'

let current: AppSettings | null = null

function file(): string {
  return path.join(cacheDir(), 'settings.json')
}

export function getSettings(): AppSettings {
  if (current) return current
  let loaded: AppSettings
  try {
    const raw = fs.readFileSync(file(), 'utf8')
    loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    loaded = { ...DEFAULT_SETTINGS }
  }
  current = loaded
  return loaded
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
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
    return JSON.parse(fs.readFileSync(path.join(cacheDir(), 'recent.json'), 'utf8'))
  } catch {
    return []
  }
}

export function pushRecentFolder(dir: string): string[] {
  const list = getRecentFolders().filter((d) => d.toLowerCase() !== dir.toLowerCase())
  list.unshift(dir)
  const trimmed = list.slice(0, 12)
  try {
    fs.writeFileSync(
      path.join(cacheDir(), 'recent.json'),
      JSON.stringify(trimmed, null, 2),
      'utf8'
    )
  } catch {
    /* 忽略 */
  }
  return trimmed
}
