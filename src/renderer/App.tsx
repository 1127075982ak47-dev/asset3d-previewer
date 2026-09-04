import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Grid from './Grid'
import Viewer from './Viewer'
import Settings from './Settings'
import Sidebar from './Sidebar'
import SelectionBar from './SelectionBar'
import TagEditor, { libKey } from './TagEditor'
import ExportDialog, { type ExportState } from './ExportDialog'
import AboutDialog from './AboutDialog'
import ShortcutsDialog from './ShortcutsDialog'
import { buildTree, isUnderDir } from './lib/tree'
import { SHEET_MAX_ITEMS, renderContactSheet } from './lib/contactSheet'
import { IconFolder, IconRefresh, IconSettings, IconSidebar, IconSort } from './icons'
import type { Api } from '../preload'
import type {
  AppSettings,
  BlenderInfo,
  LibraryPayload,
  MenuAction,
  ModelEntry,
  ScanProgress,
  ScanResult,
  ThumbRequest,
  ThumbResult
} from '../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

type SortKey = 'name' | 'size' | 'date' | 'ext' | 'tris'
type SortDir = 'asc' | 'desc'

interface Ctx {
  x: number
  y: number
  entry: ModelEntry
  index: number
}

interface Lib {
  favorites: Set<string>
  tags: Record<string, string[]>
  allTags: string[]
}

interface Toast {
  msg: string
  kind: 'ok' | 'warn' | 'error'
}

const EMPTY_LIB: Lib = { favorites: new Set(), tags: {}, allTags: [] }

function toLib(p: LibraryPayload): Lib {
  return { favorites: new Set(p.favorites), tags: p.tags, allTags: p.allTags }
}

function basename(p: string): string {
  const m = /[^\\/]+[\\/]?$/.exec(p)
  return (m ? m[0] : p).replace(/[\\/]$/, '')
}

