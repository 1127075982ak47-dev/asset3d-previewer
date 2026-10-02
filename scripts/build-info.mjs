/** 将运行源码指纹写入包内，发布时拒绝同版本旧构建。文档更新不改变指纹。 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function sourceFingerprint() {
  const files = []
  function walk(relative) {
    for (const item of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name)
      if (item.isDirectory()) walk(name)
      else if (item.isFile()) files.push(name)
    }
  }
  for (const dir of ['src', 'resources', 'build']) walk(dir)
  files.push('package.json', 'package-lock.json', 'electron-builder.yml', 'electron.vite.config.ts')
  files.sort()
  if (!files.length) throw new Error('无法读取运行源码清单')
  const hash = createHash('sha256')
  for (const name of files) {
    let bytes = fs.readFileSync(path.join(ROOT, name))
    if (/\.(?:ts|tsx|js|mjs|cjs|json|py|yml|html|css|txt)$/.test(name)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
    hash.update(name).update('\0').update(bytes).update('\0')
  }
  return hash.digest('hex')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const info = { version: pkg.version, sourceSha256: sourceFingerprint(), createdAt: new Date().toISOString() }
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'out/build-info.json'), JSON.stringify(info, null, 2), 'utf8')
  console.log('构建源码指纹：', info.sourceSha256)
}
