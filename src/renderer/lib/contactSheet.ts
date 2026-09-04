/**
 * 接触表（contact sheet）：把一批缩略图拼成一张带文件名的大图，
 * 方便发给别人挑素材、或者贴在文档里当目录。
 */

export interface SheetItem {
  name: string
  ext: string
  url?: string
}

export interface SheetLayout {
  cols: number
  rows: number
  cell: number
  labelH: number
  pad: number
  headerH: number
  width: number
  height: number
}

export const SHEET_MAX_ITEMS = 500

/** 纯布局计算，方便单测：接近正方形的网格，单元格下方留一行文字 */
export function layoutSheet(n: number, cell = 192): SheetLayout {
  const count = Math.max(1, n)
  const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * 1.2))))
  const rows = Math.ceil(count / cols)
  const labelH = 28
  const pad = 12
  const headerH = 48
  return {
    cols,
    rows,
    cell,
    labelH,
    pad,
    headerH,
    width: pad + cols * (cell + pad),
    height: headerH + pad + rows * (cell + labelH + pad)
  }
}

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    // 走 fetch → blob → ImageBitmap 而不是 <img>：自定义协议的图片直接
    // drawImage 会把 canvas 标成受污染，toDataURL 直接抛 SecurityError
    const r = await fetch(url)
    if (!r.ok) return null
    return await createImageBitmap(await r.blob())
  } catch {
    return null
  }
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}

export async function renderContactSheet(
  items: SheetItem[],
  title: string,
  cell = 192
): Promise<string> {
  const list = items.slice(0, SHEET_MAX_ITEMS)
  const L = layoutSheet(list.length, cell)
  const canvas = document.createElement('canvas')
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  ctx.fillStyle = '#1b1e24'
  ctx.fillRect(0, 0, L.width, L.height)

  ctx.fillStyle = '#e6e9ef'
  ctx.font = '600 18px "Microsoft YaHei UI", "Segoe UI", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(truncate(ctx, title, L.width - 2 * L.pad), L.pad, L.headerH / 2)

  const bitmaps = await Promise.all(list.map((it) => (it.url ? loadBitmap(it.url) : null)))

  list.forEach((it, i) => {
    const col = i % L.cols
    const row = Math.floor(i / L.cols)
    const x = L.pad + col * (L.cell + L.pad)
    const y = L.headerH + L.pad + row * (L.cell + L.labelH + L.pad)

    ctx.fillStyle = '#22262e'
    ctx.fillRect(x, y, L.cell, L.cell + L.labelH)

    const bmp = bitmaps[i]
    if (bmp) {
      const s = Math.min(L.cell / bmp.width, L.cell / bmp.height)
      const w = bmp.width * s
      const h = bmp.height * s
      ctx.drawImage(bmp, x + (L.cell - w) / 2, y + (L.cell - h) / 2, w, h)
      bmp.close()
    } else {
      ctx.fillStyle = '#6b7484'
      ctx.font = '13px "Microsoft YaHei UI", "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('无缩略图', x + L.cell / 2, y + L.cell / 2)
      ctx.textAlign = 'left'
    }

    ctx.fillStyle = '#9aa3b2'
    ctx.font = '12px "Microsoft YaHei UI", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(truncate(ctx, `${it.name}${it.ext}`, L.cell - 8), x + L.cell / 2, y + L.cell + L.labelH / 2)
    ctx.textAlign = 'left'
  })

  return canvas.toDataURL('image/png')
}
