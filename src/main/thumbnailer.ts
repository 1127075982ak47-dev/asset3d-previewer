import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import {
  copyThumb,
  deleteThumb,
  embeddedThumbKey,
  glbCachePath,
  readMeta,
  readThumb,
  thumbKey,
  writeMeta,
  writeThumb
} from './cache'
import { extractBlendThumb } from './blendThumb'
import { convertBlendToGlb } from './blenderService'
import { pathToAssetUrl, thumbUrl } from './protocol'
import { JobQueue, type QueuedJob } from './jobQueue'
import { log } from './log'
import type {
  ModelEntry,
  ModelStats,
  ThumbRequest,
  ThumbResult
} from '../shared/types'

export interface ExportResult {
  ok: boolean
  data?: Buffer
  error?: string
}

type JobKind = 'thumb' | 'export'

interface JobPayload {
  kind: JobKind
  key: string
  entry: ModelEntry
  /** 实际送去渲染的文件（.blend 转出的 GLB 与源文件不同） */
  file: string
  ext: string
  req: ThumbRequest
  resolve: (r: ThumbResult) => void
  resolveExport?: (r: ExportResult) => void
}

type Job = QueuedJob<JobPayload>

interface Worker {
  slot: number
  win: BrowserWindow
  ready: boolean
  busy: Job | null
  jobId: number
  timer: NodeJS.Timeout | null
}

/** 单张出图的上限。大型 FBX 在机械盘上读盘 + 解析可能真要这么久 */
const JOB_TIMEOUT_MS = 60_000
/** 导出 GLB 要重编码贴图，给宽一点 */
const EXPORT_TIMEOUT_MS = 180_000

const queue = new JobQueue<JobPayload>(600)
let workers: Worker[] = []
let jobSeq = 0
const inflight = new Map<number, Job>()
/** 同一个文件正在处理时，后来的请求挂到同一个 promise 上，不重复渲染 */
const pending = new Map<string, Promise<ThumbResult>>()

let onProgress: ((r: ThumbResult) => void) | null = null
/** 查看器打开时暂停出图：三个隐藏窗口全速出图会和查看器抢 GPU */
let paused = false

export function setPaused(p: boolean): void {
  if (paused === p) return
  paused = p
  log.debug('thumb', p ? '出图暂停' : '出图恢复')
  if (!p) pump()
}

export function setProgressListener(fn: (r: ThumbResult) => void): void {
  onProgress = fn
}

function workerUrl(): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}/worker.html` }
  return { file: path.join(__dirname, '../renderer/worker.html') }
}

function spawnWindow(w: Worker): void {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 隐藏窗口默认会被降频，关掉才能保持稳定出图速度
      backgroundThrottling: false,
      offscreen: false
    }
  })
  w.win = win
  w.ready = false

  // GPU 进程或渲染进程崩了不能等 60 秒超时，立刻判失败并重建
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('worker', `#${w.slot} 渲染进程退出: ${details.reason}`)
    failBusy(w, `渲染进程崩溃 (${details.reason})`)
    recycle(w)
  })
  win.webContents.on('unresponsive', () => {
    log.warn('worker', `#${w.slot} 无响应`)
    failBusy(w, '渲染进程无响应')
    recycle(w)
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log.warn('worker', `#${w.slot} ${message}`)
  })

  const target = workerUrl()
  if (target.url) void win.loadURL(target.url)
  else void win.loadFile(target.file!)
}

export function createWorkers(count: number): void {
  destroyWorkers()
  for (let i = 0; i < count; i++) {
    const w: Worker = {
      slot: i,
      win: null as unknown as BrowserWindow,
      ready: false,
      busy: null,
      jobId: 0,
      timer: null
    }
    spawnWindow(w)
    workers.push(w)
  }
  log.info('worker', `创建 ${count} 个出图窗口`)
}

/**
 * 销毁全部 worker。正在处理的任务放回队头，等新 worker 就绪后接着做 ——
 * 1.0 在这里直接丢掉在途任务，改并发数之后对应卡片就永远转圈了。
 */
export function destroyWorkers(): void {
  for (const w of workers) {
    if (w.timer) clearTimeout(w.timer)
    if (w.busy) {
      inflight.delete(w.jobId)
      queue.unshift(w.busy)
      w.busy = null
    }
    if (w.win && !w.win.isDestroyed()) w.win.destroy()
  }
  workers = []
}

export function workerCount(): number {
  return workers.length
}

/** 换文件夹时调用：让所有排队中的任务失效 */
export function bumpEpoch(): void {
  for (const j of queue.bumpEpoch()) j.payload.resolve({ id: j.id, state: 'pending' })
}

