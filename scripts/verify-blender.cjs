/** 实际调用 Blender 转换；输入只读，所有输出使用独立测试数据目录。 */
const fs = require('node:fs'), path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const input = process.argv[2]
if (!input || !fs.existsSync(input) || path.extname(input).toLowerCase() !== '.blend') throw new Error('需要一个真实 .blend 输入文件')
const dir = path.join(ROOT, '.verify-product-blender-input', String(Date.now()))
fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(input, path.join(dir, 'model.blend'))
process.env.ASSET3D_DATA_DIR ||= path.join(ROOT, '.verify-product-profile-blender')
process.argv.push(`--folder=${dir}`)
const { app, BrowserWindow, net } = require('electron')
require(path.join(ROOT, 'out/main/index.js'))
const delay = ms => new Promise(r => setTimeout(r, ms))
const timeout = setTimeout(() => app.exit(2), 120000)
app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows().find(w => w.isVisible()); if (!win) await delay(100) }
  const js = code => win.webContents.executeJavaScript(code, true)
  let scan
  for (let i = 0; i < 10; i++) {
    scan = await js(`window.api.scanFolder(${JSON.stringify(dir)}, {recursive:true,maxDepth:4})`)
    if (!scan.cancelled && scan.entries.length) break
    await delay(200)
  }
  const entry = scan.entries[0]
  if (!entry) throw new Error('未扫描到测试文件')
  const result = await js(`window.api.viewableUrl(${JSON.stringify(entry)})`)
  if (result.error || !result.url) throw new Error(JSON.stringify(result))
  const response = await net.fetch(result.url), data = Buffer.from(await response.arrayBuffer())
  if (data.subarray(0, 4).toString() !== 'glTF') throw new Error('转换结果不是 GLB')
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'))
  if (!json.meshes?.length) throw new Error('转换结果没有几何体')
  console.log(`PASS Blender 真实转换：${json.meshes.length} 个网格，${data.length} 字节 GLB`)
  fs.mkdirSync(path.join(ROOT, '.verify-reports'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, '.verify-reports/blender.json'), JSON.stringify({ passed:true, meshes:json.meshes.length, bytes:data.length }))
  clearTimeout(timeout); app.exit(0)
}).catch(err => { console.error(err); clearTimeout(timeout); app.exit(1) })
