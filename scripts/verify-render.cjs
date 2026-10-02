/**
 * 端到端验收：用真实素材跑通「协议 → 加载器 → 离屏渲染 → PNG」整条链路。
 *
 * 这个脚本复用打包产物 out/renderer/worker.html + out/preload/index.js，
 * 也就是应用里真正在跑的那份代码，不是另写一套模拟实现。
 *
 * 用法: npx electron scripts/verify-render.cjs <素材目录> [输出目录]
 */
const { app, BrowserWindow, protocol, net, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const ROOT = process.argv[2]
const OUT = process.argv[3] || path.join(__dirname, '..', '.verify-out')

if (!ROOT) {
  console.error('用法: electron scripts/verify-render.cjs <素材目录> [输出目录]')
  app.exit(2)
}

const APP_ROOT = path.join(__dirname, '..')
const DECODER_ROOT = path.join(APP_ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset3d',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

function pathToAssetUrl(abs) {
  const segs = abs.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent)
  return `asset3d://local/${segs.join('/')}`
}

const TEXTURE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.tif', '.tiff', '.webp', '.dds'])
const TEXTURE_SUBDIRS = ['', 'textures', 'Textures', 'texture', 'Texture', 'tex', 'maps', 'Maps', 'materials', 'Materials', 'images', 'Images']

/** 与 src/main/protocol.ts 中同名函数保持一致 */
function resolveTextureFallback(requested) {
  if (!TEXTURE_EXTS.has(path.extname(requested).toLowerCase())) return null
  const base = path.basename(requested)
  let dir = path.dirname(requested)
  for (let level = 0; level < 6 && dir; level++) {
    for (const sub of TEXTURE_SUBDIRS) {
      const candidate = path.join(dir, sub, base)
      if (candidate === requested) continue
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 统计 PNG 像素，用来判断这张缩略图是不是空的/纯色的 */
function analyzePng(buf) {
  const { PNG } = require(path.join(APP_ROOT, 'node_modules', 'pngjs'))
  const png = PNG.sync.read(buf)
  const { width, height, data } = png
  let opaque = 0
  const seen = new Set()
  let rs = 0
  let gs = 0
  let bs = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a > 24) {
      opaque++
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      rs += r
      gs += g
      bs += b
      // 量化到 5 bit，统计不同颜色数量
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
    }
  }
  const total = width * height
  return {
    width,
    height,
    coverage: opaque / total,
    distinctColors: seen.size,
    avg: opaque ? [Math.round(rs / opaque), Math.round(gs / opaque), Math.round(bs / opaque)] : [0, 0, 0]
  }
}

app.whenReady().then(async () => {
  protocol.handle('asset3d', async (request) => {
    const raw = request.url.split('#')[0].split('?')[0]
    const m = /^asset3d:\/\/([^/]+)\/(.*)$/i.exec(raw)
    if (!m) return new Response('bad', { status: 400 })
    const host = m[1].toLowerCase()
    const rest = m[2]
      .replace(/^\/+/, '')
      .split('/')
      .map((s) => {
        try {
          return decodeURIComponent(s)
        } catch {
          return s
        }
      })
      .join('/')
    try {
      if (host === 'local') {
        const target = path.normalize(rest)
        if (!fs.existsSync(target)) {
          const alt = resolveTextureFallback(target)
          if (alt) {
            console.log('  [兜底贴图]', path.basename(target), '->', alt)
            return await net.fetch(pathToFileURL(alt).toString())
          }
          return new Response('404', { status: 404 })
        }
        return await net.fetch(pathToFileURL(target).toString())
      }
      if (host === 'decoder') {
        return await net.fetch(
          pathToFileURL(path.normalize(path.join(DECODER_ROOT, rest))).toString()
        )
      }
    } catch (e) {
      return new Response('404', { status: 404 })
    }
    return new Response('404', { status: 404 })
  })

  // worker 通过 preload 调 app:decoderUrl 拿本地解码器地址
  ipcMain.handle('app:decoderUrl', (_e, sub) => `asset3d://decoder/${sub}`)

  fs.mkdirSync(OUT, { recursive: true })

  // ---- 1. 扫描：验证伴生文件抑制 ----
  const MESH = ['.glb', '.gltf', '.fbx', '.obj', '.stl', '.ply', '.dae', '.3ds', '.3mf', '.wrl', '.vrm', '.bvh']
  const all = []
  ;(function walk(dir, depth) {
    if (depth > 6) return
    let items
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const full = path.join(dir, it.name)
      if (it.isDirectory()) walk(full, depth + 1)
      else all.push(full)
    }
  })(ROOT, 0)

  const models = all.filter((f) => MESH.includes(path.extname(f).toLowerCase()))
  const companions = all.filter((f) =>
    ['.bin', '.mtl', '.png', '.jpg', '.jpeg', '.tga'].includes(
      path.extname(f).toLowerCase()
    )
  )

  console.log('='.repeat(64))
  console.log('素材目录:', ROOT)
  console.log(`总文件 ${all.length} · 模型 ${models.length} · 伴生(应隐藏) ${companions.length}`)
  console.log('='.repeat(64))

  if (models.length === 0) {
    console.error('没有找到模型文件')
    app.exit(1)
    return
  }

  // ---- 2. 起 worker 窗口 ----
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 640,
    webPreferences: {
      preload: path.join(APP_ROOT, 'out', 'preload', 'index.js'),
      sandbox: true,
      additionalArguments: ['--asset3d-worker'],
      backgroundThrottling: false
    }
  })

  win.webContents.on('console-message', event => {
    const { level, message } = event
    if ((level === 'warning' || level === 'error')) console.log('  [worker]', message)
  })

  await new Promise((resolve) => {
    ipcMain.once('worker:ready', resolve)
    win.loadFile(path.join(APP_ROOT, 'out', 'renderer', 'worker.html'))
  })
  console.log('worker 就绪\n')

  // ---- 3. 逐个出图 ----
  let jobId = 0
  const pending = new Map()
  ipcMain.on('worker:result', (_e, payload) => {
    const r = pending.get(payload.jobId)
    if (r) {
      pending.delete(payload.jobId)
      r(payload)
    }
  })

  function render(file) {
    const id = ++jobId
    return new Promise((resolve) => {
      pending.set(id, resolve)
      win.webContents.send('worker:render', {
        jobId: id,
        url: pathToAssetUrl(file),
        ext: path.extname(file).toLowerCase(),
        px: 512,
        diag: !!process.env.VERIFY_DIAG,
      })
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          resolve({ ok: false, error: '超时' })
        }
      }, 45000)
    })
  }

  const sample = models.slice(0, Number(process.env.VERIFY_LIMIT || 8))
  let ok = 0
  let fail = 0
  const failures = []
  const t0 = Date.now()

  for (const file of sample) {
    const name = path.basename(file)
    const started = Date.now()
    const res = await render(file)
    const ms = Date.now() - started

    if (res.ok && res.png && res.png.length > 0) {
      const buf = Buffer.from(res.png)
      const outFile = path.join(OUT, `${path.basename(file, path.extname(file))}${path.extname(file)}.png`)
      fs.writeFileSync(outFile, buf)
      const a = analyzePng(buf)
      const blank = a.coverage < 0.005
      const flat = a.distinctColors < 4
      const verdict = blank ? '空白!' : flat ? '疑似纯色' : 'OK'
      if (blank) {
        fail++
        failures.push(`${name}: 渲染出空白图`)
      } else ok++
      console.log(
        `${verdict.padEnd(9)} ${name.padEnd(34)} ${String(ms).padStart(5)}ms  ` +
          `覆盖 ${(a.coverage * 100).toFixed(1)}%  色数 ${String(a.distinctColors).padStart(4)}  ` +
          `均色 rgb(${a.avg.join(',')})  ${(buf.length / 1024).toFixed(0)}KB`
      )
      if (res.diag) console.dir(res.diag, { depth: 4 })
    } else {
      fail++
      failures.push(`${name}: ${res.error}`)
      console.log(`失败      ${name.padEnd(34)} ${String(ms).padStart(5)}ms  ${res.error}`)
    }
  }

  console.log('\n' + '='.repeat(64))
  console.log(
    `成功 ${ok} / ${sample.length}，失败 ${fail}，总耗时 ${Date.now() - t0}ms，` +
      `平均 ${Math.round((Date.now() - t0) / sample.length)}ms/张`
  )
  console.log('输出目录:', OUT)
  if (failures.length) {
    console.log('\n失败明细:')
    for (const f of failures) console.log('  -', f)
  }
  console.log('='.repeat(64))

  app.exit(fail > 0 ? 1 : 0)
})