/** 网格上报当前可见的条目，让它们插队 */
export function setVisible(ids: string[]): void {
  const dropped = queue.setVisible(ids)
  for (const j of dropped) j.payload.resolve({ id: j.id, state: 'pending' })
  pump()
}

function failBusy(w: Worker, error: string): void {
  const job = w.busy
  if (!job) return
  inflight.delete(w.jobId)
  if (w.timer) clearTimeout(w.timer)
  w.timer = null
  w.busy = null
  if (job.payload.kind === 'export') {
    job.payload.resolveExport?.({ ok: false, error })
  } else {
    finish(job, { id: job.id, state: 'failed', error })
  }
}

ipcMain.on('worker:ready', (e: IpcMainEvent) => {
  const w = workers.find((x) => !x.win.isDestroyed() && x.win.webContents.id === e.sender.id)
  if (w) {
    w.ready = true
    pump()
  }
})

ipcMain.on('worker:contextlost', (e: IpcMainEvent) => {
  const w = workers.find((x) => !x.win.isDestroyed() && x.win.webContents.id === e.sender.id)
  if (!w) return
  log.warn('worker', `#${w.slot} WebGL 上下文丢失，重建`)
  failBusy(w, 'WebGL 上下文丢失')
  recycle(w)
})

ipcMain.on(
  'worker:result',
  (
    e: IpcMainEvent,
    payload: {
      jobId: number
      ok: boolean
      png?: Uint8Array
      glb?: Uint8Array
      error?: string
      stats?: ModelStats
    }
  ) => {
    const w = workers.find((x) => !x.win.isDestroyed() && x.win.webContents.id === e.sender.id)
    const job = inflight.get(payload.jobId)
    inflight.delete(payload.jobId)
    if (w) {
      if (w.timer) clearTimeout(w.timer)
      w.timer = null
      w.busy = null
    }
    if (!job) {
      pump()
      return
    }

    void (async () => {
      if (job.payload.kind === 'export') {
        if (payload.ok && payload.glb && payload.glb.length > 0) {
          job.payload.resolveExport?.({ ok: true, data: Buffer.from(payload.glb) })
        } else {
          job.payload.resolveExport?.({ ok: false, error: payload.error ?? '导出失败' })
        }
        pump()
        return
      }

      if (payload.ok && payload.png && payload.png.length > 0) {
        try {
          await writeThumb(job.payload.key, Buffer.from(payload.png))
          if (payload.stats) await writeMeta(job.payload.key, payload.stats)
          finish(job, {
            id: job.id,
            state: 'ready',
            url: thumbUrl(job.payload.key),
            stats: payload.stats
          })
        } catch (err) {
          finish(job, {
            id: job.id,
            state: 'failed',
            error: err instanceof Error ? err.message : String(err)
          })
        }
      } else {
        log.debug('thumb', `失败 ${job.payload.entry.rel}: ${payload.error}`)
        finish(job, {
          id: job.id,
          state: 'failed',
          error: payload.error ?? '渲染失败'
        })
      }
      pump()
    })()
  }
)

function finish(job: Job, r: ThumbResult): void {
  job.payload.resolve(r)
  onProgress?.(r)
}

function pump(): void {
  if (paused) return
  for (const w of workers) {
    if (!w.ready || w.busy || w.win.isDestroyed()) continue

    let job: Job | undefined
    // 跳过换文件夹后作废的任务
    for (;;) {
      job = queue.next()
      if (!job) return
      if (job.epoch === queue.epoch) break
      job.payload.resolve({ id: job.id, state: 'pending' })
    }

    const jobId = ++jobSeq
    inflight.set(jobId, job)
    w.busy = job
    w.jobId = jobId
    const timeout = job.payload.kind === 'export' ? EXPORT_TIMEOUT_MS : JOB_TIMEOUT_MS
    w.timer = setTimeout(() => {
      // 加载器卡死会永久占住一个 worker，超时后连 GL 上下文一起重建
      log.warn('worker', `#${w.slot} 超时: ${job!.payload.entry.rel}`)
      failBusy(w, job!.payload.kind === 'export' ? '导出超时' : '渲染超时')
      recycle(w)
    }, timeout)

    w.win.webContents.send('worker:render', {
      jobId,
      kind: job.payload.kind,
      url: pathToAssetUrl(job.payload.file),
      ext: job.payload.ext,
      px: job.payload.req.px,
      lighting: job.payload.req.lighting,
      background: job.payload.req.background,
      angle: job.payload.req.angle ?? 'iso',
      shading: job.payload.req.shading ?? 'material'
    })
  }
}

