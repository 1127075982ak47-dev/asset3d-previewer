/** 从同一干净提交发布绿色版、源码和完整 Git 开发包，并生成 SHA256 清单。 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'three/examples/jsm/libs/fflate.module.js'
import asar from '@electron/asar'
import { sourceFingerprint } from './build-info.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version, product = '3D资源预览器'
const dest = path.resolve(process.argv[2] || path.join(ROOT, '..'))
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (git(['status', '--porcelain'])) throw new Error('发布前必须提交全部改动，避免源码包和程序不同步')
const commit = git(['rev-parse', 'HEAD'])
const committed = JSON.parse(git(['show', 'HEAD:package.json']))
if (committed.version !== version) throw new Error('提交中的版本与工作区不一致')
const appName = `${product}-v${version}-win64-绿色版.zip`
const appZip = path.join(ROOT, 'release', appName)
if (!fs.existsSync(appZip)) throw new Error(`缺少对应版本的绿色包，请先运行 npm run pack：${appName}`)
const packedAsar = path.join(ROOT, 'release/win-unpacked/resources/app.asar')
const build = JSON.parse(asar.extractFile(packedAsar, 'out/build-info.json').toString('utf8'))
if (build.version !== version || build.sourceSha256 !== sourceFingerprint()) throw new Error('程序包与当前运行源码不同，请重新 npm run pack')
const zippedAsar = Object.entries(unzipSync(fs.readFileSync(appZip), { filter: file => file.name.endsWith('resources/app.asar') }))
if (zippedAsar.length !== 1 || createHash('sha256').update(zippedAsar[0][1]).digest('hex') !== createHash('sha256').update(fs.readFileSync(packedAsar)).digest('hex')) throw new Error('绿色 ZIP 与当前 EXE 构建不一致')
const stage = fs.mkdtempSync(path.join(ROOT, '.verify-product-release-'))
const outputs = [appName, `${product}-v${version}-源码工程.zip`, `${product}-v${version}-开发工程完整包（含git历史）.zip`]
try {
  const source = path.join(stage, 'source.zip')
  execFileSync('git', ['archive', '--format=zip', '-o', source, commit], { cwd: ROOT, stdio: 'inherit' })
  const bundle = path.join(stage, 'history.bundle')
  execFileSync('git', ['bundle', 'create', bundle, '--all'], { cwd: ROOT, stdio: 'inherit' })
  const repo = path.join(stage, 'history')
  const branch = git(['branch', '--show-current'])
  const cloneArgs = ['clone', '--no-checkout', ...(branch ? ['--branch', branch] : []), bundle, repo]
  execFileSync('git', cloneArgs, { cwd: ROOT, stdio: 'ignore' })
  execFileSync('git', ['reset', '--mixed', commit], { cwd: repo, stdio: 'ignore' })
  const files = {}
  for (const [name, bytes] of Object.entries(unzipSync(fs.readFileSync(source)))) files[`asset3d-previewer/${name}`] = bytes
  const gitDir = path.join(repo, '.git')
  function add(relative) {
    const target = path.join(gitDir, relative)
    if (!fs.existsSync(target)) return
    if (fs.statSync(target).isDirectory()) for (const name of fs.readdirSync(target)) add(path.posix.join(relative, name))
    else files[`asset3d-previewer/.git/${relative}`] = new Uint8Array(fs.readFileSync(target))
  }
  for (const name of ['HEAD', 'index', 'packed-refs', 'refs', 'objects']) add(name)
  // 不携带源仓库远端 URL、用户身份、hooks、reflog 或机器路径。
  files['asset3d-previewer/.git/config'] = new TextEncoder().encode('[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n\tignorecase = true\n')
  const dev = path.join(stage, 'developer.zip')
  fs.writeFileSync(dev, zipSync(files, { level: 6 }))
  fs.mkdirSync(dest, { recursive: true })
  for (const [index, sourceFile] of [appZip, source, dev].entries()) {
    const output = path.join(dest, outputs[index])
    fs.copyFileSync(sourceFile, output)
    console.log(`${output} (${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB)`)
  }
  const sha256 = async file => {
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    return hash.digest('hex')
  }
  const manifest = { product, version, commit, sourceSha256: build.sourceSha256, createdAt: new Date().toISOString(), electron: pkg.devDependencies.electron, artifacts: [] }
  for (const name of outputs) manifest.artifacts.push({ name, bytes: fs.statSync(path.join(dest, name)).size, sha256: await sha256(path.join(dest, name)) })
  fs.writeFileSync(path.join(dest, `${product}-v${version}-发布清单.json`), JSON.stringify(manifest, null, 2), 'utf8')
  console.log('三个发布包与 SHA256 清单已生成；旧版本保留。')
} finally {
  const relative = path.relative(ROOT, stage)
  if (!relative.startsWith('.verify-product-release-') || path.isAbsolute(relative) || relative.includes('..')) throw new Error('临时目录清理边界异常')
  fs.rmSync(stage, { recursive: true, force: true })
}
