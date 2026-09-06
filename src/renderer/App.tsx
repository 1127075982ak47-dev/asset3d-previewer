import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Grid from './Grid'
import ListView from './ListView'
import Viewer from './Viewer'
import Settings from './Settings'
import Sidebar from './Sidebar'
import SelectionBar from './SelectionBar'
import TagEditor from './TagEditor'
import ExportDialog, { type ExportState } from './ExportDialog'
import AboutDialog from './AboutDialog'
import ShortcutsDialog from './ShortcutsDialog'
import DupesDialog from './DupesDialog'
import { ConfirmDialog, RenameDialog } from './Dialogs'
import { ColorDots, RatingStars } from './RatingStars'
import { buildTree } from './lib/tree'
import { SHEET_MAX_ITEMS, renderContactSheet } from './lib/contactSheet'
import {
  EMPTY_FILTER,
  TRI_RANGES,
  filterEntries,
  hasActiveFilter,
  libKey,
  needsThumbs,
  sortEntries,
  type FilterState
} from '../shared/filters'
import { buildInventoryCsv } from '../shared/csv'
import { COLOR_LABELS } from '../shared/labels'
import {
  IconCsv,
  IconDupes,
  IconFolder,
  IconGrid,
  IconList,
  IconRefresh,
  IconSettings,
  IconSidebar,
  IconSort
} from './icons'
import type { Api } from '../preload'
import type {
  AppSettings,
  BlenderInfo,
  LibraryPayload,
  MenuAction,
  ModelEntry,
  ScanProgress,
  ScanResult,
  SortDir,
  SortKey,
  ThumbRequest,
  ThumbResult,
  ViewMode
} from '../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

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
  ratings: Record<string, number>
  colors: Record<string, string>
}

interface Toast {
  msg: string
  kind: 'ok' | 'warn' | 'error'
}

interface Confirm {
  title: string
  message: React.ReactNode
  confirmLabel: string
  danger?: boolean
  details?: string[]
  onConfirm: () => void | Promise<void>
}

const EMPTY_LIB: Lib = { favorites: new Set(), tags: {}, allTags: [], ratings: {}, colors: {} }

function toLib(p: LibraryPayload): Lib {
  return { favorites: new Set(p.favorites), tags: p.tags, allTags: p.allTags, ratings: p.ratings ?? {}, colors: p.colors ?? {} }
}

function basename(p: string): string {
  const m = /[^\\/]+[\\/]?$/.exec(p)
  return (m ? m[0] : p).replace(/[\\/]$/, '')
}