function recycle(w: Worker): void {
  w.ready = false
  w.busy = null
  if (w.timer) clearTimeout(w.timer)
  w.timer = null
  if (w.win.isDestroyed()) {
    spawnWindow(w)
    return
  }
  try {
    w.win.webContents.reload()
  } catch (e) {
    log.warn('worker', `#${w.slot} reload 失败，重建窗口`, e)
    try {
      w.win.destroy()
    } catch {
      /* 已经没了 */
    }
    spawnWindow(w)
  }
}

function enqueue(
  kind: JobKind,
  entry: ModelEntry,
  file: string,
  ext: string,
  key: string,
  req: ThumbRequest,
  epoch: number
): Promise<ThumbResult> {
  return new Promise<ThumbResult>((resolve) => {
    queue.push({
      id: entry.id,
      priority: req.priority,
      epoch,
      payload: { kind, key, entry, file, ext, req, resolve }
    })
    pump()
  })
}

function keyOf(entry: ModelEntry, req: ThumbRequest): string {
  return thumbKey(entry, req.px, req.lighting, req.background, req.angle ?? 'iso', req.shading ?? 'material')
}

/**
 * 「用当前视角设为缩略图」：把查看器截出来的 PNG 直接写进这个文件的缓存键。
 * 统计信息保留（模型没变），只换图。
 */
export async function setCustomThumb(entry: ModelEntry, req: ThumbRequest, png: Buffer): Promise<ThumbResult> {
  const key = keyOf(entry, req)
  for (const j of queue.remove(entry.id)) j.payload.resolve({ id: j.id, state: 'pending' })
  await writeThumb(key, png)
  const stats = await readMeta<ModelStats>(key)
  const r: ThumbResult = {
    id: entry.id,
    state: 'ready',
    // 加个时间戳让 <img> 不命中浏览器缓存，协议层会把 query 去掉
    url: `${thumbUrl(key)}?v=${Date.now()}`,
    stats: stats ?? undefined
  }
  onProgress?.(r)
  return r
}

/** 文件改名 / 移动后把缩略图缓存搬到新键，并通知界面 */
export async function migrateThumb(
  oldEntry: ModelEntry,
  newEntry: ModelEntry,
  req: ThumbRequest
): Promise<ThumbResult | null> {
  const ok = await copyThumb(keyOf(oldEntry, req), keyOf(newEntry, req))
  if (!ok) return null
  const key = keyOf(newEntry, req)
  const stats = await readMeta<ModelStats>(key)
  return { id: newEntry.id, state: 'ready', url: thumbUrl(key), stats: stats ?? undefined }
}

/** 把一个模型丢进出图队列（或直接命中缓存） */
export function requestThumb(
  entry: ModelEntry,
  req: ThumbRequest,
  blendAutoConvert: boolean,
  blenderPath: string | null
): Promise<ThumbResult> {
  if (!entry.previewable) {
    return Promise.resolve({ id: entry.id, state: 'unsupported' })
  }

  const key = keyOf(entry, req)
  const existing = pending.get(key)
  if (existing) return existing

  const epoch = queue.epoch
  const p = (async (): Promise<ThumbResult> => {
    const cached = await readThumb(key)
    if (cached) {
      const stats = await readMeta<ModelStats>(key)
      return {
        id: entry.id,
        state: 'ready',
        url: thumbUrl(key),
        stats: stats ?? undefined
      }
    }

    if (entry.ext === '.blend') {
      return await handleBlend(entry, key, req, epoch, blendAutoConvert, blenderPath)
    }

    return await enqueue('thumb', entry, entry.path, entry.ext, key, req, epoch)
  })().finally(() => {
    pending.delete(key)
  })

  pending.set(key, p)
  return p
}

/**
 * 「重新生成缩略图」：把这个文件所有缓存产物删掉。
 * 1.0 只清了渲染进程的状态，下一次请求照样命中磁盘缓存，等于什么都没做。
 */
export async function invalidateThumb(entry: ModelEntry, req: ThumbRequest): Promise<void> {
  for (const j of queue.remove(entry.id)) j.payload.resolve({ id: j.id, state: 'pending' })
  await deleteThumb(keyOf(entry, req))
  await deleteThumb(embeddedThumbKey(entry))
  if (entry.ext === '.blend') {
    await fsp.rm(glbCachePath(entry), { force: true }).catch(() => {})
  }
}

