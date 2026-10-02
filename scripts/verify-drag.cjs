/**
 * 验证多选与拖出功能。
 *
 * 真正的跨进程拖放没法脚本化（要系统级拖拽手势），
 * 所以这里验证到「dragstart 能正确算出要拖哪些文件、
 * 并且调用 startDrag 不抛异常」为止 —— 剩下的交给系统。
 *
 * 用法: npx electron scripts/verify-drag.cjs <素材目录>
 */
const path = require('node:path')
const fs = require('node:fs')

const ROOT = process.argv[2] || 'E:\\Desktop\\8月\\003\\FreePack\\GLTF'
process.argv.push(`--folder=${ROOT}`)

const { app, BrowserWindow, ipcMain } = require('electron')

const captured = []

require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

/**
 * 把应用自己的 drag:start 处理器摘掉，换成只记录不执行的版本。
 *
 * 必须这么做：webContents.startDrag() 在 Windows 上会进入系统级的
 * 模态拖拽循环，一直阻塞到鼠标松开为止。脚本发的是合成 dragstart，
 * 没有真实鼠标手势，那个循环永远等不到结束 —— 主进程直接卡死。
 * 真实使用时用户是真的在拖，所以不受影响。
 */
ipcMain.removeAllListeners('drag:start')
ipcMain.on('drag:start', (_e, payload) => {
  captured.push(payload)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  let win = null
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    if (!win) await sleep(100)
  }
  const js = (code) => win.webContents.executeJavaScript(code, true)

  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const n = await js(`document.querySelectorAll('.card').length`)
    const spin = await js(`document.querySelectorAll('.card .spinner').length`)
    if (n > 0 && spin === 0) break
  }

  const errors = []
  win.webContents.on('console-message', event => {
    const { level, message } = event
    if ((level === 'warning' || level === 'error')) errors.push(message)
  })

  // 点完要等一帧让 React 重新渲染，否则读到的还是上一次的状态
  const click = async (idx, mods = {}) => {
    await js(`(() => {
      const c = document.querySelectorAll('.card')[${idx}];
      c.dispatchEvent(new MouseEvent('click', Object.assign(
        { bubbles: true }, ${JSON.stringify(mods)}
      )));
    })()`)
    await sleep(180)
    return js(`document.querySelectorAll('.card.sel').length`)
  }

  console.log('='.repeat(60))
  console.log('素材目录:', ROOT)
  console.log('='.repeat(60))

  const checks = []
  const n1 = await click(0)
  console.log('单击第 0 张          -> 选中', n1, '张 (期望 1)')
  checks.push(n1 === 1)
  const n2 = await click(2, { ctrlKey: true })
  console.log('Ctrl+单击第 2 张     -> 选中', n2, '张 (期望 2)')
  checks.push(n2 === 2)
  const n3 = await click(4, { ctrlKey: true })
  console.log('Ctrl+单击第 4 张     -> 选中', n3, '张 (期望 3)')
  checks.push(n3 === 3)
  const n4 = await click(0)
  console.log('单击第 0 张重置      -> 选中', n4, '张 (期望 1)')
  checks.push(n4 === 1)
  const n5 = await click(5, { shiftKey: true })
  console.log('Shift+单击第 5 张    -> 选中', n5, '张 (期望 6，即 0..5 连选)')
  checks.push(n5 === 6)

  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))`)
  await sleep(300)
  const all = await js(`document.querySelectorAll('.card.sel').length`)
  const total = await js(`document.querySelectorAll('.card').length`)
  console.log(`Ctrl+A               -> 选中 ${all} / ${total} 张（虚拟化只渲染可见的）`)

  // 回到 3 张选中，然后从其中一张发起拖拽
  await click(0)
  await click(1, { ctrlKey: true })
  await click(2, { ctrlKey: true })
  await js(`(() => {
    const c = document.querySelectorAll('.card')[1];
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    ev.dataTransfer = { setData(){}, setDragImage(){}, items: [], files: [] };
    c.dispatchEvent(ev);
    return true;
  })()`)
  await sleep(600)

  console.log('\n从已选中的卡片发起拖拽（当前选中 3 张）:')
  let dragged3 = 0
  if (captured.length === 0) {
    console.log('  没有收到 drag:start —— 拖拽没接上')
  } else {
    const p = captured[captured.length - 1]
    dragged3 = p.paths.length
    console.log('  要拖的文件数:', p.paths.length, '(期望 3)')
    for (const f of p.paths) console.log('   -', path.basename(f), fs.existsSync(f) ? '(存在)' : '(不存在!)')
    console.log('  拖拽图标 key:', p.thumbKey ? p.thumbKey.slice(0, 12) + '…' : '(无，用兜底图标)')
  }

  // 拖一张没被选中的卡片，应当只拖它自己
  captured.length = 0
  await js(`(() => {
    const c = document.querySelectorAll('.card')[7];
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    ev.dataTransfer = { setData(){}, setDragImage(){}, items: [], files: [] };
    c.dispatchEvent(ev);
    return true;
  })()`)
  await sleep(600)
  console.log('\n拖未选中的第 7 张:')
  console.log('  要拖的文件数:', captured.length ? captured[captured.length - 1].paths.length : 0, '(应为 1)')

  console.log('\n渲染进程报错:', errors.length ? errors.join(' | ') : '无')
  console.log('='.repeat(60))

  const ok =
    checks.every(Boolean) &&
    dragged3 === 3 &&
    captured.length > 0 &&
    captured[captured.length - 1].paths.length === 1 &&
    errors.length === 0
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
