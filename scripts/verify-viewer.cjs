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
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Electron Security Warning/.test(message)) errors.push(message)
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
  await step('shadow-on', toggle('地面阴影', true))
  await step('shadow-off', toggle('地面阴影', false))

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

  const failed = results.filter((r) => !r.ok)
  console.log('='.repeat(64))
  console.log(`步骤 ${results.length}，失败 ${failed.length}，面板隐藏生效: ${panelHidden}，节点 ${nodes} 材质 ${mats}`)
  console.log('截图目录:', OUT)
  if (errors.length) {
    console.log('渲染进程报错:')
    for (const e of errors) console.log('  -', e.slice(0, 300))
  }
  const ok = failed.length === 0 && panelHidden && nodes > 0 && mats > 0
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
