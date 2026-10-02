/**
 * 查看器专项验收：启动真实主进程，打开目录，进查看器，
 * 逐个切换显示模式 / AO / 阴影 / 线框叠加 / HDRI / 背景可见 / 正交 / 视角预设，
 * 每一步截图并收集渲染进程的报错，任何一步报错都算失败。
 *
 * 用法: npx electron scripts/verify-viewer.cjs <素材目录>
 */
const path = require('node:path')
const fs = require('node:fs')

const ROOT = process.argv[2]
if (!ROOT) {
  console.error('用法: npx electron scripts/verify-viewer.cjs <素材目录>')
  process.exit(2)
}
const OUT = path.join(__dirname, '..', '.verify-viewer')
process.argv.push(`--folder=${ROOT}`)

const { app, BrowserWindow } = require('electron')
require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
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
  const errors = []
  win.webContents.on('console-message', event => {
    const { level, message } = event
    if ((level === 'warning' || level === 'error') && !/Electron Security Warning/.test(message)) errors.push(message)
  })
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const shot = async (name) => {
    await sleep(500)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG())
  }

  // 等卡片出现
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const n = await js(`document.querySelectorAll('.card').length`)
    if (n > 0) break
  }
  await js(`document.querySelector('.card').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const st = await js(`(() => { const v = document.querySelector('.viewer'); return v ? { loading: !!v.querySelector('.loading'), error: v.querySelector('.verror .detail')?.innerText || null } : null })()`)
    if (st && !st.loading) {
      if (st.error) {
        console.error('查看器加载失败:', st.error)
        app.exit(1)
        return
      }
      break
    }
  }
  console.log('查看器已加载，开始逐项切换')

  const results = []
  const step = async (name, code) => {
    const before = errors.length
    try {
      await js(code)
    } catch (e) {
      errors.push(`执行 ${name} 抛异常: ${e.message}`)
    }
    await shot(name)
    const newErr = errors.slice(before)
    results.push({ name, ok: newErr.length === 0, err: newErr })
    console.log(`${newErr.length === 0 ? 'OK  ' : 'FAIL'} ${name}${newErr.length ? '  ' + newErr.join(' | ').slice(0, 200) : ''}`)
  }

  const clickButtonWithText = (selector, text) =>
    `(() => { const b = [...document.querySelectorAll('${selector} button')].find(x => x.textContent.trim().startsWith('${text}')); if (!b) throw new Error('没有按钮 ${text}'); b.click(); return true })()`
  const clickTab = (label) =>
    `(() => { const t = [...document.querySelectorAll('.vtab')].find(x => x.textContent.trim() === '${label}'); if (!t) throw new Error('没有标签 ${label}'); t.click(); return true })()`
  const toggle = (label, on) =>
    `(() => { const l = [...document.querySelectorAll('.prow.toggle')].find(x => x.textContent.includes('${label}')); if (!l) throw new Error('没有开关 ${label}'); const c = l.querySelector('input'); if (c.checked !== ${on}) c.click(); return true })()`

  await step('00-material', clickTab('显示'))
  for (const m of ['白膜', '雕塑', '法线', 'UV 棋盘', '线框', '透视', '材质']) {
    await step(`mode-${m}`, clickButtonWithText('.mode-grid', m))
  }
  await step('flat-on', clickButtonWithText('.prow.seg', '平直'))
  await step('flat-off', clickButtonWithText('.prow.seg', '平滑'))
  await step('wire-overlay-on', toggle('线框叠加', true))
  await step('wire-overlay-off', toggle('线框叠加', false))
  await step('ao-on', toggle('环境光遮蔽', true))
  await sleep(800)
  await step('ao-still-on', 'true')
  await step('ao-off', toggle('环境光遮蔽', false))
  await step('bg-white', `document.querySelectorAll('.prow.seg button[title="纯白"]')[0].click()`)
  await step('shadow-on', toggle('地面阴影', true))
  await step('shadow-off', toggle('地面阴影', false))
  await step('bg-dark', `document.querySelectorAll('.prow.seg button[title="深灰"]')[0].click()`)
  await step('shadow-on-dark', toggle('地面阴影', true))
  await step('shadow-off-dark', toggle('地面阴影', false))

  await step('env-tab', clickTab('环境'))
  const hdriCount = await js(`document.querySelectorAll('.hdri-item').length`)
  console.log('HDRI 条目数（含程序化房间）:', hdriCount)
  if (hdriCount > 1) {
    await step('hdri-1', `document.querySelectorAll('.hdri-item')[1].click()`)
    await sleep(1500)
    await step('hdri-1-loaded', 'true')
    await step('hdri-visible', toggle('显示为背景', true))
    await sleep(500)
    await step('hdri-visible-shot', 'true')
    await step('hdri-hidden', toggle('显示为背景', false))
    await step('hdri-room', `document.querySelectorAll('.hdri-item')[0].click()`)
  }

  await step('camera-tab', clickTab('相机'))
  await step('ortho', clickButtonWithText('.prow.seg', '正交'))
  await step('persp', clickButtonWithText('.prow.seg', '透视'))
  for (const v of ['前', '顶', '右', '等轴']) await step(`view-${v}`, clickButtonWithText('.mode-grid', v))
  await step('autorotate', toggle('自动旋转', true))
  await sleep(600)
  await step('autorotate-off', toggle('自动旋转', false))

  /* ---- 1.2 新增：贴图通道 ---- */
  await step('display-tab', clickTab('显示'))
  for (const m of ['基础色', '粗糙度', '金属度', '法线贴图', 'AO 贴图', '自发光', '顶点色']) {
    await step(`channel-${m}`, clickButtonWithText('.mode-grid', m))
  }
  await step('channel-back', clickButtonWithText('.mode-grid', '材质'))
  await step('viewhelper-off', toggle('导航球', false))
  await step('viewhelper-on', toggle('导航球', true))

  /* ---- 环境：曝光 / 色调映射 / 光方向 ---- */
  const setSlider = (label, v) =>
    `(() => { const r = [...document.querySelectorAll('.prow.slider')].find(x => x.textContent.includes('${label}')); if (!r) throw new Error('没有滑块 ${label}'); const i = r.querySelector('input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${v}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
  const setSelect = (rowText, value) =>
    `(() => { const r = [...document.querySelectorAll('.prow')].find(x => x.textContent.includes('${rowText}')); const sel = r && r.querySelector('select'); if (!sel) throw new Error('没有下拉 ${rowText}'); const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(sel, '${value}'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
  await step('env-tab2', clickTab('环境'))
  await step('exposure-2', setSlider('曝光', 2))
  await step('exposure-1', setSlider('曝光', 1))
  await step('tonemap-agx', setSelect('色调映射', 'agx'))
  await step('tonemap-neutral', setSelect('色调映射', 'neutral'))
  await step('tonemap-aces', setSelect('色调映射', 'aces'))
  await step('light-rot', setSlider('光方向', 120))
  await step('light-int', setSlider('光强度', 1.6))
  await step('light-reset', setSlider('光方向', 0))
  await step('light-int-reset', setSlider('光强度', 1))

  /* ---- 工具：剖切 / 测量 / 法线 / HUD ---- */
  await step('tools-tab', clickTab('工具'))
  await step('clip-on', toggle('启用剖切平面', true))
  await step('clip-z', clickButtonWithText('.prow.seg', 'Z 轴'))
  await step('clip-pos', setSlider('位置', 0.3))
  await step('clip-flip', toggle('翻转保留侧', true))
  await step('clip-flip-off', toggle('翻转保留侧', false))
  await step('clip-off', toggle('启用剖切平面', false))

  const rect = await js(`(() => { const r = document.querySelector('.viewer .stage canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()`)
  const cx = Math.round(rect[0] + rect[2] / 2)
  const cy = Math.round(rect[1] + rect[3] / 2)
  const realClick = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await sleep(40)
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await sleep(200)
  }
  await step('measure-on', toggle('两点测距', true))
  // 模型形状未知，围绕画布中心多试几个落点，直到两个点都落在表面上
  let measured = { label: null, hud: '' }
  const offsets = [[0, 0], [20, -20], [-25, 15], [40, 0], [0, 35], [-40, -30], [60, 25]]
  for (const [dx, dy] of offsets) {
    await realClick(cx + dx, cy + dy)
    await sleep(250)
    measured = await js(`(() => { const l = document.querySelector('.measure-label'); const hud = document.querySelector('.measure-hud')?.textContent || ''; return { label: l && !l.hidden ? l.textContent : null, hud } })()`)
    if (/距离/.test(measured.hud)) break
  }
  console.log('测量:', JSON.stringify(measured))
  results.push({ name: 'measure-distance', ok: /距离/.test(measured.hud), err: /距离/.test(measured.hud) ? [] : ['两点测量没有得到距离'] })
  await step('measure-shot', 'true')
  await step('measure-off', toggle('两点测距', false))
  await step('normals-on', toggle('顶点法线', true))
  await step('normals-off', toggle('顶点法线', false))
  await step('hud-on', toggle('性能 HUD', true))
  await sleep(900)
  const hud = await js(`document.querySelector('.stats-hud')?.textContent || null`)
  console.log('性能 HUD:', hud)
  await step('hud-off', toggle('性能 HUD', false))
  const skelDisabled = await js(`(() => { const l = [...document.querySelectorAll('.prow.toggle')].find(x => x.textContent.includes('骨骼')); return l ? l.querySelector('input').disabled : null })()`)
  if (skelDisabled === false) {
    await step('skeleton-on', toggle('骨骼', true))
    await step('skeleton-off', toggle('骨骼', false))
  }

  /* ---- 导航球：点右下角的轴 ---- */
  const beforeHelper = (await win.webContents.capturePage()).toPNG()
  // X 轴的球大致在导航球中心偏右；点导航球中心右侧 35px
  await realClick(Math.round(rect[0] + rect[2] - 64 + 36), Math.round(rect[1] + rect[3] - 64))
  await sleep(1200)
  const afterHelper = (await win.webContents.capturePage()).toPNG()
  {
    const { PNG } = require(path.join(__dirname, '..', 'node_modules', 'pngjs'))
    const a = PNG.sync.read(beforeHelper)
    const b = PNG.sync.read(afterHelper)
    let diff = 0
    for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 8) diff++
    const ratio = diff / (a.width * a.height)
    console.log(`导航球点击后画面变化: ${(ratio * 100).toFixed(1)}%`)
    results.push({ name: 'viewhelper-click', ok: ratio > 0.005, err: ratio > 0.005 ? [] : ['点击导航球后画面没变'] })
  }
  await step('viewhelper-shot', 'true')

  /* ---- 设为缩略图 ---- */
  await step('set-thumb', clickButtonWithText('.viewer .vtop', '设为缩略图'))
  await sleep(1500)
  const thumbWarn = await js(`document.querySelector('.vwarn')?.textContent || ''`)
  console.log('设为缩略图提示:', thumbWarn)
  results.push({ name: 'set-thumb-feedback', ok: /缩略图/.test(thumbWarn), err: [] })

  /* ---- 对比模式 ---- */
  await step('compare-open', clickButtonWithText('.viewer .vtop', '对比'))
  await sleep(400)
  await step('compare-pick', `(() => { const it = document.querySelector('.picker-item'); if (!it) throw new Error('没有可选模型'); it.click(); return true })()`)
  let compared = false
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    if (await js(`document.querySelectorAll('.stages.compare .stage canvas').length === 2 && !document.querySelector('.stages .loading')`)) {
      compared = true
      break
    }
  }
  results.push({ name: 'compare-two-canvases', ok: compared, err: compared ? [] : ['对比模式没有出现两个画布'] })
  await sleep(800)
  await step('compare-shot', 'true')
  await step('compare-close', clickButtonWithText('.viewer .vtop', '关闭对比'))

  await step('tree-tab', clickTab('结构'))
  const nodes = await js(`document.querySelectorAll('.nrow').length`)
  const mats = await js(`document.querySelectorAll('.mrow').length`)
  console.log('结构节点:', nodes, ' 材质:', mats)
  await step('info-tab', clickTab('信息'))
  await step('anim-tab', clickTab('动画'))

  // 键盘：W 线框、G 网格、Tab 面板
  await step('key-W', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`)
  await step('key-W-back', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`)
  await step('key-Tab', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`)
  const panelHidden = await js(`!document.querySelector('.vpanel')`)
  await step('key-Tab-back', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`)

  // 切下一个模型再回来，确认没有残留报错
  await step('next', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await sleep(2000)
  await step('next-loaded', 'true')

  // 关掉查看器后后台出图要恢复：网格上不该有一直转圈的卡片
  await step('close-viewer', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  let resumed = false
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const st = await js(`({ viewer: !!document.querySelector('.viewer'), spinners: document.querySelectorAll('.card .spinner').length, imgs: document.querySelectorAll('.card .thumb img').length })`)
    if (!st.viewer && st.spinners === 0 && st.imgs > 0) {
      resumed = true
      break
    }
  }
  console.log('关闭查看器后出图恢复:', resumed)

  // 设为缩略图之后，网格上这张卡的 <img> 应带缓存破坏参数
  const customThumb = await js(`!![...document.querySelectorAll('.card .thumb img')].find(i => /\\?v=\\d+/.test(i.src))`)
  console.log('自定义缩略图已刷新到网格:', customThumb)
  results.push({ name: 'custom-thumb-in-grid', ok: customThumb, err: [] })

  const failed = results.filter((r) => !r.ok)
  console.log('='.repeat(64))
  console.log(`步骤 ${results.length}，失败 ${failed.length}，面板隐藏生效: ${panelHidden}，节点 ${nodes} 材质 ${mats}`)
  console.log('截图目录:', OUT)
  if (errors.length) {
    console.log('渲染进程报错:')
    for (const e of errors) console.log('  -', e.slice(0, 300))
  }
  const ok = failed.length === 0 && panelHidden && nodes > 0 && mats > 0 && resumed
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
