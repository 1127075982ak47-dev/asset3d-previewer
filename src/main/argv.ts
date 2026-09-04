import fs from 'node:fs'
import path from 'node:path'

export type PathKind = 'dir' | 'file' | null

function statKind(p: string): PathKind {
  try {
    const st = fs.statSync(p)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null
  } catch {
    return null
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, '').trim()
}

/**
 * 从启动参数里解析出用户想打开的目录。
 *
 * 支持三种写法：
 *   --folder="D:\素材"       README 里写的形式
 *   --folder "D:\素材"       空格分隔
 *   "D:\素材"                位置参数：把文件夹直接拖到 exe 上时资源管理器就是这么传的
 *
 * 传的是文件则取它所在目录。开发模式下 argv[1] 是入口路径（"." 或脚本），要跳过。
 * 不依赖 electron，方便单测。
 */
export function parseLaunchArgs(
  argv: string[],
  opts: { isPackaged: boolean; kindOf?: (p: string) => PathKind } = { isPackaged: true }
): string | null {
  const kindOf = opts.kindOf ?? statKind
  // argv[0] 永远是可执行文件本身
  const args = argv.slice(opts.isPackaged ? 1 : 2)

  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--folder=')) {
      const v = stripQuotes(a.slice('--folder='.length))
      if (v) return normalizeTarget(v, kindOf)
      continue
    }
    if (a === '--folder') {
      const v = stripQuotes(args[i + 1] ?? '')
      i++
      if (v) return normalizeTarget(v, kindOf)
      continue
    }
    // 其它 --xxx 开关（Chromium/Electron 自己的）一律忽略
    if (a.startsWith('-')) continue
    positional.push(stripQuotes(a))
  }

  for (const p of positional) {
    const r = normalizeTarget(p, kindOf)
    if (r) return r
  }
  return null
}

function normalizeTarget(p: string, kindOf: (p: string) => PathKind): string | null {
  if (!p) return null
  const abs = path.resolve(p)
  const kind = kindOf(abs)
  if (kind === 'dir') return abs
  if (kind === 'file') return path.dirname(abs)
  return null
}
