import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { disposeObject, loadModel } from './lib/loaders'
import {
  addLights,
  computeStats,
  createEnvironment,
  frameObject,
  normalizeMaterials,
  relaxBackfaceCulling,
  type LightingPreset
} from './lib/framing'
import type { ModelEntry, ModelStats } from '../shared/types'

interface Props {
  entries: ModelEntry[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

const BACKGROUNDS: { key: string; label: string; color: number | null }[] = [
  { key: 'dark', label: '深灰', color: 0x14161a },
  { key: 'mid', label: '中灰', color: 0x606060 },
  { key: 'light', label: '浅灰', color: 0xd8dade },
  { key: 'black', label: '纯黑', color: 0x000000 },
  { key: 'white', label: '纯白', color: 0xffffff }
]

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

function fmtDim(d: [number, number, number]): string {
  const f = (v: number): string =>
    v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4)
  return `${f(d[0])} × ${f(d[1])} × ${f(d[2])}`
}

export default function Viewer({ entries, index, onIndex, onClose }: Props): JSX.Element {
  const entry = entries[index]
  const hostRef = useRef<HTMLDivElement>(null)

  // three.js 的一整套对象放在 ref 里，避免 React 重渲染时被重建
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    env: THREE.Texture
    lights: THREE.Light[]
    grid: THREE.GridHelper
    axes: THREE.AxesHelper
    box: THREE.Box3Helper
    mixer: THREE.AnimationMixer | null
    clips: THREE.AnimationClip[]
    action: THREE.AnimationAction | null
    current: THREE.Object3D | null
    raf: number
    clock: THREE.Clock
  } | null>(null)

  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('正在加载…')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showAxes, setShowAxes] = useState(false)
  const [showBox, setShowBox] = useState(false)
  const [bg, setBg] = useState('dark')
  const [lighting, setLighting] = useState<LightingPreset>('studio')
  const [clipNames, setClipNames] = useState<string[]>([])
  const [clipIdx, setClipIdx] = useState(-1)
  const [playing, setPlaying] = useState(true)

  /* ---------- 初始化：整个查看器生命周期只建一次 ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const env = createEnvironment(renderer)
    scene.environment = env
    scene.background = new THREE.Color(0x14161a)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // 左键旋转 / 中键推拉 / 右键平移
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    }

    const lights = addLights(scene, 'studio')

    const grid = new THREE.GridHelper(10, 20, 0x3a4050, 0x262b33)
    scene.add(grid)
    const axes = new THREE.AxesHelper(1)
    axes.visible = false
    scene.add(axes)
    const box = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x4c9aff))
    box.visible = false
    scene.add(box)

    const clock = new THREE.Clock()

    three.current = {
      renderer,
      scene,
      camera,
      controls,
      env,
      lights,
      grid,
      axes,
      box,
      mixer: null,
      clips: [],
      action: null,
      current: null,
      raf: 0,
      clock
    }

    const resize = (): void => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const tick = (): void => {
      const t = three.current
      if (!t) return
      t.raf = requestAnimationFrame(tick)
      const dt = t.clock.getDelta()
      if (t.mixer) t.mixer.update(dt)
      t.controls.update()
      t.renderer.render(t.scene, t.camera)
    }
    tick()

    return () => {
      ro.disconnect()
      const t = three.current
      three.current = null
      if (t) {
        cancelAnimationFrame(t.raf)
        if (t.current) disposeObject(t.current)
        t.controls.dispose()
        t.env.dispose()
        t.grid.geometry.dispose()
        ;(t.grid.material as THREE.Material).dispose()
        t.axes.dispose()
        t.renderer.dispose()
        t.renderer.forceContextLoss()
        t.renderer.domElement.remove()
      }
    }
  }, [])

  /* ---------- 换模型 ---------- */
  useEffect(() => {
    if (!entry) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setStats(null)
    setClipNames([])
    setClipIdx(-1)
    setLoadingMsg(
      entry.ext === '.blend'
        ? '正在调用 Blender 转换为 GLB…（首次较慢，之后走缓存）'
        : '正在加载…'
    )

    void (async () => {
      const t = three.current
      if (!t) return

      // 先卸掉上一个模型，避免两个模型同时占显存
      if (t.current) {
        t.scene.remove(t.current)
        disposeObject(t.current)
        t.current = null
      }
      if (t.mixer) {
        t.mixer.stopAllAction()
        t.mixer = null
      }
      t.action = null

      try {
        const resolved = await window.api.viewableUrl(entry)
        if (cancelled) return
        if (!resolved.url) throw new Error(resolved.error ?? '无法解析模型路径')

        const ext = entry.ext === '.blend' ? '.glb' : entry.ext
        const loaded = await loadModel(resolved.url, ext, t.renderer)
        if (cancelled) {
          disposeObject(loaded.object)
          return
        }

        normalizeMaterials(loaded.object)
        relaxBackfaceCulling(loaded.object)
        t.scene.add(loaded.object)
        t.current = loaded.object

        const { center, radius } = frameObject(loaded.object, t.camera)
        t.controls.target.copy(center)
        t.controls.minDistance = radius * 0.05
        t.controls.maxDistance = radius * 40
        t.controls.update()

        // 地面网格和坐标轴跟着模型尺度走，不然大模型看不到网格、小模型被网格淹没
        const gridSize = radius * 4
        t.grid.scale.setScalar(gridSize / 10)
        t.grid.position.set(center.x, center.y - radius, center.z)
        t.axes.scale.setScalar(radius)
        t.axes.position.copy(center)
        t.box.box.setFromObject(loaded.object)

        setStats(computeStats(loaded.object, loaded.animations))

        if (loaded.animations.length > 0) {
          t.clips = loaded.animations
          t.mixer = new THREE.AnimationMixer(loaded.object)
          setClipNames(loaded.animations.map((a, i) => a.name || `动画 ${i + 1}`))
          setClipIdx(0)
        } else {
          t.clips = []
          setClipNames([])
        }

        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)

        // 加载失败大概率是外部依赖缺失（.bin 或贴图），查一下告诉用户到底缺什么
        try {
          const dep = await window.api.dependencies(entry.path)
          if (!cancelled && dep.missing.length > 0) {
            setError(
              (prev) =>
                `${prev ?? ''}\n缺少依赖文件: ${dep.missing.join(', ')}`
            )
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

  /* ---------- 各种开关 ---------- */
  useEffect(() => {
    const t = three.current
    if (!t?.current) return
    t.current.traverse((o) => {
      const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] })
        .material
      if (!mat) return
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        const mm = m as THREE.MeshStandardMaterial
        if ('wireframe' in mm) mm.wireframe = wireframe
      }
    })
  }, [wireframe, stats])

  useEffect(() => {
    const t = three.current
    if (!t) return
    t.grid.visible = showGrid
    t.axes.visible = showAxes
    t.box.visible = showBox
  }, [showGrid, showAxes, showBox, stats])

  useEffect(() => {
    const t = three.current
    if (!t) return
    const c = BACKGROUNDS.find((b) => b.key === bg)
    t.scene.background = new THREE.Color(c?.color ?? 0x14161a)
  }, [bg])

  useEffect(() => {
    const t = three.current
    if (!t) return
    for (const l of t.lights) t.scene.remove(l)
    t.lights = addLights(t.scene, lighting)
  }, [lighting])

  useEffect(() => {
    const t = three.current
    if (!t?.mixer || clipIdx < 0 || !t.clips[clipIdx]) return
    t.mixer.stopAllAction()
    const action = t.mixer.clipAction(t.clips[clipIdx])
    action.reset()
    action.play()
    action.paused = !playing
    t.action = action
  }, [clipIdx, playing, stats])

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (index < entries.length - 1) onIndex(index + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (index > 0) onIndex(index - 1)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        resetView()
      } else if (e.key === 'w' || e.key === 'W') {
        setWireframe((v) => !v)
      } else if (e.key === 'g' || e.key === 'G') {
        setShowGrid((v) => !v)
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, entries.length, onIndex, onClose])

  function resetView(): void {
    const t = three.current
    if (!t?.current) return
    const { center, radius } = frameObject(t.current, t.camera)
    t.controls.target.copy(center)
    t.controls.minDistance = radius * 0.05
    t.controls.maxDistance = radius * 40
    t.controls.update()
  }

  async function screenshot(): Promise<void> {
    const t = three.current
    if (!t) return
    t.renderer.render(t.scene, t.camera)
    const dataUrl = t.renderer.domElement.toDataURL('image/png')
    await window.api.exportPng(`${entry?.name ?? 'model'}.png`, dataUrl)
  }

  if (!entry) return <></>

  return (
    <div className="viewer">
      <div className="vtop">
        <button onClick={onClose}>← 返回 (Esc)</button>
        <span className="title">{entry.name}</span>
        <span className="idx">
          {index + 1} / {entries.length} · {entry.ext.slice(1).toUpperCase()}
        </span>

        <div className="spacer" />

        <button onClick={() => onIndex(index - 1)} disabled={index <= 0}>
          ← 上一个
        </button>
        <button
          onClick={() => onIndex(index + 1)}
          disabled={index >= entries.length - 1}
        >
          下一个 →
        </button>
        <button onClick={resetView}>重置视角 (F)</button>
        <button
          className={wireframe ? 'primary' : ''}
          onClick={() => setWireframe((v) => !v)}
        >
          线框 (W)
        </button>
        <button className={showGrid ? 'primary' : ''} onClick={() => setShowGrid((v) => !v)}>
          网格 (G)
        </button>
        <button className={showAxes ? 'primary' : ''} onClick={() => setShowAxes((v) => !v)}>
          坐标轴
        </button>
        <button className={showBox ? 'primary' : ''} onClick={() => setShowBox((v) => !v)}>
          包围盒
        </button>

        <select value={lighting} onChange={(e) => setLighting(e.target.value as LightingPreset)}>
          <option value="studio">影棚光</option>
          <option value="outdoor">室外光</option>
          <option value="neutral">中性光</option>
        </select>

        <select value={bg} onChange={(e) => setBg(e.target.value)}>
          {BACKGROUNDS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>

        <button onClick={() => void screenshot()}>导出截图</button>
        <button onClick={() => void window.api.showItem(entry.path)}>定位文件</button>
      </div>

      <div className="stage" ref={hostRef}>
        {loading && (
          <div className="loading">
            <span className="spinner" />
            <span>{loadingMsg}</span>
          </div>
        )}

        {error && !loading && (
          <div className="verror">
            <div style={{ fontSize: 30 }}>⚠</div>
            <div>无法加载该模型</div>
            <div className="detail">{error}</div>
          </div>
        )}

        {stats && !loading && !error && (
          <div className="panel">
            <h4>模型信息</h4>
            <div className="row">
              <span>顶点</span>
              <b>{fmtNum(stats.vertices)}</b>
            </div>
            <div className="row">
              <span>三角面</span>
              <b>{fmtNum(stats.triangles)}</b>
            </div>
            <div className="row">
              <span>网格</span>
              <b>{fmtNum(stats.meshes)}</b>
            </div>
            <div className="row">
              <span>材质</span>
              <b>{fmtNum(stats.materials)}</b>
            </div>
            <div className="row">
              <span>贴图</span>
              <b>{fmtNum(stats.textures)}</b>
            </div>
            <div className="row">
              <span>动画</span>
              <b>{stats.animations.length}</b>
            </div>
            <div className="row">
              <span>尺寸</span>
              <b style={{ fontSize: 11 }}>{fmtDim(stats.dimensions)}</b>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div className="hud">
            左键拖拽 = 旋转 · 滚轮 = 缩放 · 右键拖拽 = 平移
            <br />
            ← → 切换模型 · F 重置 · W 线框 · Esc 返回
          </div>
        )}
      </div>

      {clipNames.length > 0 && (
        <div className="anim-bar">
          <button onClick={() => setPlaying((v) => !v)}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <select value={clipIdx} onChange={(e) => setClipIdx(Number(e.target.value))}>
            {clipNames.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
          <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>
            共 {clipNames.length} 段动画 · 空格键播放/暂停
          </span>
        </div>
      )}
    </div>
  )
}
