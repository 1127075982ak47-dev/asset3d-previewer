/**
 * 打完包之后的收尾：把绿色版 zip 和源码 zip 复制到发布目录。
 *
 * 绿色版 zip 由 electron-builder 的 zip target 生成（release/*.zip）；
 * 源码 zip 用 git archive 从当前提交导出，只含被跟踪的文件，
 * node_modules / out / release / .dev-data 天然不会混进去。
 *
 * 用法: node scripts/make-release.mjs [发布目录]
 *   默认发布目录是工程的上一级（D:\Projects\Asset3D）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const productName = '3D资源预览器'
const dest = path.resolve(process.argv[2] || path.join(ROOT, '..'))

fs.mkdirSync(dest, { recursive: true })

// 1. 绿色版 zip
const releaseDir = path.join(ROOT, 'release')
const appZipName = `${productName}-v${version}-win64-绿色版.zip`
const built = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((f) => f.endsWith('.zip'))
  : []
if (built.length === 0) {
  console.error('release/ 里没有 zip，先跑 npm run pack')
  process.exit(1)
}
// electron-builder 的 artifactName 已经是我们要的名字；保险起见按版本匹配
const appZip = built.find((f) => f.includes(version)) ?? built[0]
fs.copyFileSync(path.join(releaseDir, appZip), path.join(dest, appZipName))
console.log('绿色版 ->', path.join(dest, appZipName), `(${(fs.statSync(path.join(dest, appZipName)).size / 1024 / 1024).toFixed(1)} MB)`)

// 2. 源码 zip
const srcZipName = `${productName}-v${version}-源码工程.zip`
const srcZip = path.join(dest, srcZipName)
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
if (dirty) {
  console.warn('注意：工作区有未提交的改动，源码包只包含已提交的内容：\n' + dirty)
}
execFileSync('git', ['archive', '--format=zip', '-o', srcZip, 'HEAD'], { cwd: ROOT, stdio: 'inherit' })
console.log('源码包 ->', srcZip, `(${(fs.statSync(srcZip).size / 1024).toFixed(0)} KB)`)
