import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ViewerPanel, { type PanelTab } from './ViewerPanel'
import { RatingStars } from './RatingStars'
import { useEscape } from './Dialogs'
import {
  DEFAULT_PREFS,
  ViewerEngine,
  type LoadedInfo,
  type MaterialInfo,
  type NodeInfo,
  type RenderStats,
  type TextureInfo,
  type ViewPreset,
  type ViewerPrefs
} from './lib/viewerEngine'
import type { HdriEntry, LightingPreset, ModelEntry, ModelStats, ThumbBackground } from '../shared/types'
import { IconBack, IconCamera, IconCompare, IconLocate, IconNext, IconPanel, IconPrev, IconStar, IconThumb } from './icons'

interface Props {
  entries: ModelEntry[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  lighting: LightingPreset
  favorites: Set<string>
  ratings: Record<string, number>
  onToggleFavorite: (entry: ModelEntry) => void
  onRate: (entry: ModelEntry, v: number) => void
  compareEntry: ModelEntry | null
  onCompare: (entry: ModelEntry | null) => void
  getThumbUrl: (id: string) => string | undefined
  onSetThumb: (entry: ModelEntry, dataUrl: string) => Promise<void>
  thumbSize: number
  thumbBackground: ThumbBackground
}

const PREFS_KEY = 'asset3d.viewerPrefs.v2'

const THUMB_BG: Record<ThumbBackground, number | null> = {
  transparent: null,
  dark: 0x14161a,
  light: 0xd8dade,
  white: 0xffffff
}

function loadPrefs(lighting: LightingPreset): ViewerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ViewerPrefs>
      // 工具类状态（剖切 / 测量）不跨会话记忆，每次打开都是干净的
      return { ...DEFAULT_PREFS, lighting, ...saved, clipEnabled: false, measure: false, normals: false }
    }
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

/** 一个 stage（画布容器）+ 它的引擎；对比模式下有两个 */
interface Stage {
  host: HTMLDivElement | null
  engine: ViewerEngine | null
}

function ComparePicker({
  entries,
  current,
  getThumbUrl,
  onPick,
  onClose
}: {
  entries: ModelEntry[]
  current: ModelEntry
  getThumbUrl: (id: string) => string | undefined
  onPick: (e: ModelEntry) => void
  onClose: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useEffect(() => ref.current?.focus(), [])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return entries.filter((e) => e.previewable && e.id !== current.id && (!s || e.name.toLowerCase().includes(s) || e.rel.toLowerCase().includes(s))).slice(0, 200)
  }, [entries, q, current])
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h3>选择要对比的模型</h3>
        <p className="note">两个模型并排显示，旋转缩放同步。也可以在网格里选中两个后点「对比」。</p>
        <input ref={ref} type="search" placeholder="搜索…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
        <div className="picker-list">
          {list.map((e) => {
            const url = getThumbUrl(e.id)
            return (
              <div key={e.id} className="picker-item" onClick={() => onPick(e)} title={e.rel}>
                <span className="picker-thumb">{url ? <img src={url} alt="" /> : <span className="mini">—</span>}</span>
                <span className="picker-name">{e.name}</span>
                <span className="picker-ext">{e.ext.slice(1)}</span>
              </div>
            )
          })}
          {list.length === 0 && <p className="note">没有匹配的模型</p>}
        </div>
        <div className="actions">
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}

