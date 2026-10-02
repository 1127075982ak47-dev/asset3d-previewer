/** 实际主进程的故障回归：仅操作本脚本生成的文件与独立数据目录。 */
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')
const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, '.verify-product-files', String(Date.now()))
process.env.ASSET3D_DATA_DIR ||= path.join(ROOT, '.verify-product-profile-acceptance')
const { app, BrowserWindow, net, shell, dialog } = require('electron')
const delay = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}
function write(rel, data) { const p = path.join(DATA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p }
const OBJ = 'mtllib material.mtl\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nusemtl test\nf 1 2 3\n'
const first = write('assets/a/model.obj', OBJ); const second = write('assets/b/model.obj', OBJ)
write('assets/a/material.mtl', 'newmtl test\nKd 1 0 0\n'); write('assets/b/material.mtl', 'newmtl test\nKd 0 0 1\n')
fs.utimesSync(second, fs.statSync(first).atime, fs.statSync(first).mtime)
const openRoot = path.join(DATA, 'assets')
const blocked = write('assets/blocked.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
const trashable = write('assets/trashable.obj', OBJ)
write('outside/secret.txt', 'outside-resource-root')
fs.symlinkSync(path.join(DATA, 'outside'), path.join(openRoot, 'escape'), 'junction')
process.argv.push(`--folder=${openRoot}`)
require(path.join(ROOT, 'out/main/index.js'))
const timeout = setTimeout(() => { console.error('产品验收超时'); app.exit(2) }, 180000)

app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows().find(w => w.isVisible()); if (!win) await delay(100) }
  if (!win) throw new Error('主窗口未显示')
  const js = code => win.webContents.executeJavaScript(code, true)
  const api = async (method, ...args) => js(`window.api[${JSON.stringify(method)}](...${JSON.stringify(args)})`)
  let scan
  for (let i = 0; i < 10; i++) {
    scan = await api('scanFolder', openRoot, { recursive: true, maxDepth: 8 })
    if (!scan.cancelled && scan.entries.length >= 4) break
    await delay(200)
  }
  if (scan.cancelled || scan.entries.length < 4) throw new Error('测试素材未完成扫描')
  check('目录外 junction 不进入扫描结果', !scan.entries.some(e => e.rel.includes('escape')))
  const a = scan.entries.find(e => e.path === first), b = scan.entries.find(e => e.path === second)
  const req = { px: 256, priority: 0, lighting: 'studio', background: 'transparent' }
  const [ta, tb] = await Promise.all([api('requestThumb', a, req), api('requestThumb', b, req)])
  check('同名同大小模型具有独立缓存', ta.state === 'ready' && tb.state === 'ready' && ta.url !== tb.url)
  async function average(url) {
    const response = await net.fetch(url)
    const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()))
    const sums = [0, 0, 0]; let n = 0
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] > 128) { for (let c = 0; c < 3; c++) sums[c] += png.data[i + c]; n++ }
    return sums.map(s => s / Math.max(n, 1))
  }
  const [red, blue] = await Promise.all([average(ta.url), average(tb.url)])
  check('缩略图实际像素分别显示红色和蓝色', red[0] > red[2] * 1.3 && blue[2] > blue[0] * 1.3)
  write('assets/a/material.mtl', 'newmtl test\nKd 0 1 0\n')
  const changed = await api('requestThumb', a, req)
  const green = await average(changed.url)
  check('仅更新材质即重建缩略图', changed.url !== ta.url && green[1] > green[0] + 20 && green[1] > green[2] + 20, JSON.stringify({ newKey: changed.url !== ta.url, red, green }))
  const leaked = await net.fetch(`asset3d://local/${path.join(openRoot, 'escape/secret.txt').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`)
  check('协议拒绝目录外 junction', leaked.status === 403, String(leaked.status))
  const worker = BrowserWindow.getAllWindows().find(w => !w.isVisible())
  const surfaces = await worker.webContents.executeJavaScript('({ trash: typeof window.api.trashModels, decoder: typeof window.api.decoderUrl, worker: typeof window.workerApi })')
  check('worker 没有文件整理权限', surfaces.trash === 'undefined' && surfaces.decoder === 'function' && surfaces.worker === 'object')
  const forged = await js(`window.api.openInBlender(${JSON.stringify(path.join(DATA, 'outside/secret.txt'))}).then(() => false, () => true)`)
  check('IPC 拒绝未扫描的文件', forged)

  await api('pauseThumbs', true)
  const exported = await Promise.race([api('exportBatchTo', [a], path.join(DATA, 'export-glb'), { toGlb: true }), delay(15000).then(() => null)])
  const glb = path.join(DATA, 'export-glb/model.glb')
  check('暂停缩略图时 GLB 导出完成', exported?.ok && fs.existsSync(glb) && fs.readFileSync(glb).subarray(0, 4).toString() === 'glTF')
  await api('pauseThumbs', false)
  const copied = await api('exportBatchTo', [a], path.join(DATA, 'export-original'), {})
  check('原格式导出携带材质', copied.ok && fs.existsSync(path.join(DATA, 'export-original/material.mtl')))
  write('move-conflict/material.mtl', 'conflicting-material')
  const moved = await api('moveModels', [a], path.join(DATA, 'move-conflict'))
  check('依赖冲突阻止移动并保留源文件', !moved.ok && fs.existsSync(first) && !fs.existsSync(path.join(DATA, 'move-conflict/model.obj')))

  await api('setFavorites', [blocked, trashable], true)
  const originalTrash = shell.trashItem
  shell.trashItem = async p => { if (p === blocked) throw new Error('验收：模拟文件被占用'); return originalTrash(p) }
  let deleted
  try { deleted = await api('trashModels', [blocked, trashable]) } finally { shell.trashItem = originalTrash }
  const lib = await api('library')
  check('部分删除失败按完整路径返回结果', deleted.done === 1 && deleted.removedPaths.length === 1 && deleted.removedPaths[0] === trashable)
  check('删除失败的收藏与文件均保留', fs.existsSync(blocked) && lib.favorites.includes(blocked.toLowerCase()) && !lib.favorites.includes(trashable.toLowerCase()))

  const originalSave = dialog.showSaveDialog, originalOpen = dialog.showOpenDialog
  const backup = path.join(DATA, 'library-backup.json')
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup })
  try { await api('backupLibrary') } finally { dialog.showSaveDialog = originalSave }
  check('用户资源库备份保存完整', fs.existsSync(backup) && JSON.parse(fs.readFileSync(backup, 'utf8')).favorites.includes(blocked.toLowerCase()))
  const imported = JSON.parse(fs.readFileSync(backup, 'utf8')); imported.tags[blocked.toLowerCase()] = ['恢复验收']; fs.writeFileSync(backup, JSON.stringify(imported))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] })
  try { await api('restoreLibrary') } finally { dialog.showOpenDialog = originalOpen }
  check('备份导入合并标签', (await api('library')).tags[blocked.toLowerCase()]?.includes('恢复验收'))
  const pngRejected = await js(`window.api.setCustomThumb(${JSON.stringify(a)}, ${JSON.stringify(req)}, 'data:image/png;base64,eA==').then(() => false, () => true)`)
  check('拒绝伪造图片数据', pngRejected)
  await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '设置')?.click()`)
  await delay(200)
  await js(`Array.from(document.querySelectorAll('.snav')).find(b => b.textContent.trim() === '缓存与系统')?.click()`)
  await delay(200)
  check('设置中显示资源库备份、导入与 GPU 选项', await js(`(() => { const s = document.querySelector('.settings'); return !!s && ['备份资源库', '导入备份', 'GPU 硬件加速'].every(t => s.textContent.includes(t)) })()`))
  const output = path.join(ROOT, '.verify-reports'); fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'settings.png'), (await win.webContents.capturePage()).toPNG())
  const report = { version: (await api('appInfo')).version, electron: process.versions.electron, results, passed: results.every(r => r.ok) }
  fs.writeFileSync(path.join(output, 'product.json'), JSON.stringify(report, null, 2))
  console.log(`产品验收 ${results.length} 项，失败 ${results.filter(r => !r.ok).length}`)
  clearTimeout(timeout); app.exit(report.passed ? 0 : 1)
}).catch(err => { console.error(err); clearTimeout(timeout); app.exit(1) })
