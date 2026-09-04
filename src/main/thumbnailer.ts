import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import path from 'node:path'
import { readMeta, readThumb, thumbKey, writeMeta, writeThumb } from './cache'
import { extractBlendThumb } from './blendThumb'
import { convertBlendToGlb } from './blenderService'
import { pathToAssetUrl, thumbUrl } from './protocol'
import type { ModelEntry, ModelStats, ThumbResult } from '../shared/types'

interface Job {
  key: string
  entry: ModelEntry
  px: number
  priority: number
  /** 用于换文件夹时批量丢弃过期任务 */
  epoch: number
  resolve: (r: ThumbResult) => void
}

interface Worker {
  win: BrowserWindow
  ready: boolean
  busy: Job | null
  timer: NodeJS.Timeout | null
}

const JOB_TIMEOUT_MS = 45_000

let workers: Worker[] = []
let queue: Job[] = []
let epoch = 0
let jobSeq = 0
const inflight = new Map<number, Job>()
/** 同一个文件正在处理时，后来的请求挂到同一个 promise 上，不重复渲染 */
const pending = new Map<string, Promise<ThumbResult>>()

let onProgress: ((r: ThumbResult) => void) | null = null

export function setProgressListener(fn: (r: ThumbResult) => void): void {
  onProgress = fn
}

function workerUrl(): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}/worker.html` }
  return { file: path.join(__dirname, '../renderer/worker.html') }
}

export function createWorkers(count: number): void {
  destroyWorkers()
  for (let i = 0; i < count; i++) {
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
    const w: Worker = { win, ready: false, busy: null, timer: null }
    const target = workerUrl()
    if (target.url) void win.loadURL(target.url)
    else void win.loadFile(target.file!)
    workers.push(w)
  }
}

export function destroyWorkers(): void {
  for (const w of workers) {
    if (w.timer) clearTimeout(w.timer)
    if (!w.win.isDestroyed()) w.win.destroy()
  }
  workers = []
}

/** 换文件夹时调用：让所有排队中的任务失效 */
export function bumpEpoch(): void {
  epoch++
  for (const j of queue) j.resolve({ id: j.entry.id, state: 'pending' })
  queue = []
}

ipcMain.on('worker:ready', (e: IpcMainEvent) => {
  const w = workers.find((x) => x.win.webContents.id === e.sender.id)
  if (w) {
    w.ready = true
    pump()
  }
})

ipcMain.on(
  'worker:result',
  (
    e: IpcMainEvent,
    payload: {
      jobId: number
      ok: boolean
      png?: Uint8Array
      error?: string
      stats?: ModelStats
    }
  ) => {
    const w = workers.find((x) => x.win.webContents.id === e.sender.id)
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
      if (payload.ok && payload.png && payload.png.length > 0) {
        try {
          await writeThumb(job.key, Buffer.from(payload.png))
          if (payload.stats) await writeMeta(job.key, payload.stats)
          finish(job, {
            id: job.entry.id,
            state: 'ready',
            url: thumbUrl(job.key),
            stats: payload.stats
          })
        } catch (err) {
          finish(job, {
            id: job.entry.id,
            state: 'failed',
            error: err instanceof Error ? err.message : String(err)
          })
        }
      } else {
        finish(job, {
          id: job.entry.id,
          state: 'failed',
          error: payload.error ?? '渲染失败'
        })
      }
      pump()
    })()
  }
)

function finish(job: Job, r: ThumbResult): void {
  job.resolve(r)
  onProgress?.(r)
}

function pump(): void {
  if (queue.length === 0) return
  for (const w of workers) {
    if (!w.ready || w.busy) continue
    // 取优先级最高的（数字越小越优先，代表离视口越近）
    let bi = 0
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].priority < queue[bi].priority) bi = i
    }
    const job = queue.splice(bi, 1)[0]
    if (!job) return

    if (job.epoch !== epoch) {
      job.resolve({ id: job.entry.id, state: 'pending' })
      continue
    }

    const jobId = ++jobSeq
    inflight.set(jobId, job)
    w.busy = job
    w.timer = setTimeout(() => {
      // 加载器卡死会永久占住一个 worker，超时后连 GL 上下文一起重建
      inflight.delete(jobId)
      finish(job, { id: job.entry.id, state: 'failed', error: '渲染超时' })
      recycle(w)
    }, JOB_TIMEOUT_MS)

    w.win.webContents.send('worker:render', {
      jobId,
      url: pathToAssetUrl(job.entry.path),
      ext: job.entry.ext,
      px: job.px
    })

    if (queue.length === 0) return
  }
}

function recycle(w: Worker): void {
  w.ready = false
  w.busy = null
  if (w.timer) clearTimeout(w.timer)
  w.timer = null
  if (!w.win.isDestroyed()) w.win.webContents.reload()
}

/** 把一个模型丢进出图队列（或直接命中缓存） */
export function requestThumb(
  entry: ModelEntry,
  px: number,
  priority: number,
  blendAutoConvert: boolean,
  blenderPath: string | null
): Promise<ThumbResult> {
  const key = thumbKey(entry.path, entry.mtimeMs, entry.size, px)
  const existing = pending.get(key)
  if (existing) return existing

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
      return await handleBlend(entry, px, key, blendAutoConvert, blenderPath)
    }

    return await enqueue(entry, px, key, priority)
  })().finally(() => {
    pending.delete(key)
  })

  pending.set(key, p)
  return p
}

function enqueue(
  entry: ModelEntry,
  px: number,
  key: string,
  priority: number
): Promise<ThumbResult> {
  return new Promise<ThumbResult>((resolve) => {
    queue.push({ key, entry, px, priority, epoch, resolve })
    pump()
  })
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
  px: number,
  key: string,
  autoConvert: boolean,
  blenderPath: string | null
): Promise<ThumbResult> {
  const embedKey = thumbKey(`${entry.path}#embedded`, entry.mtimeMs, entry.size, px)
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
  } catch {
    /* 没有内嵌图就直接走转换 */
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

  const conv = await convertBlendToGlb(
    entry.path,
    entry.mtimeMs,
    entry.size,
    blenderPath
  )
  if (!conv.ok || !conv.glbPath) {
    return (
      embedded ?? {
        id: entry.id,
        state: 'failed',
        error: conv.error ?? 'Blender 转换失败'
      }
    )
  }

  // 拿转换出来的 GLB 走和其它格式完全相同的渲染路径
  const glbEntry: ModelEntry = { ...entry, path: conv.glbPath, ext: '.glb' }
  const r = await enqueue(glbEntry, px, key, 0)
  return r.state === 'ready' ? { ...r, id: entry.id } : (embedded ?? { ...r, id: entry.id })
}

/** 拿到可交互的模型 URL：.blend 返回转换后的 GLB，其它原样返回 */
export async function resolveViewableUrl(
  entry: ModelEntry,
  blenderPath: string | null
): Promise<{ url: string; path: string; converted: boolean; error?: string }> {
  if (entry.ext !== '.blend') {
    return { url: pathToAssetUrl(entry.path), path: entry.path, converted: false }
  }
  const conv = await convertBlendToGlb(
    entry.path,
    entry.mtimeMs,
    entry.size,
    blenderPath
  )
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
