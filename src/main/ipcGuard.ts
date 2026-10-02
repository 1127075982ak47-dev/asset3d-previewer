import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent, type WebContents } from 'electron'
import path from 'node:path'
import { DEFAULT_SETTINGS, type ModelEntry, type ThumbRequest } from '../shared/types'
import { isAllowedPath } from './protocol'
import { validateName } from './fileOps'

let main: WebContents | null = null
const workers = new Set<number>()
const catalog = new Map<string, ModelEntry>()
const key = (p: string): string => path.resolve(p).toLowerCase()

export function trustMain(contents: WebContents): void { main = contents }
export function trustWorker(contents: WebContents): void {
  workers.add(contents.id)
  contents.once('destroyed', () => workers.delete(contents.id))
}
export function rememberModels(entries: ModelEntry[]): void {
  for (const entry of entries) catalog.set(key(entry.path), entry)
}
export function forgetModels(paths: string[]): void { for (const p of paths) catalog.delete(key(p)) }

export function isTrustedMainEvent(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return !!main && event.sender.id === main.id && event.senderFrame === main.mainFrame
}

export function knownModelPaths(value: unknown): string[] {
  return array(value).map(v => model(v).path)
}

function localPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32768 || value.includes('\0') || !path.isAbsolute(value)) throw new Error('无效的文件路径')
  return path.resolve(value)
}

function model(value: unknown): ModelEntry {
  const p = typeof value === 'string' ? value : (value as ModelEntry | undefined)?.path
  const found = catalog.get(key(localPath(p)))
  if (!found || !isAllowedPath(found.path)) throw new Error('该文件未在已打开的资源目录中，请重新扫描')
  return { ...found }
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 20000) throw new Error('文件列表无效或过长')
  return value
}

export function sanitizeThumbRequest(value: unknown): ThumbRequest {
  const r = (value ?? {}) as Partial<ThumbRequest>
  return {
    px: [256, 512, 768, 1024].includes(Number(r.px)) ? Number(r.px) : DEFAULT_SETTINGS.thumbSize,
    priority: Number.isFinite(r.priority) ? Math.max(0, Math.min(1000000, Number(r.priority))) : 0,
    lighting: ['studio', 'outdoor', 'neutral'].includes(String(r.lighting)) ? r.lighting! : DEFAULT_SETTINGS.lighting,
    background: ['transparent', 'dark', 'light', 'white'].includes(String(r.background)) ? r.background! : DEFAULT_SETTINGS.background,
    angle: ['iso', 'iso-left', 'front', 'top', 'side'].includes(String(r.angle)) ? r.angle : 'iso',
    shading: ['material', 'clay', 'matcap'].includes(String(r.shading)) ? r.shading : 'material'
  }
}

export function pngBytes(value: unknown): Buffer {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,') || value.length > 64 * 1024 * 1024) throw new Error('PNG 图片无效或超过大小限制')
  const data = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64')
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('图片不是 PNG 格式')
  return data
}

function validate(channel: string, args: unknown[]): void {
  const single = ['thumb:request', 'thumb:invalidate', 'thumb:setCustom', 'model:viewableUrl', 'fs:rename', 'export:glb']
  if (single.includes(channel)) args[0] = model(args[0])
  if (['thumb:request', 'thumb:invalidate', 'thumb:setCustom'].includes(channel)) args[1] = sanitizeThumbRequest(args[1])
  if (channel === 'fs:rename') {
    if (typeof args[1] !== 'string' || validateName(args[1])) throw new Error('新文件名无效')
    args[2] = localPath(args[2]); args[3] = sanitizeThumbRequest(args[3])
  }
  if (['fs:move', 'export:batchTo'].includes(channel)) {
    args[0] = array(args[0]).map(model); args[1] = localPath(args[1])
  }
  if (channel === 'dupes:find') args[0] = array(args[0]).map(m => { const e = model(m); return { path: e.path, size: e.size } })
  if (['fs:trash', 'library:setFavorites', 'library:addTag', 'library:removeTag', 'library:setRating', 'library:setColor'].includes(channel)) args[0] = array(args[0]).map(m => model(m).path)
  if (['library:toggleFavorite', 'library:setTags', 'model:dependencies', 'blender:open'].includes(channel)) args[0] = model(args[0]).path
  if (['shell:openPath', 'shell:showItem'].includes(channel)) {
    const p = localPath(args[0])
    if (!isAllowedPath(p)) throw new Error('此路径不在已打开的资源范围内')
    args[0] = p
  }
  if (['scan:folder', 'scan:validateFolder'].includes(channel)) args[0] = localPath(args[0])
  if (channel === 'scan:folder') {
    const opts = (args[1] ?? {}) as { recursive?: unknown; maxDepth?: unknown }
    args[1] = { recursive: opts.recursive !== false, maxDepth: Number.isFinite(opts.maxDepth) ? Math.max(0, Math.min(64, Math.floor(Number(opts.maxDepth)))) : 16 }
  }
  if (['library:addTag', 'library:removeTag'].includes(channel) && (typeof args[1] !== 'string' || args[1].length > 128)) throw new Error('标签无效或过长')
  if (channel === 'library:setTags') args[1] = array(args[1]).filter(v => typeof v === 'string' && v.length <= 128).slice(0, 100)
  if (channel === 'thumb:setVisible') args[0] = array(args[0]).filter(v => typeof v === 'string' && v.length <= 100)
  if (channel === 'app:decoderUrl' && (typeof args[0] !== 'string' || !/^(draco|basis|rhino3dm)\/[a-zA-Z0-9_./-]*$/.test(args[0]) || args[0].includes('..'))) throw new Error('解码器路径无效')
  if (channel === 'export:frames') {
    if (typeof args[1] !== 'string' || validateName(args[1])) throw new Error('序列名称无效')
    const frames = array(args[2])
    if (frames.length > 72 || frames.reduce<number>((n, f) => n + (typeof f === 'string' ? f.length : Infinity), 0) > 256 * 1024 * 1024) throw new Error('序列超过大小限制')
    for (const f of frames) pngBytes(f)
  }
  if (['thumb:setCustom', 'export:contactSheet', 'export:png'].includes(channel)) pngBytes(args[channel === 'thumb:setCustom' ? 2 : channel === 'export:png' ? 1 : 0])
}

/** worker 只能取解码器路径；文件整理接口只接受可信主窗口的顶层 frame。 */
export function handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const fromMain = isTrustedMainEvent(event)
    const fromWorker = channel === 'app:decoderUrl' && workers.has(event.sender.id) && event.senderFrame === event.sender.mainFrame
    if (!fromMain && !fromWorker) throw new Error('拒绝非授权窗口调用')
    try {
      validate(channel, args)
      return await handler(event, ...args)
    } catch (err) {
      if (fromMain && !main!.isDestroyed()) main!.send('app:notice', err instanceof Error ? err.message : String(err))
      throw err
    }
  })
}
