import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtSize, fmtTris, useItemKeyboard, type ItemViewProps } from './Grid'
import { RatingStars } from './RatingStars'
import { colorOf } from '../shared/labels'
import { libKey } from '../shared/filters'
import type { SortDir, SortKey } from '../shared/types'

const ROW_H = 44

interface Props extends ItemViewProps {
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}

const COLUMNS: { key: SortKey | null; label: string; cls: string }[] = [
  { key: null, label: '', cls: 'c-thumb' },
  { key: 'name', label: '名称', cls: 'c-name' },
  { key: 'ext', label: '格式', cls: 'c-ext' },
  { key: 'size', label: '大小', cls: 'c-size' },
  { key: 'tris', label: '面数', cls: 'c-tris' },
  { key: 'date', label: '修改时间', cls: 'c-date' },
  { key: 'rating', label: '评分', cls: 'c-rating' },
  { key: null, label: '标签', cls: 'c-tags' }
]

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 列表（详情）视图：一行一个模型，列头可排序。和网格一样是窗口化渲染。 */
export default function ListView({
  entries,
  thumbs,
  favorites,
  tags,
  ratings,
  colors,
  selectedIds,
  onSelect,
  onOpen,
  onContext,
  onDragStart,
  onToggleFavorite,
  onRate,
  onThumbError,
  focusedIndex,
  onFocusIndex,
  keyboardEnabled,
  onVisibleRange,
  sortKey,
  sortDir,
  onSort
}: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const totalH = entries.length * ROW_H
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop > Math.max(0, totalH - viewportH)) {
      el.scrollTop = Math.max(0, totalH - viewportH)
      setScrollTop(el.scrollTop)
    }
  }, [totalH, viewportH])

  const buffer = 6
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - buffer)
  const end = Math.min(entries.length, Math.ceil((scrollTop + viewportH) / ROW_H) + buffer)

  useEffect(() => {
    if (entries.length === 0) return
    const center = (scrollTop + viewportH / 2) / ROW_H
    const batch: { entry: (typeof entries)[number]; priority: number }[] = []
    for (let i = start; i < end; i++) {
      const e = entries[i]
      if (e) batch.push({ entry: e, priority: Math.abs(i - center) / 4 })
    }
    onVisibleRange(batch)
  }, [start, end, entries, scrollTop, viewportH, onVisibleRange])

  const scrollIntoView = useCallback((index: number) => {
    const el = scrollRef.current
    if (!el) return
    const top = index * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
  }, [])

  useItemKeyboard(
    keyboardEnabled,
    entries.length,
    1,
    Math.max(1, Math.floor(viewportH / ROW_H)),
    focusedIndex,
    onFocusIndex,
    scrollIntoView
  )

  const rows: JSX.Element[] = []
  for (let i = start; i < end; i++) {
    const e = entries[i]
    if (!e) continue
    const t = thumbs.get(e.id)
    const key = libKey(e)
    const fav = favorites.has(key)
    const tagList = tags[key] ?? []
    const color = colorOf(colors[key])
    rows.push(
      <div
        key={e.id}
        className={`lrow${selectedIds.has(e.id) ? ' sel' : ''}${focusedIndex === i ? ' focus' : ''}${
          e.previewable ? '' : ' unsupported'
        }`}
        style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H }}
        draggable
        onClick={(ev) => onSelect(i, ev.ctrlKey || ev.metaKey ? 'toggle' : ev.shiftKey ? 'range' : 'single')}
        onDoubleClick={() => onOpen(i)}
        onContextMenu={(ev) => onContext(ev, e, i)}
        onDragStart={(ev) => {
          ev.preventDefault()
          onDragStart(i)
        }}
        title={e.rel}
      >
        <div className="c-thumb">
          {t?.url ? (
            <img src={t.url} alt="" draggable={false} loading="lazy" onError={() => onThumbError(e)} />
          ) : t?.state === 'failed' ? (
            <span className="mini failed">⚠</span>
          ) : !e.previewable ? (
            <span className="mini">—</span>
          ) : (
            <span className="spinner small" />
          )}
        </div>
        <div className="c-name">
          <span
            className={`star${fav ? ' on' : ''}`}
            onClick={(ev) => {
              ev.stopPropagation()
              onToggleFavorite(e)
            }}
            onDoubleClick={(ev) => ev.stopPropagation()}
          >
            {fav ? '★' : '☆'}
          </span>
          {color && <i className="color-mark" style={{ background: color }} />}
          <span className="txt">{e.name}</span>
          {t?.stats && t.stats.animations.length > 0 && <span className="pill">▶</span>}
          {t?.state === 'embedded' && <span className="pill warn">内嵌图</span>}
        </div>
        <div className="c-ext">{e.ext.slice(1)}</div>
        <div className="c-size">{fmtSize(e.size)}</div>
        <div className="c-tris">{t?.stats ? fmtTris(t.stats.triangles) : '—'}</div>
        <div className="c-date">{fmtDate(e.mtimeMs)}</div>
        <div className="c-rating">
          <RatingStars value={ratings[key] ?? 0} onChange={(v) => onRate(e, v)} size={12} />
        </div>
        <div className="c-tags">
          {tagList.map((tg) => (
            <span key={tg}>{tg}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="list-wrap">
      <div className="lhead">
        {COLUMNS.map((c) => (
          <div
            key={c.cls}
            className={`${c.cls}${c.key ? ' sortable' : ''}${c.key === sortKey ? ' on' : ''}`}
            onClick={() => c.key && onSort(c.key)}
          >
            {c.label}
            {c.key === sortKey && <span className="arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>}
          </div>
        ))}
      </div>
      <div className="list-scroll" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="list-inner" style={{ height: totalH }}>
          {rows}
        </div>
      </div>
    </div>
  )
}
