import { useCallback, useEffect, useRef, useState } from 'react'
import ViewerPanel, { type PanelTab } from './ViewerPanel'
import {
  DEFAULT_PREFS,
  ViewerEngine,
  type MaterialInfo,
  type NodeInfo,
  type ViewPreset,
  type ViewerPrefs
} from './lib/viewerEngine'
import type { HdriEntry, LightingPreset, ModelEntry, ModelStats } from '../shared/types'
import { IconBack, IconCamera, IconLocate, IconNext, IconPanel, IconPrev, IconStar } from './icons'

interface Props {
  entries: ModelEntry[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  lighting: LightingPreset
  favorites: Set<string>
  onToggleFavorite: (entry: ModelEntry) => void
}

const PREFS_KEY = 'asset3d.viewerPrefs.v1'

function loadPrefs(lighting: LightingPreset): ViewerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { ...DEFAULT_PREFS, lighting, ...(JSON.parse(raw) as Partial<ViewerPrefs>) }
  } catch {
    /* 坏数据就用默认 */
  }
  return { ...DEFAULT_PREFS, lighting }
}

function savePrefs(p: ViewerPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* 存不了就算了 */
  }
}

export default function Viewer({
  entries,
  index,
  onIndex,
  onClose,
  lighting: initialLighting,
  favorites,
  onToggleFavorite
}: Props): JSX.Element {
  const entry = entries[index]
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ViewerEngine | null>(null)

  const [prefs, setPrefsRaw] = useState<ViewerPrefs>(() => loadPrefs(initialLighting))
  const [hdris, setHdris] = useState<HdriEntry[]>([])
  const [tab, setTab] = useState<PanelTab>('display')
  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('正在加载…')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [clips, setClips] = useState<string[]>([])
  const [clipIdx, setClipIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [duration, setDuration] = useState(0)
  const [hierarchy, setHierarchy] = useState<NodeInfo[]>([])
  const [materials, setMaterials] = useState<MaterialInfo[]>([])
  const [soloed, setSoloed] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [shotMenu, setShotMenu] = useState(false)

  const timeInputRef = useRef<HTMLInputElement>(null)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const hdrisRef = useRef(hdris)
  hdrisRef.current = hdris

  const showWarn = useCallback((msg: string) => {
    setWarn(msg)
    if (warnTimer.current) clearTimeout(warnTimer.current)
    warnTimer.current = setTimeout(() => setWarn(null), 3500)
  }, [])

  const setPrefs = useCallback((patch: Partial<ViewerPrefs>) => {
    setPrefsRaw((prev) => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  /* ---------- 引擎：整个查看器生命周期只建一次 ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = new ViewerEngine(host)
    engineRef.current = engine
    engine.onWarn = showWarn
    engine.onFrame = (t, d) => {
      if (timeInputRef.current && document.activeElement !== timeInputRef.current) {
        timeInputRef.current.value = String(t)
      }
      if (timeLabelRef.current) timeLabelRef.current.textContent = `${t.toFixed(2)} / ${d.toFixed(2)}s`
    }
    engine.applyPrefs(prefsRef.current, hdrisRef.current, true)

    void window.api.hdriList().then((list) => {
      setHdris(list)
      engine.applyPrefs(prefsRef.current, list, true)
    })

    return () => {
      engineRef.current = null
      engine.dispose()
    }
  }, [showWarn])

  /* ---------- 设置变化同步到引擎 ---------- */
  useEffect(() => {
    engineRef.current?.applyPrefs(prefs, hdris)
  }, [prefs, hdris])

  /* ---------- 换模型 ---------- */
  useEffect(() => {
    const engine = engineRef.current
    if (!entry || !engine) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setStats(null)
    setClips([])
    setClipIdx(0)
    setDuration(0)
    setHierarchy([])
    setMaterials([])
    setSoloed(null)
    setProgress(null)
    setLoadingMsg(
      entry.ext === '.blend'
        ? '正在调用 Blender 转换为 GLB…（首次较慢，之后走缓存）'
        : '正在加载…'
    )

    void (async () => {
      try {
        if (!entry.previewable) {
          throw new Error(
            entry.ext + ' 是私有格式，没有开源库能解析它。可以右键「用默认程序打开」，或在原软件里导出为 FBX / GLB。'
          )
        }
        const resolved = await window.api.viewableUrl(entry)
        if (cancelled) return
        if (!resolved.url) throw new Error(resolved.error ?? '无法解析模型路径')

        const ext = entry.ext === '.blend' ? '.glb' : entry.ext
        const info = await engine.load(resolved.url, ext, (l, tot) => {
          if (!cancelled && tot > 0) setProgress(Math.round((l / tot) * 100))
        })
        if (cancelled || !info) return

        setStats(info.stats)
        setClips(info.clips)
        setPlaying(true)
        if (info.clips.length > 0) setDuration(engine['clips'][0]?.duration ?? 0)
        setHierarchy(engine.hierarchy())
        setMaterials(engine.materials())
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
        // 加载失败大概率是外部依赖缺失（.bin 或贴图），查一下告诉用户到底缺什么
        try {
          const dep = await window.api.dependencies(entry.path)
          if (!cancelled && dep.missing.length > 0) {
            setError((prev) => `${prev ?? ''}\n缺少依赖文件: ${dep.missing.join(', ')}`)
          }
        } catch {
          /* 查不了就算了 */
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [entry?.id])

  /* ---------- 动画 ---------- */
  const onClip = useCallback((i: number) => {
    const engine = engineRef.current
    if (!engine) return
    setClipIdx(i)
    engine.setClip(i, true)
    setPlaying(true)
    setDuration(engine['clips'][i]?.duration ?? 0)
  }, [])

  const onPlay = useCallback((on: boolean) => {
    engineRef.current?.setPlaying(on)
    setPlaying(on)
  }, [])

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inControl =
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        e.preventDefault()
        if (shotMenu) setShotMenu(false)
        else if (inControl) (e.target as HTMLElement).blur()
        else onClose()
        return
      }
      if (inControl) return
      const engine = engineRef.current
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          if (index < entries.length - 1) onIndex(index + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (index > 0) onIndex(index - 1)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          engine?.resetView()
          break
        case 'w':
        case 'W':
          setPrefs({ mode: prefsRef.current.mode === 'wire' ? 'material' : 'wire' })
          break
        case 'g':
        case 'G':
          setPrefs({ grid: !prefsRef.current.grid })
          break
        case 'r':
        case 'R':
          setPrefs({ autoRotate: !prefsRef.current.autoRotate })
          break
        case '1':
          engine?.setView('front')
          break
        case '3':
          engine?.setView('right')
          break
        case '7':
          engine?.setView('top')
          break
        case '5':
          engine?.setView('iso')
          break
        case 'Tab':
          e.preventDefault()
          setPrefs({ panelOpen: !prefsRef.current.panelOpen })
          break
        case ' ':
          e.preventDefault()
          onPlay(!playing)
          break
        case 'd':
        case 'D':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            if (entry) onToggleFavorite(entry)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, entries.length, onIndex, onClose, playing, onPlay, setPrefs, shotMenu, entry, onToggleFavorite])

  /* ---------- 截图 ---------- */
  async function screenshot(opts: { transparent?: boolean; scale?: number }): Promise<void> {
    const engine = engineRef.current
    if (!engine || !entry) return
    setShotMenu(false)
    const dataUrl = engine.screenshot(opts)
    const suffix = opts.transparent ? '-透明' : opts.scale && opts.scale > 1 ? `-${opts.scale}x` : ''
    await window.api.exportPng(`${entry.name}${suffix}.png`, dataUrl)
  }

  const onView = useCallback((p: ViewPreset) => engineRef.current?.setView(p), [])

  if (!entry) return <></>
  const isFav = favorites.has(entry.path.toLowerCase())

  return (
    <div className="viewer">
      <div className="vtop">
        <button onClick={onClose}>
          <IconBack /> 返回 (Esc)
        </button>
        <span className="title" title={entry.rel}>
          {entry.name}
        </span>
        <span className="idx">
          {index + 1} / {entries.length} · {entry.ext.slice(1).toUpperCase()}
        </span>

        <div className="spacer" />

        <button onClick={() => onIndex(index - 1)} disabled={index <= 0}>
          <IconPrev /> 上一个
        </button>
        <button onClick={() => onIndex(index + 1)} disabled={index >= entries.length - 1}>
          下一个 <IconNext />
        </button>
        <span className="vsep" />
        <button
          className={`icon-only${isFav ? ' primary' : ''}`}
          onClick={() => onToggleFavorite(entry)}
          title={isFav ? '取消收藏 (Ctrl+D)' : '收藏 (Ctrl+D)'}
        >
          <IconStar filled={isFav} />
        </button>
        <div className="shot-wrap">
          <button onClick={() => setShotMenu((v) => !v)} disabled={loading || !!error}>
            <IconCamera /> 截图 ▾
          </button>
          {shotMenu && (
            <div className="shot-menu" onMouseLeave={() => setShotMenu(false)}>
              <button onClick={() => void screenshot({})}>当前视图</button>
              <button onClick={() => void screenshot({ scale: 2 })}>2 倍分辨率</button>
              <button onClick={() => void screenshot({ transparent: true })}>透明背景</button>
              <button onClick={() => void screenshot({ transparent: true, scale: 2 })}>透明 · 2 倍</button>
            </div>
          )}
        </div>
        <button onClick={() => void window.api.showItem(entry.path)}>
          <IconLocate /> 定位
        </button>
        <button
          className={prefs.panelOpen ? 'on' : ''}
          onClick={() => setPrefs({ panelOpen: !prefs.panelOpen })}
          title="显示 / 隐藏面板 (Tab)"
        >
          <IconPanel /> 面板
        </button>
      </div>

      <div className="vbody">
        <div
          className="stage"
          ref={hostRef}
          onDoubleClick={(e) => {
            if (e.target === engineRef.current?.renderer.domElement) engineRef.current?.resetView()
          }}
        >
          {loading && (
            <div className="loading">
              <span className="spinner" />
              <span>
                {loadingMsg}
                {progress !== null && progress < 100 ? ' ' + progress + '%' : ''}
              </span>
            </div>
          )}

          {error && !loading && (
            <div className="verror">
              <div style={{ fontSize: 30 }}>⚠</div>
              <div>无法加载该模型</div>
              <div className="detail">{error}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => void window.api.openPath(entry.path)}>用默认程序打开</button>
                <button onClick={() => void window.api.showItem(entry.path)}>定位文件</button>
              </div>
            </div>
          )}

          {!loading && !error && (
            <div className="hud">
              左键旋转 · 滚轮缩放 · 右键平移 · 双击重置
              <br />
              ← → 切换 · F 重置 · W 线框 · R 旋转 · 1/3/7/5 视角 · Tab 面板
            </div>
          )}

          {warn && <div className="vwarn">{warn}</div>}
        </div>

        {prefs.panelOpen && (
          <ViewerPanel
            entry={entry}
            prefs={prefs}
            onPrefs={setPrefs}
            hdris={hdris}
            onImportHdri={() => void window.api.hdriImport().then(setHdris)}
            onRemoveHdri={(id) => {
              void window.api.hdriRemove(id).then((list) => {
                setHdris(list)
                if (prefsRef.current.envId === id) setPrefs({ envId: 'room' })
              })
            }}
            onOpenHdriDir={() => void window.api.hdriOpenDir()}
            stats={stats}
            clips={clips}
            clipIdx={clipIdx}
            playing={playing}
            duration={duration}
            onClip={onClip}
            onPlay={onPlay}
            onSeek={(t) => engineRef.current?.seek(t)}
            timeInputRef={timeInputRef}
            timeLabelRef={timeLabelRef}
            hierarchy={hierarchy}
            soloed={soloed}
            onNodeVisible={(uuid, v) => {
              engineRef.current?.setNodeVisible(uuid, v)
              setHierarchy((h) => h.map((n) => (n.uuid === uuid ? { ...n, visible: v } : n)))
            }}
            onSolo={(uuid) => {
              engineRef.current?.solo(uuid)
              setSoloed(uuid)
              setHierarchy(engineRef.current?.hierarchy() ?? [])
            }}
            materials={materials}
            onView={onView}
            tab={tab}
            onTab={setTab}
          />
        )}
      </div>
    </div>
  )
}
