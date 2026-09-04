/**
 * UI 集成验收：启动真正的主进程（out/main/index.js），
 * 打开指定素材目录，等缩略图跑完，然后截图 + 读取界面状态。
 *
 * 关键点：out/main/index.js 自己会注册 app.whenReady()，
 * 我们在 require 之后再注册一个，Electron 按注册顺序执行，
 * 所以这里拿到的是应用完全初始化后的真实状态，不是模拟。
 *
 * 用法: npx electron scripts/verify-ui.cjs <素材目录>
 */
const path = require('node:path')
const fs = require('node:fs')

const ROOT = process.argv[2] || 'E:\\Desktop\\8月\\003\\FreePack\\GLTF'
const OUT = path.join(__dirname, '..', '.verify-ui')

// 让主进程以为是命令行带目录启动的
process.argv.push(`--folder=${ROOT}`)

const { app, BrowserWindow } = require('electron')
require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })

  // 等主窗口出现（worker 窗口是隐藏的，靠 isVisible 区分）
  let win = null
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    if (!win) await sleep(100)
  }
  if (!win) {
    console.error('没等到主窗口')
    app.exit(1)
    return
  }

  const js = (code) => win.webContents.executeJavaScript(code, true)

  // 等扫描 + 缩略图跑完
  let state = null
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    await sleep(500)
    state = await js(`(() => {
      const cards = document.querySelectorAll('.card');
      const imgs  = document.querySelectorAll('.card .thumb img');
      const spin  = document.querySelectorAll('.card .spinner');
      const fail  = document.querySelectorAll('.card .state.failed');
      const emb   = document.querySelectorAll('.card .state.embedded');
      const status = document.querySelector('.statusbar')?.innerText || '';
      const chips = [...document.querySelectorAll('.chip')].map(c => c.innerText);
      const names = [...document.querySelectorAll('.card .meta .name')].map(n => n.innerText);
      return {
        cards: cards.length, imgs: imgs.length, spinners: spin.length,
        failed: fail.length, embedded: emb.length,
        status, chips, names: names.slice(0, 5),
        scrollH: document.querySelector('.grid-inner')?.style.height || null
      };
    })()`)
    if (state.cards > 0 && state.spinners === 0) break
  }

  console.log('='.repeat(64))
  console.log('素材目录:', ROOT)
  console.log('='.repeat(64))
  console.log('可见卡片数(虚拟化窗口内):', state.cards)
  console.log('已出图:', state.imgs, ' 转圈中:', state.spinners, ' 失败:', state.failed)
  console.log('内嵌图(.blend):', state.embedded)
  console.log('格式筛选 chips:', state.chips.join(' | '))
  console.log('前几个模型:', state.names.join(', '))
  console.log('网格总高度:', state.scrollH)
  console.log('状态栏:', state.status.replace(/\s+/g, ' '))

  // 截图主界面
  const shot = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, 'grid.png'), shot.toPNG())
  console.log('\n网格截图 ->', path.join(OUT, 'grid.png'))

  // 双击第一张卡片，进详情查看器
  await js(`(() => {
    const c = document.querySelector('.card');
    if (!c) return false;
    c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  })()`)

  // 等模型在查看器里加载完
  let viewer = null
  const vDeadline = Date.now() + 60000
  while (Date.now() < vDeadline) {
    await sleep(500)
    viewer = await js(`(() => {
      const v = document.querySelector('.viewer');
      if (!v) return null;
      return {
        open: true,
        loading: !!v.querySelector('.loading'),
        error: v.querySelector('.verror .detail')?.innerText || null,
        title: v.querySelector('.title')?.innerText || null,
        idx: v.querySelector('.idx')?.innerText || null,
        panel: v.querySelector('.panel')?.innerText.replace(/\\s+/g, ' ') || null,
        canvas: !!v.querySelector('canvas'),
        hud: !!v.querySelector('.hud')
      };
    })()`)
    if (viewer && !viewer.loading) break
  }

  console.log('\n' + '='.repeat(64))
  if (!viewer) {
    console.log('查看器没有打开！')
  } else {
    console.log('查看器已打开:', viewer.title, viewer.idx)
    console.log('canvas 存在:', viewer.canvas, ' 操作提示存在:', viewer.hud)
    console.log('错误:', viewer.error || '无')
    console.log('信息面板:', viewer.panel)
  }

  await sleep(800)
  const shot2 = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, 'viewer.png'), shot2.toPNG())
  console.log('查看器截图 ->', path.join(OUT, 'viewer.png'))

  // ---- 拖拽旋转 / 滚轮缩放 ----
  // 用 sendInputEvent 发真实输入事件，而不是 dispatchEvent 造合成事件：
  // OrbitControls 会调 setPointerCapture，合成的 pointerId 会让它抛异常。
  const before = (await win.webContents.capturePage()).toPNG()

  const [cx, cy] = await js(`(() => {
    const c = document.querySelector('.viewer canvas');
    const r = c.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  })()`)

  win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 12; i++) {
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: cx + i * 14,
      y: cy + i * 3,
      button: 'left',
      buttons: 1
    })
    await sleep(16)
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: cx + 168, y: cy + 36, button: 'left', clickCount: 1 })
  await sleep(700)

  const afterRotate = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, 'viewer-rotated.png'), afterRotate)

  win.webContents.sendInputEvent({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -420, canScroll: true })
  await sleep(700)
  const afterZoom = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, 'viewer-zoomed.png'), afterZoom)

  const { PNG } = require(path.join(__dirname, '..', 'node_modules', 'pngjs'))
  const diffRatio = (a, b) => {
    const pa = PNG.sync.read(a)
    const pb = PNG.sync.read(b)
    if (pa.width !== pb.width || pa.height !== pb.height) return 1
    let diff = 0
    for (let i = 0; i < pa.data.length; i += 4) {
      if (Math.abs(pa.data[i] - pb.data[i]) > 8) diff++
    }
    return diff / (pa.width * pa.height)
  }

  const rotDiff = diffRatio(before, afterRotate)
  const zoomDiff = diffRatio(afterRotate, afterZoom)
  console.log(`\n拖拽旋转后画面变化: ${(rotDiff * 100).toFixed(1)}%  ${rotDiff > 0.01 ? '✓' : '✗ 没转动'}`)
  console.log(`滚轮缩放后画面变化: ${(zoomDiff * 100).toFixed(1)}%  ${zoomDiff > 0.01 ? '✓' : '✗ 没缩放'}`)

  // ---- 键盘切换模型 ----
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await sleep(2500)
  const next = await js(
    `document.querySelector('.viewer .title')?.innerText + ' | ' + document.querySelector('.viewer .idx')?.innerText`
  )
  console.log('按 → 之后:', next)

  const shot3 = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, 'viewer-next.png'), shot3.toPNG())
  console.log('='.repeat(64))

  const ok =
    state.cards > 0 &&
    state.failed === 0 &&
    viewer &&
    !viewer.error &&
    viewer.canvas &&
    rotDiff > 0.01 &&
    zoomDiff > 0.01 &&
    /\b2 \/ \d+/.test(next)
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