/** 右键菜单：按窗口边界钳位，别弹到屏幕外面去 */
function ContextMenu({ x, y, children }: { x: number; y: number; children: React.ReactNode }): JSX.Element {
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
  const [filter, setFilterRaw] = useState<FilterState>(EMPTY_FILTER)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [cardSize, setCardSize] = useState(176)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const anchorRef = useRef<number | null>(null)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [compareEntry, setCompareEntry] = useState<ModelEntry | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showDupes, setShowDupes] = useState(false)
  const [tagTarget, setTagTarget] = useState<ModelEntry[] | null>(null)
  const [renameTarget, setRenameTarget] = useState<ModelEntry | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [failInfo, setFailInfo] = useState<{ entry: ModelEntry; error: string; missing: string[] } | null>(null)
  const [blender, setBlender] = useState<BlenderInfo | null>(null)
  const [recent, setRecent] = useState<{ dir: string; exists: boolean }[]>([])
  const [dragging, setDragging] = useState(false)
  const [folderChanged, setFolderChanged] = useState(false)
  const [lib, setLib] = useState<Lib>(EMPTY_LIB)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  /** 检测到 WebGL 跑在 CPU 软件渲染器上时的渲染器名 */
  const [softwareGl, setSoftwareGl] = useState<string | null>(null)
  const [toast, setToastRaw] = useState<Toast | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setToast = useCallback((msg: string, kind: Toast['kind'] = 'ok') => {
    setToastRaw({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastRaw(null), kind === 'error' ? 5000 : 2600)
  }, [])

  const setFilter = useCallback((patch: Partial<FilterState>) => {
    setFilterRaw((f) => ({ ...f, ...patch }))
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
  const thumbsRef = useRef(thumbs)
  thumbsRef.current = thumbs
  /** 设置就绪后才把界面状态（排序 / 视图 / 卡片大小）写回设置 */
  const uiReady = useRef(false)
  const uiSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setSortKey(s.sortKey)
      setSortDir(s.sortDir)
      setViewMode(s.viewMode)
      setCardSize(s.cardSize)
      uiReady.current = true
      await refreshRecent()
      setBlender(await window.api.blenderInfo())
      await refreshLib()
    })()
  }, [refreshLib, refreshRecent])

  // 主题：浅色玻璃拟态是默认，深色作为可选
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'light'
  }, [settings?.theme])

  // 记住排序 / 视图 / 卡片大小
  useEffect(() => {
    if (!uiReady.current) return
    if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current)
    uiSaveTimer.current = setTimeout(() => {
      void window.api.saveSettings({ sortKey, sortDir, viewMode, cardSize })
    }, 500)
  }, [sortKey, sortDir, viewMode, cardSize])

  useEffect(() => {
    document.title = root ? `${basename(root)} - 3D 资源预览器` : '3D 资源预览器'
  }, [root])

  // 关掉 GPU 加速（或显卡驱动不可用）时 WebGL 会落到 SwiftShader 软件渲染，
  // 3D 会卡成幻灯片。用户往往不知道是这个原因，明确提示出来。
  useEffect(() => {
    try {
      const c = document.createElement('canvas')
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
      if (!gl) {
        setSoftwareGl('无 WebGL')
        return
      }
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
      if (/swiftshader|llvmpipe|software|microsoft basic render/i.test(name)) setSoftwareGl(name)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* 检测不了就算了 */
    }
  }, [])

  const thumbReq = useCallback((priority: number): ThumbRequest => {
    const s = settingsRef.current
    return {
      px: s?.thumbSize ?? 512,
      priority,
      lighting: s?.lighting ?? 'studio',
      background: s?.background ?? 'transparent',
      angle: s?.thumbAngle ?? 'iso',
      shading: s?.thumbShading ?? 'material'
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

  // .blend 的两段式出图靠这个通道推第二次结果（内嵌图 → 真渲染图）；自定义缩略图也走它
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
      setCompareEntry(null)
      setCtx(null)
      setFilter({ dirFilter: '', exts: new Set(), failed: false, triRange: null })
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
    [refreshRecent, setToast, setFilter]
  )

  useEffect(() => window.api.onScanProgress((p) => setScanProgress(p)), [])
  // 查看器打开时暂停后台出图；关掉后恢复
  useEffect(() => {
    void window.api.pauseThumbs(viewerIdx !== null)
  }, [viewerIdx])
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

  const tree = useMemo(() => (scan ? buildTree(scan.entries, basename(scan.root) || scan.root) : null), [scan])

  const thumbsForFilter = needsThumbs(filter, sortKey) ? thumbs : null

  const entries = useMemo(() => {
    const list = filterEntries(scan?.entries ?? [], filter, lib, thumbsForFilter)
    return sortEntries(list, sortKey, sortDir, lib, thumbsForFilter)
  }, [scan, filter, thumbsForFilter, sortKey, sortDir, lib])

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

  const resubmitVisible = useCallback(() => {
    requested.current = new Set()
    setThumbs(new Map())
    // Grid 的可见范围没变不会重新上报，手动补一次
    setTimeout(() => {
      for (const v of lastVisible.current) requestOne(v.entry, v.priority)
    }, 50)
  }, [requestOne])

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

  // 命令行 --folder=<路径> / 拖到 exe 上启动 / 上次的文件夹（只在设置就绪后跑一次）
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

  const selectedEntries = useMemo(() => entries.filter((e) => selectedIds.has(e.id)), [entries, selectedIds])

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
      const key = url ? /([a-f0-9]{40})\.png/.exec(url)?.[1] : null
      draggingOut.current = true
      // 系统级拖拽循环结束后不一定有 dragend，兜底 1.5 秒后自动解除
      setTimeout(() => {
        draggingOut.current = false
      }, 1500)
      window.api.startDrag(paths.length > 0 ? paths : [entry.path], key)
    },
    [entries, selectedIds, thumbs]
  )

  /* ---------- 收藏 / 标签 / 评分 / 颜色 ---------- */

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

  const rate = useCallback(
    async (targets: ModelEntry[], v: number) => {
      if (targets.length === 0) return
      setLib(toLib(await window.api.setRating(targets.map((e) => e.path), v)))
      setToast(v === 0 ? '已清除评分' : `已评 ${v} 星`)
    },
    [setToast]
  )

  const setColor = useCallback(async (targets: ModelEntry[], c: string | null) => {
    if (targets.length === 0) return
    setLib(toLib(await window.api.setColor(targets.map((e) => e.path), c)))
  }, [])

  /* ---------- 文件操作 ---------- */

  /** 把扫描结果里的一个条目换成新的（改名后） */
  const replaceEntry = useCallback((oldId: string, next: ModelEntry, thumb: ThumbResult | undefined) => {
    setScan((s) => (s ? { ...s, entries: s.entries.map((e) => (e.id === oldId ? next : e)) } : s))
    setThumbs((prev) => {
      const m = new Map(prev)
      m.delete(oldId)
      if (thumb) m.set(next.id, thumb)
      return m
    })
    requested.current.delete(oldId)
    if (thumb) requested.current.add(next.id)
    setSelectedIds((prev) => {
      if (!prev.has(oldId)) return prev
      const n = new Set(prev)
      n.delete(oldId)
      n.add(next.id)
      return n
    })
  }, [])

  const doRename = useCallback(
    async (entry: ModelEntry, newName: string): Promise<string | null> => {
      if (!root) return '没有打开文件夹'
      const r = await window.api.renameModel(entry, newName, root, thumbReq(0))
      if (!r.ok || !r.entry) return r.error ?? '改名失败'
      replaceEntry(entry.id, r.entry, r.thumb)
      setRenameTarget(null)
      setToast(`已改名为 ${r.entry.name}${r.entry.ext}${r.companions?.length ? '（.fbm 目录一起改了）' : ''}`)
      return null
    },
    [root, thumbReq, replaceEntry, setToast]
  )

  const removeEntries = useCallback((ids: Set<string>) => {
    setScan((s) => (s ? { ...s, entries: s.entries.filter((e) => !ids.has(e.id)) } : s))
    setThumbs((prev) => {
      const m = new Map(prev)
      for (const id of ids) m.delete(id)
      return m
    })
    for (const id of ids) requested.current.delete(id)
    setSelectedIds((prev) => {
      const n = new Set(prev)
      for (const id of ids) n.delete(id)
      return n
    })
    setViewerIdx(null)
  }, [])

  const trashEntries = useCallback(
    (targets: ModelEntry[]) => {
      if (targets.length === 0) return
      setConfirm({
        title: '删除到回收站',
        message: (
          <>
            把 {targets.length === 1 ? `「${targets[0].name}${targets[0].ext}」` : `这 ${targets.length} 个文件`}
            移到回收站？可以在资源管理器的回收站里找回。
          </>
        ),
        details: targets.length > 1 ? targets.map((e) => e.rel) : undefined,
        confirmLabel: '移到回收站',
        danger: true,
        onConfirm: async () => {
          const r = await window.api.trashModels(targets.map((e) => e.path))
          setConfirm(null)
          const goneIds = new Set(targets.map((e) => e.id))
          if (r.failed.length > 0) {
            // 失败的留在列表里
            const failedNames = new Set(r.failed.map((f) => f.split(':')[0]))
            for (const e of targets) if (failedNames.has(`${e.name}${e.ext}`)) goneIds.delete(e.id)
            setToast(`${r.done} 个已删除，${r.failed.length} 个失败`, 'error')
          } else {
            setToast(`已把 ${r.done} 个文件移到回收站`)
          }
          removeEntries(goneIds)
          void refreshLib()
        }
      })
    },
    [removeEntries, refreshLib, setToast]
  )

  const moveEntries = useCallback(
    async (targets: ModelEntry[]) => {
      if (targets.length === 0 || !root) return
      const dir = await window.api.pickFolder('选择要移动到的文件夹')
      if (!dir) return
      setConfirm({
        title: '移动文件',
        message: (
          <>
            把 {targets.length} 个模型移动到
            <br />
            <b className="wrap">{dir}</b>
            <br />
            .gltf 的 .bin 与贴图、.obj 的 .mtl 与贴图、.fbx 的 .fbm 目录会一起搬走。同名文件不会覆盖。
          </>
        ),
        confirmLabel: '移动',
        onConfirm: async () => {
          const r = await window.api.moveModels(targets, dir)
          setConfirm(null)
          if (r.failed.length > 0) setToast(`移动了 ${r.moved} 个，${r.failed.length} 个失败：${r.failed[0]}`, 'error')
          else setToast(`已移动 ${r.moved} 个文件`)
          for (const e of targets) requested.current.delete(e.id)
          // 移动改变了路径与 rel，重扫最省事；缩略图缓存按文件名+大小+时间命中，不会重新出图
          void openFolder(root)
        }
      })
    },
    [root, openFolder, setToast]
  )

  const pinFolder = useCallback(
    async (dir: string, pin: boolean) => {
      const cur = settingsRef.current?.pinnedFolders ?? []
      const next = pin
        ? [...cur.filter((p) => p.toLowerCase() !== dir.toLowerCase()), dir]
        : cur.filter((p) => p.toLowerCase() !== dir.toLowerCase())
      setSettings(await window.api.saveSettings({ pinnedFolders: next }))
      setToast(pin ? '已固定到资源库' : '已取消固定')
    },
    [setToast]
  )

  /* ---------- 导出 ---------- */

  const exportEntries = useCallback(async (targets: ModelEntry[], toGlb: boolean) => {
    if (targets.length === 0) return
    const dir = await window.api.pickFolder(toGlb ? '选择 GLB 导出到哪个文件夹' : '选择导出到哪个文件夹')
    if (!dir) return
    setExportState({ total: targets.length, done: 0, name: '', dir })
    const off = window.api.onExportProgress((p) => setExportState((s) => (s ? { ...s, done: p.done, name: p.name } : s)))
    try {
      const result = await window.api.exportBatchTo(targets, dir, { toGlb })
      setExportState((s) => (s ? { ...s, result } : s))
    } finally {
      off()
    }
  }, [])

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

  const exportCsv = useCallback(
    async (targets: ModelEntry[]) => {
      if (targets.length === 0) return
      const csv = buildInventoryCsv(
        targets.map((e) => {
          const k = libKey(e)
          const t = thumbs.get(e.id)
          return {
            entry: e,
            stats: t?.stats,
            state: t?.state,
            favorite: lib.favorites.has(k),
            tags: lib.tags[k] ?? [],
            rating: lib.ratings[k] ?? 0,
            color: lib.colors[k] ?? null
          }
        })
      )
      const saved = await window.api.exportText(`${root ? basename(root) : '模型'}-清单.csv`, csv, 'CSV 表格', 'csv')
      if (saved) setToast(`清单已保存（${targets.length} 行）`)
    },
    [thumbs, lib, root, setToast]
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

  const showFailure = useCallback(
    async (entry: ModelEntry) => {
      const t = thumbs.get(entry.id)
      let missing: string[] = []
      try {
        missing = (await window.api.dependencies(entry.path)).missing
      } catch {
        /* 查不了就算了 */
      }
      setFailInfo({ entry, error: t?.error ?? '未知错误', missing })
    },
    [thumbs]
  )

  /* ---------- 对比 / 自定义缩略图 ---------- */

  const compareSelected = useCallback(() => {
    if (selectedEntries.length !== 2) return
    const [a, b] = selectedEntries
    const idx = entries.findIndex((e) => e.id === a.id)
    if (idx < 0) return
    setCompareEntry(b)
    setViewerIdx(idx)
  }, [selectedEntries, entries])

  const getThumbUrl = useCallback((id: string) => thumbsRef.current.get(id)?.url, [])

  const setCustomThumb = useCallback(
    async (entry: ModelEntry, dataUrl: string) => {
      const r = await window.api.setCustomThumb(entry, thumbReq(0), dataUrl)
      setThumbs((prev) => {
        const next = new Map(prev)
        next.set(entry.id, r)
        return next
      })
      requested.current.add(entry.id)
      setToast('已把当前视角设为缩略图')
    },
    [thumbReq, setToast]
  )

  /* ---------- 菜单 / 快捷键 ---------- */

  const modalOpen =
    showSettings || showAbout || showShortcuts || showDupes || !!tagTarget || !!exportState || !!failInfo || !!renameTarget || !!confirm

  const toggleView = useCallback(() => setViewMode((v) => (v === 'grid' ? 'list' : 'grid')), [])

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
          setCardSize((v) => Math.min(360, v + 20))
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
        case 'toggle-view':
          toggleView()
          break
        case 'find-dupes':
          if (scan && scan.entries.length > 0) setShowDupes(true)
          break
        case 'export-csv':
          void exportCsv(selectedEntries.length > 0 ? selectedEntries : entries)
          break
        case 'shortcuts':
          setShowShortcuts(true)
          break
        case 'about':
          setShowAbout(true)
          break
      }
    })
  }, [openFolder, root, toggleView, scan, exportCsv, selectedEntries, entries])

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
      const focused = focusedIndex >= 0 ? entries[focusedIndex] : undefined
      if (e.key === 'Enter') {
        const idx = focusedIndex >= 0 ? focusedIndex : entries.findIndex((x) => selectedIds.has(x.id))
        if (idx >= 0) setViewerIdx(idx)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelectedIds(new Set(entries.map((x) => x.id)))
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        void toggleFavorite(selectedEntries)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        toggleView()
      } else if (e.key === 'Delete') {
        e.preventDefault()
        trashEntries(selectedEntries.length > 0 ? selectedEntries : focused ? [focused] : [])
      } else if (e.key === 'F2') {
        e.preventDefault()
        const target = selectedEntries.length === 1 ? selectedEntries[0] : focused
        if (target) setRenameTarget(target)
      } else if (/^[0-5]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
        const targets = selectedEntries.length > 0 ? selectedEntries : focused ? [focused] : []
        if (targets.length > 0) {
          e.preventDefault()
          void rate(targets, Number(e.key))
        }
      } else if (e.key === 'Escape') {
        if (ctx) setCtx(null)
        else setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, entries, viewerIdx, focusedIndex, modalOpen, ctx, toggleFavorite, selectedEntries, toggleView, trashEntries, rate])

  const closeViewer = useCallback(() => {
    setViewerIdx(null)
    setCompareEntry(null)
  }, [])
  const toggleFavoriteOne = useCallback((e: ModelEntry) => void toggleFavorite([e]), [toggleFavorite])
  const rateOne = useCallback((e: ModelEntry, v: number) => void rate([e], v), [rate])

  const hasBlend = useMemo(() => (scan?.entries ?? []).some((e) => e.ext === '.blend'), [scan])

  const ctxTargets = useMemo(() => {
    if (!ctx) return []
    return selectedIds.has(ctx.entry.id) && selectedEntries.length > 0 ? selectedEntries : [ctx.entry]
  }, [ctx, selectedIds, selectedEntries])

  const allSelectedFav = selectedEntries.length > 0 && selectedEntries.every((e) => lib.favorites.has(libKey(e)))
  /** 选中项的共同评分 / 颜色（不一致就显示为空） */
  const commonRating = useMemo(() => {
    if (selectedEntries.length === 0) return 0
    const first = lib.ratings[libKey(selectedEntries[0])] ?? 0
    return selectedEntries.every((e) => (lib.ratings[libKey(e)] ?? 0) === first) ? first : 0
  }, [selectedEntries, lib])
  const commonColor = useMemo(() => {
    if (selectedEntries.length === 0) return null
    const first = lib.colors[libKey(selectedEntries[0])] ?? null
    return selectedEntries.every((e) => (lib.colors[libKey(e)] ?? null) === first) ? first : null
  }, [selectedEntries, lib])

  const isPinned = !!root && (settings?.pinnedFolders ?? []).some((p) => p.toLowerCase() === root.toLowerCase())

  const itemViewProps = {
    entries,
    thumbs,
    favorites: lib.favorites,
    tags: lib.tags,
    ratings: lib.ratings,
    colors: lib.colors,
    selectedIds,
    onSelect: select,
    onOpen: setViewerIdx,
    onDragStart: handleDragStart,
    onToggleFavorite: toggleFavoriteOne,
    onRate: rateOne,
    onThumbError: (e: ModelEntry) => {
      // 缓存被清掉了，图片 404：重新请求一次
      requested.current.delete(e.id)
      requestOne(e, 0)
    },
    focusedIndex,
    onFocusIndex: (i: number) => select(i, 'single'),
    keyboardEnabled: viewerIdx === null && !modalOpen && ctx === null,
    onContext: (e: React.MouseEvent, entry: ModelEntry, index: number) => {
      e.preventDefault()
      if (!selectedIds.has(entry.id)) setSelectedIds(new Set([entry.id]))
      setFocusedIndex(index)
      setCtx({ x: e.clientX, y: e.clientY, entry, index })
    },
    onVisibleRange
  }

  /* ---------- 渲染 ---------- */

  return (
    <div className="app">
      <div className="toolbar main">
        <div className="brand" title="3D 资源预览器">
          <span className="brand-logo">🧊</span>
          <span className="brand-name">3D 资源预览器</span>
        </div>
        <button className="primary" onClick={() => void openFolder()} title="Ctrl+O">
          <IconFolder /> 打开文件夹
        </button>
        {root && (
          <>
            <button onClick={() => void openFolder(root)} disabled={scanning} title="重新扫描 (F5)">
              <IconRefresh />
            </button>
            <button
              className={`icon-only${sidebarVisible ? ' on' : ''}`}
              onClick={() =>
                setSidebarVisible((v) => {
                  void window.api.saveSettings({ sidebarVisible: !v })
                  return !v
                })
              }
              title="侧栏 (Ctrl+B)"
            >
              <IconSidebar />
            </button>
            <span className="path" title={root}>
              {root}
            </span>
          </>
        )}

        <div className="spacer" />

        <div className="search-box">
          <input
            ref={searchRef}
            type="search"
            placeholder="搜索名称 / 路径 / 标签…  (Ctrl+F)"
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
          />
        </div>

        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} title="排序">
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="date">按修改时间</option>
          <option value="ext">按格式</option>
          <option value="tris">按面数</option>
          <option value="rating">按评分</option>
        </select>
        <button
          className="icon-only"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
        >
          <IconSort desc={sortDir === 'desc'} />
        </button>

        <div className="seg view-seg" title="网格 / 列表 (Ctrl+L)">
          <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')}>
            <IconGrid />
          </button>
          <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>
            <IconList />
          </button>
        </div>

        {viewMode === 'grid' && (
          <input
            type="range"
            min={110}
            max={360}
            step={2}
            value={cardSize}
            onChange={(e) => setCardSize(Number(e.target.value))}
            title="缩略图大小 (Ctrl+= / Ctrl+-)"
            className="size-range"
          />
        )}

        <button onClick={() => setShowSettings(true)} title="设置 (Ctrl+,)">
          <IconSettings /> 设置
        </button>
      </div>

      {softwareGl && (
        <div className="banner warn">
          ⚠ 当前 3D 由 CPU 软件渲染（{softwareGl}），出图和查看器都会非常慢。
          {settings?.disableGpu ? ' 你在设置里关闭了 GPU 硬件加速，' : ' 显卡驱动可能不可用，请更新显卡驱动；也可以'}
          <span className="link" onClick={() => setShowSettings(true)}>
            打开设置
          </span>
          {settings?.disableGpu ? ' 重新勾选「GPU 硬件加速」并重启程序。' : ' 检查「GPU 硬件加速」是否开启。'}
        </div>
      )}

      {scan && scan.entries.length > 0 && (
        <div className="toolbar chips">
          <span className={`chip${!hasActiveFilter(filter) ? ' on' : ''}`} onClick={() => setFilter({ ...EMPTY_FILTER, query: filter.query, dirFilter: filter.dirFilter })}>
            全部 {scan.entries.length}
          </span>
          {available.map(([ext, n]) => (
            <span
              key={ext}
              className={`chip${filter.exts.has(ext) ? ' on' : ''}`}
              onClick={() => {
                const next = new Set(filter.exts)
                if (next.has(ext)) next.delete(ext)
                else next.add(ext)
                setFilter({ exts: next })
              }}
            >
              {ext.slice(1)} {n}
            </span>
          ))}
          <span className="chip-sep" />
          <span className={`chip fav${filter.fav ? ' on' : ''}`} onClick={() => setFilter({ fav: !filter.fav })}>
            ★ 收藏
          </span>
          <span className={`chip${filter.anim ? ' on' : ''}`} onClick={() => setFilter({ anim: !filter.anim })} title="只看带动画的（需已出图）">
            ▶ 动画
          </span>
          {failedCount > 0 && (
            <span className={`chip warn${filter.failed ? ' on' : ''}`} onClick={() => setFilter({ failed: !filter.failed })}>
              ⚠ 失败 {failedCount}
            </span>
          )}
          <span className="chip-sep" />
          {[3, 4, 5].map((n) => (
            <span
              key={n}
              className={`chip rating${filter.minRating === n ? ' on' : ''}`}
              onClick={() => setFilter({ minRating: filter.minRating === n ? 0 : n })}
              title={`评分 ${n} 星及以上`}
            >
              {'★'.repeat(n)}
              {n < 5 ? '+' : ''}
            </span>
          ))}
          <span className="chip-colors">
            {COLOR_LABELS.map((c) => (
              <i
                key={c.key}
                className={`dot${filter.colors.has(c.key) ? ' on' : ''}`}
                style={{ background: c.color }}
                title={`颜色标签：${c.name}`}
                onClick={() => {
                  const next = new Set(filter.colors)
                  if (next.has(c.key)) next.delete(c.key)
                  else next.add(c.key)
                  setFilter({ colors: next })
                }}
              />
            ))}
          </span>
          <span className="chip-sep" />
          {TRI_RANGES.map((r) => (
            <span
              key={r.key}
              className={`chip${filter.triRange === r.key ? ' on' : ''}`}
              onClick={() => setFilter({ triRange: filter.triRange === r.key ? null : r.key })}
              title="按三角面数筛选（需已出图）"
            >
              {r.label}
            </span>
          ))}
          {lib.allTags.length > 0 && <span className="chip-sep" />}
          {lib.allTags.map((t) => (
            <span
              key={t}
              className={`chip tag${filter.tags.has(t) ? ' on' : ''}`}
              onClick={() => {
                const next = new Set(filter.tags)
                if (next.has(t)) next.delete(t)
                else next.add(t)
                setFilter({ tags: next })
              }}
            >
              # {t}
            </span>
          ))}
        </div>
      )}

      <div className="body">
        {sidebarVisible && (root || (settings?.pinnedFolders.length ?? 0) > 0) && (
          <Sidebar
            tree={root && scan && !scanning ? tree : null}
            selected={filter.dirFilter}
            onSelect={(rel) => setFilter({ dirFilter: rel })}
            pinned={settings?.pinnedFolders ?? []}
            current={root}
            onOpen={(dir) => void openFolder(dir)}
            onPin={(dir) => void pinFolder(dir, true)}
            onUnpin={(dir) => void pinFolder(dir, false)}
          />
        )}

        {!root ? (
          <div className="empty hero">
            <div className="hero-card">
              <div className="hero-logo">🧊</div>
              <h2>选择一个 3D 资源文件夹</h2>
              <p>
                自动为 glb / gltf / fbx / obj / stl / ply / dae / 3ds / blend 等几十种格式批量生成缩略图。
                <br />
                .bin、.mtl 和贴图会被自动识别为伴生文件并隐藏，只留下真正的模型。
                <br />
                选好的模型可以直接从窗口里拖进 Blender、Unity 等程序。
              </p>
              <div className="hero-actions">
                <button className="primary big" onClick={() => void openFolder()}>
                  <IconFolder /> 打开文件夹
                </button>
              </div>
              <p className="hint">也可以直接把文件夹拖进窗口，或拖到程序图标上</p>
              {recent.length > 0 && (
                <div className="recent">
                  <div className="recent-title">最近打开</div>
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
            <div className="empty-ico">⚠</div>
            <h2>打不开这个文件夹</h2>
            <p>{scanError}</p>
            <button onClick={() => void openFolder()}>选择其它文件夹</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">∅</div>
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
        ) : viewMode === 'grid' ? (
          <Grid {...itemViewProps} cardSize={cardSize} />
        ) : (
          <ListView
            {...itemViewProps}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(k) => {
              if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
              else {
                setSortKey(k)
                setSortDir(k === 'rating' || k === 'date' || k === 'size' || k === 'tris' ? 'desc' : 'asc')
              }
            }}
          />
        )}
      </div>

      {root && !scanning && selectedEntries.length > 0 && (
        <SelectionBar
          count={selectedEntries.length}
          allFavorite={allSelectedFav}
          hasConvertible={selectedEntries.some((e) => e.previewable)}
          canCompare={selectedEntries.length === 2 && selectedEntries.every((e) => e.previewable)}
          rating={commonRating}
          color={commonColor}
          onFavorite={() => void toggleFavorite(selectedEntries)}
          onRate={(v) => void rate(selectedEntries, v)}
          onColor={(c) => void setColor(selectedEntries, c)}
          onTags={() => setTagTarget(selectedEntries)}
          onRename={() => setRenameTarget(selectedEntries[0])}
          onMove={() => void moveEntries(selectedEntries)}
          onTrash={() => trashEntries(selectedEntries)}
          onCompare={compareSelected}
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
            <span className="status-danger" onClick={() => setFilter({ failed: !filter.failed })} title="点击只看失败的">
              {failedCount} 个失败
            </span>
          )}
          {folderChanged && (
            <span className="changed" onClick={() => void openFolder(root)} title="文件夹内容有变动">
              ⟳ 文件夹有变动，点击重新扫描
            </span>
          )}
          <div className="spacer" />
          {scan && scan.entries.length > 0 && (
            <>
              <span className="status-btn" onClick={() => setShowDupes(true)} title="按文件内容查找完全相同的重复文件">
                <IconDupes size={12} /> 查找重复
              </span>
              <span className="status-btn" onClick={() => void exportCsv(selectedEntries.length > 0 ? selectedEntries : entries)} title="把当前列表（或选中项）导出成 CSV 清单">
                <IconCsv size={12} /> 导出清单
              </span>
              {!isPinned && (
                <span className="status-btn" onClick={() => void pinFolder(root, true)} title="固定到侧栏资源库">
                  固定文件夹
                </span>
              )}
            </>
          )}
          {hasBlend && (
            <span
              className={blender?.available ? 'status-ok' : 'status-warn'}
              title={
                blender?.available
                  ? blender.installs.map((i) => i.version).join(' / ')
                  : '未检测到 Blender，.blend 只能显示内嵌预览图'
              }
            >
              {blender?.available ? `Blender ${blender.installs[blender.installs.length - 1]?.version} 就绪` : '未检测到 Blender'}
            </span>
          )}
          <span className="status-hint">双击放大 · 拖拽可直接拖入 Blender · F1 快捷键</span>
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
          <div className="ctx-row">
            <span>评分</span>
            <RatingStars
              value={ctxTargets.length === 1 ? (lib.ratings[libKey(ctxTargets[0])] ?? 0) : 0}
              onChange={(v) => {
                void rate(ctxTargets, v)
                setCtx(null)
              }}
              size={15}
            />
          </div>
          <div className="ctx-row">
            <span>颜色</span>
            <ColorDots
              value={ctxTargets.length === 1 ? (lib.colors[libKey(ctxTargets[0])] ?? null) : null}
              onChange={(c) => {
                void setColor(ctxTargets, c)
                setCtx(null)
              }}
            />
          </div>
          <button
            onClick={() => {
              setTagTarget(ctxTargets)
              setCtx(null)
            }}
          >
            编辑标签…
          </button>
          <hr />
          {ctxTargets.length === 1 && (
            <button
              onClick={() => {
                setRenameTarget(ctx.entry)
                setCtx(null)
              }}
            >
              重命名… <kbd>F2</kbd>
            </button>
          )}
          <button
            onClick={() => {
              void moveEntries(ctxTargets)
              setCtx(null)
            }}
          >
            移动到文件夹…{ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''}
          </button>
          <button
            onClick={() => {
              trashEntries(ctxTargets)
              setCtx(null)
            }}
          >
            删除到回收站{ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''} <kbd>Del</kbd>
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
          <button onClick={() => void window.api.openPath(ctx.entry.path)}>用默认程序打开</button>
          <button onClick={() => void window.api.showItem(ctx.entry.path)}>在资源管理器中显示</button>
          <button onClick={() => copyPaths(ctxTargets)}>
            复制完整路径{ctxTargets.length > 1 ? `（${ctxTargets.length} 个）` : ''}
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
          <button
            onClick={() => {
              void exportCsv(ctxTargets)
              setCtx(null)
            }}
          >
            导出清单 (CSV)…
          </button>
        </ContextMenu>
      )}

      {viewerIdx !== null && entries[viewerIdx] && (
        <Viewer
          entries={entries}
          index={viewerIdx}
          onIndex={setViewerIdx}
          onClose={closeViewer}
          lighting={settings?.lighting ?? 'studio'}
          favorites={lib.favorites}
          ratings={lib.ratings}
          onToggleFavorite={toggleFavoriteOne}
          onRate={rateOne}
          compareEntry={compareEntry}
          onCompare={setCompareEntry}
          getThumbUrl={getThumbUrl}
          onSetThumb={setCustomThumb}
          thumbSize={settings?.thumbSize ?? 512}
          thumbBackground={settings?.background ?? 'transparent'}
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
            if (patch.recursive !== undefined || patch.maxDepth !== undefined || patch.showUnsupported !== undefined) {
              if (root) void openFolder(root)
            }
            if (
              patch.thumbSize !== undefined ||
              patch.lighting !== undefined ||
              patch.background !== undefined ||
              patch.thumbAngle !== undefined ||
              patch.thumbShading !== undefined
            ) {
              resubmitVisible()
            }
            if (patch.disableGpu !== undefined) setToast('GPU 设置改动需要重启程序才生效', 'warn')
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

      {renameTarget && (
        <RenameDialog entry={renameTarget} onClose={() => setRenameTarget(null)} onRename={(n) => doRename(renameTarget, n)} />
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}

      {showDupes && scan && (
        <DupesDialog
          entries={scan.entries}
          getThumbUrl={getThumbUrl}
          onClose={() => setShowDupes(false)}
          onTrash={async (paths) => {
            const r = await window.api.trashModels(paths)
            const gone = new Set(paths.map((p) => p.toLowerCase()))
            const ids = new Set((scan.entries ?? []).filter((e) => gone.has(e.path.toLowerCase())).map((e) => e.id))
            removeEntries(ids)
            void refreshLib()
            return r
          }}
          onTag={async (paths, tag) => {
            await window.api.addTag(paths, tag)
            await refreshLib()
          }}
          onReveal={(p) => void window.api.showItem(p)}
        />
      )}

      {exportState && (
        <ExportDialog state={exportState} onClose={() => setExportState(null)} onOpenDir={(dir) => void window.api.openPath(dir)} />
      )}

      {failInfo && (
        <div className="modal-mask" onClick={() => setFailInfo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>缩略图生成失败</h3>
            <p className="wrap">{failInfo.entry.rel}</p>
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
