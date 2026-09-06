import * as THREE from 'three'

/**
 * 查看器的显示模式。
 *
 * 材质替换的原则：永远不改动模型自带的材质对象，只在 mesh 上换引用，
 * 切回「材质」模式时把原引用放回去。这样任何模式切换都是无损的。
 */
export type BaseMode = 'material' | 'clay' | 'normals' | 'matcap' | 'uv' | 'wire' | 'xray'
export type ChannelMode = 'albedo' | 'roughness' | 'metalness' | 'normalmap' | 'ao' | 'emissive' | 'vertexcolor'
export type ShadingMode = BaseMode | ChannelMode

export const SHADING_MODES: { key: BaseMode; label: string; hint: string }[] = [
  { key: 'material', label: '材质', hint: '模型自带的材质与贴图（PBR）' },
  { key: 'clay', label: '白膜', hint: '统一的浅灰无贴图材质，看结构和布线' },
  { key: 'matcap', label: '雕塑', hint: 'Matcap 材质，类似 ZBrush 的观感' },
  { key: 'normals', label: '法线', hint: '用法线方向着色，检查法线与平滑组' },
  { key: 'uv', label: 'UV 棋盘', hint: '棋盘格贴图，检查 UV 拉伸与密度' },
  { key: 'wire', label: '线框', hint: '只画边线' },
  { key: 'xray', label: '透视', hint: '半透明叠加，看内部结构' }
]

/** 贴图通道检查：不受光照影响，直接把某一张贴图（或某个通道）画在模型上 */
export const CHANNEL_MODES: { key: ChannelMode; label: string; hint: string }[] = [
  { key: 'albedo', label: '基础色', hint: '只看 Base Color / 漫反射贴图，不受光照影响' },
  { key: 'roughness', label: '粗糙度', hint: '粗糙度贴图（glTF 取 G 通道），越白越粗糙' },
  { key: 'metalness', label: '金属度', hint: '金属度贴图（glTF 取 B 通道），越白越金属' },
  { key: 'normalmap', label: '法线贴图', hint: '直接显示法线贴图的颜色' },
  { key: 'ao', label: 'AO 贴图', hint: '环境光遮蔽贴图（R 通道），没有就是全白' },
  { key: 'emissive', label: '自发光', hint: '自发光贴图 × 自发光颜色' },
  { key: 'vertexcolor', label: '顶点色', hint: '几何体自带的顶点颜色，没有就显示灰色' }
]

export function isChannelMode(m: ShadingMode): m is ChannelMode {
  return CHANNEL_MODES.some((c) => c.key === m)
}

type MatOrArr = THREE.Material | THREE.Material[]

interface Holder {
  material: MatOrArr
  geometry?: THREE.BufferGeometry
}

