import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Grid from './Grid'
import Viewer from './Viewer'
import Settings from './Settings'
import type { Api } from '../preload'
import type {
  AppSettings,
  BlenderInfo,
  ModelEntry,
  ScanResult,
  ThumbResult
} from '../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

type SortKey = 'name' | 'size' | 'date' | 'ext'

interface Ctx {
  x: number
  y: number
  entry: ModelEntry
  index: number
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [thumbs, setThumbs] = useState<Map<string, ThumbResult>>(new Map())
  const [query, setQuery] = useState('')
  const [extFilter, setExtFilter] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [cardSize, setCardSize] = useState(168)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const anchorRef = useRef<number | null>(null)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [blender, setBlender] = useState<BlenderInfo | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [toast, setToastRaw] = useState<string | null>(null)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setToast = useCallback((msg: string) => {
    setToastRaw(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastRaw(null), 2600)
  }, [])

  /** 已经派过单的 id，避免同一个模型被反复丢进队列 */
  const requested = useRef<Set<string>>(new Set())

  useEffect(() => {
    void (async () => {
      const s = await window.api.getSettings()
      setSettings(s)
      setRecent(await window.api.recentFolders())
      setBlender(await window.api.blenderInfo())
    })()
  }, [])

  // .blend 的两段式出图靠这个通道推第二次结果（内嵌图 → 真渲染图）
  useEffect(() => {
    return window.api.onThumbProgress((r) => {
      if (r.state === 'pending') return
      setThumbs((prev) => {
        const next = new Map(prev)
        next.set(r.id, r)
        return next
      })
    })
  }, [])

  const openFolder = useCallback(
    async (dir?: string) => {
      const target = dir ?? (await window.api.selectFolder())
      if (!target) return

      const s = settings ?? (await window.api.getSettings())
      setScanning(true)
      setThumbs(new Map())
      requested.current = new Set()
      setSelectedIds(new Set())
      setFocusedIndex(-1)
      anchorRef.current = null
      setViewerIdx(null)
      setRoot(target)

      try {
        const result = await window.api.scanFolder(target, {
          recursive: s.recursive,
          maxDepth: s.maxDepth
        })
        setScan(result)
        setRecent(await window.api.recentFolders())
      } finally {
        setScanning(false)
      }
    },
    [settings]
  )

  /* ---------- 筛选 / 排序 ---------- */

