import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { glbCachePath } from './cache'
import { readBlendVersion } from './blendThumb'
import type { BlenderInfo } from '../shared/types'

export interface BlenderInstall {
  version: string
  major: number
  minor: number
  exe: string
}

let cachedInstalls: BlenderInstall[] | null = null

/** Blender 官方安装器的固定布局：<root>\Blender <ver>\blender.exe */
const FOUNDATION_ROOTS = [
  'C:\\Program Files\\Blender Foundation',
  'C:\\Program Files (x86)\\Blender Foundation'
]

const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender',
  'C:\\Program Files\\Steam\\steamapps\\common\\Blender'
]

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

function parseVersionFromDirName(name: string): { major: number; minor: number } | null {
  const m = /(\d+)\.(\d+)/.exec(name)
  if (!m) return null
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) }
}

/**
 * 探测本机所有 Blender 安装。
 * 本机实测装了 4.0 / 4.5 / 5.0 / 5.1，且都不在 PATH 上，
 * 所以必须按已知路径扫目录，不能只靠 `where blender`。
 */
export async function detectBlender(userPath?: string | null): Promise<BlenderInstall[]> {
  const found = new Map<string, BlenderInstall>()

  const add = async (exe: string, hint?: { major: number; minor: number }): Promise<void> => {
    if (found.has(exe.toLowerCase())) return
    if (!(await exists(exe))) return
    const v = hint ?? (await probeVersion(exe))
    if (!v) return
    found.set(exe.toLowerCase(), {
      exe,
      major: v.major,
      minor: v.minor,
      version: `${v.major}.${v.minor}`
    })
  }

  // 用户手填的路径优先级最高
  if (userPath) await add(userPath)

  for (const root of FOUNDATION_ROOTS) {
    let dirs: string[]
    try {
      dirs = await fsp.readdir(root)
    } catch {
      continue
    }
    for (const d of dirs) {
      const v = parseVersionFromDirName(d)
      await add(path.join(root, d, 'blender.exe'), v ?? undefined)
    }
  }

  for (const root of STEAM_ROOTS) {
    await add(path.join(root, 'blender.exe'))
  }

  // 最后兜底看 PATH
  const onPath = await which('blender')
  if (onPath) await add(onPath)

  const list = [...found.values()].sort(
    (a, b) => a.major - b.major || a.minor - b.minor
  )
  cachedInstalls = list
  return list
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', [cmd], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const first = stdout.split(/\r?\n/).find((l) => l.trim().length > 0)
      resolve(first ? first.trim() : null)
    })
  })
}

function probeVersion(exe: string): Promise<{ major: number; minor: number } | null> {
  return new Promise((resolve) => {
    execFile(
      exe,
      ['--version'],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const m = /Blender\s+(\d+)\.(\d+)/i.exec(stdout)
        resolve(m ? { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) } : null)
      }
    )
  })
}

export async function getBlenderInfo(userPath?: string | null): Promise<BlenderInfo> {
  const installs = cachedInstalls ?? (await detectBlender(userPath))
  return { available: installs.length > 0, installs }
}

/**
 * 挑一个能打开这个 .blend 的 Blender。
 *
 * 向下不兼容是真实存在的：5.1 存的文件用 4.0 打开会报错或丢数据，
 * 所以先读 .blend 头部的版本号，选第一个 >= 它的安装；
 * 都不满足就退而求其次用最新的那个。
 */
export async function pickBlenderFor(
  filePath: string,
  userPath?: string | null
): Promise<BlenderInstall | null> {
  const installs = cachedInstalls ?? (await detectBlender(userPath))
  if (installs.length === 0) return null

  const header = await readBlendVersion(filePath)
  if (!header) return installs[installs.length - 1]

  const ok = installs.find(
    (i) => i.major > header.major || (i.major === header.major && i.minor >= header.minor)
  )
  return ok ?? installs[installs.length - 1]
}

/** 整批的超时，按每个文件 20s 估，再加一次进程启动的富余 */
const PER_FILE_TIMEOUT_MS = 20_000
const BATCH_STARTUP_MS = 30_000

/** 一个 Blender 进程一次处理多少个文件 */
const BATCH_SIZE = 12
/** 同时最多跑 2 个 Blender 进程，再多会把内存和 CPU 吃满 */
const MAX_PARALLEL = 2
/** 攒一小会儿再发批，好让首屏可见的那些文件凑到同一批里 */
const BATCH_DEBOUNCE_MS = 120

/**
 * 定位导出脚本。
 *
 * 不能只靠 app.getAppPath()：它返回的是入口脚本所在目录，
 * 用不同方式启动（electron . / electron 某个脚本 / 打包后）结果不一样。
 * 这里以构建产物自身位置为基准逐个试，取第一个真实存在的。
 */
function exportScriptPath(): string {
  const name = 'blender_export_glb.py'
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, name)]
    : [
        // out/main/index.js -> 项目根/resources
        path.join(__dirname, '..', '..', 'resources', name),
        path.join(app.getAppPath(), 'resources', name),
        path.join(process.cwd(), 'resources', name)
      ]
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c
  }
  return candidates[0]
}

export interface ConvertResult {
  ok: boolean
  glbPath?: string
  error?: string
  blenderVersion?: string
}

