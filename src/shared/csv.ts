import type { ModelEntry, ModelStats } from './types'

/** 清单导出的一行 */
export interface InventoryRow {
  entry: ModelEntry
  stats?: ModelStats
  state?: string
  favorite: boolean
  tags: string[]
  rating: number
  color: string | null
}

const HEADER = [
  '文件名',
  '格式',
  '相对路径',
  '完整路径',
  '大小(字节)',
  '修改时间',
  '顶点',
  '三角面',
  '网格',
  '材质',
  '贴图',
  '动画',
  '尺寸X',
  '尺寸Y',
  '尺寸Z',
  '缩略图状态',
  '收藏',
  '评分',
  '颜色',
  '标签'
]

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function num(v: number | undefined): string {
  return v === undefined ? '' : String(Math.round(v * 10000) / 10000)
}

/**
 * 生成 CSV 文本（带 UTF-8 BOM，Excel 双击打开中文不乱码）。
 * 日期用 ISO 本地时间，Excel 与 Python 都能直接解析。
 */
export function buildInventoryCsv(rows: InventoryRow[]): string {
  const lines = [HEADER.map(csvEscape).join(',')]
  for (const r of rows) {
    const e = r.entry
    const s = r.stats
    const d = new Date(e.mtimeMs)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    lines.push(
      [
        `${e.name}${e.ext}`,
        e.ext.slice(1),
        e.rel,
        e.path,
        e.size,
        date,
        num(s?.vertices),
        num(s?.triangles),
        num(s?.meshes),
        num(s?.materials),
        num(s?.textures),
        s ? s.animations.length : '',
        num(s?.dimensions[0]),
        num(s?.dimensions[1]),
        num(s?.dimensions[2]),
        r.state ?? '',
        r.favorite ? '是' : '',
        r.rating > 0 ? r.rating : '',
        r.color ?? '',
        r.tags.join(';')
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}
