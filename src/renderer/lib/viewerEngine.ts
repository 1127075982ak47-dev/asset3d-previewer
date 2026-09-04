import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { disposeObject, loadModel } from './loaders'
import {
  addLights,
  computeStats,
  frameObject,
  normalizeMaterials,
  relaxBackfaceCulling,
  type LightingPreset
} from './framing'
import { ShadingController, type ShadingMode } from './shading'
import type { HdriEntry, ModelStats } from '../../shared/types'

export type BgKey = 'dark' | 'mid' | 'light' | 'black' | 'white'
export const BACKGROUNDS: { key: BgKey; label: string; color: number }[] = [
  { key: 'dark', label: '深灰', color: 0x14161a },
  { key: 'mid', label: '中灰', color: 0x606060 },
  { key: 'light', label: '浅灰', color: 0xd8dade },
  { key: 'black', label: '纯黑', color: 0x000000 },
  { key: 'white', label: '纯白', color: 0xffffff }
]

export type ViewPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

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
  ortho: boolean
  fov: number
  autoRotate: boolean
  animSpeed: number
  animLoop: boolean
  panelOpen: boolean
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
  bg: 'dark',
  envId: 'room',
  envIntensity: 1,
  envRotation: 0,
  envVisible: false,
  envBlur: 0,
  lighting: 'studio',
  ortho: false,
  fov: 45,
  autoRotate: false,
  animSpeed: 1,
  animLoop: true,
  panelOpen: true
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

export interface MaterialInfo {
  name: string
  type: string
  color: string | null
  maps: { slot: string; size: string }[]
  transparent: boolean
  meshes: number
}