function Viewer({
  entries,
  index,
  onIndex,
  onClose,
  lighting: initialLighting,
  favorites,
  ratings,
  onToggleFavorite,
  onRate,
  compareEntry,
  onCompare,
  getThumbUrl,
  onSetThumb,
  thumbSize,
  thumbBackground
}: Props): JSX.Element {
  const entry = entries[index]
  const hostRef = useRef<HTMLDivElement>(null)
  const hostBRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ViewerEngine | null>(null)
  const engineBRef = useRef<ViewerEngine | null>(null)
  /** 最近一次鼠标所在的画布：只从它向另一个同步相机，避免互相打架 */
  const activeRef = useRef<'a' | 'b'>('a')

  const [prefs, setPrefsRaw] = useState<ViewerPrefs>(() => loadPrefs(initialLighting))
  const [hdris, setHdris] = useState<HdriEntry[]>([])
  const [tab, setTab] = useState<PanelTab>('display')
  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('正在加载…')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<LoadedInfo | null>(null)
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [clips, setClips] = useState<string[]>([])
  const [clipIdx, setClipIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [duration, setDuration] = useState(0)
  const [hierarchy, setHierarchy] = useState<NodeInfo[]>([])
  const [materials, setMaterials] = useState<MaterialInfo[]>([])
  const [soloed, setSoloed] = useState<string | null>(null)
  const [variant, setVariant] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [shotMenu, setShotMenu] = useState(false)
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null)
  const [measureDist, setMeasureDist] = useState<number | null>(null)
  const [unit, setUnit] = useState<{ scale: number; name: string }>({ scale: 1, name: '' })
  const [texPreview, setTexPreview] = useState<TextureInfo | null>(null)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [bState, setBState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })

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

  /* ---------- 引擎 A：整个查看器生命周期只建一次 ---------- */
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
    engine.onStats = (s) => {
      if (prefsRef.current.statsHud) setRenderStats(s)
    }
    engine.onMeasure = setMeasureDist
    engine.onViewChange = () => {
      if (activeRef.current === 'a' && engineBRef.current) engineBRef.current.setViewState(engine.getViewState())
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

  /* ---------- 引擎 B：对比模式时才有 ---------- */
  useEffect(() => {
    const host = hostBRef.current
    if (!compareEntry || !host) {
      return
    }
    const engine = new ViewerEngine(host)
    engineBRef.current = engine
    engine.onWarn = showWarn
    engine.onViewChange = () => {
      if (activeRef.current === 'b' && engineRef.current) engineRef.current.setViewState(engine.getViewState())
    }
    engine.applyPrefs(prefsRef.current, hdrisRef.current, true)
    let cancelled = false
    setBState({ loading: true, error: null })
    void (async () => {
      try {
        const resolved = await window.api.viewableUrl(compareEntry)
        if (cancelled) return
        if (!resolved.url) throw new Error(resolved.error ?? '无法解析模型路径')
        const ext = compareEntry.ext === '.blend' ? '.glb' : compareEntry.ext
        await engine.load(resolved.url, ext)
        if (cancelled) return
        // 加载完先对齐到 A 的视角
        if (engineRef.current?.hasModel()) engine.setViewState(engineRef.current.getViewState())
        setBState({ loading: false, error: null })
      } catch (e) {
        if (!cancelled) setBState({ loading: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancelled = true
      engineBRef.current = null
      engine.dispose()
      setBState({ loading: false, error: null })
    }
  }, [compareEntry, showWarn])

  /* ---------- 设置变化同步到引擎 ---------- */
  useEffect(() => {
    engineRef.current?.applyPrefs(prefs, hdris)
    engineBRef.current?.applyPrefs(prefs, hdris)
  }, [prefs, hdris])

  useEffect(() => {
    if (engineRef.current) engineRef.current.measureUnit = unit
  }, [unit])

  /* ---------- 换模型 ---------- */
  useEffect(() => {
    const engine = engineRef.current
    if (!entry || !engine) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setInfo(null)
    setStats(null)
    setClips([])
    setClipIdx(0)
    setDuration(0)
    setHierarchy([])
    setMaterials([])
    setSoloed(null)
    setVariant(null)
    setProgress(null)
    setMeasureDist(null)
    setLoadingMsg(entry.ext === '.blend' ? '正在调用 Blender 转换为 GLB…（首次较慢，之后走缓存）' : '正在加载…')

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
        const loadedInfo = await engine.load(resolved.url, ext, (l, tot) => {
          if (!cancelled && tot > 0) setProgress(Math.round((l / tot) * 100))
        })
        if (cancelled || !loadedInfo) return

        setInfo(loadedInfo)
        setStats(loadedInfo.stats)
        setClips(loadedInfo.clips)
        setPlaying(true)
        if (loadedInfo.clips.length > 0) setDuration(engine.clipDuration(0))
        setHierarchy(engine.hierarchy())
        setMaterials(engine.materials())
        setLoading(false)
        if (engineBRef.current?.hasModel()) engineBRef.current.setViewState(engine.getViewState())
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
    setDuration(engine.clipDuration(i))
  }, [])

  const onPlay = useCallback((on: boolean) => {
    engineRef.current?.setPlaying(on)
    setPlaying(on)
  }, [])

  const onVariant = useCallback(
    async (name: string | null) => {
      const engine = engineRef.current
      if (!engine) return
      await engine.selectVariant(name)
      setVariant(name)
      setMaterials(engine.materials())
    },
    []
  )

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inControl =
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        if (texPreview || picker) return // 各自的弹层自己处理
        e.preventDefault()
        if (shotMenu) setShotMenu(false)
        else if (inControl) (e.target as HTMLElement).blur()
        else if (prefsRef.current.measure) setPrefs({ measure: false })
        else onClose()
        return
      }
      if (inControl || texPreview || picker) return
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
          engineBRef.current?.resetView()
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
        case 'm':
        case 'M':
          setPrefs({ measure: !prefsRef.current.measure })
          if (!prefsRef.current.measure) setTab('tools')
          break
        case 'x':
        case 'X':
          setPrefs({ clipEnabled: !prefsRef.current.clipEnabled })
          if (!prefsRef.current.clipEnabled) setTab('tools')
          break
        case 'b':
        case 'B':
          setPrefs({ skeleton: !prefsRef.current.skeleton })
          break
        case 'n':
        case 'N':
          setPrefs({ normals: !prefsRef.current.normals })
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
  }, [index, entries.length, onIndex, onClose, playing, onPlay, setPrefs, shotMenu, entry, onToggleFavorite, texPreview, picker])

  /* ---------- 截图 / 缩略图 / 转盘 ---------- */
  async function screenshot(opts: { transparent?: boolean; scale?: number }): Promise<void> {
    const engine = engineRef.current
    if (!engine || !entry) return
    setShotMenu(false)
    const dataUrl = engine.screenshot(opts)
    const suffix = opts.transparent ? '-透明' : opts.scale && opts.scale > 1 ? `-${opts.scale}x` : ''
    await window.api.exportPng(`${entry.name}${suffix}.png`, dataUrl)
  }

  async function turntable(n: number): Promise<void> {
    const engine = engineRef.current
    if (!engine || !entry) return
    setShotMenu(false)
    setBusy(`正在渲染 ${n} 帧转盘序列…`)
    await new Promise((r) => setTimeout(r, 30))
    try {
      const frames = engine.turntableFrames(n, { transparent: true })
      const r = await window.api.exportFrames('选择转盘序列保存到哪个文件夹', entry.name, frames)
      if (r.ok) showWarn(`已保存 ${n} 帧到 ${r.dir}`)
      else if (r.error) showWarn(r.error)
    } finally {
      setBusy(null)
    }
  }

  async function setAsThumb(): Promise<void> {
    const engine = engineRef.current
    if (!engine || !entry) return
    setBusy('正在生成缩略图…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const url = engine.captureSquare(thumbSize, THUMB_BG[thumbBackground] ?? null)
      await onSetThumb(entry, url)
      showWarn('已把当前视角设为这个模型的缩略图')
    } finally {
      setBusy(null)
    }
  }

  const onView = useCallback((p: ViewPreset) => {
    engineRef.current?.setView(p)
    if (engineRef.current && engineBRef.current) engineBRef.current.setViewState(engineRef.current.getViewState())
  }, [])

  const openTexture = useCallback((materialIndex: number, slot: string) => {
    const t = engineRef.current?.textureInfo(materialIndex, slot)
    if (t) setTexPreview(t)
  }, [])

  if (!entry) return <></>
  const isFav = favorites.has(entry.path.toLowerCase())
  const rating = ratings[entry.path.toLowerCase()] ?? 0

  return (
    <div className="viewer">
      <div className="vtop">
        <button onClick={onClose}>
          <IconBack /> 返回
        </button>
        <span className="title" title={entry.rel}>
          {entry.name}
        </span>
        <span className="idx">
          {index + 1} / {entries.length} · {entry.ext.slice(1).toUpperCase()}
        </span>
        <span className="vsep" />
        <button
          className={`icon-only${isFav ? ' primary' : ''}`}
          onClick={() => onToggleFavorite(entry)}
          title={isFav ? '取消收藏 (Ctrl+D)' : '收藏 (Ctrl+D)'}
        >
          <IconStar filled={isFav} />
        </button>
        <RatingStars value={rating} onChange={(v) => onRate(entry, v)} size={15} />

        <div className="spacer" />

        <button onClick={() => onIndex(index - 1)} disabled={index <= 0} title="上一个 (←)">
          <IconPrev />
        </button>
        <button onClick={() => onIndex(index + 1)} disabled={index >= entries.length - 1} title="下一个 (→)">
          <IconNext />
        </button>
        <span className="vsep" />
        <button
          className={compareEntry ? 'on' : ''}
          onClick={() => (compareEntry ? onCompare(null) : setPicker(true))}
          title="并排对比两个模型，相机同步"
        >
          <IconCompare /> {compareEntry ? '关闭对比' : '对比…'}
        </button>
        <button onClick={() => void setAsThumb()} disabled={loading || !!error || !!busy} title="用当前视角替换这个模型在网格里的缩略图">
          <IconThumb /> 设为缩略图
        </button>
        <div className="shot-wrap">
          <button onClick={() => setShotMenu((v) => !v)} disabled={loading || !!error || !!busy}>
            <IconCamera /> 截图 ▾
          </button>
          {shotMenu && (
            <div className="shot-menu" onMouseLeave={() => setShotMenu(false)}>
              <button onClick={() => void screenshot({})}>当前视图</button>
              <button onClick={() => void screenshot({ scale: 2 })}>2 倍分辨率</button>
              <button onClick={() => void screenshot({ transparent: true })}>透明背景</button>
              <button onClick={() => void screenshot({ transparent: true, scale: 2 })}>透明 · 2 倍</button>
              <hr />
              <button onClick={() => void turntable(12)}>转盘序列 · 12 帧</button>
              <button onClick={() => void turntable(24)}>转盘序列 · 24 帧</button>
              <button onClick={() => void turntable(36)}>转盘序列 · 36 帧</button>
            </div>
          )}
        </div>
        <button onClick={() => void window.api.showItem(entry.path)} title="在资源管理器中显示">
          <IconLocate />
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
        <div className={`stages${compareEntry ? ' compare' : ''}`}>
          <div
            className="stage"
            ref={hostRef}
            onPointerEnter={() => (activeRef.current = 'a')}
            onDoubleClick={(e) => {
              if (e.target === engineRef.current?.renderer.domElement) {
                engineRef.current?.resetView()
                if (engineRef.current && engineBRef.current) engineBRef.current.setViewState(engineRef.current.getViewState())
              }
            }}
          >
            {compareEntry && <div className="stage-label">A · {entry.name}</div>}
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
                <div className="verror-ico">⚠</div>
                <div>无法加载该模型</div>
                <div className="detail">{error}</div>
                <div className="verror-actions">
                  <button onClick={() => void window.api.openPath(entry.path)}>用默认程序打开</button>
                  <button onClick={() => void window.api.showItem(entry.path)}>定位文件</button>
                </div>
              </div>
            )}

            {!loading && !error && !compareEntry && (
              <div className="hud">
                左键旋转 · 滚轮缩放 · 右键平移 · 双击重置 · 右下角导航球点轴切视角
                <br />
                ← → 切换 · F 重置 · W 线框 · M 测量 · X 剖切 · 1/3/7/5 视角 · Tab 面板
              </div>
            )}

            {prefs.measure && !loading && !error && (
              <div className="measure-hud">
                <b>测量</b>
                {measureDist === null ? '在模型表面点两个点' : `距离 ${(measureDist * unit.scale).toFixed(4)} ${unit.name || '(原始单位)'}`}
                <button onClick={() => engineRef.current?.clearMeasure()}>清除</button>
                <button onClick={() => setPrefs({ measure: false })}>退出 (Esc)</button>
              </div>
            )}

            {prefs.statsHud && renderStats && (
              <div className="stats-hud">
                {renderStats.fps} fps · {renderStats.calls} 次绘制 · △{renderStats.triangles.toLocaleString('zh-CN')}
                {renderStats.points > 0 ? ` · 点 ${renderStats.points.toLocaleString('zh-CN')}` : ''}
                {renderStats.lines > 0 ? ` · 线 ${renderStats.lines.toLocaleString('zh-CN')}` : ''}
                <br />
                几何体 {renderStats.geometries} · 贴图 {renderStats.textures}
              </div>
            )}

            {warn && <div className="vwarn">{warn}</div>}
            {busy && (
              <div className="loading">
                <span className="spinner" />
                <span>{busy}</span>
              </div>
            )}
          </div>

          {compareEntry && (
            <div className="stage" ref={hostBRef} onPointerEnter={() => (activeRef.current = 'b')}>
              <div className="stage-label">B · {compareEntry.name}</div>
              {bState.loading && (
                <div className="loading">
                  <span className="spinner" />
                  <span>正在加载…</span>
                </div>
              )}
              {bState.error && (
                <div className="verror">
                  <div className="verror-ico">⚠</div>
                  <div className="detail">{bState.error}</div>
                </div>
              )}
            </div>
          )}
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
            info={info}
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
            onTexture={openTexture}
            variant={variant}
            onVariant={(n) => void onVariant(n)}
            onView={onView}
            tab={tab}
            onTab={setTab}
            measureDist={measureDist}
            onClearMeasure={() => engineRef.current?.clearMeasure()}
            unit={unit}
            onUnit={setUnit}
          />
        )}
      </div>

      {texPreview && (
        <div className="modal-mask" onClick={() => setTexPreview(null)}>
          <div className="modal texview" onClick={(e) => e.stopPropagation()}>
            <h3>
              贴图 · {texPreview.slot.replace('Map', '')}
              <span className="hint" style={{ marginLeft: 10 }}>
                {texPreview.width}×{texPreview.height} · {texPreview.colorSpace} · {texPreview.wrap}
              </span>
            </h3>
            <div className="texview-body">
              {texPreview.dataUrl ? <img src={texPreview.dataUrl} alt="" /> : <p className="note">{texPreview.note ?? '无法显示'}</p>}
            </div>
            <p className="note wrap">{texPreview.file ?? '（来源未知）'}</p>
            <div className="actions">
              {texPreview.path && <button onClick={() => void window.api.showItem(texPreview.path!)}>定位贴图文件</button>}
              <button className="primary" onClick={() => setTexPreview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <ComparePicker
          entries={entries}
          current={entry}
          getThumbUrl={getThumbUrl}
          onPick={(e) => {
            setPicker(false)
            onCompare(e)
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}

/** memo：后台出图结果会让 App 频繁重渲染，查看器不该跟着一起重画 */
export default memo(Viewer)
