import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js'
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js'
import { disposeObject, loadModel, type LoadedModel } from './loaders'
import {
  addLights,
  computeStats,
  frameObject,
  normalizeMaterials,
  relaxBackfaceCulling,
  type LightingPreset
} from './framing'
import { ShadingController, type ShadingMode } from './shading'
import { MeasureTool } from './measure'
import type { HdriEntry, ModelStats } from '../../shared/types'

export type BgKey = 'soft' | 'dark' | 'mid' | 'light' | 'black' | 'white'
export const BACKGROUNDS: { key: BgKey; label: string; color: number }[] = [
  { key: 'soft', label: '淡蓝', color: 0xe9eef8 },
  { key: 'light', label: '浅灰', color: 0xd8dade },
  { key: 'mid', label: '中灰', color: 0x606060 },
  { key: 'dark', label: '深灰', color: 0x14161a },
  { key: 'black', label: '纯黑', color: 0x000000 },
  { key: 'white', label: '纯白', color: 0xffffff }
]

export type ViewPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type ToneMappingKey = 'aces' | 'agx' | 'neutral' | 'linear' | 'none'
export const TONE_MAPPINGS: { key: ToneMappingKey; label: string }[] = [
  { key: 'aces', label: 'ACES（电影感）' },
  { key: 'agx', label: 'AgX（Blender 4 默认）' },
  { key: 'neutral', label: 'Neutral（还原色彩）' },
  { key: 'linear', label: 'Linear' },
  { key: 'none', label: '无' }
]
const TONE_MAP: Record<ToneMappingKey, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping
}
export type ClipAxis = 'x' | 'y' | 'z'

export interface ViewerPrefs {
  mode: ShadingMode
  flat: boolean
  wireOverlay: boolean
  ao: boolean
  shadow: boolean
  grid: boolean
  axes: boolean
  bbox: boolean
  bg: BgKey
  /** 'room' = 程序化房间环境；否则是 HdriEntry.id */
  envId: string
  envIntensity: number
  /** 角度 */
  envRotation: number
  envVisible: boolean
  envBlur: number
  lighting: LightingPreset | 'none'
  /** 补光整体绕 Y 轴旋转（度）与强度倍率 */
  lightRotation: number
  lightIntensity: number
  exposure: number
  toneMapping: ToneMappingKey
  ortho: boolean
  fov: number
  autoRotate: boolean
  viewHelper: boolean
  animSpeed: number
  animLoop: boolean
  panelOpen: boolean
  /* 工具 */
  clipEnabled: boolean
  clipAxis: ClipAxis
  /** 0–1，沿轴从包围盒最小到最大 */
  clipPos: number
  clipFlip: boolean
  measure: boolean
  skeleton: boolean
  normals: boolean
  pointSize: number
  statsHud: boolean
}

export const DEFAULT_PREFS: ViewerPrefs = {
  mode: 'material',
  flat: false,
  wireOverlay: false,
  ao: false,
  shadow: false,
  grid: true,
  axes: false,
  bbox: false,
  bg: 'soft',
  envId: 'room',
  envIntensity: 1,
  envRotation: 0,
  envVisible: false,
  envBlur: 0,
  lighting: 'studio',
  lightRotation: 0,
  lightIntensity: 1,
  exposure: 1,
  toneMapping: 'aces',
  ortho: false,
  fov: 45,
  autoRotate: false,
  viewHelper: true,
  animSpeed: 1,
  animLoop: true,
  panelOpen: true,
  clipEnabled: false,
  clipAxis: 'y',
  clipPos: 0.5,
  clipFlip: false,
  measure: false,
  skeleton: false,
  normals: false,
  pointSize: 1,
  statsHud: false
}

export interface NodeInfo {
  uuid: string
  name: string
  type: string
  depth: number
  isMesh: boolean
  tris: number
  visible: boolean
}

export interface MapInfo {
  slot: string
  size: string
  /** 供 textureInfo() 回查 */
  index: number
}

export interface MaterialInfo {
  index: number
  name: string
  type: string
  color: string | null
  maps: MapInfo[]
  transparent: boolean
  meshes: number
}

export interface TextureInfo {
  slot: string
  width: number
  height: number
  colorSpace: string
  wrap: string
  /** 能画出来就是 dataURL；压缩贴图画不出来为 null */
  dataUrl: string | null
  /** 贴图来源（asset3d 本地路径解出来的文件名），内嵌贴图为 null */
  file: string | null
  path: string | null
  note: string | null
}

export interface LoadedInfo {
  stats: ModelStats
  clips: string[]
  variants: string[]
  hasSkeleton: boolean
  hasVertexColors: boolean
  isPointCloud: boolean
}

export interface RenderStats {
  fps: number
  calls: number
  triangles: number
  points: number
  lines: number
  geometries: number
  textures: number
}

/** 两个查看器之间同步相机用的、与模型尺度无关的视角描述 */
export interface ViewState {
  dir: [number, number, number]
  distRatio: number
  targetOffset: [number, number, number]
  up: [number, number, number]
  zoom: number
}

class HdriNotReady extends Error {}

interface EnvCacheEntry {
  env: THREE.Texture
  equirect: THREE.Texture | null
}

const MAP_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'alphaMap',
  'displacementMap',
  'lightMap',
  'specularMap',
  'envMap',
  'matcap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'transmissionMap',
  'thicknessMap'
]

const NORMALS_MAX_VERTS = 300_000
const VIEW_HELPER_DIM = 128

/**
 * 查看器的 three.js 引擎。所有场景对象、后处理、相机、动画都在这里，
 * React 层只管状态与 UI，通过方法调用驱动。
 */
