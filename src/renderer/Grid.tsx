import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ModelEntry, ThumbResult } from '../shared/types'

const GAP = 12
const META_H = 38

interface Props {
  entries: ModelEntry[]
  thumbs: Map<string, ThumbResult>
  cardSize: number
  selectedIds: Set<string>
  onSelect: (index: number, mode: 'single' | 'toggle' | 'range') => void
  onOpen: (index: number) => void
  onContext: (e: React.MouseEvent, entry: ModelEntry, index: number) => void
  onDragStart: (index: number) => void
  /** 当前键盘焦点所在的卡片下标 */
  focusedIndex: number
  onFocusIndex: (index: number) => void
  /** 有弹层/查看器打开时置 false，避免抢键盘 */
  keyboardEnabled: boolean
  /** 可视范围变化时回调，主进程据此调整出图优先级 */
  onVisibleRange: (entries: { entry: ModelEntry; priority: number }[]) => void
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 定高定宽的窗口化网格。
 *
 * 只渲染视口内（外加几行缓冲）的卡片 —— 一个几千个模型的素材库
 * 全量塞进 DOM 会直接卡死；这样滚动始终是 60fps。
 */
export default function Grid({
  entries,
  thumbs,
  cardSize,
  selectedIds,
  onSelect,
  onOpen,
  onContext,
  onDragStart,
  focusedIndex,
  onFocusIndex,
  keyboardEnabled,
  onVisibleRange
}: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  const cardW = cardSize
  const cardH = cardSize + META_H
  const rowH = cardH + GAP
  const innerW = Math.max(viewport.w - 24, cardW)
  const cols = Math.max(1, Math.floor((innerW + GAP) / (cardW + GAP)))
  const rows = Math.ceil(entries.length / cols)
  const totalH = rows * rowH

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const bufferRows = 2
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - bufferRows)
  const lastRow = Math.min(
    rows - 1,
    Math.ceil((scrollTop + viewport.h) / rowH) + bufferRows
  )
  const start = firstRow * cols
  const end = Math.min(entries.length, (lastRow + 1) * cols)

  // 把当前可视条目上报，让离视口越近的越早出图
  useEffect(() => {
    if (entries.length === 0) return
    const centerRow = (scrollTop + viewport.h / 2) / rowH
    const batch: { entry: ModelEntry; priority: number }[] = []
    for (let i = start; i < end; i++) {
      const e = entries[i]
      if (!e) continue
      const row = Math.floor(i / cols)
      batch.push({ entry: e, priority: Math.abs(row - centerRow) })
    }
    onVisibleRange(batch)
  }, [start, end, entries, cols, scrollTop, viewport.h, rowH, onVisibleRange])

  /** 把某张卡片滚进视野，键盘移动焦点时用 */
  const scrollIntoView = useCallback(
    (index: number) => {
      const el = scrollRef.current
      if (!el || cols === 0) return
      const row = Math.floor(index / cols)
      const top = row * rowH
      const bottom = top + cardH
      if (top < el.scrollTop) {
        el.scrollTop = Math.max(0, top - GAP)
      } else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight + GAP
      }
    },
    [cols, rowH, cardH]
  )

  // 方向键在卡片之间移动。Grid 自己处理是因为只有它知道当前一行几列。
  useEffect(() => {
    if (!keyboardEnabled || entries.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      const perPage = Math.max(1, Math.floor(viewport.h / rowH)) * cols
      const cur = focusedIndex < 0 ? 0 : focusedIndex
      let next: number | null = null

      switch (e.key) {
        case 'ArrowRight':
          next = cur + 1
          break
        case 'ArrowLeft':
          next = cur - 1
          break
        case 'ArrowDown':
          next = cur + cols
          break
        case 'ArrowUp':
          next = cur - cols
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = entries.length - 1
          break
        case 'PageDown':
          next = cur + perPage
          break
        case 'PageUp':
          next = cur - perPage
          break
        default:
          return
      }

      e.preventDefault()
      // 首次按方向键时先落到第 0 张，而不是直接跳走
      if (focusedIndex < 0) next = 0
      const clamped = Math.max(0, Math.min(entries.length - 1, next))
      onFocusIndex(clamped)
      scrollIntoView(clamped)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    keyboardEnabled,
    entries.length,
    cols,
    rowH,
    viewport.h,
    focusedIndex,
    onFocusIndex,
    scrollIntoView
  ])

  const cards: JSX.Element[] = []
  for (let i = start; i < end; i++) {
    const e = entries[i]
    if (!e) continue
    const row = Math.floor(i / cols)
    const col = i % cols
    const t = thumbs.get(e.id)

    cards.push(
      <div
        key={e.id}
        className={`card${selectedIds.has(e.id) ? ' sel' : ''}${
          focusedIndex === i ? ' focus' : ''
        }`}
        style={{
          width: cardW,
          height: cardH,
          transform: `translate(${col * (cardW + GAP)}px, ${row * rowH}px)`
        }}
        draggable
        onClick={(ev) =>
          onSelect(i, ev.ctrlKey || ev.metaKey ? 'toggle' : ev.shiftKey ? 'range' : 'single')
        }
        onDoubleClick={() => onOpen(i)}
        onContextMenu={(ev) => onContext(ev, e, i)}
        onDragStart={(ev) => {
          // 必须阻止 HTML5 默认拖拽，交给 Electron 的原生 startDrag 接管，
          // 否则拖到外部程序只会得到一段文本而不是真实文件
          ev.preventDefault()
          onDragStart(i)
        }}
        title={`${e.rel}\n拖拽可直接拖入 Blender / Unity 等程序`}
      >
        <div className="thumb">
          {t?.url ? (
            <img src={t.url} alt={e.name} draggable={false} loading="lazy" />
          ) : t?.state === 'failed' ? (
            <span className="placeholder-ico">⚠</span>
          ) : t?.state === 'rendering' || t?.state === 'pending' || !t ? (
            <span className="spinner" />
          ) : (
            <span className="placeholder-ico">◻</span>
          )}

          <span className={`badge${e.ext === '.blend' ? ' blend' : ''}`}>
            {e.ext.slice(1)}
          </span>

          {t?.state === 'embedded' && (
            <span className="state embedded" title="来自 .blend 内嵌预览图，尚未转换为可交互模型">
              内嵌图
            </span>
          )}
          {t?.state === 'failed' && (
            <span className="state failed" title={t.error}>
              失败
            </span>
          )}
        </div>

        <div className="meta">
          <div className="name">{e.name}</div>
          <div className="sub">
            <span>{fmtSize(e.size)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="grid-inner" style={{ height: totalH }}>
        {cards}
      </div>
    </div>
  )
}