/**
 * .blend 分层策略：
 *   第一层 —— 直接抠内嵌预览图，毫秒级出图，用户立刻看到东西；
 *   第二层 —— 后台喊 Blender 转 GLB，转完重新出一张真渲染图，
 *            并且从此该文件可以双击进去自由旋转缩放。
 *
 * 两层用**不同的缓存键**是关键：早期版本共用一个键，内嵌图先落盘之后，
 * 下次启动 requestThumb 一查缓存就命中、直接当成最终结果返回，
 * 真正的渲染再也不会发生 —— 表现就是缩略图永远停在那张内嵌图上。
 */
async function handleBlend(
  entry: ModelEntry,
  key: string,
  req: ThumbRequest,
  epoch: number,
  autoConvert: boolean,
  blenderPath: string | null
): Promise<ThumbResult> {
  const embedKey = embeddedThumbKey(entry)
  let embedded: ThumbResult | null = null

  try {
    const cachedEmbed = await readThumb(embedKey)
    if (cachedEmbed) {
      embedded = { id: entry.id, state: 'embedded', url: thumbUrl(embedKey) }
      onProgress?.(embedded)
    } else {
      const t = await extractBlendThumb(entry.path)
      // 整窗截图（满屏 Blender 界面、模型只是中间一个小点）不如不显示，
      // 直接留占位符等真渲染，免得误导
      if (t && !t.windowScreenshot) {
        await writeThumb(embedKey, t.png)
        embedded = { id: entry.id, state: 'embedded', url: thumbUrl(embedKey) }
        // 先把内嵌图推给界面，别等 Blender
        onProgress?.(embedded)
      }
    }
  } catch (e) {
    log.debug('blend', `内嵌图提取失败 ${entry.rel}`, e)
  }

  if (!autoConvert) {
    return (
      embedded ?? {
        id: entry.id,
        state: 'failed',
        error: '该 .blend 没有可用的内嵌预览图，且未启用 Blender 自动转换'
      }
    )
  }

  const conv = await convertBlendToGlb(entry, blenderPath)
  if (!conv.ok || !conv.glbPath) {
    const error = conv.error ?? 'Blender 转换失败'
    log.warn('blend', `转换失败 ${entry.rel}: ${error}`)
    // 有内嵌图就继续显示内嵌图，但把失败原因带上，角标里能看到
    return embedded ? { ...embedded, error } : { id: entry.id, state: 'failed', error }
  }

  // 拿转换出来的 GLB 走和其它格式完全相同的渲染路径。
  // 带上发起时的 epoch：用户已经换了文件夹的话别再插队。
  const r = await enqueue('thumb', entry, conv.glbPath, '.glb', key, req, epoch)
  return r.state === 'ready' ? r : (embedded ?? r)
}

/** 拿到可交互的模型 URL：.blend 返回转换后的 GLB，其它原样返回 */
export async function resolveViewableUrl(
  entry: ModelEntry,
  blenderPath: string | null
): Promise<{ url: string; path: string; converted: boolean; error?: string }> {
  if (!entry.previewable) {
    return { url: '', path: '', converted: false, error: `${entry.ext} 格式无法预览` }
  }
  if (entry.ext !== '.blend') {
    return { url: pathToAssetUrl(entry.path), path: entry.path, converted: false }
  }
  const conv = await convertBlendToGlb(entry, blenderPath)
  if (!conv.ok || !conv.glbPath) {
    return {
      url: '',
      path: '',
      converted: false,
      error: conv.error ?? 'Blender 转换失败'
    }
  }
  return { url: pathToAssetUrl(conv.glbPath), path: conv.glbPath, converted: true }
}

/**
 * 用 worker 把任意可加载的格式导出成 GLB（three.js GLTFExporter）。
 * .blend 走 Blender 转换缓存，不经过这里。
 */
export function requestGlbExport(entry: ModelEntry, file: string, ext: string): Promise<ExportResult> {
  return new Promise<ExportResult>((resolveExport) => {
    queue.push({
      id: `export:${entry.id}`,
      priority: -1,
      epoch: queue.epoch,
      payload: {
        kind: 'export',
        key: '',
        entry,
        file,
        ext,
        req: { px: 256, priority: -1, lighting: 'studio', background: 'transparent' },
        resolve: () => {},
        resolveExport
      }
    })
    // 导出任务不受换文件夹作废影响：用户是明确点了导出
    pump()
  })
}

export function queueStats(): { queued: number; inflight: number; workers: number } {
  return { queued: queue.size, inflight: inflight.size, workers: workers.length }
}