interface PendingJob {
  src: string
  out: string
  tmp: string
  blender: BlenderInstall
  resolve: (r: ConvertResult) => void
}

const waiting: PendingJob[] = []
const inflight = new Map<string, Promise<ConvertResult>>()
let activeProcs = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, BATCH_DEBOUNCE_MS)
}

async function flush(): Promise<void> {
  while (activeProcs < MAX_PARALLEL && waiting.length > 0) {
    // 同一批必须用同一个 Blender 版本，按版本分组取
    const first = waiting[0]
    const batch: PendingJob[] = []
    for (let i = 0; i < waiting.length && batch.length < BATCH_SIZE; ) {
      if (waiting[i].blender.exe === first.blender.exe) {
        batch.push(waiting.splice(i, 1)[0])
      } else {
        i++
      }
    }
    if (batch.length === 0) return
    activeProcs++
    void runBatch(batch).finally(() => {
      activeProcs--
      if (waiting.length > 0) void flush()
    })
  }
}

async function runBatch(batch: PendingJob[]): Promise<void> {
  const blender = batch[0].blender
  const done = new Set<string>()
  const jobsFile = path.join(
    os.tmpdir(),
    `blendjobs-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )

  try {
    await fsp.writeFile(
      jobsFile,
      JSON.stringify(batch.map((j) => ({ in: j.src, out: j.tmp }))),
      'utf8'
    )

    // --factory-startup 必加：用户装的第三方插件在无头模式下经常报错甚至挂死，
    // 用出厂配置启动能把这类随机失败挡掉。
    const child = spawn(
      blender.exe,
      ['-b', '--factory-startup', '-P', exportScriptPath(), '--', jobsFile],
      { windowsHide: true }
    )

    const byPath = new Map(batch.map((j) => [j.src, j]))
    let stdout = ''
    let stderr = ''

    const settle = async (job: PendingJob, ok: boolean, err?: string): Promise<void> => {
      if (done.has(job.src)) return
      done.add(job.src)
      if (ok && (await exists(job.tmp))) {
        try {
          await fsp.rename(job.tmp, job.out)
          job.resolve({ ok: true, glbPath: job.out, blenderVersion: blender.version })
          return
        } catch (e) {
          job.resolve({
            ok: false,
            error: e instanceof Error ? e.message : String(e)
          })
          return
        }
      }
      job.resolve({
        ok: false,
        error: `Blender ${blender.version} 导出失败: ${err ?? '未知错误'}`,
        blenderVersion: blender.version
      })
    }

    // 边收边处理：每转完一个立刻兑现对应的 promise，界面能增量刷新，
    // 不用等整批 12 个都跑完
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      buf += s
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('BATCH_OK\t')) {
          const src = line.slice('BATCH_OK\t'.length).trim()
          const job = byPath.get(src)
          if (job) void settle(job, true)
        } else if (line.startsWith('BATCH_ERR\t')) {
          const parts = line.slice('BATCH_ERR\t'.length).split('\t')
          const job = byPath.get(parts[0]?.trim() ?? '')
          if (job) void settle(job, false, parts[1] ?? '未知错误')
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    })

    const timeoutMs = BATCH_STARTUP_MS + batch.length * PER_FILE_TIMEOUT_MS
    const timer = setTimeout(() => child.kill(), timeoutMs)

    await new Promise<void>((resolve) => {
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    clearTimeout(timer)

    // 整批崩了/超时的话，剩下没兑现的在这里统一失败掉
    const fatal = /BATCH_FATAL:\s*(.+)/.exec(stdout)?.[1]?.trim()
    const tail = stderr.trim().split(/\r?\n/).slice(-2).join(' ')
    for (const job of batch) {
      await settle(job, false, fatal || tail || 'Blender 进程异常退出')
    }
  } catch (e) {
    for (const job of batch) {
      if (!done.has(job.src)) {
        done.add(job.src)
        job.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
  } finally {
    await fsp.rm(jobsFile, { force: true }).catch(() => {})
    for (const job of batch) {
      await fsp.rm(job.tmp, { force: true }).catch(() => {})
    }
  }
}

/**
 * 无头调用 Blender 把 .blend 导出成 GLB。
 * 转换结果按 mtime 缓存，第二次打开同一文件夹直接命中。
 */
export async function convertBlendToGlb(
  filePath: string,
  mtimeMs: number,
  size: number,
  userPath?: string | null
): Promise<ConvertResult> {
  const out = glbCachePath(filePath, mtimeMs, size)
  if (await exists(out)) return { ok: true, glbPath: out }

  const running = inflight.get(out)
  if (running) return running

  const p = (async (): Promise<ConvertResult> => {
    const blender = await pickBlenderFor(filePath, userPath)
    if (!blender) return { ok: false, error: '未检测到 Blender 安装' }
    if (await exists(out)) return { ok: true, glbPath: out }

    await fsp.mkdir(path.dirname(out), { recursive: true })
    const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp.glb`

    return await new Promise<ConvertResult>((resolve) => {
      waiting.push({ src: filePath, out, tmp, blender, resolve })
      scheduleFlush()
    })
  })().finally(() => {
    inflight.delete(out)
  })

  inflight.set(out, p)
  return p
}
