/**
 * 资源库功能验收：列表视图、评分、颜色、重命名、固定文件夹、重复查找、回收站、主题切换、对比模式。
 *
 * 用合成夹具的一份临时拷贝跑，改名 / 删除不会碰真实素材。
 * 用法: npx electron scripts/verify-library.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const APP_ROOT = path.join(__dirname, '..')
const DATA = path.join(APP_ROOT, '.verify-lib-data')
const OUT = path.join(APP_ROOT, '.verify-lib')

fs.rmSync(DATA, { recursive: true, force: true })
execFileSync(process.execPath.includes('electron') ? 'node' : process.execPath, [path.join(__dirname, 'make-fixtures.mjs'), DATA], {
  stdio: 'ignore'
})
process.argv.push(`--folder=${DATA}`)

const { app, BrowserWindow } = require('electron')
require(path.join(APP_ROOT, 'out', 'main', 'index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
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
    await sleep(400)
    fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
  }
  const waitFor = async (code, timeoutMs = 15000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (await js(code)) return true
      await sleep(200)
    }
    return false
  }
  const key = (k, opts = {}) =>
    js(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...opts })}))`)
  const clickText = (selector, text) =>
    js(
      `(() => { const b = [...document.querySelectorAll('${selector}')].find(x => x.textContent.trim().includes('${text}')); if (!b) throw new Error('没有 ${text}'); b.click(); return true })()`
    )
  const setInput = (selector, value) =>
    js(
      `(() => { const i = document.querySelector('${selector}'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )

  // 等扫描 + 出图完成（夹具里有 1 个会失败的 broken.gltf 和 2 个不支持的）
  await waitFor(`document.querySelectorAll('.card').length > 5 && document.querySelectorAll('.card .spinner').length === 0`, 60000)
  const cards0 = await js(`document.querySelectorAll('.card').length`)
  check('网格出现', cards0 > 5, `${cards0} 张卡片`)
  await shot('01-grid')

  /* ---- 列表视图 ---- */
  await key('l', { ctrlKey: true })
  await sleep(400)
  const rows = await js(`document.querySelectorAll('.lrow').length`)
  check('Ctrl+L 切到列表视图', rows > 5 && (await js(`!!document.querySelector('.lhead')`)), `${rows} 行`)
  await clickText('.lhead > div', '大小')
  await sleep(300)
  const sortedOn = await js(`document.querySelector('.lhead > div.on')?.textContent.trim()`)
  check('列头点击排序', /大小/.test(sortedOn ?? ''), sortedOn)
  await shot('02-list')
  await key('l', { ctrlKey: true })
  await sleep(400)
  check('切回网格', (await js(`document.querySelectorAll('.card').length`)) > 5)

  /* ---- 评分 / 颜色 ---- */
  await js(`document.querySelector('.card').click()`)
  await key('4')
  await sleep(500)
  const rated = await js(`document.querySelectorAll('.card .stars.has').length`)
  check('数字键评分', rated >= 1, `${rated} 张带评分`)
  const lib = JSON.parse(fs.readFileSync(path.join(APP_ROOT, '.dev-data', 'library.json'), 'utf8'))
  check('评分落盘', Object.values(lib.ratings ?? {}).includes(4))

  await js(`document.querySelector('.card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))`)
  await sleep(300)
  check('右键菜单', await js(`!!document.querySelector('.ctxmenu')`))
  await shot('03-ctxmenu')
  await js(`document.querySelector('.ctxmenu .color-dots .dot').click()`)
  await sleep(500)
  check('颜色标签', (await js(`document.querySelectorAll('.card .color-mark').length`)) >= 1)

  /* ---- 重命名 ---- */
  // 挑一个可预览的、名字确定的：tga-box/box.obj
  const idx = await js(`[...document.querySelectorAll('.card .meta .name')].findIndex(n => n.textContent.trim() === 'box' && n.closest('.card').title.includes('tga-box'))`)
  check('找到 tga-box/box.obj 卡片', idx >= 0)
  await js(`document.querySelectorAll('.card')[${idx}].click()`)
  await key('F2')
  await sleep(300)
  check('F2 打开重命名', await js(`!!document.querySelector('.modal.rename')`))
  await setInput('.modal.rename input[type=text]', 'renamed_box')
  await clickText('.modal.rename .actions button', '改名')
  const renamedOk = await waitFor(`!document.querySelector('.modal.rename') && [...document.querySelectorAll('.card .meta .name')].some(n => n.textContent.trim() === 'renamed_box')`)
  check('改名后卡片更新', renamedOk)
  check('磁盘上文件已改名', fs.existsSync(path.join(DATA, 'tga-box', 'renamed_box.obj')) && !fs.existsSync(path.join(DATA, 'tga-box', 'box.obj')))
  const renamedThumb = await js(`(() => { const n = [...document.querySelectorAll('.card .meta .name')].find(n => n.textContent.trim() === 'renamed_box'); return !!n.closest('.card').querySelector('.thumb img') })()`)
  check('改名后缩略图直接沿用（不重出图）', renamedThumb)
  await shot('04-renamed')

  /* ---- 固定文件夹 ---- */
  await clickText('.status-btn', '固定文件夹')
  await sleep(500)
  check('固定到资源库', (await js(`document.querySelectorAll('.pin-row').length`)) === 1)
  await js(`document.querySelector('.pin-remove').click()`)
  await sleep(400)
  check('取消固定', (await js(`document.querySelectorAll('.pin-row').length`)) === 0)

  /* ---- 重复查找 ---- */
  await clickText('.status-btn', '查找重复')
  const found = await waitFor(`document.querySelectorAll('.dupe-group').length > 0`, 20000)
  const groups = await js(`document.querySelectorAll('.dupe-group').length`)
  check('找到重复组', found && groups >= 1, `${groups} 组`)
  await shot('05-dupes')
  await clickText('.modal.dupes .actions button', '删除勾选')
  await sleep(200)
  await clickText('.modal.dupes .actions button', '确定删除')
  const trashed = await waitFor(`document.querySelectorAll('.dupe-group').length === 0`, 15000)
  check('重复副本已进回收站', trashed && !fs.existsSync(path.join(DATA, 'dupes', 'b', 'box_copy.obj')))
  await clickText('.modal.dupes .actions button', '关闭')
  await sleep(300)

  /* ---- 回收站（Delete 键） ---- */
  const before = await js(`document.querySelectorAll('.card').length`)
  const maxIdx = await js(`[...document.querySelectorAll('.card .meta .name')].findIndex(n => n.textContent.trim() === 'old')`)
  await js(`document.querySelectorAll('.card')[${maxIdx}].click()`)
  await key('Delete')
  await sleep(300)
  check('Delete 弹确认', await js(`!!document.querySelector('.modal.confirm')`))
  await clickText('.modal.confirm .actions button', '移到回收站')
  const gone = await waitFor(`document.querySelectorAll('.card').length === ${before - 1}`)
  check('删除后卡片减少且文件消失', gone && !fs.existsSync(path.join(DATA, 'old.max')))

  /* ---- 主题切换 ---- */
  await clickText('.toolbar.main button', '设置')
  await sleep(300)
  await clickText('.snav', '扫描与界面')
  await clickText('.settings-body .seg button', '深色')
  await clickText('.modal.settings .actions button', '保存')
  await sleep(600)
  check('深色主题生效', (await js(`document.documentElement.dataset.theme`)) === 'dark')
  await shot('06-dark')
  await clickText('.toolbar.main button', '设置')
  await sleep(300)
  await clickText('.snav', '扫描与界面')
  await clickText('.settings-body .seg button', '浅色')
  await clickText('.modal.settings .actions button', '保存')
  await sleep(500)
  check('切回浅色', (await js(`document.documentElement.dataset.theme`)) === 'light')

  /* ---- 对比模式 ---- */
  const ids = await js(`[...document.querySelectorAll('.card')].filter(c => !c.classList.contains('unsupported') && c.querySelector('.thumb img')).slice(0, 2).map(c => c.querySelector('.meta .name').textContent.trim())`)
  check('有两个可对比的模型', ids.length === 2, ids.join(' / '))
  await js(`(() => { const cs = [...document.querySelectorAll('.card')].filter(c => !c.classList.contains('unsupported') && c.querySelector('.thumb img')); cs[0].click(); cs[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); return true })()`)
  await sleep(300)
  await clickText('.selbar button', '对比')
  const compared = await waitFor(`document.querySelectorAll('.stages.compare .stage canvas').length === 2 && !document.querySelector('.viewer .loading')`, 30000)
  check('对比模式两个画布', compared)
  await sleep(1500)
  await shot('07-compare')
  await clickText('.viewer .vtop button', '关闭对比')
  await sleep(500)
  check('关闭对比', (await js(`document.querySelectorAll('.viewer .stage').length`)) === 1)
  await key('Escape')
  await sleep(500)

  const failed = results.filter((r) => !r.ok)
  console.log('='.repeat(64))
  console.log(`检查 ${results.length} 项，失败 ${failed.length}`)
  if (errors.length) {
    console.log('渲染进程报错:')
    for (const e of errors) console.log('  -', e.slice(0, 300))
  }
  console.log('截图目录:', OUT)
  const ok = failed.length === 0 && errors.length === 0
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
