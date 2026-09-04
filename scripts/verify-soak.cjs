/**
 * 大库压力验收：打开一个上千模型的目录，滚到底再滚回顶，
 * 验证「当前可见的卡片优先出图」—— 滚到底后 15 秒内可见卡片应全部出图，
 * 同时报告整体吞吐、内存和失败数。
 *
 * 用法: npx electron scripts/verify-soak.cjs <大素材目录> [等待秒数=180]
 */
const path = require('node:path')

const ROOT = process.argv[2]
const WAIT = Number(process.argv[3] || 180)
if (!ROOT) {
  console.error('用法: npx electron scripts/verify-soak.cjs <素材目录> [等待秒数]')
  process.exit(2)
}
process.argv.push(`--folder=${ROOT}`)

const { app, BrowserWindow } = require('electron')
require(path.join(__dirname, '..', 'out', 'main', 'index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mb = (b) => (b / 1024 / 1024).toFixed(0) + ' MB'

app.whenReady().then(async () => {
  let win = null
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    if (!win) await sleep(100)
  }
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const state = () =>
    js(`(() => {
      const cards = [...document.querySelectorAll('.card')];
      return {
        cards: cards.length,
        imgs: document.querySelectorAll('.card .thumb img').length,
        spinners: document.querySelectorAll('.card .spinner').length,
        failed: document.querySelectorAll('.card .state.failed').length,
        status: document.querySelector('.statusbar')?.innerText.replace(/\\s+/g, ' ') || ''
      }
    })()`)

  for (let i = 0; i < 200; i++) {
    await sleep(500)
    const s = await state()
    if (s.cards > 0) break
  }
  const total = await js(`document.querySelectorAll('.tree-row')[0]?.querySelector('.tree-count')?.innerText || '0'`)
  console.log('='.repeat(64))
  console.log('素材目录:', ROOT, '· 模型数:', total)
  const t0 = Date.now()

  // 立刻滚到底：这时队列里已经压着首屏的任务，看可见的能不能插队
  await js(`(() => { const el = document.querySelector('.grid-scroll'); el.scrollTop = el.scrollHeight; return el.scrollTop })()`)
  await sleep(300)
  let bottomDone = null
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const s = await state()
    if (s.spinners === 0 && s.cards > 0) {
      bottomDone = (Date.now() - t0) / 1000
      break
    }
  }
  console.log(`滚到底后可见卡片全部出图耗时: ${bottomDone === null ? '超过 30s（未通过）' : bottomDone.toFixed(1) + 's'}`)

  // 滚回中间再回顶
  await js(`(() => { const el = document.querySelector('.grid-scroll'); el.scrollTop = el.scrollHeight / 2; return 1 })()`)
  await sleep(2000)
  await js(`(() => { const el = document.querySelector('.grid-scroll'); el.scrollTop = 0; return 1 })()`)
  let topDone = null
  const t1 = Date.now()
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const s = await state()
    if (s.spinners === 0) {
      topDone = (Date.now() - t1) / 1000
      break
    }
  }
  console.log(`滚回顶后可见卡片全部出图耗时: ${topDone === null ? '超过 30s' : topDone.toFixed(1) + 's'}`)

  // 让它把整个库跑完（或到超时），看吞吐与内存
  const deadline = Date.now() + WAIT * 1000
  let last = null
  while (Date.now() < deadline) {
    await sleep(3000)
    last = await state()
    const m = /缩略图 (\d+)\/(\d+)/.exec(last.status)
    if (!m) break // 状态栏没有进度条 = 已完成（或还没开始）
    if (m[1] === m[2]) break
  }
  const elapsed = (Date.now() - t0) / 1000
  const metrics = app.getAppMetrics()
  const memTotal = metrics.reduce((s, m) => s + (m.memory?.workingSetSize || 0) * 1024, 0)
  const gpu = metrics.find((m) => m.type === 'GPU')
  console.log(`总耗时 ${elapsed.toFixed(0)}s · 状态栏: ${last?.status}`)
  console.log(`进程数 ${metrics.length} · 工作集合计 ${mb(memTotal)} · GPU 进程 ${gpu ? mb((gpu.memory?.workingSetSize || 0) * 1024) : '无'}`)
  console.log(`失败(可见): ${last?.failed}`)
  const ok = bottomDone !== null && bottomDone <= 15 && topDone !== null && topDone <= 15
  console.log(ok ? '通过' : '有问题')
  app.exit(ok ? 0 : 1)
})
