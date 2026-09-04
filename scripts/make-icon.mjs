/**
 * 生成应用图标：等距立方体 + 网格底纹，配色跟界面一致。
 *
 * 纯代码画而不是塞一张位图，好处是任何尺寸都是重新光栅化的，
 * 16x16 那种小尺寸不会糊成一团。
 *
 * 输出 build/icon.ico（含 16/24/32/48/64/128/256 七种尺寸）
 * 以及 build/icon.png（256，给非 Windows 平台和文档用）。
 *
 * 用法: node scripts/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'build')

/** 超采样倍数，先画大再缩小，等于免费拿到抗锯齿 */
const SS = 4

const BG_TOP = [0x1e, 0x22, 0x2b]
const BG_BOTTOM = [0x11, 0x13, 0x18]
const GRID = [0x2b, 0x31, 0x3d]
const FACE_TOP = [0x6f, 0xb1, 0xff]
const FACE_LEFT = [0x3d, 0x7d, 0xd6]
const FACE_RIGHT = [0x2a, 0x5a, 0x9e]
const EDGE = [0x9c, 0xcf, 0xff]

const lerp = (a, b, t) => a + (b - a) * t

/** 点是否在多边形内（射线法） */
function inPoly(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 点到线段的距离，用来画描边 */
function distToSeg(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

function renderIcon(size) {
  const S = size * SS
  const png = new PNG({ width: S, height: S })

  // 圆角半径按比例走，小图标圆角小一些才不糊
  const radius = S * 0.22
  const cx = S / 2
  const cy = S / 2

  // 等距立方体：顶点按 2:1 等距投影排布
  const r = S * 0.29 // 立方体半宽
  const h = S * 0.165 // 顶面菱形半高
  const bodyH = S * 0.2 // 侧面高度

  const topC = [cx, cy - bodyH * 0.9]
  const vTop = [topC[0], topC[1] - h]
  const vRight = [topC[0] + r, topC[1]]
  const vBottom = [topC[0], topC[1] + h]
  const vLeft = [topC[0] - r, topC[1]]

  const bLeft = [vLeft[0], vLeft[1] + bodyH * 1.5]
  const bBottom = [vBottom[0], vBottom[1] + bodyH * 1.5]
  const bRight = [vRight[0], vRight[1] + bodyH * 1.5]

  const faceTop = [vTop, vRight, vBottom, vLeft]
  const faceLeft = [vLeft, vBottom, bBottom, bLeft]
  const faceRight = [vBottom, vRight, bRight, bBottom]

  const edges = [
    [vTop, vRight],
    [vRight, vBottom],
    [vBottom, vLeft],
    [vLeft, vTop],
    [vLeft, bLeft],
    [vBottom, bBottom],
    [vRight, bRight],
    [bLeft, bBottom],
    [bBottom, bRight]
  ]
  const edgeW = Math.max(S * 0.006, 1.2)

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) << 2

      // --- 圆角矩形裁剪 ---
      const qx = Math.max(radius - x, x - (S - radius), 0)
      const qy = Math.max(radius - y, y - (S - radius), 0)
      if (Math.hypot(qx, qy) > radius) {
        png.data[i + 3] = 0
        continue
      }

      // --- 背景竖向渐变 ---
      const t = y / S
      let R = lerp(BG_TOP[0], BG_BOTTOM[0], t)
      let G = lerp(BG_TOP[1], BG_BOTTOM[1], t)
      let B = lerp(BG_TOP[2], BG_BOTTOM[2], t)

      // --- 底部网格线，暗示"3D 场景"，小尺寸下会自然消失 ---
      if (size >= 48) {
        const step = S / 9
        const near = Math.min(x % step, step - (x % step), y % step, step - (y % step))
        if (near < S * 0.004 && y > S * 0.52) {
          const fade = Math.min(1, (y - S * 0.52) / (S * 0.3))
          R = lerp(R, GRID[0], 0.55 * fade)
          G = lerp(G, GRID[1], 0.55 * fade)
          B = lerp(B, GRID[2], 0.55 * fade)
        }
      }

      // --- 立方体三个面 ---
      let face = null
      if (inPoly(x, y, faceTop)) face = FACE_TOP
      else if (inPoly(x, y, faceLeft)) face = FACE_LEFT
      else if (inPoly(x, y, faceRight)) face = FACE_RIGHT

      if (face) {
        R = face[0]
        G = face[1]
        B = face[2]
        // 顶面加一点从左上到右下的明暗，别太死板
        if (face === FACE_TOP) {
          const g = (x / S + y / S) / 2
          R = lerp(R + 18, R - 18, g)
          G = lerp(G + 14, G - 14, g)
          B = lerp(B + 6, B - 6, g)
        }
      }

      // --- 棱线高光 ---
      let minD = Infinity
      for (const [a, b] of edges) {
        const d = distToSeg(x, y, a, b)
        if (d < minD) minD = d
      }
      if (minD < edgeW) {
        const k = (1 - minD / edgeW) * 0.55
        R = lerp(R, EDGE[0], k)
        G = lerp(G, EDGE[1], k)
        B = lerp(B, EDGE[2], k)
      }

      png.data[i] = Math.max(0, Math.min(255, Math.round(R)))
      png.data[i + 1] = Math.max(0, Math.min(255, Math.round(G)))
      png.data[i + 2] = Math.max(0, Math.min(255, Math.round(B)))
      png.data[i + 3] = 255
    }
  }

  return downsample(png, S, size)
}

/** 盒式降采样，把超采样的大图缩到目标尺寸 */
function downsample(src, S, size) {
  const out = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const si = ((y * SS + sy) * S + (x * SS + sx)) << 2
          const al = src.data[si + 3] / 255
          r += src.data[si] * al
          g += src.data[si + 1] * al
          b += src.data[si + 2] * al
          a += src.data[si + 3]
        }
      }
      const n = SS * SS
      const alpha = a / n
      const norm = alpha > 0 ? alpha / 255 : 1
      const oi = (y * size + x) << 2
      out.data[oi] = Math.round(r / n / norm)
      out.data[oi + 1] = Math.round(g / n / norm)
      out.data[oi + 2] = Math.round(b / n / norm)
      out.data[oi + 3] = Math.round(alpha)
    }
  }
  return out
}

/**
 * 组装 ICO。
 * Vista 以后每个条目可以直接放 PNG 数据，不用转 BMP，
 * 所以这里就是「目录表 + 一串 PNG」。
 */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count

  entries.forEach((e, idx) => {
    const o = idx * 16
    // 256 要写成 0
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1)
    dir.writeUInt8(0, o + 2) // 调色板数
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // color planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(e.data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.data.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const entries = sizes.map((size) => {
  const png = renderIcon(size)
  const data = PNG.sync.write(png)
  return { size, data }
})

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(entries))

const png256 = entries.find((e) => e.size === 256)
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png256.data)

console.log('已生成:')
console.log('  build/icon.ico  ', sizes.join('/'), 'px,', fs.statSync(path.join(OUT_DIR, 'icon.ico')).size, 'bytes')
console.log('  build/icon.png   256px')