/** 右键菜单：按窗口边界钳位，别弹到屏幕外面去 */
function ContextMenu({
  x,
  y,
  children
}: {
  x: number
  y: number
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4))
    const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4))
    setPos({ left, top })
  }, [x, y])
  return (
    <div ref={ref} className="ctxmenu" style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Map<string, ThumbResult>>(new Map())
  const [query, setQuery] = useState('')
  const [extFilter, setExtFilter] = useState<Set<string>>(new Set())
  const [favFilter, setFavFilter] = useState(false)
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set())
  const [animFilter, setAnimFilter] = useState(false)
  const [failedFilter, setFailedFilter] = useState(false)
  const [dirFilter, setDirFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [cardSize, setCardSize] = useState(168)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const anchorRef = useRef<number | null>(null)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [tagTarget, setTagTarget] = useState<ModelEntry[] | null>(null)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [failInfo, setFailInfo] = useState<{ entry: ModelEntry; error: string; missing: string[] } | null>(null)
  const [blender, setBlender] = useState<BlenderInfo | null>(null)
  const [recent, setRecent] = useState<{ dir: string; exists: boolean }[]>([])
  const [dragging, setDragging] = useState(false)
  const [folderChanged, setFolderChanged] = useState(false)
  const [lib, setLib] = useState<Lib>(EMPTY_LIB)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [toast, setToastRaw] = useState<Toast | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setToast = useCallback((msg: string, kind: Toast['kind'] = 'ok') => {
    setToastRaw({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastRaw(null), kind === 'error' ? 5000 : 2600)
  }, [])

  /** 已经派过单的 id，避免同一个模型被反复丢进队列 */
  const requested = useRef<Set<string>>(new Set())
  /** 每次扫描递增；慢的那次回来时发现自己已经过时就直接丢弃 */
  const scanSeq = useRef(0)
  /** 正在把卡片往窗口外拖：此时窗口级的 dragover/drop 都要忽略 */
  const draggingOut = useRef(false)
  /** Grid 最近一次上报的可见批次，任务被主进程退回后用它重新提交 */
  const lastVisible = useRef<{ entry: ModelEntry; priority: number }[]>([])
  const visibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settings

  const refreshLib = useCallback(async () => {
    setLib(toLib(await window.api.library()))
  }, [])

  const refreshRecent = useCallback(async () => {
    setRecent(await window.api.recentFolders())
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await window.api.getSettings()
      setSettings(s)
      setSidebarVisible(s.sidebarVisible)
      await refreshRecent()
      setBlender(await window.api.blenderInfo())
      await refreshLib()
    })()
  }, [refreshLib, refreshRecent])

  useEffect(() => {
    document.title = root ? `${basename(root)} - 3D 资源预览器` : '3D 资源预览器'
  }, [root])

  const thumbReq = useCallback((priority: number): ThumbRequest => {
    const s = settingsRef.current
    return {
      px: s?.thumbSize ?? 512,
      priority,
      lighting: s?.lighting ?? 'studio',
      background: s?.background ?? 'transparent'
    }
  }, [])

  /* ---------- 出图请求 ---------- */

  const requestOne = useCallback(
    (entry: ModelEntry, priority: number) => {
      if (requested.current.has(entry.id)) return
      requested.current.add(entry.id)

      setThumbs((prev) => {
        if (prev.has(entry.id)) return prev
        const next = new Map(prev)
        next.set(entry.id, { id: entry.id, state: 'pending' })
        return next
      })

      void window.api
        .requestThumb(entry, thumbReq(priority))
        .then((r) => {
          if (r.state === 'pending') {
            // 换文件夹 / 队列满导致任务被退回，放回未请求状态，可见时再提交
            requested.current.delete(entry.id)
            if (resubmitTimer.current) clearTimeout(resubmitTimer.current)
            resubmitTimer.current = setTimeout(() => {
              for (const v of lastVisible.current) requestOne(v.entry, v.priority)
            }, 200)
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
    },
    [thumbReq]
  )

  // .blend 的两段式出图靠这个通道推第二次结果（内嵌图 → 真渲染图）
  useEffect(() => {
    return window.api.onThumbProgress((r) => {
      if (r.state === 'pending') return
      setThumbs((prev) => {
        // 只认当前列表里的条目，换文件夹后迟到的结果直接扔掉
        if (!prev.has(r.id)) return prev
        const cur = prev.get(r.id)
        if (cur?.state === 'ready' && r.state === 'embedded') return prev
        const next = new Map(prev)
        next.set(r.id, r)
        return next
      })
    })
  }, [])

  /* ---------- 打开文件夹 / 扫描 ---------- */

  const openFolder = useCallback(
    async (dir?: string) => {
      const target = dir ?? (await window.api.selectFolder())
      if (!target) return

      const s = settingsRef.current ?? (await window.api.getSettings())
      const seq = ++scanSeq.current
      setScanning(true)
      setScanProgress(null)
      setScanError(null)
      setFolderChanged(false)
      setThumbs(new Map())
      requested.current = new Set()
      lastVisible.current = []
      setSelectedIds(new Set())
      setFocusedIndex(-1)
      anchorRef.current = null
      setViewerIdx(null)
      setCtx(null)
      setDirFilter('')
      setExtFilter(new Set())
      setFailedFilter(false)
      setRoot(target)

      try {
        const result = await window.api.scanFolder(target, {
          recursive: s.recursive,
          maxDepth: s.maxDepth
        })
        if (seq !== scanSeq.current) return
        if (result.error) {
          setScanError(result.error)
          setScan(null)
        } else {
          setScan(result)
          if (result.cancelled) setToast('扫描已取消，显示部分结果', 'warn')
        }
        await refreshRecent()
      } finally {
        if (seq === scanSeq.current) setScanning(false)
      }
    },
    [refreshRecent, setToast]
  )

  useEffect(() => window.api.onScanProgress((p) => setScanProgress(p)), [])
  useEffect(() => window.api.onOpenFolder((dir) => void openFolder(dir)), [openFolder])
  useEffect(() => window.api.onFolderChanged(() => setFolderChanged(true)), [])

  const cancelScan = useCallback(() => {
    void window.api.cancelScan()
  }, [])

  /* ---------- 筛选 / 排序 ---------- */

  const available = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of scan?.entries ?? []) m.set(e.ext, (m.get(e.ext) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [scan])

  const tree = useMemo(
    () => (scan ? buildTree(scan.entries, basename(scan.root) || scan.root) : null),
    [scan]
  )

  const needsThumbs = animFilter || failedFilter || sortKey === 'tris'
  const thumbsForFilter = needsThumbs ? thumbs : null

  const entries = useMemo(() => {
    let list = scan?.entries ?? []
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.rel.toLowerCase().includes(q) ||
          (lib.tags[libKey(e)] ?? []).some((t) => t.toLowerCase().includes(q))
      )
    }
    if (dirFilter) list = list.filter((e) => isUnderDir(e.rel, dirFilter))
    if (extFilter.size > 0) list = list.filter((e) => extFilter.has(e.ext))
    if (favFilter) list = list.filter((e) => lib.favorites.has(libKey(e)))
    if (tagFilter.size > 0) {
      list = list.filter((e) => (lib.tags[libKey(e)] ?? []).some((t) => tagFilter.has(t)))
    }
    if (thumbsForFilter) {
      if (animFilter) {
        list = list.filter((e) => (thumbsForFilter.get(e.id)?.stats?.animations.length ?? 0) > 0)
      }
      if (failedFilter) list = list.filter((e) => thumbsForFilter.get(e.id)?.state === 'failed')
    }

    const sorted = [...list]
    const dir = sortDir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'size':
          return (a.size - b.size) * dir
        case 'date':
          return (a.mtimeMs - b.mtimeMs) * dir
        case 'ext':
          return (
            a.ext.localeCompare(b.ext) * dir || a.name.localeCompare(b.name, 'zh-CN')
          )
        case 'tris': {
          const ta = thumbsForFilter?.get(a.id)?.stats?.triangles
          const tb = thumbsForFilter?.get(b.id)?.stats?.triangles
          // 还没出图的（未知）永远排最后
          if (ta === undefined && tb === undefined) return 0
          if (ta === undefined) return 1
          if (tb === undefined) return -1
          return (ta - tb) * dir
        }
        default:
          return (
            a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true, sensitivity: 'base' }) * dir
          )
      }
    })
    return sorted
  }, [scan, query, dirFilter, extFilter, favFilter, tagFilter, animFilter, failedFilter, thumbsForFilter, sortKey, sortDir, lib])

  /* ---------- 出图调度 ---------- */

  const onVisibleRange = useCallback(
    (batch: { entry: ModelEntry; priority: number }[]) => {
      if (!settingsRef.current) return
      lastVisible.current = batch
      for (const { entry, priority } of batch) requestOne(entry, priority)
      // 滚动停下来再告诉主进程谁可见，别每一帧都发一次 IPC
      if (visibleTimer.current) clearTimeout(visibleTimer.current)
      visibleTimer.current = setTimeout(() => {
        void window.api.setVisibleThumbs(batch.map((b) => b.entry.id))
      }, 80)
    },
    [requestOne]
  )

  const doneCount = useMemo(() => {
    let n = 0
    for (const t of thumbs.values()) {
      if (t.state === 'ready' || t.state === 'embedded' || t.state === 'failed' || t.state === 'unsupported') n++
    }
    return n
  }, [thumbs])

  const failedCount = useMemo(() => {
    let n = 0
    for (const t of thumbs.values()) if (t.state === 'failed') n++
    return n
  }, [thumbs])

  /* ---------- 拖放文件夹进来 ---------- */

  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      if (draggingOut.current) return
      setDragging(true)
    }
    const leave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      // 自己拖出去的卡片又松回自己窗口上，不是要打开它所在的目录
      if (draggingOut.current) return
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const p = window.api.getPathForFile(f)
      if (!p) return
      void window.api.validateFolder(p).then((isDir) => {
        // 拖进来的是文件就打开它所在的目录
        void openFolder(isDir ? p : p.replace(/[\\/][^\\/]+$/, ''))
      })
    }
    const endDragOut = (): void => {
      draggingOut.current = false
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', endDragOut)
    window.addEventListener('mouseup', endDragOut)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', endDragOut)
      window.removeEventListener('mouseup', endDragOut)
    }
  }, [openFolder])

  // 右键菜单：点别处 / 滚动 / 失焦都关掉
  useEffect(() => {
    if (!ctx) return
    const close = (): void => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [ctx])

  // 命令行 --folder=<路径> / 拖到 exe 上启动时自动打开（只在设置就绪后跑一次）
  const bootedRef = useRef(false)
  useEffect(() => {
    if (!settings || bootedRef.current) return
    bootedRef.current = true
    void window.api.initialFolder().then((dir) => {
      if (dir) void openFolder(dir)
    })
  }, [settings, openFolder])

  /* ---------- 选择 ---------- */

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

  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds]
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
      draggingOut.current = true
      // 系统级拖拽循环结束后不一定有 dragend，兜底 1.5 秒后自动解除
      setTimeout(() => {
        draggingOut.current = false
      }, 1500)
      window.api.startDrag(paths.length > 0 ? paths : [entry.path], key)
    },
    [entries, selectedIds, thumbs]
  )

  /* ---------- 收藏与标签 ---------- */

  const toggleFavorite = useCallback(
    async (targets: ModelEntry[]) => {
      if (targets.length === 0) return
      const allFav = targets.every((e) => lib.favorites.has(libKey(e)))
      await window.api.setFavorites(
        targets.map((e) => e.path),
        !allFav
      )
      await refreshLib()
      setToast(allFav ? '已取消收藏' : `已收藏 ${targets.length} 个`)
    },
    [lib, refreshLib, setToast]
  )

  /* ---------- 导出 ---------- */

  const exportEntries = useCallback(
    async (targets: ModelEntry[], toGlb: boolean) => {
      if (targets.length === 0) return
      const dir = await window.api.pickFolder(toGlb ? '选择 GLB 导出到哪个文件夹' : '选择导出到哪个文件夹')
      if (!dir) return
      setExportState({ total: targets.length, done: 0, name: '', dir })
      const off = window.api.onExportProgress((p) =>
        setExportState((s) => (s ? { ...s, done: p.done, name: p.name } : s))
      )
      try {
        const result = await window.api.exportBatchTo(targets, dir, { toGlb })
        setExportState((s) => (s ? { ...s, result } : s))
      } finally {
        off()
      }
    },
    []
  )

  const makeContactSheet = useCallback(
    async (targets: ModelEntry[]) => {
      if (targets.length === 0) return
      if (targets.length > SHEET_MAX_ITEMS) {
        setToast(`接触表一次最多 ${SHEET_MAX_ITEMS} 个，请缩小选择范围`, 'warn')
        return
      }
      setToast('正在合成接触表…')
      try {
        const title = `${root ? basename(root) : '接触表'} · ${targets.length} 个模型 · ${new Date().toLocaleDateString('zh-CN')}`
        const dataUrl = await renderContactSheet(
          targets.map((e) => ({ name: e.name, ext: e.ext, url: thumbs.get(e.id)?.url })),
          title
        )
        const saved = await window.api.exportContactSheet(dataUrl, `${root ? basename(root) : 'contact-sheet'}-接触表.png`)
        if (saved) setToast('接触表已保存')
      } catch (e) {
        setToast(`接触表生成失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },
    [root, thumbs, setToast]
  )

  const copyPaths = useCallback(
    (targets: ModelEntry[]) => {
      void navigator.clipboard.writeText(targets.map((e) => e.path).join('\n'))
      setToast(targets.length === 1 ? '已复制路径' : `已复制 ${targets.length} 个路径`)
    },
    [setToast]
  )

  /* ---------- 重新生成 / 失败原因 ---------- */

  const regenerate = useCallback(
    async (targets: ModelEntry[]) => {
      for (const entry of targets) {
        await window.api.invalidateThumb(entry, thumbReq(0))
        requested.current.delete(entry.id)
        setThumbs((prev) => {
          const next = new Map(prev)
          next.delete(entry.id)
          return next
        })
        requestOne(entry, 0)
      }
    },
    [requestOne, thumbReq]
  )

  const showFailure = useCallback(async (entry: ModelEntry) => {
    const t = thumbs.get(entry.id)
    let missing: string[] = []
    try {
      missing = (await window.api.dependencies(entry.path)).missing
    } catch {
      /* 查不了就算了 */
    }
    setFailInfo({ entry, error: t?.error ?? '未知错误', missing })
  }, [thumbs])

  /* ---------- 菜单 / 快捷键 ---------- */

  const modalOpen = showSettings || showAbout || showShortcuts || !!tagTarget || !!exportState || !!failInfo

  useEffect(() => {
    return window.api.onMenuAction((action: MenuAction) => {
      switch (action) {
        case 'open-folder':
          void openFolder()
          break
        case 'rescan':
          if (root) void openFolder(root)
          break
        case 'settings':
          setShowSettings(true)
          break
        case 'zoom-in':
          setCardSize((v) => Math.min(320, v + 20))
          break
        case 'zoom-out':
          setCardSize((v) => Math.max(110, v - 20))
          break
        case 'toggle-sidebar':
          setSidebarVisible((v) => {
            void window.api.saveSettings({ sidebarVisible: !v })
            return !v
          })
          break
        case 'shortcuts':
          setShowShortcuts(true)
          break
        case 'about':
          setShowAbout(true)
          break
      }
    })
  }, [openFolder, root])

  // 网格里的键盘操作。查看器 / 弹层打开时不响应
  useEffect(() => {
    if (viewerIdx !== null || modalOpen) return
    const onKey = (e: KeyboardEvent): void => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (inInput) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.key === 'Enter') {
        const idx = focusedIndex >= 0 ? focusedIndex : entries.findIndex((x) => selectedIds.has(x.id))
        if (idx >= 0) setViewerIdx(idx)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelectedIds(new Set(entries.map((x) => x.id)))
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        void toggleFavorite(selectedEntries)
      } else if (e.key === 'Escape') {
        if (ctx) setCtx(null)
        else setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, entries, viewerIdx, focusedIndex, modalOpen, ctx, toggleFavorite, selectedEntries])

  const hasBlend = useMemo(
    () => (scan?.entries ?? []).some((e) => e.ext === '.blend'),
    [scan]
  )

  const ctxTargets = useMemo(() => {
    if (!ctx) return []
    return selectedIds.has(ctx.entry.id) && selectedEntries.length > 0 ? selectedEntries : [ctx.entry]
  }, [ctx, selectedIds, selectedEntries])

  const allSelectedFav = selectedEntries.length > 0 && selectedEntries.every((e) => lib.favorites.has(libKey(e)))

  /* ---------- 渲染 ---------- */

  return (
    <div className="app">
      <div className="toolbar">
        <button className="primary" onClick={() => void openFolder()} title="Ctrl+O">
          <IconFolder /> 打开文件夹
        </button>
        {root && (
          <>
            <button onClick={() => void openFolder(root)} disabled={scanning} title="F5">
              <IconRefresh /> 重新扫描
            </button>
            <button
              className={`icon-only${sidebarVisible ? ' on' : ''}`}
              onClick={() =>
                setSidebarVisible((v) => {
                  void window.api.saveSettings({ sidebarVisible: !v })
                  return !v
                })
              }
              title="文件夹侧栏 (Ctrl+B)"
            >
              <IconSidebar />
            </button>
            <span className="path" title={root}>
              {root}
            </span>
          </>
        )}

        <div className="spacer" />

        <input
          ref={searchRef}
          type="search"
          placeholder="搜索名称 / 路径 / 标签…  (Ctrl+F)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 220 }}
        />

        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="date">按修改时间</option>
          <option value="ext">按格式</option>
          <option value="tris">按面数</option>
        </select>
        <button
          className="icon-only"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
        >
          <IconSort desc={sortDir === 'desc'} />
        </button>

        <input
          type="range"
          min={110}
          max={320}
          step={2}
          value={cardSize}
          onChange={(e) => setCardSize(Number(e.target.value))}
          title="缩略图大小 (Ctrl+= / Ctrl+-)"
          style={{ width: 96 }}
        />

        <button onClick={() => setShowSettings(true)} title="Ctrl+,">
          <IconSettings /> 设置
        </button>
      </div>

      {scan && scan.entries.length > 0 && (
        <div className="toolbar chips">
          <span
            className={`chip${extFilter.size === 0 && !favFilter && tagFilter.size === 0 && !animFilter && !failedFilter ? ' on' : ''}`}
            onClick={() => {
              setExtFilter(new Set())
              setFavFilter(false)
              setTagFilter(new Set())
              setAnimFilter(false)
              setFailedFilter(false)
            }}
          >
            全部 {scan.entries.length}
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
          <span className="chip-sep" />
          <span className={`chip fav${favFilter ? ' on' : ''}`} onClick={() => setFavFilter((v) => !v)}>
            ★ 收藏
          </span>
          <span className={`chip${animFilter ? ' on' : ''}`} onClick={() => setAnimFilter((v) => !v)} title="只看带动画的（需已出图）">
            ▶ 动画
          </span>
          {failedCount > 0 && (
            <span className={`chip warn${failedFilter ? ' on' : ''}`} onClick={() => setFailedFilter((v) => !v)}>
              ⚠ 失败 {failedCount}
            </span>
          )}
          {lib.allTags.length > 0 && <span className="chip-sep" />}
          {lib.allTags.map((t) => (
            <span
              key={t}
              className={`chip tag${tagFilter.has(t) ? ' on' : ''}`}
              onClick={() =>
                setTagFilter((prev) => {
                  const next = new Set(prev)
                  if (next.has(t)) next.delete(t)
                  else next.add(t)
                  return next
                })
              }
            >
              # {t}
            </span>
          ))}
        </div>
      )}

      <div className="body">
        {root && scan && sidebarVisible && tree && !scanning && (
          <Sidebar tree={tree} selected={dirFilter} onSelect={setDirFilter} />
        )}

        {!root ? (
          <div className="empty">
            <div style={{ fontSize: 46, opacity: 0.3 }}>🧊</div>
            <h2>选择一个 3D 资源文件夹</h2>
            <p>
              自动为 glb / gltf / fbx / obj / stl / ply / dae / 3ds / blend 等几十种格式批量生成缩略图。
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
            <p style={{ fontSize: 12, opacity: 0.7 }}>也可以直接把文件夹拖进窗口，或拖到程序图标上</p>
            {recent.length > 0 && (
              <div className="recent">
                <div style={{ fontSize: 12, marginBottom: 2 }}>最近打开</div>
                {recent.slice(0, 8).map((r) => (
                  <div key={r.dir} className={`recent-row${r.exists ? '' : ' gone'}`}>
                    <button
                      onClick={() => void openFolder(r.dir)}
                      title={r.exists ? r.dir : `${r.dir}\n（目录不存在）`}
                      disabled={!r.exists}
                    >
                      {r.dir}
                    </button>
                    <span
                      className="remove"
                      title="从列表移除"
                      onClick={() => {
                        void window.api.removeRecent(r.dir).then(() => void refreshRecent())
                      }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : scanning ? (
          <div className="empty">
            <span className="spinner" />
            <div>正在扫描…</div>
            {scanProgress && (
              <div className="note">
                已扫描 {scanProgress.scannedFiles} 个文件 · 找到 {scanProgress.found} 个模型
                <br />
                <span style={{ opacity: 0.7 }}>{scanProgress.dir}</span>
              </div>
            )}
            <button onClick={cancelScan}>取消</button>
          </div>
        ) : scanError ? (
          <div className="empty">
            <div style={{ fontSize: 40, opacity: 0.3 }}>⚠</div>
            <h2>打不开这个文件夹</h2>
            <p>{scanError}</p>
            <button onClick={() => void openFolder()}>选择其它文件夹</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 40, opacity: 0.3 }}>∅</div>
            <h2>{scan && scan.entries.length > 0 ? '没有符合筛选条件的模型' : '没有找到可预览的模型'}</h2>
            <p>
              {scan && scan.entries.length > 0 ? (
                '换个筛选条件或清空搜索试试。'
              ) : (
                <>
                  这个文件夹里没有支持的 3D 格式
                  {scan && scan.hiddenCount > 0 && <>（已跳过 {scan.hiddenCount} 个贴图/伴生文件）</>}。
                  {!settings?.recursive && '当前未开启递归扫描，子文件夹里的模型不会被列出。'}
                </>
              )}
            </p>
          </div>
        ) : (
          <Grid
            entries={entries}
            thumbs={thumbs}
            favorites={lib.favorites}
            tags={lib.tags}
            cardSize={cardSize}
            selectedIds={selectedIds}
            onSelect={select}
            onOpen={setViewerIdx}
            onDragStart={handleDragStart}
            onToggleFavorite={(e) => void toggleFavorite([e])}
            onThumbError={(e) => {
              // 缓存被清掉了，图片 404：重新请求一次
              requested.current.delete(e.id)
              requestOne(e, 0)
            }}
            focusedIndex={focusedIndex}
            onFocusIndex={(i) => select(i, 'single')}
            keyboardEnabled={viewerIdx === null && !modalOpen && ctx === null}
            onContext={(e, entry, index) => {
              e.preventDefault()
              if (!selectedIds.has(entry.id)) setSelectedIds(new Set([entry.id]))
              setFocusedIndex(index)
              setCtx({ x: e.clientX, y: e.clientY, entry, index })
            }}
            onVisibleRange={onVisibleRange}
          />
        )}
      </div>

      {root && !scanning && selectedEntries.length > 0 && (
        <SelectionBar
          count={selectedEntries.length}
          allFavorite={allSelectedFav}
          hasConvertible={selectedEntries.some((e) => e.previewable)}
          onFavorite={() => void toggleFavorite(selectedEntries)}
          onTags={() => setTagTarget(selectedEntries)}
          onExport={() => void exportEntries(selectedEntries, false)}
          onExportGlb={() => void exportEntries(selectedEntries, true)}
          onContactSheet={() => void makeContactSheet(selectedEntries)}
          onCopyPaths={() => copyPaths(selectedEntries)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {root && (
        <div className="statusbar">
          <span>
            {entries.length}
            {scan && entries.length !== scan.entries.length ? ` / ${scan.entries.length}` : ''} 个模型
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
            <span
              style={{ color: 'var(--danger)', cursor: 'pointer' }}
              onClick={() => setFailedFilter((v) => !v)}
              title="点击只看失败的"
            >
              {failedCount} 个失败
            </span>
          )}
          {folderChanged && (
            <span className="changed" onClick={() => void openFolder(root)} title="文件夹内容有变动">
              ⟳ 文件夹有变动，点击重新扫描
            </span>
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
          <span style={{ color: 'var(--fg-faint)' }}>
            双击放大 · 拖拽可直接拖入 Blender · Ctrl/Shift 多选 · F1 快捷键
          </span>
        </div>
      )}

      {dragging && <div className="drop-hint">松开以打开该文件夹</div>}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y}>
          <button onClick={() => setViewerIdx(ctx.index)} disabled={!ctx.entry.previewable}>
            放大查看
          </button>
          <button
            onClick={() => {
              void toggleFavorite(ctxTargets)
              setCtx(null)
            }}
          >
            {ctxTargets.every((e) => lib.favorites.has(libKey(e))) ? '☆ 取消收藏' : '★ 收藏'}
            {ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''}
          </button>
          <button
            onClick={() => {
              setTagTarget(ctxTargets)
              setCtx(null)
            }}
          >
            编辑标签…
          </button>
          <hr />
          <button
            onClick={() =>
              void window.api.openInBlender(ctx.entry.path).then((r) => {
                if (!r.ok) setToast(r.error ?? '打开失败', 'error')
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
          <button onClick={() => copyPaths(ctxTargets)}>
            复制完整路径{ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''}
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
          {ctx.entry.previewable && (
            <button
              onClick={() => {
                void regenerate(ctxTargets)
                setCtx(null)
              }}
            >
              重新生成缩略图{ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''}
            </button>
          )}
          {thumbs.get(ctx.entry.id)?.state === 'failed' && (
            <button
              onClick={() => {
                void showFailure(ctx.entry)
                setCtx(null)
              }}
            >
              查看失败原因…
            </button>
          )}
          {ctx.entry.previewable && (
            <button
              onClick={() => {
                setToast(ctx.entry.ext === '.blend' ? '正在用 Blender 转换…' : '正在转换为 GLB…')
                void window.api.exportGlb(ctx.entry).then((r) => {
                  if (r.ok && r.path) setToast('已导出 GLB')
                  else if (r.error) setToast(r.error, 'error')
                })
              }}
            >
              导出为 GLB…
            </button>
          )}
          {ctxTargets.length > 1 && (
            <button
              onClick={() => {
                void exportEntries(ctxTargets, false)
                setCtx(null)
              }}
            >
              导出 {ctxTargets.length} 个到文件夹…
            </button>
          )}
        </ContextMenu>
      )}

      {viewerIdx !== null && entries[viewerIdx] && (
        <Viewer
          entries={entries}
          index={viewerIdx}
          onIndex={setViewerIdx}
          onClose={() => setViewerIdx(null)}
          lighting={settings?.lighting ?? 'studio'}
          favorites={lib.favorites}
          onToggleFavorite={(e) => void toggleFavorite([e])}
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
            if (patch.blenderPath !== undefined) setBlender(await window.api.blenderInfo())
            if (
              patch.recursive !== undefined ||
              patch.maxDepth !== undefined ||
              patch.showUnsupported !== undefined
            ) {
              if (root) void openFolder(root)
            }
            if (
              patch.thumbSize !== undefined ||
              patch.lighting !== undefined ||
              patch.background !== undefined
            ) {
              requested.current = new Set()
              setThumbs(new Map())
              // Grid 的可见范围没变不会重新上报，手动补一次
              setTimeout(() => {
                for (const v of lastVisible.current) requestOne(v.entry, v.priority)
              }, 50)
            }
            if (patch.disableGpu !== undefined) {
              setToast('GPU 设置改动需要重启程序才生效', 'warn')
            }
          }}
          onBlenderRedetect={async (p) => {
            const info = await window.api.blenderRedetect(p)
            setBlender(info)
            return info
          }}
        />
      )}

      {tagTarget && (
        <TagEditor
          entries={tagTarget}
          tags={lib.tags}
          allTags={lib.allTags}
          onAdd={async (tag) => {
            await window.api.addTag(
              tagTarget.map((e) => e.path),
              tag
            )
            await refreshLib()
          }}
          onRemove={async (tag) => {
            await window.api.removeTag(
              tagTarget.map((e) => e.path),
              tag
            )
            await refreshLib()
          }}
          onClose={() => setTagTarget(null)}
        />
      )}

      {exportState && (
        <ExportDialog
          state={exportState}
          onClose={() => setExportState(null)}
          onOpenDir={(dir) => void window.api.openPath(dir)}
        />
      )}

      {failInfo && (
        <div className="modal-mask" onClick={() => setFailInfo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>缩略图生成失败</h3>
            <p style={{ wordBreak: 'break-all' }}>{failInfo.entry.rel}</p>
            <pre className="errbox">{failInfo.error}</pre>
            {failInfo.missing.length > 0 && (
              <>
                <p className="note">缺少以下依赖文件（模型旁边应该有它们）：</p>
                <pre className="errbox">{failInfo.missing.join('\n')}</pre>
              </>
            )}
            <div className="actions">
              <button
                onClick={() => {
                  void regenerate([failInfo.entry])
                  setFailInfo(null)
                }}
              >
                重试
              </button>
              <button className="primary" onClick={() => setFailInfo(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
