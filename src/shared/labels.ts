/** 颜色标签（Bridge / Eagle 风格），主进程校验与渲染进程显示共用 */
export interface ColorLabel {
  key: string
  name: string
  /** 浅色主题下的色值 */
  color: string
}

export const COLOR_LABELS: ColorLabel[] = [
  { key: 'red', name: '红', color: '#ff7a8a' },
  { key: 'orange', name: '橙', color: '#ffb066' },
  { key: 'yellow', name: '黄', color: '#f5d35a' },
  { key: 'green', name: '绿', color: '#6fd39a' },
  { key: 'blue', name: '蓝', color: '#6fb3ff' },
  { key: 'purple', name: '紫', color: '#b58cff' },
  { key: 'gray', name: '灰', color: '#a9b1bf' }
]

const KEYS = new Set(COLOR_LABELS.map((c) => c.key))

export function isColorLabel(key: unknown): key is string {
  return typeof key === 'string' && KEYS.has(key)
}

export function colorOf(key: string | undefined | null): string | null {
  if (!key) return null
  return COLOR_LABELS.find((c) => c.key === key)?.color ?? null
}

/** 评分 0–5，0 表示清除 */
export function clampRating(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n)))
}