  const available = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of scan?.entries ?? []) m.set(e.ext, (m.get(e.ext) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [scan])

  const entries = useMemo(() => {
    let list = scan?.entries ?? []
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q))
    if (extFilter.size > 0) list = list.filter((e) => extFilter.has(e.ext))

    const sorted = [...list]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'size':
          return b.size - a.size
        case 'date':
          return b.mtimeMs - a.mtimeMs
        case 'ext':
          return a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name, 'zh-CN')
        default:
          return a.rel.localeCompare(b.rel, 'zh-CN', {
            numeric: true,
            sensitivity: 'base'
          })
      }
    })
    return sorted
  }, [scan, query, extFilter, sortKey])

  /* ---------- 出图调度 ---------- */

  const onVisibleRange = useCallback(
    (batch: { entry: ModelEntry; priority: number }[]) => {
      if (!settings) return
      for (const { entry, priority } of batch) {
        if (requested.current.has(entry.id)) continue
        requested.current.add(entry.id)

        setThumbs((prev) => {
          if (prev.has(entry.id)) return prev
          const next = new Map(prev)
          next.set(entry.id, { id: entry.id, state: 'pending' })
          return next
        })

        void window.api
          .requestThumb(entry, settings.thumbSize, priority)
          .then((r) => {
            if (r.state === 'pending') {
              // 换文件夹导致任务被作废，放回未请求状态以便重试
              requested.current.delete(entry.id)
              return
            }
            setThumbs((prev) => {
              const cur = prev.get(entry.id)
              // 别让先到的内嵌图覆盖后到的完整渲染图
              if (cur?.state === 'ready' && r.state === 'embedded') return prev
              const next = new Map(prev)
              next.set(entry.id, r)
              return next
            })
          })
          .catch(() => {
            requested.current.delete(entry.id)
          })
      }
    },
    [settings]
  )

  const doneCount = useMemo(() => {
    let n = 0
    for (const t of thumbs.values()) {
      if (t.state === 'ready' || t.state === 'embedded' || t.state === 'failed') n++
    }
    return n
  }, [thumbs])

  const failedCount = useMemo(() => {
    let n = 0
    for (const t of thumbs.values()) if (t.state === 'failed') n++
    return n
  }, [thumbs])

  /* ---------- 拖放文件夹 ---------- */

  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const p = window.api.getPathForFile(f)
      if (!p) return
      void window.api.validateFolder(p).then((isDir) => {
        // 拖进来的是文件就打开它所在的目录
        void openFolder(isDir ? p : p.replace(/[\\/][^\\/]+$/, ''))
      })
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [openFolder])

  useEffect(() => {
    const close = (): void => setCtx(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // 命令行 --folder=<路径> 启动时自动打开（只在设置就绪后跑一次）
  const bootedRef = useRef(false)
  useEffect(() => {
    if (!settings || bootedRef.current) return
    bootedRef.current = true
    void window.api.initialFolder().then((dir) => {
      if (dir) void openFolder(dir)
    })
  }, [settings, openFolder])

  const select = useCallback(
    (index: number, mode: 'single' | 'toggle' | 'range') => {
      const entry = entries[index]
      if (!entry) return
      setFocusedIndex(index)
      setSelectedIds((prev) => {
        if (mode === 'toggle') {
          const next = new Set(prev)
          if (next.has(entry.id)) next.delete(entry.id)
          else next.add(entry.id)
          anchorRef.current = index
          return next
        }
        if (mode === 'range' && anchorRef.current !== null) {
          const [a, b] = [anchorRef.current, index].sort((x, y) => x - y)
          const next = new Set<string>()
          for (let i = a; i <= b; i++) if (entries[i]) next.add(entries[i].id)
          return next
        }
        anchorRef.current = index
        return new Set([entry.id])
      })
    },
    [entries]
  )

  /** 拖到外部程序。拖没被选中的卡片时，先把它变成唯一选中项 */
  const handleDragStart = useCallback(
    (index: number) => {
      const entry = entries[index]
      if (!entry) return

      let ids = selectedIds
      if (!ids.has(entry.id)) {
        ids = new Set([entry.id])
        setSelectedIds(ids)
        anchorRef.current = index
      }

      const paths = entries.filter((e) => ids.has(e.id)).map((e) => e.path)
      // 用被拖那一个的缩略图当拖拽图标
      const url = thumbs.get(entry.id)?.url
      const key = url ? /([a-f0-9]{40})\.png$/.exec(url)?.[1] : null
      window.api.startDrag(paths.length > 0 ? paths : [entry.path], key)
    },
    [entries, selectedIds, thumbs]
  )

  // 网格里按回车/方向键/Ctrl+A 也能操作
  useEffect(() => {
    if (viewerIdx !== null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
        return
      if (e.key === 'Enter') {
        const idx =
          focusedIndex >= 0
            ? focusedIndex
            : entries.findIndex((x) => selectedIds.has(x.id))
        if (idx >= 0) setViewerIdx(idx)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelectedIds(new Set(entries.map((x) => x.id)))
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, entries, viewerIdx, focusedIndex])

  function regenerate(entry: ModelEntry): void {
    requested.current.delete(entry.id)
    setThumbs((prev) => {
      const next = new Map(prev)
      next.delete(entry.id)
      return next
    })
  }

  const hasBlend = useMemo(
    () => (scan?.entries ?? []).some((e) => e.ext === '.blend'),
    [scan]
  )

  return (
    <div className="app">
      <div className="toolbar">
        <button className="primary" onClick={() => void openFolder()}>
          打开文件夹
        </button>
        {root && (
          <>
            <button onClick={() => void openFolder(root)} disabled={scanning}>
              重新扫描
            </button>
            <span className="path" title={root}>
              {root}
            </span>
          </>
        )}

        <div className="spacer" />

        <input
          type="search"
          placeholder="搜索名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 168 }}
        />

        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="date">按修改时间</option>
          <option value="ext">按格式</option>
        </select>

        <input
          type="range"
          min={110}
          max={300}
          step={2}
          value={cardSize}
          onChange={(e) => setCardSize(Number(e.target.value))}
          title="缩略图大小"
          style={{ width: 96 }}
        />

        <button onClick={() => setShowSettings(true)}>设置</button>
      </div>

      {available.length > 0 && (
        <div className="toolbar" style={{ paddingTop: 5, paddingBottom: 5 }}>
          <span
            className={`chip${extFilter.size === 0 ? ' on' : ''}`}
            onClick={() => setExtFilter(new Set())}
          >
            全部 {scan?.entries.length ?? 0}
          </span>
          {available.map(([ext, n]) => (
            <span
              key={ext}
              className={`chip${extFilter.has(ext) ? ' on' : ''}`}
              onClick={() =>
                setExtFilter((prev) => {
                  const next = new Set(prev)
                  if (next.has(ext)) next.delete(ext)
                  else next.add(ext)
                  return next
                })
              }
            >
              {ext.slice(1)} {n}
            </span>
          ))}
        </div>
      )}

      {!root ? (
        <div className="empty">
          <div style={{ fontSize: 46, opacity: 0.3 }}>🧊</div>
          <h2>选择一个 3D 资源文件夹</h2>
          <p>
            自动为 glb / gltf / fbx / obj / stl / ply / dae / 3ds / 3mf / blend
            批量生成缩略图。
            <br />
            .bin、.mtl 和贴图会被自动识别为伴生文件并隐藏，只留下真正的模型。
            <br />
            选好的模型可以直接从窗口里拖进 Blender、Unity 等程序。
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => void openFolder()}>
              打开文件夹
            </button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.7 }}>也可以直接把文件夹拖进窗口</p>
          {recent.length > 0 && (
            <div className="recent">
              <div style={{ fontSize: 12, marginBottom: 2, direction: 'ltr' }}>
                最近打开
              </div>
              {recent.slice(0, 6).map((d) => (
                <button key={d} onClick={() => void openFolder(d)} title={d}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : scanning ? (
        <div className="empty">
          <span className="spinner" />
          <div>正在扫描…</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 40, opacity: 0.3 }}>∅</div>
          <h2>没有找到可预览的模型</h2>
          <p>
            这个文件夹里没有支持的 3D 格式
            {scan && scan.hiddenCount > 0 && (
              <>
                （已跳过 {scan.hiddenCount} 个贴图/伴生文件）
              </>
            )}
            。
            {!settings?.recursive && '当前未开启递归扫描，子文件夹里的模型不会被列出。'}
          </p>
        </div>
      ) : (
        <Grid
          entries={entries}
          thumbs={thumbs}
          cardSize={cardSize}
          selectedIds={selectedIds}
          onSelect={select}
          onOpen={setViewerIdx}
          onDragStart={handleDragStart}
          focusedIndex={focusedIndex}
          onFocusIndex={(i) => select(i, 'single')}
          keyboardEnabled={viewerIdx === null && !showSettings && ctx === null}
          onContext={(e, entry, index) => {
            e.preventDefault()
            if (!selectedIds.has(entry.id)) setSelectedIds(new Set([entry.id]))
            setCtx({ x: e.clientX, y: e.clientY, entry, index })
          }}
          onVisibleRange={onVisibleRange}
        />
      )}

      {root && (
        <div className="statusbar">
          <span>
            {entries.length} 个模型
            {scan && scan.hiddenCount > 0 && ` · 已隐藏 ${scan.hiddenCount} 个伴生文件`}
            {scan && ` · 扫描 ${scan.scannedFiles} 个文件 / ${scan.elapsedMs}ms`}
          </span>
          {thumbs.size > 0 && doneCount < thumbs.size && (
            <>
              <div className="progress">
                <i style={{ width: `${(doneCount / thumbs.size) * 100}%` }} />
              </div>
              <span>
                缩略图 {doneCount}/{thumbs.size}
              </span>
            </>
          )}
          {failedCount > 0 && (
            <span style={{ color: 'var(--danger)' }}>{failedCount} 个失败</span>
          )}
          <div className="spacer" />
          {hasBlend && (
            <span
              style={{ color: blender?.available ? 'var(--ok)' : 'var(--warn)' }}
              title={
                blender?.available
                  ? blender.installs.map((i) => i.version).join(' / ')
                  : '未检测到 Blender，.blend 只能显示内嵌预览图'
              }
            >
              {blender?.available
                ? `Blender ${blender.installs[blender.installs.length - 1]?.version} 就绪`
                : '未检测到 Blender'}
            </span>
          )}
          {selectedIds.size > 1 && (
            <span style={{ color: 'var(--accent)' }}>已选中 {selectedIds.size} 个</span>
          )}
          <span style={{ color: 'var(--fg-faint)' }}>
            双击放大 · 拖拽可直接拖入 Blender · Ctrl/Shift 多选
          </span>
        </div>
      )}

      {dragging && <div className="drop-hint">松开以打开该文件夹</div>}

      {toast && <div className="toast">{toast}</div>}

      {ctx && (
        <div className="ctxmenu" style={{ left: ctx.x, top: ctx.y }}>
          <button onClick={() => setViewerIdx(ctx.index)}>放大查看</button>
          <button
            onClick={() =>
              void window.api.openInBlender(ctx.entry.path).then((r) => {
                if (!r.ok) setToast(r.error ?? '打开失败')
              })
            }
            disabled={!blender?.available}
            title={blender?.available ? undefined : '未检测到 Blender'}
          >
            用 Blender 打开
          </button>
          <button onClick={() => void window.api.openPath(ctx.entry.path)}>
            用默认程序打开
          </button>
          <hr />
          <button onClick={() => void window.api.showItem(ctx.entry.path)}>
            在资源管理器中显示
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(ctx.entry.path)
              setToast('已复制路径')
            }}
          >
            复制完整路径
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(ctx.entry.name)
              setToast('已复制文件名')
            }}
          >
            复制文件名
          </button>
          <hr />
          <button onClick={() => regenerate(ctx.entry)}>重新生成缩略图</button>
          <button
            onClick={() =>
              void window.api.exportGlb(ctx.entry).then((r) => {
                if (r.ok && r.path) setToast('已导出 GLB')
                else if (r.error) setToast(r.error)
              })
            }
          >
            导出为 GLB…
          </button>
        </div>
      )}

      {viewerIdx !== null && entries[viewerIdx] && (
        <Viewer
          entries={entries}
          index={viewerIdx}
          onIndex={setViewerIdx}
          onClose={() => setViewerIdx(null)}
        />
      )}

      {showSettings && settings && (
        <Settings
          settings={settings}
          blender={blender}
          onClose={() => setShowSettings(false)}
          onSave={async (patch) => {
            const next = await window.api.saveSettings(patch)
            setSettings(next)
            if (patch.recursive !== undefined || patch.maxDepth !== undefined) {
              if (root) void openFolder(root)
            }
            if (patch.thumbSize !== undefined) {
              requested.current = new Set()
              setThumbs(new Map())
            }
          }}
          onBlenderRedetect={async () => {
            const info = await window.api.blenderRedetect()
            setBlender(info)
            return info
          }}
        />
      )}
    </div>
  )
}