export interface LoadedInfo {
  stats: ModelStats
  clips: string[]
}

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
  'matcap'
]

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
  private lights: THREE.Light[] = []
  private shadowLight: THREE.DirectionalLight | null = null
  private ground: THREE.Mesh | null = null
  private grid: THREE.GridHelper
  private axes: THREE.AxesHelper
  private box: THREE.Box3Helper
  private shading = new ShadingController()
  private envCache = new Map<string, EnvCacheEntry>()
  private pmrem: THREE.PMREMGenerator
  private current: THREE.Object3D | null = null
  private center = new THREE.Vector3()
  private radius = 1
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
  private soloed: string | null = null
  private hiddenBySolo: THREE.Object3D[] = []
  private disposed = false

  onFrame: ((time: number, duration: number) => void) | null = null
  onWarn: ((msg: string) => void) | null = null

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = false
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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

    this.grid = new THREE.GridHelper(10, 20, 0x3a4050, 0x262b33)
    this.scene.add(this.grid)
    this.axes = new THREE.AxesHelper(1)
    this.axes.visible = false
    this.scene.add(this.axes)
    this.box = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x4c9aff))
    this.box.visible = false
    this.scene.add(this.box)

    this.scene.background = new THREE.Color(0x14161a)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.tick()
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
  }

  private tick = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = this.clock.getDelta()
    if (this.mixer) {
      this.mixer.update(dt)
      if (this.action && this.onFrame) {
        const clip = this.action.getClip()
        this.onFrame(this.action.time, clip.duration)
      }
    }
    this.controls.update()
    this.render()
  }

  private render(): void {
    if (this.prefs.ao && this.composer && this.current) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.unload()
    this.shading.dispose()
    this.controls.dispose()
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

  /* ------------------------------ 模型 ------------------------------ */

  private unload(): void {
    this.shading.detach()
    if (this.current) {
      this.scene.remove(this.current)
      disposeObject(this.current)
      this.current = null
    }
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    this.action = null
    this.clips = []
    this.soloed = null
    this.hiddenBySolo = []
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
    this.shading.attach(loaded.object)

    this.frame()
    this.applyPrefs(this.prefs, this.hdris, true)

    if (loaded.animations.length > 0) {
      this.clips = loaded.animations
      this.mixer = new THREE.AnimationMixer(loaded.object)
      this.mixer.timeScale = this.prefs.animSpeed
      this.setClip(0, true)
    }

    return {
      stats: computeStats(loaded.object, loaded.animations),
      clips: loaded.animations.map((a, i) => a.name || `动画 ${i + 1}`)
    }
  }

  hasModel(): boolean {
    return !!this.current
  }

  /** 把相机摆到能看全模型的位置，并按模型尺度调整网格/坐标轴/阴影 */
  private frame(): void {
    if (!this.current) return
    const { center, radius } = frameObject(this.current, this.persp)
    this.center.copy(center)
    this.radius = radius
    const bbox = new THREE.Box3().setFromObject(this.current)
    this.bottomY = bbox.isEmpty() ? center.y - radius : bbox.min.y

    this.controls.target.copy(center)
    this.controls.minDistance = radius * 0.05
    this.controls.maxDistance = radius * 40
    this.syncOrthoFromPersp()
    this.controls.update()

    this.grid.scale.setScalar((radius * 4) / 10)
    this.grid.position.set(center.x, this.bottomY, center.z)
    this.axes.scale.setScalar(radius)
    this.axes.position.copy(center)
    this.box.box.copy(bbox)
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
      if (!h) throw new Error('找不到这张 HDRI')
      const isExr = /\.exr$/i.test(h.url)
      const tex = isExr
        ? await new EXRLoader().loadAsync(h.url)
        : await new RGBELoader().loadAsync(h.url)
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
      this.onWarn?.(`环境贴图加载失败: ${e instanceof Error ? e.message : String(e)}`)
      entry = await this.getEnv('room')
    }
    if (token !== this.envToken || this.disposed) return
    this.scene.environment = entry.env
    this.scene.environmentIntensity = p.envIntensity
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(p.envRotation), 0)
    this.applyBackground(p, entry)
  }

  private applyBackground(p: ViewerPrefs, entry?: EnvCacheEntry): void {
    const e = entry ?? this.envCache.get(p.envId)
    if (p.envVisible && e?.equirect) {
      this.scene.background = e.equirect
      this.scene.backgroundBlurriness = p.envBlur
      this.scene.backgroundIntensity = p.envIntensity
      this.scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(p.envRotation), 0)
    } else {
      const c = BACKGROUNDS.find((b) => b.key === p.bg)?.color ?? 0x14161a
      this.scene.background = new THREE.Color(c)
    }
  }

  private applyLighting(preset: LightingPreset | 'none'): void {
    for (const l of this.lights) this.scene.remove(l)
    this.lights = preset === 'none' ? [] : addLights(this.scene, preset)
    this.shadowLight = (this.lights.find((l) => (l as THREE.DirectionalLight).isDirectionalLight) as
      | THREE.DirectionalLight
      | undefined) ?? null
    this.updateShadowRig()
  }

  private updateShadowRig(): void {
    const on = this.prefs.shadow && !!this.current
    this.renderer.shadowMap.enabled = on
    if (this.ground) this.ground.visible = on
    if (!this.shadowLight) return
    const l = this.shadowLight
    l.castShadow = on
    if (!on) return
    const r = this.radius
    l.shadow.mapSize.set(2048, 2048)
    l.shadow.bias = -0.0008
    l.shadow.normalBias = r * 0.01
    // 光的方向保持预设里的相对方向，但距离要随模型尺度走
    const dir = l.position.clone().normalize()
    l.position.copy(this.center).addScaledVector(dir, r * 4)
    l.target.position.copy(this.center)
    if (!l.target.parent) this.scene.add(l.target)
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
        new THREE.ShadowMaterial({ opacity: 0.32, transparent: true })
      )
      this.ground.rotation.x = -Math.PI / 2
      this.ground.receiveShadow = true
      this.ground.name = '__ground'
      this.scene.add(this.ground)
    }
    this.ground.scale.setScalar(r * 10)
    this.ground.position.set(this.center.x, this.bottomY - r * 0.002, this.center.z)
    this.renderer.shadowMap.needsUpdate = true
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
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false
    })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 })
  }

  /* ------------------------------ 设置应用 ------------------------------ */

  applyPrefs(p: ViewerPrefs, hdris: HdriEntry[], force = false): void {
    const prev = this.prefs
    this.prefs = { ...p }
    this.hdris = hdris

    if (force || prev.lighting !== p.lighting) this.applyLighting(p.lighting)
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
    if (force || prev.mode !== p.mode || prev.flat !== p.flat) this.shading.apply(p.mode, p.flat)
    if (force || prev.wireOverlay !== p.wireOverlay) {
      const r = this.shading.setWireOverlay(p.wireOverlay)
      if (r === -1) this.onWarn?.('模型面数太多，线框叠加已跳过（可以用「线框」模式）')
    }
    if (force || prev.shadow !== p.shadow) this.updateShadowRig()
    if (p.ao) this.ensureComposer()
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
  }

  setPlaying(on: boolean): void {
    if (!this.action) return
    if (on && this.action.time >= this.action.getClip().duration - 1e-4 && !this.prefs.animLoop) {
      this.action.reset()
      this.action.play()
    }
    this.action.paused = !on
  }

  seek(t: number): void {
    if (!this.action || !this.mixer) return
    this.action.time = t
    this.mixer.update(0)
  }

  /* ------------------------------ 结构 / 材质 ------------------------------ */

  hierarchy(limit = 3000): NodeInfo[] {
    const out: NodeInfo[] = []
    if (!this.current) return out
    const walk = (o: THREE.Object3D, depth: number): void => {
      if (out.length >= limit) return
      if (o.name === '__wire_overlay') return
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
  }

  soloedUuid(): string | null {
    return this.soloed
  }

  materials(): MaterialInfo[] {
    const out = new Map<THREE.Material, MaterialInfo>()
    if (!this.current) return []
    this.current.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || o.name === '__wire_overlay') return
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        if (!mat) continue
        let info = out.get(mat)
        if (!info) {
          const anyM = mat as unknown as Record<string, unknown>
          const color = (anyM['color'] as THREE.Color | undefined)?.isColor
            ? `#${(anyM['color'] as THREE.Color).getHexString()}`
            : null
          const maps: { slot: string; size: string }[] = []
          for (const slot of MAP_SLOTS) {
            const t = anyM[slot] as THREE.Texture | undefined
            if (t && t.isTexture) {
              const img = t.image as { width?: number; height?: number } | undefined
              maps.push({ slot, size: img?.width ? `${img.width}×${img.height}` : '?' })
            }
          }
          info = { name: mat.name || '(未命名)', type: mat.type, color, maps, transparent: mat.transparent, meshes: 0 }
          out.set(mat, info)
        }
        info.meshes++
      }
    })
    return [...out.values()]
  }

  /* ------------------------------ 截图 ------------------------------ */

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
    return url
  }
}
