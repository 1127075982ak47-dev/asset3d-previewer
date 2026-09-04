import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ModelEntry, ThumbResult } from '../shared/types'

const GAP = 12
const META_H = 40

interface Props {
  entries: ModelEntry[]
  thumbs: Map<string, ThumbResult>
  favorites: Set<string>
  tags: Record<string, string[]>
  cardSize: number
  selectedIds: Set<string>
  onSelect: (index: number, mode: 'single' | 'toggle' | 'range') => void
  onOpen: (index: number) => void
  onContext: (e: React.MouseEvent, entry: ModelEntry, index: number) => void
  onDragStart: (index: number) => void
  onToggleFavorite: (entry: ModelEntry) => void
  onThumbError: (entry: ModelEntry) => void
  /** 当前键盘焦点所在的卡片下标 */
  focusedIndex: number
  onFocusIndex: (index: number) => void
  /** 有弹层/查看器打开时置 false，避免抢键盘 */
  keyboardEnabled: boolean
  /** 可视范围变化时回调，主进程据此调整出图优先级 */
  onVisibleRange: (entries: { entry: ModelEntry; priority: number }[]) => void
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function fmtTris(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function libKey(e: ModelEntry): string {
  return e.path.toLowerCase()
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
  favorites,
  tags,
  cardSize,
  selectedIds,
  onSelect,
  onOpen,
  onContext,
  onDragStart,
  onToggleFavorite,
  onThumbError,
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

  // 换了筛选/排序后列表变短，滚动位置可能已经超出范围
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop > Math.max(0, totalH - viewport.h)) {
      el.scrollTop = Math.max(0, totalH - viewport.h)
      setScrollTop(el.scrollTop)
    }
  }, [totalH, viewport.h])

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
    const fav = favorites.has(libKey(e))
    const tagList = tags[libKey(e)] ?? []
    const animated = !!t?.stats && t.stats.animations.length > 0

    cards.push(
      <div
        key={e.id}
        className={`card${selectedIds.has(e.id) ? ' sel' : ''}${
          focusedIndex === i ? ' focus' : ''
        }${e.previewable ? '' : ' unsupported'}`}
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
        title={`${e.rel}${tagList.length ? `\n标签: ${tagList.join(', ')}` : ''}${
          t?.state === 'failed' && t.error ? `\n失败: ${t.error}` : ''
        }\n拖拽可直接拖入 Blender / Unity 等程序`}
      >
        <div className="thumb">
          {t?.url ? (
            <img
              src={t.url}
              alt={e.name}
              draggable={false}
              loading="lazy"
              onError={() => onThumbError(e)}
            />
          ) : !e.previewable ? (
            <span className="placeholder-ext">{e.ext.slice(1).toUpperCase()}</span>
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

          <span
            className={`star${fav ? ' on' : ''}`}
            title={fav ? '取消收藏' : '收藏'}
            onClick={(ev) => {
              ev.stopPropagation()
              onToggleFavorite(e)
            }}
            onDoubleClick={(ev) => ev.stopPropagation()}
          >
            {fav ? '★' : '☆'}
          </span>

          {animated && (
            <span className="state anim" title={`${t!.stats!.animations.length} 段动画`}>
              ▶ 动画
            </span>
          )}
          {t?.state === 'embedded' && (
            <span
              className="state embedded"
              title={
                t.error
                  ? `来自 .blend 内嵌预览图。Blender 转换失败：${t.error}`
                  : '来自 .blend 内嵌预览图，尚未转换为可交互模型'
              }
            >
              内嵌图
            </span>
          )}
          {t?.state === 'failed' && (
            <span className="state failed" title={t.error}>
              失败
            </span>
          )}
          {!e.previewable && (
            <span className="state unsupported" title="没有开源库能解析这个格式，只能用默认程序打开">
              不支持预览
            </span>
          )}
        </div>

        <div className="meta">
          <div className="name">{e.name}</div>
          <div className="sub">
            <span>
              {fmtSize(e.size)}
              {t?.stats ? ` · △${fmtTris(t.stats.triangles)}` : ''}
            </span>
            {tagList.length > 0 && (
              <span className="tags">
                {tagList.slice(0, 2).join(' · ')}
                {tagList.length > 2 ? ` +${tagList.length - 2}` : ''}
              </span>
            )}
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
