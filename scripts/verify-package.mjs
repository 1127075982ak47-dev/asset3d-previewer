/** 启动真实 EXE 的便携副本，验证版本、扫描、查看器、单实例和退出。 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2] || path.join(ROOT, 'release/win-unpacked')
const models = process.argv[3]
if (!models || !fs.statSync(models).isDirectory()) throw new Error('用法：node scripts/verify-package.mjs <win-unpacked 目录> <模型目录>')
const stage = fs.mkdtempSync(path.join(ROOT, '.verify-product-packaged-'))
const dir = path.join(stage, 'app')
fs.cpSync(source, dir, { recursive: true, filter: p => path.relative(source, p).split(path.sep)[0] !== 'data' })
const exe = path.join(dir, '3D资源预览器.exe')
const port = 19000 + Math.floor(Math.random() * 10000)
const results = []
const delay = ms => new Promise(r => setTimeout(r, ms))
const env = { ...process.env }; delete env.ASSET3D_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE
let child, socket
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`); if (!ok) throw new Error(name) }
async function waitFor(action, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await action(); if (value) return value; await delay(200) }
  throw new Error('等待超时')
}
let seq = 0
const pending = new Map()
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function js(expression) {
  const r = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
try {
  child = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--folder=${models}`], { env, stdio: 'ignore', windowsHide: true })
  const target = await waitFor(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && /index\.html/.test(t.url)) } catch { return null }
  })
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', e => {
    const msg = JSON.parse(e.data), promise = pending.get(msg.id)
    if (promise) { pending.delete(msg.id); if (msg.error) promise.reject(new Error(JSON.stringify(msg.error))); else promise.resolve(msg.result) }
  })
  await waitFor(() => js(`typeof window.api === 'object' && document.querySelectorAll('.card').length > 0`))
  const info = await js('window.api.appInfo()')
  check('真实 EXE 版本与 Electron 正确', info.version === '1.3.0' && info.electron === '44.5.1', JSON.stringify(info))
  check('便携数据位于 EXE 同级 data', info.portable && path.resolve(info.dataDir) === path.join(dir, 'data'))
  await waitFor(() => js(`document.querySelectorAll('.card .thumb img').length > 0 && document.querySelectorAll('.card .spinner').length === 0`))
  check('真实 EXE 缩略图生成', await js(`document.querySelectorAll('.card .thumb img').length > 0 && document.querySelectorAll('.card .state.failed').length === 0`))
  await js(`document.querySelector('.card').dispatchEvent(new MouseEvent('dblclick', { bubbles:true }))`)
  await waitFor(() => js(`!!document.querySelector('.viewer canvas') && !document.querySelector('.viewer .loading')`))
  check('真实 EXE 打开 3D 查看器', await js(`!!document.querySelector('.viewer canvas') && !document.querySelector('.viewer .v-error')`))
  const reportDir = path.join(ROOT, '.verify-reports'); fs.mkdirSync(reportDir, { recursive: true })
  const image = await rpc('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(reportDir, 'packaged-viewer.png'), Buffer.from(image.data, 'base64'))
  await js(`document.querySelector('.viewer .vtop button')?.click()`)
  const second = spawn(exe, [`--folder=${models}`], { env, stdio: 'ignore', windowsHide: true })
  const code = await Promise.race([new Promise((resolve, reject) => { second.on('exit', resolve); second.on('error', reject) }), delay(10000).then(() => 'timeout')])
  check('第二实例交接后退出', code === 0, String(code))
  check('程序包含用户说明与许可文件', ['使用说明.txt', '第三方许可说明.txt', 'LICENSE.txt', 'LICENSES.chromium.html'].every(f => fs.existsSync(path.join(dir, f))))
  await js('setTimeout(() => window.close(), 100); true')
  await waitFor(async () => child.exitCode !== null, 15000)
  socket.close(); socket = null
  await delay(500)
  const psLiteral = dir.replace(/'/g, "''")
  const count = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${psLiteral}', [System.StringComparison]::OrdinalIgnoreCase) }).Count`], { encoding: 'utf8' }).trim())
  check('关闭后所有本次 EXE 进程退出', count === 0, String(count))
  fs.writeFileSync(path.join(reportDir, 'packaged.json'), JSON.stringify({ passed: true, info, results }, null, 2))
  console.log(`真实发布程序 ${results.length} 项验收通过`)
} finally {
  socket?.close()
  if (child?.pid && child.exitCode === null) {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  const relative = path.relative(ROOT, stage)
  if (!relative.startsWith('.verify-product-packaged-') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('便携测试目录越界')
  fs.rmSync(stage, { recursive: true, force: true })
}
