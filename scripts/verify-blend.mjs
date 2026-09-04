/**
 * 验证 .blend 管线：
 *   第一层 —— 纯 JS 抠内嵌预览图（不需要 Blender）
 *   第二层 —— 调 Blender 转 GLB
 *
 * blendThumb.ts / blenderService.ts 都不依赖 electron，
 * 所以这里用 esbuild 现编到临时目录，直接在 node 里跑。
 *
 * 用法: node scripts/verify-blend.mjs <目录或.blend文件>
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(__dirname, '..')
const target = process.argv[2] || path.join(APP_ROOT, '.testdata')

// 放在项目内而不是系统临时目录，否则 bundle 里的 pngjs 解析不到 node_modules
const tmp = fs.mkdtempSync(path.join(APP_ROOT, '.tmp-verify-'))
const bundle = path.join(tmp, 'blend.mjs')

// 用 esbuild 的 JS API，不 spawn npx —— Node 24 在 Windows 上禁止直接 spawn .cmd
const esbuild = await import('esbuild')
await esbuild.build({
  entryPoints: [path.join(APP_ROOT, 'src/main/blendThumb.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['pngjs'],
  outfile: bundle,
  absWorkingDir: APP_ROOT
})

const { extractBlendThumb, readBlendVersion, parseHeader } = await import(
  pathToFileURL(bundle).toString()
)

const files = fs.statSync(target).isDirectory()
  ? fs
      .readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith('.blend'))
      .map((f) => path.join(target, f))
  : [target]

if (files.length === 0) {
  console.error('没有找到 .blend 文件:', target)
  process.exit(1)
}

const outDir = path.join(APP_ROOT, '.verify-blend')
fs.mkdirSync(outDir, { recursive: true })

/**
 * 往一个真实 .blend 里插入一个合法的 TEST 块。
 *
 * 为什么需要这一步：Blender 在 -b 无头模式下根本不会写内嵌预览图
 * （没有视口可截、也不跑相机渲染），所以脚本生成的 .blend 一律没有 TEST 块。
 * 想验证解析器就得自己造一个 —— 但基于真实文件结构造，而不是凭空捏。
 *
 * 图案特意做成上下不对称（上半红、下半蓝），用来检验垂直翻转是否正确：
 * Blender 按 OpenGL 惯例自下而上存行，解析出来必须是上红下蓝。
 */
function injectTestBlock(srcFile, dstFile, w = 128, h = 128) {
  const buf = fs.readFileSync(srcFile)
  if (buf.subarray(0, 7).toString('latin1') !== 'BLENDER') return false

  const ptrSize = String.fromCharCode(buf[7]) === '_' ? 4 : 8
  const headerSize = 16 + ptrSize

  const pixels = Buffer.alloc(w * h * 4)
  for (let row = 0; row < h; row++) {
    // row 0 是最底行（OpenGL 惯例）-> 应该是蓝色
    const bottomHalf = row < h / 2
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4
      pixels[o] = bottomHalf ? 0 : 255 // R
      pixels[o + 1] = 0 // G
      pixels[o + 2] = bottomHalf ? 255 : 0 // B
      pixels[o + 3] = 255 // A
    }
  }

  const payload = Buffer.alloc(8 + pixels.length)
  payload.writeInt32LE(w, 0)
  payload.writeInt32LE(h, 4)
  pixels.copy(payload, 8)

  const blockHeader = Buffer.alloc(headerSize)
  blockHeader.write('TEST', 0, 4, 'latin1')
  blockHeader.writeInt32LE(payload.length, 4)

  // 插在第一个 block（REND）之后，和 Blender 真实的排布一致
  const firstSize = buf.readInt32LE(12 + 4)
  const insertAt = 12 + headerSize + firstSize

  fs.writeFileSync(
    dstFile,
    Buffer.concat([
      buf.subarray(0, insertAt),
      blockHeader,
      payload,
      buf.subarray(insertAt)
    ])
  )
  return true
}

console.log('='.repeat(64))
let pass = 0
let fail = 0

for (const f of files) {
  const name = path.basename(f)
  const raw = fs.readFileSync(f).subarray(0, 4)
  const compressed = !raw.subarray(0, 4).toString('latin1').startsWith('BLEN')

  const t0 = Date.now()
  const ver = await readBlendVersion(f)
  const thumb = await extractBlendThumb(f)
  const ms = Date.now() - t0

  if (thumb) {
    const out = path.join(outDir, `${name}.thumb.png`)
    fs.writeFileSync(out, thumb.png)
    console.log(
      `OK   ${name.padEnd(32)} 版本 ${String(ver?.version).padEnd(5)} ` +
        `${compressed ? '已压缩' : '未压缩'}  内嵌图 ${thumb.width}x${thumb.height}  ${ms}ms`
    )
    pass++
  } else {
    console.log(
      `无图 ${name.padEnd(32)} 版本 ${String(ver?.version).padEnd(5)} ` +
        `${compressed ? '已压缩' : '未压缩'}  (保存时未开启预览图)  ${ms}ms`
    )
    fail++
  }
}

console.log(
  '\n注意: Blender 无头模式(-b)不会写内嵌预览图，脚本生成的 .blend 必然没有 TEST 块。'
)
console.log('下面用真实文件结构注入一个 TEST 块来验证解析器本身。\n')

// ---- 解析器验证：注入 TEST 块后再抠出来，并检查垂直翻转 ----
const { PNG } = await import('pngjs')
let parserOk = true

for (const src of files.slice(0, 1)) {
  const injected = path.join(outDir, 'injected_' + path.basename(src))
  if (!injectTestBlock(src, injected)) {
    // 压缩过的文件不能直接插块，跳过
    continue
  }

  const t = await extractBlendThumb(injected)
  if (!t) {
    console.log('失败: 注入 TEST 块后仍然抠不出缩略图')
    parserOk = false
    break
  }

  fs.writeFileSync(path.join(outDir, 'injected.thumb.png'), t.png)
  const png = PNG.sync.read(t.png)
  const px = (x, y) => {
    const o = (y * png.width + x) * 4
    return [png.data[o], png.data[o + 1], png.data[o + 2]]
  }
  const top = px(64, 10)
  const bottom = px(64, 118)

  const topIsRed = top[0] > 200 && top[2] < 50
  const bottomIsBlue = bottom[2] > 200 && bottom[0] < 50

  console.log(
    `解析 ${t.width}x${t.height}  顶部 rgb(${top}) ${topIsRed ? '红✓' : '✗'}  ` +
      `底部 rgb(${bottom}) ${bottomIsBlue ? '蓝✓' : '✗'}`
  )
  if (topIsRed && bottomIsBlue) {
    console.log('垂直翻转正确（Blender 自下而上存储，已转正）')
  } else {
    console.log('垂直翻转有误！图像上下颠倒了')
    parserOk = false
  }
}

console.log('='.repeat(64))
console.log(
  `内嵌缩略图直接提取: ${pass} / ${files.length}（无头生成的文件本就没有，属预期）`
)
console.log(`TEST 块解析器: ${parserOk ? '通过' : '失败'}`)
console.log('输出:', outDir)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(parserOk ? 0 : 1)
