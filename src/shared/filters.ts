import type { ModelEntry, SortDir, SortKey, ThumbResult } from './types'

/**
 * 网格的筛选与排序。纯函数，渲染进程用，单测直接跑。
 * 库数据（收藏 / 标签 / 评分 / 颜色）按小写路径键查。
 */
export type TriRange = 'lt1k' | '1k-10k' | '10k-100k' | 'gt100k'

export const TRI_RANGES: { key: TriRange; label: string; min: number; max: number }[] = [
  { key: 'lt1k', label: '< 1k 面', min: 0, max: 1000 },
  { key: '1k-10k', label: '1k – 10k', min: 1000, max: 10000 },
  { key: '10k-100k', label: '10k – 100k', min: 10000, max: 100000 },
  { key: 'gt100k', label: '> 100k', min: 100000, max: Infinity }
]

export interface LibView {
  favorites: Set<string>
  tags: Record<string, string[]>
  ratings: Record<string, number>
  colors: Record<string, string>
}

export interface FilterState {
  query: string
  dirFilter: string
  exts: Set<string>
  fav: boolean
  tags: Set<string>
  anim: boolean
  failed: boolean
  /** 0 = 不筛 */
  minRating: number
  colors: Set<string>
  triRange: TriRange | null
}

export const EMPTY_FILTER: FilterState = {
  query: '',
  dirFilter: '',
  exts: new Set(),
  fav: false,
  tags: new Set(),
  anim: false,
  failed: false,
  minRating: 0,
  colors: new Set(),
  triRange: null
}

export function libKey(e: { path: string }): string {
  return e.path.toLowerCase()
}

/** 目录筛选：rel 是否位于 dir（相对路径前缀）之下 */
export function isUnderDir(rel: string, dir: string): boolean {
  if (!dir) return true
  const r = rel.replace(/\\/g, '/').toLowerCase()
  const d = dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  return r.startsWith(d + '/')
}

/** 这些筛选 / 排序需要缩略图统计信息 */
export function needsThumbs(f: FilterState, sortKey: SortKey): boolean {
  return f.anim || f.failed || f.triRange !== null || sortKey === 'tris'
}

export function hasActiveFilter(f: FilterState): boolean {
  return (
    f.exts.size > 0 ||
    f.fav ||
    f.tags.size > 0 ||
    f.anim ||
    f.failed ||
    f.minRating > 0 ||
    f.colors.size > 0 ||
    f.triRange !== null
  )
}

export function filterEntries(
  all: ModelEntry[],
  f: FilterState,
  lib: LibView,
  thumbs: Map<string, ThumbResult> | null
): ModelEntry[] {
  let list = all
  const q = f.query.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.rel.toLowerCase().includes(q) ||
        (lib.tags[libKey(e)] ?? []).some((t) => t.toLowerCase().includes(q))
    )
  }
  if (f.dirFilter) list = list.filter((e) => isUnderDir(e.rel, f.dirFilter))
  if (f.exts.size > 0) list = list.filter((e) => f.exts.has(e.ext))
  if (f.fav) list = list.filter((e) => lib.favorites.has(libKey(e)))
  if (f.tags.size > 0) list = list.filter((e) => (lib.tags[libKey(e)] ?? []).some((t) => f.tags.has(t)))
  if (f.minRating > 0) list = list.filter((e) => (lib.ratings[libKey(e)] ?? 0) >= f.minRating)
  if (f.colors.size > 0) list = list.filter((e) => f.colors.has(lib.colors[libKey(e)] ?? ''))
  if (thumbs) {
    if (f.anim) list = list.filter((e) => (thumbs.get(e.id)?.stats?.animations.length ?? 0) > 0)
    if (f.failed) list = list.filter((e) => thumbs.get(e.id)?.state === 'failed')
    if (f.triRange) {
      const r = TRI_RANGES.find((x) => x.key === f.triRange)!
      list = list.filter((e) => {
        const t = thumbs.get(e.id)?.stats?.triangles
        return t !== undefined && t >= r.min && t < r.max
      })
    }
  }
  return list
}

export function sortEntries(
  list: ModelEntry[],
  key: SortKey,
  dir: SortDir,
  lib: LibView,
  thumbs: Map<string, ThumbResult> | null
): ModelEntry[] {
  const sorted = [...list]
  const d = dir === 'asc' ? 1 : -1
  const byName = (a: ModelEntry, b: ModelEntry): number =>
    a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true, sensitivity: 'base' })
  sorted.sort((a, b) => {
    switch (key) {
      case 'size':
        return (a.size - b.size) * d || byName(a, b)
      case 'date':
        return (a.mtimeMs - b.mtimeMs) * d || byName(a, b)
      case 'ext':
        return a.ext.localeCompare(b.ext) * d || byName(a, b)
      case 'rating': {
        const ra = lib.ratings[libKey(a)] ?? 0
        const rb = lib.ratings[libKey(b)] ?? 0
        // 没评分的永远排最后
        if (ra === 0 && rb === 0) return byName(a, b)
        if (ra === 0) return 1
        if (rb === 0) return -1
        return (ra - rb) * d || byName(a, b)
      }
      case 'tris': {
        const ta = thumbs?.get(a.id)?.stats?.triangles
        const tb = thumbs?.get(b.id)?.stats?.triangles
        // 还没出图的（未知）永远排最后
        if (ta === undefined && tb === undefined) return byName(a, b)
        if (ta === undefined) return 1
        if (tb === undefined) return -1
        return (ta - tb) * d || byName(a, b)
      }
      default:
        return byName(a, b) * d
    }
  })
  return sorted
}