export class ViewerEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly persp: THREE.PerspectiveCamera
  readonly ortho: THREE.OrthographicCamera
  camera: THREE.Camera
  readonly controls: OrbitControls

  private host: HTMLElement
  private composer: EffectComposer | null = null
  private renderPass: RenderPass | null = null
  private gtao: GTAOPass | null = null
  private lightRig = new THREE.Group()
  private lights: THREE.Light[] = []
  private shadowLight: THREE.DirectionalLight | null = null
  private ground: THREE.Mesh | null = null
  private grid: THREE.GridHelper
  private axes: THREE.AxesHelper
  private box: THREE.Box3Helper
  private viewHelper: ViewHelper
  private shading = new ShadingController()
  private measure: MeasureTool
  private envCache = new Map<string, EnvCacheEntry>()
  private pmrem: THREE.PMREMGenerator
  private current: THREE.Object3D | null = null
  private loaded: LoadedModel | null = null
  private center = new THREE.Vector3()
  private radius = 1
  private bbox = new THREE.Box3()
  private bottomY = 0
  private mixer: THREE.AnimationMixer | null = null
  private clips: THREE.AnimationClip[] = []
  private action: THREE.AnimationAction | null = null
  private clock = new THREE.Clock()
  private raf = 0
  private ro: ResizeObserver
  private loadToken = 0
  private prefs: ViewerPrefs = { ...DEFAULT_PREFS }
  private hdris: HdriEntry[] = []
  private shadowOpacity = 0.5
  private basePixelRatio = 1
  /** 还要画几帧。静止时不重绘，省 GPU；任何状态变化都把它拨上去 */
  private dirty = 3
  private shadowDirty = true
  private idleFrames = 0
  private soloed: string | null = null
  private hiddenBySolo: THREE.Object3D[] = []
  private skeletonHelper: THREE.SkeletonHelper | null = null
  private normalHelpers: VertexNormalsHelper[] = []
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  private materialList: THREE.Material[] = []
  private suppressViewEvents = false
  private disposed = false
  /* 统计 */
  private frameTimes: number[] = []
  private lastStatsAt = 0
  private pointerDown: { x: number; y: number; button: number } | null = null

  onFrame: ((time: number, duration: number) => void) | null = null
  onWarn: ((msg: string) => void) | null = null
  onStats: ((s: RenderStats) => void) | null = null
  onViewChange: (() => void) | null = null
  onMeasure: ((distance: number | null) => void) | null = null
  /** 测量标签的单位换算，由界面按「信息」面板选的单位设置 */
  measureUnit = { scale: 1, name: '' }

  constructor(host: HTMLElement) {
    this.host = host
    // 不用 preserveDrawingBuffer：截图是「渲染完立刻同步读」，不需要它，
    // 开着会让每帧多一次拷贝
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    })
    this.basePixelRatio = Math.min(window.devicePixelRatio, 1.5)
    this.renderer.setPixelRatio(this.basePixelRatio)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = false
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // 阴影贴图只在模型 / 光 / 动画变化时重画，不是每帧
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.localClippingEnabled = true
    host.appendChild(this.renderer.domElement)

    this.pmrem = new THREE.PMREMGenerator(this.renderer)

    this.persp = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
    this.camera = this.persp
    this.controls = new OrbitControls(this.persp, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    }
    this.controls.addEventListener('change', () => {
      if (!this.suppressViewEvents) this.onViewChange?.()
    })

    this.lightRig.name = '__light_rig'
    this.scene.add(this.lightRig)

    this.grid = new THREE.GridHelper(10, 20, 0x8a94a8, 0xb9c1d0)
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.55
    this.scene.add(this.grid)
    this.axes = new THREE.AxesHelper(1)
    this.axes.visible = false
    this.scene.add(this.axes)
    this.box = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x4c9aff))
    this.box.visible = false
    this.scene.add(this.box)

    this.measure = new MeasureTool(host)
    this.measure.onChange = (d) => this.onMeasure?.(d)
    this.scene.add(this.measure.group)

    // 右下角的导航球：点轴切视角
    this.viewHelper = new ViewHelper(this.persp, this.renderer.domElement)
    this.viewHelper.center = this.controls.target
    this.viewHelper.setLabels('X', 'Y', 'Z')

    this.scene.background = new THREE.Color(0xe9eef8)

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.tick()
    if (import.meta.env.DEV) (window as unknown as { __engine?: ViewerEngine }).__engine = this
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.updateOrthoFrustum()
    this.composer?.setSize(w, h)
    this.gtao?.setSize(w, h)
    this.invalidate()
  }

  /** 让接下来几帧重绘。异步的贴图 / 环境加载完成也要调它 */
  invalidate(frames = 2): void {
    this.dirty = Math.max(this.dirty, frames)
  }

  private tick = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = this.clock.getDelta()
    const animating = !!(this.mixer && this.action && !this.action.paused)
    if (this.mixer && animating) {
      this.mixer.update(dt)
      if (this.action && this.onFrame) {
        const clip = this.action.getClip()
        this.onFrame(this.action.time, clip.duration)
      }
      this.shadowDirty = true
    }
    let helperMoving = false
    if (this.viewHelper.animating) {
      this.viewHelper.update(dt)
      if (this.camera === this.ortho) this.syncOrthoFromPersp()
      helperMoving = true
      if (!this.viewHelper.animating) this.onViewChange?.()
    }
    // OrbitControls.update 在相机真的动了时返回 true（含阻尼余量）
    const moved = this.controls.update()
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowDirty = false
      this.dirty = Math.max(this.dirty, 1)
    }
    // 静止时不重绘；每秒兜底画一帧，防止漏掉某个异步更新
    this.idleFrames++
    if (moved || animating || helperMoving || this.controls.autoRotate || this.dirty > 0 || this.idleFrames % 60 === 0) {
      this.render()
      if (this.dirty > 0) this.dirty--
      this.trackStats()
    }
  }

  private applyPixelRatio(): void {
    // AO 是全屏后处理，按 1.5 倍像素比跑在大窗口上会卡成幻灯片
    const pr = this.prefs.ao ? 1 : this.basePixelRatio
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr)
      this.composer?.setPixelRatio(pr)
      this.resize()
    }
  }

  private render(): void {
    if (this.prefs.ao && this.composer && this.current) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    if (this.prefs.viewHelper) {
      this.renderer.autoClear = false
      this.viewHelper.render(this.renderer)
      this.renderer.autoClear = true
    }
    if (this.prefs.measure) {
      this.measure.updateLabel(this.camera, this.host.clientWidth, this.host.clientHeight, this.measureUnit.scale, this.measureUnit.name)
    }
  }

  private trackStats(): void {
    if (!this.onStats) return
    const now = performance.now()
    this.frameTimes.push(now)
    while (this.frameTimes.length > 0 && now - this.frameTimes[0] > 1000) this.frameTimes.shift()
    if (now - this.lastStatsAt < 400) return
    this.lastStatsAt = now
    const info = this.renderer.info
    this.onStats({
      fps: this.frameTimes.length,
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    })
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.unload()
    this.shading.dispose()
    this.measure.dispose()
    this.controls.dispose()
    this.viewHelper.dispose()
    for (const e of this.envCache.values()) {
      e.env.dispose()
      e.equirect?.dispose()
    }
    this.envCache.clear()
    this.pmrem.dispose()
    this.composer?.dispose()
    this.grid.geometry.dispose()
    ;(this.grid.material as THREE.Material).dispose()
    this.axes.dispose()
    this.ground?.geometry.dispose()
    ;(this.ground?.material as THREE.Material | undefined)?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  /* ------------------------------ 指针：导航球 / 测量 ------------------------------ */

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button }
  }

  private onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown
    this.pointerDown = null
    if (!down || down.button !== 0) return
    // 拖动过就不算点击
    if (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (this.prefs.viewHelper) {
      const inHelper = e.clientX > rect.right - VIEW_HELPER_DIM && e.clientY > rect.bottom - VIEW_HELPER_DIM
      if (inHelper && this.viewHelper.handleClick(e)) {
        this.invalidate(60)
        return
      }
    }
    if (this.prefs.measure && this.current) {
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      if (!this.measure.pick(ndc, this.camera, this.current)) this.onWarn?.('没点到模型表面')
      this.invalidate()
    }
  }

  /* ------------------------------ 模型 ------------------------------ */

  private unload(): void {
    this.shading.detach()
    this.measure.clear()
    this.clearHelpers()
    if (this.current) {
      this.scene.remove(this.current)
      disposeObject(this.current)
      this.current = null
    }
    this.loaded = null
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    this.action = null
    this.clips = []
    this.soloed = null
    this.hiddenBySolo = []
    this.materialList = []
  }

  /** 加载一个模型；返回 null 表示这次加载已被更新的一次取代 */
  async load(
    url: string,
    ext: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<LoadedInfo | null> {
    const token = ++this.loadToken
    this.unload()

    const loaded = await loadModel(url, ext, this.renderer, { onProgress })
    if (token !== this.loadToken || this.disposed) {
      disposeObject(loaded.object)
      return null
    }

    normalizeMaterials(loaded.object)
    relaxBackfaceCulling(loaded.object)
    loaded.object.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    this.scene.add(loaded.object)
    this.current = loaded.object
    this.loaded = loaded
    this.shading.attach(loaded.object)
    this.rememberPointSizes()

    this.frame()
    this.applyPrefs(this.prefs, this.hdris, true)
    this.shadowDirty = true
    this.invalidate(3)

    if (loaded.animations.length > 0) {
      this.clips = loaded.animations
      this.mixer = new THREE.AnimationMixer(loaded.object)
      this.mixer.timeScale = this.prefs.animSpeed
      this.setClip(0, true)
    }

    let hasSkeleton = false
    let isPointCloud = true
    loaded.object.traverse((o) => {
      if ((o as THREE.Bone).isBone) hasSkeleton = true
      if ((o as THREE.Mesh).isMesh) isPointCloud = false
    })
    if (!loaded.object.children.length && !(loaded.object as THREE.Points).isPoints) isPointCloud = false

    return {
      stats: computeStats(loaded.object, loaded.animations),
      clips: loaded.animations.map((a, i) => a.name || `动画 ${i + 1}`),
      variants: loaded.variants ?? [],
      hasSkeleton,
      hasVertexColors: this.shading.hasVertexColors(),
      isPointCloud
    }
  }

  hasModel(): boolean {
    return !!this.current
  }

  /** glTF 材质变体（KHR_materials_variants） */
  async selectVariant(name: string | null): Promise<void> {
    if (!this.loaded?.selectVariant || !this.current) return
    await this.loaded.selectVariant(name)
    // 换了材质引用，显示模式与剖切都要重新套一遍
    this.shading.attach(this.current)
    this.shading.apply(this.prefs.mode, this.prefs.flat)
    this.shading.setWireOverlay(this.prefs.wireOverlay)
    this.applyClipping()
    this.materialList = []
    this.shadowDirty = true
    this.invalidate(3)
  }

  private rememberPointSizes(): void {
    this.current?.traverse((o) => {
      const p = o as THREE.Points
      if (!p.isPoints) return
      const m = p.material as THREE.PointsMaterial
      if (m && typeof m.size === 'number' && m.userData.baseSize === undefined) m.userData.baseSize = m.size
    })
  }

  private applyPointSize(factor: number): void {
    this.current?.traverse((o) => {
      const p = o as THREE.Points
      if (!p.isPoints) return
      const m = p.material as THREE.PointsMaterial
      if (m && typeof m.userData.baseSize === 'number') m.size = m.userData.baseSize * factor
    })
  }

  /** 把相机摆到能看全模型的位置，并按模型尺度调整网格/坐标轴/阴影 */
  private frame(): void {
    if (!this.current) return
    const { center, radius, box } = frameObject(this.current, this.persp)
    this.center.copy(center)
    this.radius = radius
    this.bbox.copy(box)
    this.bottomY = box.isEmpty() ? center.y - radius : box.min.y

    this.controls.target.copy(center)
    this.controls.minDistance = radius * 0.05
    this.controls.maxDistance = radius * 40
    this.syncOrthoFromPersp()
    this.controls.update()

    this.grid.scale.setScalar((radius * 4) / 10)
    this.grid.position.set(center.x, this.bottomY, center.z)
    this.axes.scale.setScalar(radius)
    this.axes.position.copy(center)
    this.box.box.copy(box)
    this.measure.setScale(radius)
    this.updateShadowRig()
    if (this.gtao) this.tuneGtao()
  }

  resetView(): void {
    if (!this.current) return
    const { center, radius } = frameObject(this.current, this.persp)
    this.controls.target.copy(center)
    this.controls.minDistance = radius * 0.05
    this.controls.maxDistance = radius * 40
    this.syncOrthoFromPersp()
    this.controls.update()
    this.invalidate()
  }

  setView(preset: ViewPreset): void {
    if (!this.current) return
    if (preset === 'iso') {
      this.resetView()
      return
    }
    const dirs: Record<Exclude<ViewPreset, 'iso'>, [number, number, number]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [-1, 0, 0],
      right: [1, 0, 0],
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001]
    }
    const d = new THREE.Vector3(...dirs[preset]).normalize()
    const fov = THREE.MathUtils.degToRad(this.persp.fov)
    const dist = (this.radius / Math.sin(fov / 2)) * 1.15
    this.persp.position.copy(this.center).addScaledVector(d, dist)
    this.persp.near = Math.max(dist - this.radius * 4, this.radius / 1000)
    this.persp.far = dist + this.radius * 8
    this.persp.updateProjectionMatrix()
    this.persp.lookAt(this.center)
    this.controls.target.copy(this.center)
    this.syncOrthoFromPersp()
    this.controls.update()
    this.invalidate()
  }

  /* ------------------------------ 相机同步（对比模式） ------------------------------ */

  getViewState(): ViewState {
    const cam = this.persp
    const target = this.controls.target
    const dir = new THREE.Vector3().subVectors(cam.position, target)
    const dist = dir.length() || this.radius * 3
    dir.normalize()
    const off = new THREE.Vector3().subVectors(target, this.center).divideScalar(this.radius || 1)
    return {
      dir: [dir.x, dir.y, dir.z],
      distRatio: dist / (this.radius || 1),
      targetOffset: [off.x, off.y, off.z],
      up: [cam.up.x, cam.up.y, cam.up.z],
      zoom: this.ortho.zoom
    }
  }

  setViewState(s: ViewState): void {
    if (!this.current) return
    this.suppressViewEvents = true
    const target = new THREE.Vector3(...s.targetOffset).multiplyScalar(this.radius).add(this.center)
    const dist = s.distRatio * this.radius
    this.persp.position.copy(target).addScaledVector(new THREE.Vector3(...s.dir), dist)
    this.persp.up.set(...s.up)
    this.persp.near = Math.max(dist - this.radius * 4, this.radius / 1000)
    this.persp.far = dist + this.radius * 8
    this.persp.updateProjectionMatrix()
    this.persp.lookAt(target)
    this.controls.target.copy(target)
    this.syncOrthoFromPersp()
    this.ortho.zoom = s.zoom
    this.ortho.updateProjectionMatrix()
    this.controls.update()
    this.suppressViewEvents = false
    this.invalidate()
  }

  /* ------------------------------ 相机 ------------------------------ */

  private updateOrthoFrustum(): void {
    const w = this.host.clientWidth || 1
    const h = this.host.clientHeight || 1
    const aspect = w / h
    const dist = this.persp.position.distanceTo(this.controls.target) || this.radius * 3
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2)
    this.ortho.left = -halfH * aspect
    this.ortho.right = halfH * aspect
    this.ortho.top = halfH
    this.ortho.bottom = -halfH
    this.ortho.near = this.persp.near
    this.ortho.far = this.persp.far
    this.ortho.updateProjectionMatrix()
  }

  private syncOrthoFromPersp(): void {
    this.ortho.position.copy(this.persp.position)
    this.ortho.quaternion.copy(this.persp.quaternion)
    this.ortho.zoom = 1
    this.updateOrthoFrustum()
  }

  private setOrtho(on: boolean): void {
    if (on && this.camera !== this.ortho) {
      this.syncOrthoFromPersp()
      this.camera = this.ortho
    } else if (!on && this.camera !== this.persp) {
      // 把正交的缩放折算回透视距离
      const dir = new THREE.Vector3().subVectors(this.ortho.position, this.controls.target).normalize()
      const halfH = this.ortho.top / this.ortho.zoom
      const dist = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2)
      this.persp.position.copy(this.controls.target).addScaledVector(dir, dist)
      this.persp.lookAt(this.controls.target)
      this.camera = this.persp
    }
    this.controls.object = this.camera
    this.controls.update()
    if (this.renderPass) this.renderPass.camera = this.camera
    if (this.gtao) this.gtao.camera = this.camera
  }

  /* ------------------------------ 环境 / 光照 ------------------------------ */

  private async getEnv(id: string): Promise<EnvCacheEntry> {
    const cached = this.envCache.get(id)
    if (cached) return cached
    let entry: EnvCacheEntry
    if (id === 'room') {
      const env = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      entry = { env, equirect: null }
    } else {
      const h = this.hdris.find((x) => x.id === id)
      // 列表还没从主进程回来时先静默用程序化房间，列表到了会再应用一次
      if (!h && this.hdris.length === 0) throw new HdriNotReady()
      if (!h) throw new Error('找不到这张 HDRI（文件可能已被删除）')
      const isExr = /\.exr$/i.test(h.url)
      const tex = isExr ? await new EXRLoader().loadAsync(h.url) : await new RGBELoader().loadAsync(h.url)
      tex.mapping = THREE.EquirectangularReflectionMapping
      const env = this.pmrem.fromEquirectangular(tex).texture
      entry = { env, equirect: tex }
    }
    this.envCache.set(id, entry)
    return entry
  }

  private envToken = 0
  private async applyEnvironment(p: ViewerPrefs): Promise<void> {
    const token = ++this.envToken
    let entry: EnvCacheEntry
    try {
      entry = await this.getEnv(p.envId)
    } catch (e) {
      if (!(e instanceof HdriNotReady)) {
        this.onWarn?.(`环境贴图加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
      entry = await this.getEnv('room')
    }
    if (token !== this.envToken || this.disposed) return
    this.scene.environment = entry.env
    this.scene.environmentIntensity = p.envIntensity
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(p.envRotation), 0)
    this.applyBackground(p, entry)
    this.invalidate()
  }

  private applyBackground(p: ViewerPrefs, entry?: EnvCacheEntry): void {
    const e = entry ?? this.envCache.get(p.envId)
    let lum = 0.5
    if (p.envVisible && e?.equirect) {
      this.scene.background = e.equirect
      this.scene.backgroundBlurriness = p.envBlur
      this.scene.backgroundIntensity = p.envIntensity
      this.scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(p.envRotation), 0)
    } else {
      const c = BACKGROUNDS.find((b) => b.key === p.bg)?.color ?? 0xe9eef8
      this.scene.background = new THREE.Color(c)
      const col = new THREE.Color(c)
      lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b
    }
    // 阴影是往背景上叠黑：深色背景上 0.3 的黑几乎看不见，得加重；浅色背景上反之
    this.shadowOpacity = lum < 0.2 ? 0.75 : lum < 0.6 ? 0.5 : 0.3
    if (this.ground) (this.ground.material as THREE.ShadowMaterial).opacity = this.shadowOpacity
    // 网格线在浅色和深色背景上要不同的颜色才看得见
    const gridMat = this.grid.material as THREE.LineBasicMaterial
    gridMat.color.set(lum > 0.5 ? 0x9aa4b8 : 0x3a4050)
    gridMat.opacity = lum > 0.5 ? 0.5 : 0.7
  }

  private applyLighting(preset: LightingPreset | 'none'): void {
    for (const l of this.lights) this.lightRig.remove(l)
    this.lights = preset === 'none' ? [] : addLights(this.lightRig as unknown as THREE.Scene, preset)
    for (const l of this.lights) {
      l.userData.baseIntensity = l.intensity
      l.intensity = l.userData.baseIntensity * this.prefs.lightIntensity
    }
    this.updateShadowRig()
  }

  private applyLightRig(p: ViewerPrefs): void {
    this.lightRig.rotation.y = THREE.MathUtils.degToRad(p.lightRotation)
    for (const l of this.lights) {
      if (typeof l.userData.baseIntensity === 'number') l.intensity = l.userData.baseIntensity * p.lightIntensity
    }
    this.shadowDirty = true
  }

  /**
   * 地面阴影用一盏独立的光，从左后上方打下来。
   * 不能借用预设里的主光：影棚主光的方向和默认相机几乎重合，
   * 阴影正好落在模型背后，开了跟没开一样。
   */
  private updateShadowRig(): void {
    const on = this.prefs.shadow && !!this.current
    if (on && !this.shadowLight) {
      const l = new THREE.DirectionalLight(0xffffff, 0.7)
      l.name = '__shadow_light'
      this.shadowLight = l
    }
    if (this.shadowLight) {
      if (on && !this.shadowLight.parent) {
        this.scene.add(this.shadowLight)
        this.scene.add(this.shadowLight.target)
      } else if (!on && this.shadowLight.parent) {
        this.scene.remove(this.shadowLight)
        this.scene.remove(this.shadowLight.target)
      }
    }
    if (this.renderer.shadowMap.enabled !== on) {
      this.renderer.shadowMap.enabled = on
      // 运行时切换 shadowMap.enabled 不会让已编译的材质重新编译，
      // 不手动标记的话阴影永远出不来（three.js 的经典坑）
      this.markMaterialsDirty()
    }
    if (this.ground) this.ground.visible = on
    if (!this.shadowLight) return
    const l = this.shadowLight
    l.castShadow = on
    if (!on) return
    const r = this.radius
    l.shadow.mapSize.set(2048, 2048)
    l.shadow.bias = -0.0008
    l.shadow.normalBias = r * 0.01
    // 左后上方，距离随模型尺度走
    const dir = new THREE.Vector3(-0.6, 1.4, -0.35).normalize()
    l.position.copy(this.center).addScaledVector(dir, r * 4)
    l.target.position.copy(this.center)
    l.target.updateMatrixWorld()
    const cam = l.shadow.camera
    cam.left = -r * 1.6
    cam.right = r * 1.6
    cam.top = r * 1.6
    cam.bottom = -r * 1.6
    cam.near = r * 0.5
    cam.far = r * 8
    cam.updateProjectionMatrix()
    l.shadow.needsUpdate = true

    if (!this.ground) {
      this.ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: this.shadowOpacity, transparent: true })
      )
      this.ground.rotation.x = -Math.PI / 2
      this.ground.receiveShadow = true
      this.ground.name = '__ground'
      this.scene.add(this.ground)
    }
    this.ground.scale.setScalar(r * 10)
    this.ground.position.set(this.center.x, this.bottomY - r * 0.002, this.center.z)
    this.shadowDirty = true
  }

  private markMaterialsDirty(): void {
    this.scene.traverse((o) => {
      const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (!mat) return
      for (const m of Array.isArray(mat) ? mat : [mat]) m.needsUpdate = true
    })
  }

  /* ------------------------------ 后处理 ------------------------------ */

  private ensureComposer(): void {
    if (this.composer) return
    const w = this.host.clientWidth || 1
    const h = this.host.clientHeight || 1
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    this.gtao = new GTAOPass(this.scene, this.camera, w, h)
    this.gtao.output = GTAOPass.OUTPUT.Default
    this.gtao.blendIntensity = 1
    this.composer.addPass(this.gtao)
    this.composer.addPass(new OutputPass())
    this.tuneGtao()
  }

  private tuneGtao(): void {
    if (!this.gtao) return
    this.gtao.updateGtaoMaterial({
      radius: Math.max(this.radius * 0.12, 1e-3),
      distanceExponent: 1,
      thickness: 1,
      scale: 1,
      samples: 8,
      distanceFallOff: 1,
      screenSpaceRadius: false
    })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, radiusExponent: 1, rings: 2, samples: 8 })
  }

  /* ------------------------------ 剖切 / 辅助显示 ------------------------------ */

  private applyClipping(): void {
    const p = this.prefs
    const planes: THREE.Plane[] = []
    if (p.clipEnabled && this.current && !this.bbox.isEmpty()) {
      const axis = p.clipAxis
      const min = this.bbox.min[axis]
      const max = this.bbox.max[axis]
      const pos = min + (max - min) * THREE.MathUtils.clamp(p.clipPos, 0, 1)
      const n = new THREE.Vector3()
      n[axis] = p.clipFlip ? 1 : -1
      // 平面方程 n·x + c = 0；n·x + c < 0 的一侧被裁掉
      this.clipPlane.normal.copy(n)
      this.clipPlane.constant = p.clipFlip ? -pos : pos
      planes.push(this.clipPlane)
    }
    const list = this.shading.activeMaterials()
    for (const m of list) {
      m.clippingPlanes = planes
      m.clipShadows = planes.length > 0
    }
  }

  private clearHelpers(): void {
    if (this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper)
      this.skeletonHelper.dispose()
      this.skeletonHelper = null
    }
    for (const h of this.normalHelpers) {
      this.scene.remove(h)
      h.dispose()
    }
    this.normalHelpers = []
  }

  private applyHelpers(p: ViewerPrefs): void {
    if (!this.current) return
    if (p.skeleton && !this.skeletonHelper) {
      let hasBones = false
      let alreadyDrawn = false
      this.current.traverse((o) => {
        if ((o as THREE.Bone).isBone) hasBones = true
        if ((o as THREE.SkeletonHelper).isSkeletonHelper) alreadyDrawn = true
      })
      // BVH 加载时自带骨架线，不用再画一层
      if (hasBones && !alreadyDrawn) {
        this.skeletonHelper = new THREE.SkeletonHelper(this.current)
        ;(this.skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false
        this.skeletonHelper.renderOrder = 998
        this.scene.add(this.skeletonHelper)
      }
    } else if (!p.skeleton && this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper)
      this.skeletonHelper.dispose()
      this.skeletonHelper = null
    }

    if (p.normals && this.normalHelpers.length === 0) {
      let verts = 0
      const meshes: THREE.Mesh[] = []
      this.current.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && m.geometry?.getAttribute('normal')) {
          verts += m.geometry.getAttribute('position').count
          meshes.push(m)
        }
      })
      if (verts > NORMALS_MAX_VERTS) {
        this.onWarn?.(`顶点太多（${verts.toLocaleString('zh-CN')}），法线显示已跳过`)
      } else {
        for (const m of meshes) {
          const h = new VertexNormalsHelper(m, this.radius * 0.02, 0x2bd6a3)
          h.name = '__normals'
          this.scene.add(h)
          this.normalHelpers.push(h)
        }
      }
    } else if (!p.normals && this.normalHelpers.length > 0) {
      for (const h of this.normalHelpers) {
        this.scene.remove(h)
        h.dispose()
      }
      this.normalHelpers = []
    }
  }

  /* ------------------------------ 设置应用 ------------------------------ */

  applyPrefs(p: ViewerPrefs, hdris: HdriEntry[], force = false): void {
    const prev = this.prefs
    this.prefs = { ...p }
    this.hdris = hdris

    if (force || prev.lighting !== p.lighting) {
      this.applyLighting(p.lighting)
      this.shadowDirty = true
    }
    if (force || prev.lightRotation !== p.lightRotation || prev.lightIntensity !== p.lightIntensity) this.applyLightRig(p)
    if (
      force ||
      prev.envId !== p.envId ||
      prev.envIntensity !== p.envIntensity ||
      prev.envRotation !== p.envRotation ||
      prev.envVisible !== p.envVisible ||
      prev.envBlur !== p.envBlur ||
      prev.bg !== p.bg
    ) {
      void this.applyEnvironment(p)
    }
    if (force || prev.exposure !== p.exposure) this.renderer.toneMappingExposure = p.exposure
    if (force || prev.toneMapping !== p.toneMapping) {
      this.renderer.toneMapping = TONE_MAP[p.toneMapping] ?? THREE.ACESFilmicToneMapping
      this.markMaterialsDirty()
    }
    const shadingChanged = force || prev.mode !== p.mode || prev.flat !== p.flat
    if (shadingChanged) this.shading.apply(p.mode, p.flat)
    if (force || prev.wireOverlay !== p.wireOverlay) {
      const r = this.shading.setWireOverlay(p.wireOverlay)
      if (r === -1) this.onWarn?.('模型面数太多，线框叠加已跳过（可以用「线框」模式）')
    }
    if (
      shadingChanged ||
      prev.wireOverlay !== p.wireOverlay ||
      prev.clipEnabled !== p.clipEnabled ||
      prev.clipAxis !== p.clipAxis ||
      prev.clipPos !== p.clipPos ||
      prev.clipFlip !== p.clipFlip
    ) {
      this.applyClipping()
    }
    if (force || prev.shadow !== p.shadow) this.updateShadowRig()
    if (p.ao) this.ensureComposer()
    this.applyPixelRatio()
    this.grid.visible = p.grid
    this.axes.visible = p.axes
    this.box.visible = p.bbox && !!this.current
    if (force || prev.ortho !== p.ortho) this.setOrtho(p.ortho)
    if (force || prev.fov !== p.fov) {
      this.persp.fov = p.fov
      this.persp.updateProjectionMatrix()
      this.updateOrthoFrustum()
    }
    this.controls.autoRotate = p.autoRotate
    this.controls.autoRotateSpeed = 2
    if (this.mixer) this.mixer.timeScale = p.animSpeed
    if (this.action && prev.animLoop !== p.animLoop) {
      this.action.setLoop(p.animLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      this.action.clampWhenFinished = !p.animLoop
    }
    if (force || prev.pointSize !== p.pointSize) this.applyPointSize(p.pointSize)
    this.applyHelpers(p)
    this.measure.setVisible(p.measure)
    if (!p.measure && prev.measure) this.measure.clear()
    this.renderer.domElement.style.cursor = p.measure ? 'crosshair' : ''
    if (!p.statsHud) this.frameTimes = []
    this.shadowDirty = this.shadowDirty || shadingChanged || prev.wireOverlay !== p.wireOverlay
    this.invalidate(3)
  }

  clearMeasure(): void {
    this.measure.clear()
    this.invalidate()
  }

  /* ------------------------------ 动画 ------------------------------ */

  setClip(i: number, play = true): void {
    if (!this.mixer || !this.clips[i]) return
    this.mixer.stopAllAction()
    const action = this.mixer.clipAction(this.clips[i])
    action.reset()
    action.setLoop(this.prefs.animLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !this.prefs.animLoop
    action.play()
    action.paused = !play
    this.action = action
    this.shadowDirty = true
    this.invalidate()
  }

  clipDuration(i: number): number {
    return this.clips[i]?.duration ?? 0
  }

  setPlaying(on: boolean): void {
    if (!this.action) return
    if (on && this.action.time >= this.action.getClip().duration - 1e-4 && !this.prefs.animLoop) {
      this.action.reset()
      this.action.play()
    }
    this.action.paused = !on
    this.invalidate()
  }

  seek(t: number): void {
    if (!this.action || !this.mixer) return
    this.action.time = t
    this.mixer.update(0)
    this.shadowDirty = true
    this.invalidate()
  }

  /* ------------------------------ 结构 / 材质 ------------------------------ */

  hierarchy(limit = 3000): NodeInfo[] {
    const out: NodeInfo[] = []
    if (!this.current) return out
    const walk = (o: THREE.Object3D, depth: number): void => {
      if (out.length >= limit) return
      if (o.name.startsWith('__')) return
      const m = o as THREE.Mesh
      const g = m.isMesh ? m.geometry : null
      const tris = g ? Math.round(g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3) : 0
      out.push({
        uuid: o.uuid,
        name: o.name || (m.isMesh ? '(未命名网格)' : `(${o.type})`),
        type: o.type,
        depth,
        isMesh: !!m.isMesh,
        tris,
        visible: o.visible
      })
      for (const c of o.children) walk(c, depth + 1)
    }
    walk(this.current, 0)
    return out
  }

  setNodeVisible(uuid: string, visible: boolean): void {
    const o = this.current?.getObjectByProperty('uuid', uuid)
    if (o) o.visible = visible
    this.shadowDirty = true
    this.invalidate()
  }

  /** 只显示某个节点（及其子树）；传 null 还原 */
  solo(uuid: string | null): void {
    if (!this.current) return
    for (const o of this.hiddenBySolo) o.visible = true
    this.hiddenBySolo = []
    this.soloed = uuid
    if (!uuid) return
    const target = this.current.getObjectByProperty('uuid', uuid)
    if (!target) return
    const keep = new Set<THREE.Object3D>()
    target.traverse((o) => keep.add(o))
    let p: THREE.Object3D | null = target.parent
    while (p) {
      keep.add(p)
      p = p.parent
    }
    this.current.traverse((o) => {
      if (!keep.has(o) && o.visible) {
        o.visible = false
        this.hiddenBySolo.push(o)
      }
    })
    this.shadowDirty = true
    this.invalidate()
  }

  soloedUuid(): string | null {
    return this.soloed
  }

  materials(): MaterialInfo[] {
    const out = new Map<THREE.Material, MaterialInfo>()
    if (!this.current) return []
    this.materialList = []
    this.current.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || o.name.startsWith('__')) return
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        if (!mat) continue
        let info = out.get(mat)
        if (!info) {
          const anyM = mat as unknown as Record<string, unknown>
          const color = (anyM['color'] as THREE.Color | undefined)?.isColor
            ? `#${(anyM['color'] as THREE.Color).getHexString()}`
            : null
          const maps: MapInfo[] = []
          for (const slot of MAP_SLOTS) {
            const t = anyM[slot] as THREE.Texture | undefined
            if (t && t.isTexture) {
              const img = t.image as { width?: number; height?: number } | undefined
              maps.push({ slot, size: img?.width ? `${img.width}×${img.height}` : '?', index: maps.length })
            }
          }
          info = {
            index: this.materialList.length,
            name: mat.name || '(未命名)',
            type: mat.type,
            color,
            maps,
            transparent: mat.transparent,
            meshes: 0
          }
          out.set(mat, info)
          this.materialList.push(mat)
        }
        info.meshes++
      }
    })
    return [...out.values()]
  }

  /** 把某张贴图画成可显示的图片，供贴图检查器用 */
  textureInfo(materialIndex: number, slot: string): TextureInfo | null {
    const mat = this.materialList[materialIndex] as unknown as Record<string, unknown> | undefined
    const tex = mat?.[slot] as THREE.Texture | undefined
    if (!tex || !tex.isTexture) return null
    const img = tex.image as
      | (HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas | { data?: ArrayLike<number>; width: number; height: number; src?: string })
      | undefined
    const width = (img as { width?: number } | undefined)?.width ?? 0
    const height = (img as { height?: number } | undefined)?.height ?? 0
    let dataUrl: string | null = null
    let note: string | null = null
    try {
      const MAX = 1024
      const scale = Math.min(1, MAX / Math.max(width, height, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')!
      const anyImg = img as { data?: ArrayLike<number> } | undefined
      if ((tex as THREE.CompressedTexture).isCompressedTexture) {
        note = '压缩贴图（DDS / KTX2）无法在这里解码显示'
      } else if (anyImg && anyImg.data && width && height) {
        // DataTexture（TGA / HDR / 生成的贴图）：按 RGBA 8 位画
        const d = anyImg.data
        const rgba = new Uint8ClampedArray(width * height * 4)
        const stride = d.length / (width * height)
        const isFloat = !(d instanceof Uint8Array || d instanceof Uint8ClampedArray)
        for (let i = 0; i < width * height; i++) {
          for (let c = 0; c < 4; c++) {
            const v = c < stride ? Number(d[i * stride + c]) : c === 3 ? 255 : 0
            rgba[i * 4 + c] = isFloat ? Math.max(0, Math.min(255, v * 255)) : v
          }
          if (stride < 4) rgba[i * 4 + 3] = 255
        }
        const tmp = document.createElement('canvas')
        tmp.width = width
        tmp.height = height
        tmp.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
        // DataTexture 默认 flipY=false，原点在左下，画的时候翻回来
        if (!tex.flipY) {
          ctx.translate(0, canvas.height)
          ctx.scale(1, -1)
        }
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height)
        dataUrl = canvas.toDataURL('image/png')
      } else if (img && width && height) {
        ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height)
        dataUrl = canvas.toDataURL('image/png')
      } else {
        note = '贴图还没有加载完成'
      }
    } catch (e) {
      note = `无法显示：${e instanceof Error ? e.message : String(e)}`
    }
    const src = (tex.source?.data as { src?: string } | undefined)?.src ?? (img as { src?: string } | undefined)?.src ?? null
    let file: string | null = null
    let path: string | null = null
    if (src && src.startsWith('asset3d://local/')) {
      const rest = src.slice('asset3d://local/'.length).split('?')[0].split('#')[0]
      const segs = rest.split('/').map((s) => {
        try {
          return decodeURIComponent(s)
        } catch {
          return s
        }
      })
      file = segs[segs.length - 1] ?? null
      path = segs[0] === 'UNC' ? '\\\\' + segs.slice(1).join('\\') : segs.join('\\')
    } else if (src && src.startsWith('blob:')) {
      file = '（内嵌在模型文件里）'
    } else if (src && src.startsWith('data:')) {
      file = '（内嵌 base64）'
    }
    const cs = tex.colorSpace === THREE.SRGBColorSpace ? 'sRGB' : tex.colorSpace === THREE.LinearSRGBColorSpace ? 'Linear' : '未标注'
    const wrapName = (w: THREE.Wrapping): string =>
      w === THREE.RepeatWrapping ? '重复' : w === THREE.MirroredRepeatWrapping ? '镜像重复' : '拉伸'
    return {
      slot,
      width,
      height,
      colorSpace: cs,
      wrap: `${wrapName(tex.wrapS)} / ${wrapName(tex.wrapT)}`,
      dataUrl,
      file,
      path,
      note
    }
  }

  /* ------------------------------ 截图 ------------------------------ */

  private withHelpersHidden<T>(fn: () => T): T {
    const vis = [this.grid.visible, this.axes.visible, this.box.visible, this.measure.group.visible]
    const helpers = [this.skeletonHelper, ...this.normalHelpers].filter(Boolean) as THREE.Object3D[]
    const helperVis = helpers.map((h) => h.visible)
    this.grid.visible = false
    this.axes.visible = false
    this.box.visible = false
    this.measure.group.visible = false
    for (const h of helpers) h.visible = false
    try {
      return fn()
    } finally {
      ;[this.grid.visible, this.axes.visible, this.box.visible, this.measure.group.visible] = vis
      helpers.forEach((h, i) => (h.visible = helperVis[i]))
    }
  }

  screenshot(opts: { transparent?: boolean; scale?: number } = {}): string {
    const scale = opts.scale ?? 1
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const prevBg = this.scene.background
    const prevPixelRatio = this.renderer.getPixelRatio()
    if (opts.transparent) this.scene.background = null
    this.renderer.setPixelRatio(prevPixelRatio * scale)
    this.renderer.setSize(w, h, false)
    // 透明截图不走后处理（后处理会把 alpha 抹掉）
    if (this.prefs.ao && this.composer && !opts.transparent) {
      this.composer.setSize(w * prevPixelRatio * scale, h * prevPixelRatio * scale)
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
    const url = this.renderer.domElement.toDataURL('image/png')
    this.scene.background = prevBg
    this.renderer.setPixelRatio(prevPixelRatio)
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.invalidate()
    return url
  }

  /**
   * 正方形出图（设为缩略图用）：不画网格 / 坐标轴 / 测量，按给定背景色或透明。
   * 相机保持当前视角，只是改画幅比例。
   */
  captureSquare(px: number, background: number | null): string {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const prevBg = this.scene.background
    const prevPixelRatio = this.renderer.getPixelRatio()
    const prevAspect = this.persp.aspect
    return this.withHelpersHidden(() => {
      this.scene.background = background === null ? null : new THREE.Color(background)
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(px, px, false)
      this.persp.aspect = 1
      this.persp.updateProjectionMatrix()
      if (this.camera === this.ortho) {
        const halfH = this.ortho.top
        this.ortho.left = -halfH
        this.ortho.right = halfH
        this.ortho.updateProjectionMatrix()
      }
      this.renderer.render(this.scene, this.camera)
      const url = this.renderer.domElement.toDataURL('image/png')
      this.scene.background = prevBg
      this.renderer.setPixelRatio(prevPixelRatio)
      this.renderer.setSize(w, h, false)
      this.persp.aspect = prevAspect
      this.persp.updateProjectionMatrix()
      this.updateOrthoFrustum()
      this.composer?.setSize(w, h)
      this.invalidate()
      return url
    })
  }

  /** 转盘序列：绕目标点水平转一圈，均匀截 n 帧 */
  turntableFrames(n: number, opts: { transparent?: boolean; scale?: number } = {}): string[] {
    if (!this.current) return []
    const target = this.controls.target.clone()
    const start = this.persp.position.clone()
    const startOrtho = this.ortho.position.clone()
    const startQ = this.persp.quaternion.clone()
    const frames: string[] = []
    const offset = new THREE.Vector3().subVectors(start, target)
    const axis = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < n; i++) {
      const rotated = offset.clone().applyAxisAngle(axis, (i / n) * Math.PI * 2)
      this.persp.position.copy(target).add(rotated)
      this.persp.lookAt(target)
      this.ortho.position.copy(this.persp.position)
      this.ortho.quaternion.copy(this.persp.quaternion)
      frames.push(this.screenshot(opts))
    }
    this.persp.position.copy(start)
    this.persp.quaternion.copy(startQ)
    this.ortho.position.copy(startOrtho)
    this.ortho.quaternion.copy(startQ)
    this.invalidate()
    return frames
  }
}
