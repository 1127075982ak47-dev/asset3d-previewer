/** 国内镜像下载 Electron，使用 npm 包内官方 SHA256 校验，安全解压。 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electron = path.join(root, 'node_modules/electron')
const version = JSON.parse(fs.readFileSync(path.join(electron, 'package.json'), 'utf8')).version
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('本工程的发布与安装脚本面向 Windows x64')
const dist = path.join(electron, 'dist')
if (fs.existsSync(path.join(dist, 'electron.exe')) && fs.existsSync(path.join(dist, 'version')) && fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '') === version) {
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron.exe')
  console.log(`Electron ${version} 已就绪`)
} else {
  const name = `electron-v${version}-win32-x64.zip`
  const expected = JSON.parse(fs.readFileSync(path.join(electron, 'checksums.json'), 'utf8'))[name]
  if (!expected) throw new Error('缺少官方校验值，停止安装')
  const urls = [
    `https://npmmirror.com/mirrors/electron/${version}/${name}`,
    `https://github.com/electron/electron/releases/download/v${version}/${name}`
  ]
  let archive
  for (const url of urls) {
    try {
      console.log(`下载 Electron ${version}：${url}`)
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('SHA256 校验不匹配')
      archive = bytes
      break
    } catch (err) { console.warn(String(err)) }
  }
  if (!archive) throw new Error('下载失败，请检查网络后重跑 npm run setup')
  for (const [name, data] of Object.entries(unzipSync(archive))) {
    const target = path.resolve(dist, name)
    const relative = path.relative(dist, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('压缩包路径越界')
    if (name.endsWith('/')) fs.mkdirSync(target, { recursive: true })
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data) }
  }
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron.exe')
  console.log(`Electron ${version} 安装完成，SHA256 已核验`)
}
