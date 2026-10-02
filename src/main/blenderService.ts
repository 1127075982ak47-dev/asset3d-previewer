import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { glbCachePath, type FileIdentity } from './cache'
import { readBlendVersion } from './blendThumb'
import { log } from './log'
import type { BlenderInfo } from '../shared/types'

export interface BlenderInstall {
  version: string
  major: number
  minor: number
  exe: string
}

let cachedInstalls: BlenderInstall[] | null = null

/** Blender 官方安装器的固定布局：<root>\Blender <ver>\blender.exe */
function foundationRoots(): string[] {
  const roots: string[] = []
  // 不只看 C 盘：不少人把大软件装在 D/E
  for (let c = 67; c <= 90; c++) {
    const drive = String.fromCharCode(c)
    roots.push(`${drive}:\\Program Files\\Blender Foundation`)
    roots.push(`${drive}:\\Program Files (x86)\\Blender Foundation`)
  }
  const local = process.env['LOCALAPPDATA']
  if (local) roots.push(path.join(local, 'Programs', 'Blender Foundation'))
  return roots
}

const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender',
  'C:\\Program Files\\Steam\\steamapps\\common\\Blender',
  'D:\\Steam\\steamapps\\common\\Blender',
  'D:\\SteamLibrary\\steamapps\\common\\Blender',
  'E:\\SteamLibrary\\steamapps\\common\\Blender'
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
 * 不能只靠 `where blender`：官方安装器不会把它加进 PATH。
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

  // 用户手填的路径优先级最高，而且要真正跑一下 --version 确认它是 Blender
  if (userPath) {
    const p = userPath.trim()
    const exe = p.toLowerCase().endsWith('.exe') ? p : path.join(p, 'blender.exe')
    await add(exe)
  }

  for (const root of foundationRoots()) {
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
  log.info('blender', `探测到 ${list.length} 个安装: ${list.map((i) => i.version).join(' / ') || '无'}`)
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
 * 都不满足就退而求其次用最新的那个。非 .blend 直接用最新的。
 */
export async function pickBlenderFor(
  filePath: string,
  userPath?: string | null
): Promise<BlenderInstall | null> {
  const installs = cachedInstalls ?? (await detectBlender(userPath))
  if (installs.length === 0) return null
  if (!filePath.toLowerCase().endsWith('.blend')) return installs[installs.length - 1]

  const header = await readBlendVersion(filePath)
  if (!header) return installs[installs.length - 1]

  const ok = installs.find(
    (i) => i.major > header.major || (i.major === header.major && i.minor >= header.minor)
  )
  return ok ?? installs[installs.length - 1]
}

/** 单个文件的转换上限。看门狗按「距离上一个文件完成」计时，一个卡死的不会拖累整批 */
const PER_FILE_TIMEOUT_MS = 30_000
/** 进程启动到第一个文件完成之间的富余 */
const STARTUP_GRACE_MS = 30_000

/** 一个 Blender 进程一次处理多少个文件 */
const BATCH_SIZE = 12
/** 同时最多跑 2 个 Blender 进程，再多会把内存和 CPU 吃满 */
const MAX_PARALLEL = 2
/** 攒一小会儿再发批，好让首屏可见的那些文件凑到同一批里 */
const BATCH_DEBOUNCE_MS = 120

/**
 * 定位随程序发布的资源文件（Blender 脚本等）。
 *
 * 不能只靠 app.getAppPath()：它返回的是入口脚本所在目录，
 * 用不同方式启动（electron . / electron 某个脚本 / 打包后）结果不一样。
 * 这里以构建产物自身位置为基准逐个试，取第一个真实存在的。
 */
export function resourcePath(name: string): string {
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
  retries: number
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
  let child: ChildProcess | null = null
  let killedByWatchdog = false

  try {
    await fsp.writeFile(
      jobsFile,
      JSON.stringify(batch.map((j) => ({ in: j.src, out: j.tmp }))),
      'utf8'
    )

    // --factory-startup 必加：用户装的第三方插件在无头模式下经常报错甚至挂死，
    // 用出厂配置启动能把这类随机失败挡掉。
    child = spawn(
      blender.exe,
      ['-b', '--factory-startup', '--disable-autoexec', '-P', resourcePath('blender_export_glb.py'), '--', jobsFile],
      { windowsHide: true }
    )
    log.info('blender', `批转换 ${batch.length} 个文件 (Blender ${blender.version})`)

    const byPath = new Map(batch.map((j) => [j.src, j]))
    let stdout = ''
    let stderr = ''
    let lastActivity = Date.now()

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

    // 边收边处理：每转完一个立刻兑现对应的 promise，界面能增量刷新
    let buf = ''
    child.stdout!.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      if (stdout.length > 256 * 1024) stdout = stdout.slice(-128 * 1024)
      buf += s
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('BATCH_OK\t')) {
          lastActivity = Date.now()
          const src = line.slice('BATCH_OK\t'.length).trim()
          const job = byPath.get(src)
          if (job) void settle(job, true)
        } else if (line.startsWith('BATCH_ERR\t')) {
          lastActivity = Date.now()
          const parts = line.slice('BATCH_ERR\t'.length).split('\t')
          const job = byPath.get(parts[0]?.trim() ?? '')
          if (job) void settle(job, false, parts[1] ?? '未知错误')
        }
      }
    })
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    })

    // 看门狗：一个文件卡死不该让同批其它 11 个陪葬。
    // 距上一次有文件完成超过单文件上限就杀掉进程，只判当前那个失败，其余重新排队。
    const watchdog = setInterval(() => {
      const idle = Date.now() - lastActivity
      const limit = done.size === 0 ? STARTUP_GRACE_MS + PER_FILE_TIMEOUT_MS : PER_FILE_TIMEOUT_MS
      if (idle > limit && child && child.exitCode === null) {
        killedByWatchdog = true
        log.warn('blender', `看门狗：${Math.round(idle / 1000)}s 无进展，终止进程`)
        child.kill()
      }
    }, 2000)

    await new Promise<void>((resolve) => {
      child!.on('close', () => resolve())
      child!.on('error', () => resolve())
    })
    clearInterval(watchdog)

    const fatal = /BATCH_FATAL:\s*(.+)/.exec(stdout)?.[1]?.trim()
    const tail = stderr.trim().split(/\r?\n/).slice(-2).join(' ')

    if (killedByWatchdog) {
      // Blender 是按顺序处理的：第一个没完成的就是卡住的那个，判它超时；
      // 后面的还没开始，重新排队（最多重试一次，防止一个坏文件反复拖死进程）
      const remaining = batch.filter((j) => !done.has(j.src))
      const [stuck, ...rest] = remaining
      if (stuck) await settle(stuck, false, `转换超时（超过 ${PER_FILE_TIMEOUT_MS / 1000}s）`)
      for (const job of rest) {
        if (job.retries < 1) {
          job.retries++
          waiting.push(job)
        } else {
          await settle(job, false, '多次重试仍未完成')
        }
      }
      if (rest.length) scheduleFlush()
      return
    }

    // 整批崩了的话，剩下没兑现的在这里统一失败掉
    for (const job of batch) {
      await settle(job, false, fatal || tail || 'Blender 进程异常退出')
    }
  } catch (e) {
    log.error('blender', '批转换异常', e)
    for (const job of batch) {
      if (!done.has(job.src)) {
        done.add(job.src)
        job.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
  } finally {
    await fsp.rm(jobsFile, { force: true }).catch(() => {})
    for (const job of batch) {
      if (done.has(job.src)) await fsp.rm(job.tmp, { force: true }).catch(() => {})
    }
  }
}

/**
 * 无头调用 Blender 把 .blend 导出成 GLB。
 * 转换结果按文件身份缓存，第二次打开同一文件夹直接命中。
 */
export async function convertBlendToGlb(
  file: FileIdentity,
  userPath?: string | null
): Promise<ConvertResult> {
  const out = glbCachePath(file)
  if (await exists(out)) return { ok: true, glbPath: out }

  const running = inflight.get(out)
  if (running) return running

  const p = (async (): Promise<ConvertResult> => {
    const blender = await pickBlenderFor(file.path, userPath)
    if (!blender) return { ok: false, error: '未检测到 Blender 安装' }
    if (await exists(out)) return { ok: true, glbPath: out }

    await fsp.mkdir(path.dirname(out), { recursive: true })
    const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp.glb`

    return await new Promise<ConvertResult>((resolve) => {
      waiting.push({ src: file.path, out, tmp, blender, retries: 0, resolve })
      scheduleFlush()
    })
  })().finally(() => {
    inflight.delete(out)
  })

  inflight.set(out, p)
  return p
}

/**
 * 用 Blender 打开一个文件（GUI 模式）。
 *
 * .blend 直接作为位置参数；其它格式 Blender 的命令行是不认的
 * （只会报 "not a blend file"），得带一个 python 脚本调对应的导入算子。
 */
export async function openInBlender(
  filePath: string,
  userPath?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const install = await pickBlenderFor(filePath, userPath)
  if (!install) return { ok: false, error: '未检测到 Blender 安装' }
  const args = filePath.toLowerCase().endsWith('.blend')
    ? ['--disable-autoexec', filePath]
    : ['--disable-autoexec', '--python', resourcePath('blender_import.py'), '--', filePath]
  try {
    // detached + unref：让 Blender 独立活着，关掉预览器不会把它一起带走
    const child = spawn(install.exe, args, { detached: true, stdio: 'ignore' })
    child.unref()
    log.info('blender', `打开 ${path.basename(filePath)} (Blender ${install.version})`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
