import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { cacheDir } from './cache'
import { log } from './log'
import type { HdriEntry } from '../shared/types'

/**
 * 环境光 HDRI 管理。
 *
 * 内置的四张来自 Poly Haven（CC0，1k 分辨率，每张约 1.5 MB），
 * 用户自己的放在 <data>/hdri/ 下，绿色版跟着目录走。
 */

const BUILTIN: { file: string; name: string }[] = [
  { file: 'studio_small_09.hdr', name: '小型影棚' },
  { file: 'brown_photostudio_02.hdr', name: '暖色摄影棚' },
  { file: 'kloofendal_48d_partly_cloudy_puresky.hdr', name: '户外天空' },
  { file: 'moonless_golf.hdr', name: '夜晚草地' }
]

export const HDRI_EXTS = new Set(['.hdr', '.exr'])

export function builtinHdriDir(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'hdri')]
    : [
        path.join(__dirname, '..', '..', 'resources', 'hdri'),
        path.join(app.getAppPath(), 'resources', 'hdri'),
        path.join(process.cwd(), 'resources', 'hdri')
      ]
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
}

export function userHdriDir(): string {
  const d = path.join(cacheDir(), 'hdri')
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {
    /* 只读介质 */
  }
  return d
}

/** 安全的文件名：只允许用户目录里真实存在的文件名，不接受路径 */
function safeName(name: string): string | null {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null
  return name
}

export function resolveHdriFile(kind: string, name: string): string | null {
  const n = safeName(name)
  if (!n) return null
  if (kind === 'builtin') return path.join(builtinHdriDir(), n)
  if (kind === 'user') return path.join(userHdriDir(), n)
  return null
}

export async function listHdri(): Promise<HdriEntry[]> {
  const out: HdriEntry[] = []
  const bdir = builtinHdriDir()
  for (const b of BUILTIN) {
    if (fs.existsSync(path.join(bdir, b.file))) {
      out.push({ id: `builtin/${b.file}`, name: b.name, url: `asset3d://hdri/builtin/${encodeURIComponent(b.file)}`, builtin: true })
    }
  }
  try {
    const files = await fsp.readdir(userHdriDir())
    for (const f of files.sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
      const ext = path.extname(f).toLowerCase()
      if (!HDRI_EXTS.has(ext)) continue
      out.push({
        id: `user/${f}`,
        name: f.slice(0, f.length - ext.length),
        url: `asset3d://hdri/user/${encodeURIComponent(f)}`,
        builtin: false
      })
    }
  } catch {
    /* 没有用户目录 */
  }
  return out
}

/** 弹文件框选一张或多张 .hdr/.exr 复制进用户目录 */
export async function importHdri(win: BrowserWindow | null): Promise<HdriEntry[]> {
  if (!win) return await listHdri()
  const r = await dialog.showOpenDialog(win, {
    title: '选择 HDRI 环境贴图（.hdr / .exr）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'HDRI', extensions: ['hdr', 'exr'] }]
  })
  if (r.canceled) return await listHdri()
  const dir = userHdriDir()
  for (const src of r.filePaths) {
    const ext = path.extname(src).toLowerCase()
    if (!HDRI_EXTS.has(ext)) continue
    let dest = path.join(dir, path.basename(src))
    let n = 1
    const stem = path.basename(src, ext)
    while (fs.existsSync(dest)) dest = path.join(dir, `${stem}_${n++}${ext}`)
    try {
      await fsp.copyFile(src, dest)
      log.info('hdri', `导入 ${path.basename(dest)}`)
    } catch (e) {
      log.warn('hdri', `导入失败 ${src}`, e)
    }
  }
  return await listHdri()
}

export async function removeHdri(id: string): Promise<HdriEntry[]> {
  const m = /^user\/(.+)$/.exec(id)
  const n = m ? safeName(m[1]) : null
  if (n) {
    await fsp.rm(path.join(userHdriDir(), n), { force: true }).catch(() => {})
    log.info('hdri', `删除 ${n}`)
  }
  return await listHdri()
}
