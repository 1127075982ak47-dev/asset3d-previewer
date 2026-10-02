import fs from 'node:fs'
import path from 'node:path'

/**
 * 极简文件日志。不引第三方库 —— 绿色版要的是零依赖、可直接打开看的文本。
 *
 * 写到 <data>/logs/app.log，超过 2 MB 轮转，保留 3 份。
 * 同步追加写：主进程日志量很小，同步写换来的是崩溃前最后一行也不丢。
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 3

let dir: string | null = null
let file: string | null = null
let debugEnabled = !!process.env['ASSET3D_DEBUG']

export function initLog(logDir: string, opts: { debug?: boolean } = {}): void {
  try {
    fs.mkdirSync(logDir, { recursive: true })
    dir = logDir
    file = path.join(logDir, 'app.log')
    if (opts.debug !== undefined) debugEnabled = opts.debug
  } catch {
    dir = null
    file = null
  }
}

export function logDirectory(): string | null {
  return dir
}

export function logFile(): string | null {
  return file
}

function ts(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  )
}

function fmtExtra(extra: unknown): string {
  if (extra === undefined) return ''
  if (extra instanceof Error) return ` ${extra.stack ?? extra.message}`
  try {
    return ' ' + JSON.stringify(extra)
  } catch {
    return ` ${String(extra)}`
  }
}

function rotate(): void {
  if (!file) return
  try {
    const st = fs.statSync(file)
    if (st.size < MAX_BYTES) return
  } catch {
    return
  }
  try {
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${file}.${i}`
      const to = `${file}.${i + 1}`
      if (fs.existsSync(from)) fs.renameSync(from, to)
    }
    fs.renameSync(file, `${file}.1`)
  } catch {
    /* 轮转失败就继续往同一个文件写，不能因此丢日志 */
  }
}

let lineCount = 0

let consoleAvailable = true
function write(level: Level, scope: string, msg: string, extra?: unknown, toConsole = true): void {
  const line = `${ts()} [${level.toUpperCase().padEnd(5)}] ${scope}: ${msg}${fmtExtra(extra)}`
  const con = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (consoleAvailable && toConsole) {
    try { con(line) } catch { consoleAvailable = false }
  }
  if (!file || level === 'debug') return
  try {
    // 每 200 行检查一次大小，别每行都 stat
    if (lineCount++ % 200 === 0) rotate()
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {
    /* 只读介质 */
  }
}

export const log = {
  debug: (scope: string, msg: string, extra?: unknown): void => {
    if (debugEnabled) write('debug', scope, msg, extra)
  },
  info: (scope: string, msg: string, extra?: unknown): void => write('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown): void => write('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown): void => write('error', scope, msg, extra)
}

/** 主进程的最后一道网：未捕获异常只记录不退出，一个坏文件不该带崩整个程序 */
export function installGlobalHandlers(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', () => { consoleAvailable = false })
  }
  process.on('uncaughtException', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') { consoleAvailable = false; return }
    write('error', 'process', 'uncaughtException', err, false)
  })
  process.on('unhandledRejection', (reason) => {
    write('error', 'process', 'unhandledRejection', reason, false)
  })
}
