import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 配置先完整写入临时文件、同步到磁盘，再替换。保留上一份合法 JSON。 */
export function writeJsonAtomic(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = fs.openSync(temp, 'wx')
    fs.writeFileSync(fd, text, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    if (fs.existsSync(file)) {
      // 损坏的主文件不能覆盖仍然有效的备份。
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'))
        fs.copyFileSync(file, `${file}.bak`)
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err
      }
    }
    fs.renameSync(temp, file)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(temp, { force: true })
  }
}

export function readJsonRecover<T>(file: string, fallback: () => T): T {
  for (const candidate of [file, `${file}.bak`]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')) as T
    } catch {
      // 主文件被中断或损坏时读上一次完整保存的版本。
    }
  }
  return fallback()
}