/** 程序化 Matcap：一个球面上的柔光 + 高光，不用往包里塞图片 */
export function makeMatcapTexture(size = 256): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const base = ctx.createRadialGradient(c * 0.7, c * 0.65, c * 0.05, c, c, c)
  base.addColorStop(0, '#f4f4f6')
  base.addColorStop(0.45, '#b9bcc4')
  base.addColorStop(0.85, '#5a5e68')
  base.addColorStop(1, '#2a2d34')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // 顶部一圈冷色反光
  const rim = ctx.createRadialGradient(c, c, c * 0.8, c, c, c)
  rim.addColorStop(0, 'rgba(120,160,220,0)')
  rim.addColorStop(1, 'rgba(120,160,220,0.35)')
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, size, size)
  // 高光点
  const hl = ctx.createRadialGradient(c * 0.62, c * 0.55, 0, c * 0.62, c * 0.55, c * 0.28)
  hl.addColorStop(0, 'rgba(255,255,255,0.9)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** UV 棋盘格：8×8 双色 + 细分格线 */
export function makeCheckerTexture(size = 512): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const n = 8
  const cell = size / n
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#3b6fd6' : '#e6e9ef'
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  for (let i = 0; i <= n * 4; i++) {
    const p = (i * size) / (n * 4)
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 线框叠加的三角面上限，再多 WireframeGeometry 会吃掉几百 MB 内存 */
const WIRE_OVERLAY_MAX_TRIS = 1_500_000

/* ------------------------------ 通道着色器 ------------------------------ */

const CHANNEL_VERT = /* glsl */ `
uniform mat3 uvTransform;
uniform float useUv1;
attribute vec2 uv1;
varying vec2 vUv;
void main() {
  vec2 base = useUv1 > 0.5 ? uv1 : uv;
  vUv = (uvTransform * vec3(base, 1.0)).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * 数据类贴图（粗糙度 / 金属度 / 法线 / AO）要按原始数值显示：
 * 先把原值当 sRGB 反解成线性，经输出编码后正好还原成原值。
 * 颜色类贴图（基础色 / 自发光）采样得到的已是线性值，直接走输出编码。
 */
const CHANNEL_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float hasMap;
uniform int channel;
uniform vec3 fallback;
uniform vec3 tint;
uniform float isColor;
varying vec2 vUv;
vec3 srgbToLinear3(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec3 c = fallback;
  if (hasMap > 0.5) {
    vec4 t = texture2D(map, vUv);
    if (channel == 0) c = t.rgb;
    else if (channel == 1) c = vec3(t.r);
    else if (channel == 2) c = vec3(t.g);
    else if (channel == 3) c = vec3(t.b);
    else c = vec3(t.a);
  }
  c *= tint;
  if (isColor < 0.5) c = srgbToLinear3(clamp(c, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`

interface ChannelSpec {
  slot: string
  channel: number
  isColor: boolean
  fallback: (m: Record<string, unknown>) => THREE.Color
  tint: (m: Record<string, unknown>) => THREE.Color
}

function scalar(m: Record<string, unknown>, key: string, def: number): number {
  const v = m[key]
  return typeof v === 'number' ? v : def
}

function colorProp(m: Record<string, unknown>, key: string, def: number): THREE.Color {
  const v = m[key] as THREE.Color | undefined
  return v && v.isColor ? v.clone() : new THREE.Color(def)
}

const CHANNEL_SPECS: Record<Exclude<ChannelMode, 'vertexcolor'>, ChannelSpec> = {
  albedo: {
    slot: 'map',
    channel: 0,
    isColor: true,
    fallback: (m) => colorProp(m, 'color', 0xffffff),
    tint: (m) => (m['map'] ? colorProp(m, 'color', 0xffffff) : new THREE.Color(1, 1, 1))
  },
  roughness: {
    slot: 'roughnessMap',
    channel: 2,
    isColor: false,
    fallback: (m) => new THREE.Color().setScalar(scalar(m, 'roughness', 0.5)),
    tint: (m) => new THREE.Color().setScalar(m['roughnessMap'] ? scalar(m, 'roughness', 1) : 1)
  },
  metalness: {
    slot: 'metalnessMap',
    channel: 3,
    isColor: false,
    fallback: (m) => new THREE.Color().setScalar(scalar(m, 'metalness', 0)),
    tint: (m) => new THREE.Color().setScalar(m['metalnessMap'] ? scalar(m, 'metalness', 1) : 1)
  },
  normalmap: {
    slot: 'normalMap',
    channel: 0,
    isColor: false,
    fallback: () => new THREE.Color(0.5, 0.5, 1),
    tint: () => new THREE.Color(1, 1, 1)
  },
  ao: {
    slot: 'aoMap',
    channel: 1,
    isColor: false,
    fallback: () => new THREE.Color(1, 1, 1),
    tint: () => new THREE.Color(1, 1, 1)
  },
  emissive: {
    slot: 'emissiveMap',
    channel: 0,
    isColor: true,
    fallback: (m) => colorProp(m, 'emissive', 0x000000).multiplyScalar(scalar(m, 'emissiveIntensity', 1)),
    tint: (m) =>
      m['emissiveMap']
        ? colorProp(m, 'emissive', 0xffffff).multiplyScalar(scalar(m, 'emissiveIntensity', 1))
        : new THREE.Color(1, 1, 1)
  }
}

export class ShadingController {
  private root: THREE.Object3D | null = null
  private originals = new Map<Holder, MatOrArr>()
  /** 各模式的共享材质，按需创建 */
  private clay: THREE.MeshStandardMaterial | null = null
  private normals: THREE.MeshNormalMaterial | null = null
  private matcap: THREE.MeshMatcapMaterial | null = null
  private uv: THREE.MeshBasicMaterial | null = null
  private xray: THREE.MeshBasicMaterial | null = null
  private vcolor: THREE.MeshBasicMaterial | null = null
  private vcolorNone: THREE.MeshBasicMaterial | null = null
  /** 材质模式 + 平直着色 / 线框模式 / 通道模式需要的克隆体，按原材质缓存 */
  private clones = new Map<string, THREE.Material>()
  private overlays: THREE.LineSegments[] = []
  private overlayMat = new THREE.LineBasicMaterial({
    color: 0x9bd0ff,
    transparent: true,
    opacity: 0.55,
    depthTest: true
  })

  mode: ShadingMode = 'material'
  flat = false

  attach(root: THREE.Object3D): void {
    this.detach()
    this.root = root
    root.traverse((o) => {
      const h = o as unknown as Holder
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && h.material) this.originals.set(h, h.material)
    })
  }

  /** 还原原材质、拆掉线框叠加。不销毁共享材质（下一个模型还要用） */
  detach(): void {
    for (const [h, m] of this.originals) h.material = m
    this.originals.clear()
    this.setWireOverlay(false)
    for (const c of this.clones.values()) c.dispose()
    this.clones.clear()
    this.root = null
  }

  /** 当前生效的所有材质（含原材质 / 克隆 / 共享），剖切平面要逐个设置 */
  activeMaterials(): THREE.Material[] {
    const out = new Set<THREE.Material>()
    for (const h of this.originals.keys()) {
      for (const m of Array.isArray(h.material) ? h.material : [h.material]) if (m) out.add(m)
    }
    out.add(this.overlayMat)
    return [...out]
  }

  private ensureShared(): void {
    if (!this.clay) {
      this.clay = new THREE.MeshStandardMaterial({
        color: 0xd9d9dc,
        roughness: 0.78,
        metalness: 0,
        side: THREE.DoubleSide
      })
    }
    if (!this.normals) this.normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
    if (!this.matcap) {
      this.matcap = new THREE.MeshMatcapMaterial({ matcap: makeMatcapTexture(), side: THREE.DoubleSide })
    }
    if (!this.uv) {
      this.uv = new THREE.MeshBasicMaterial({ map: makeCheckerTexture(), side: THREE.DoubleSide })
    }
    if (!this.xray) {
      this.xray = new THREE.MeshBasicMaterial({
        color: 0x9bbcff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    }
    if (!this.vcolor) this.vcolor = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    if (!this.vcolorNone) this.vcolorNone = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide })
  }

  private cloneFor(src: THREE.Material, kind: 'flat' | 'wire'): THREE.Material {
    const key = `${src.uuid}|${kind}`
    let c = this.clones.get(key)
    if (!c) {
      c = src.clone()
      if (kind === 'flat') {
        const anyM = c as THREE.MeshStandardMaterial
        if ('flatShading' in anyM) anyM.flatShading = true
      } else {
        const anyM = c as THREE.MeshStandardMaterial
        if ('wireframe' in anyM) anyM.wireframe = true
      }
      c.needsUpdate = true
      this.clones.set(key, c)
    }
    return c
  }

  private channelFor(src: THREE.Material, mode: Exclude<ChannelMode, 'vertexcolor'>): THREE.Material {
    const key = `${src.uuid}|${mode}`
    let c = this.clones.get(key)
    if (!c) {
      const spec = CHANNEL_SPECS[mode]
      const m = src as unknown as Record<string, unknown>
      const tex = m[spec.slot] as THREE.Texture | undefined
      const hasMap = !!(tex && tex.isTexture)
      const uvTransform = new THREE.Matrix3()
      if (hasMap) {
        tex!.updateMatrix()
        uvTransform.copy(tex!.matrix)
      }
      c = new THREE.ShaderMaterial({
        vertexShader: CHANNEL_VERT,
        fragmentShader: CHANNEL_FRAG,
        uniforms: {
          map: { value: hasMap ? tex : null },
          hasMap: { value: hasMap ? 1 : 0 },
          channel: { value: spec.channel },
          fallback: { value: spec.fallback(m) },
          tint: { value: spec.tint(m) },
          isColor: { value: spec.isColor ? 1 : 0 },
          uvTransform: { value: uvTransform },
          useUv1: { value: hasMap && tex!.channel === 1 ? 1 : 0 }
        },
        side: THREE.DoubleSide,
        toneMapped: false
      })
      c.name = `__channel_${mode}`
      this.clones.set(key, c)
    }
    return c
  }

  apply(mode: ShadingMode, flat: boolean): void {
    this.mode = mode
    this.flat = flat
    if (!this.root) return
    this.ensureShared()

    // 共享材质的平直/平滑切换
    for (const m of [this.clay!, this.normals!, this.matcap!]) {
      if (m.flatShading !== flat) {
        m.flatShading = flat
        m.needsUpdate = true
      }
    }

    for (const [h, orig] of this.originals) {
      const isPoints = !!(h as unknown as THREE.Points).isPoints
      const mapOne = (m: THREE.Material): THREE.Material => {
        // 点云只有点材质能画，别的模式一律保持原样
        if (isPoints) return m
        switch (mode) {
          case 'clay':
            return this.clay!
          case 'normals':
            return this.normals!
          case 'matcap':
            return this.matcap!
          case 'uv':
            return this.uv!
          case 'xray':
            return this.xray!
          case 'wire':
            return this.cloneFor(m, 'wire')
          case 'vertexcolor':
            return h.geometry?.getAttribute('color') ? this.vcolor! : this.vcolorNone!
          case 'albedo':
          case 'roughness':
          case 'metalness':
          case 'normalmap':
          case 'ao':
          case 'emissive':
            return this.channelFor(m, mode)
          default:
            return flat && 'flatShading' in m ? this.cloneFor(m, 'flat') : m
        }
      }
      h.material = Array.isArray(orig) ? orig.map(mapOne) : mapOne(orig)
    }
  }

  /** 有没有任何网格带顶点色（面板上给个提示） */
  hasVertexColors(): boolean {
    for (const h of this.originals.keys()) if (h.geometry?.getAttribute('color')) return true
    return false
  }

  /**
   * 线框叠加：给每个 mesh 挂一个 WireframeGeometry 子节点。
   * 返回叠加的三角面总数；超过上限则不做，返回 -1。
   */
  setWireOverlay(on: boolean): number {
    for (const l of this.overlays) {
      l.removeFromParent()
      l.geometry.dispose()
    }
    this.overlays = []
    if (!on || !this.root) return 0

    let tris = 0
    const meshes: THREE.Mesh[] = []
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.geometry) return
      const g = m.geometry
      tris += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
      meshes.push(m)
    })
    if (tris > WIRE_OVERLAY_MAX_TRIS) return -1

    for (const m of meshes) {
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), this.overlayMat)
      lines.name = '__wire_overlay'
      // 和面重合会闪烁，稍微往相机方向推一点
      ;(lines.material as THREE.LineBasicMaterial).polygonOffset = true
      ;(lines.material as THREE.LineBasicMaterial).polygonOffsetFactor = -1
      lines.raycast = () => {}
      m.add(lines)
      this.overlays.push(lines)
    }
    return tris
  }

  dispose(): void {
    this.detach()
    this.clay?.dispose()
    this.normals?.dispose()
    if (this.matcap) {
      this.matcap.matcap?.dispose()
      this.matcap.dispose()
    }
    if (this.uv) {
      this.uv.map?.dispose()
      this.uv.dispose()
    }
    this.xray?.dispose()
    this.vcolor?.dispose()
    this.vcolorNone?.dispose()
    this.overlayMat.dispose()
  }
}
