import * as THREE from 'three'

/**
 * 查看器的显示模式。
 *
 * 材质替换的原则：永远不改动模型自带的材质对象，只在 mesh 上换引用，
 * 切回「材质」模式时把原引用放回去。这样任何模式切换都是无损的。
 */
export type ShadingMode = 'material' | 'clay' | 'normals' | 'matcap' | 'uv' | 'wire' | 'xray'

export const SHADING_MODES: { key: ShadingMode; label: string; hint: string }[] = [
  { key: 'material', label: '材质', hint: '模型自带的材质与贴图（PBR）' },
  { key: 'clay', label: '白膜', hint: '统一的浅灰无贴图材质，看结构和布线' },
  { key: 'matcap', label: '雕塑', hint: 'Matcap 材质，类似 ZBrush 的观感' },
  { key: 'normals', label: '法线', hint: '用法线方向着色，检查法线与平滑组' },
  { key: 'uv', label: 'UV 棋盘', hint: '棋盘格贴图，检查 UV 拉伸与密度' },
  { key: 'wire', label: '线框', hint: '只画边线' },
  { key: 'xray', label: '透视', hint: '半透明叠加，看内部结构' }
]

type MatOrArr = THREE.Material | THREE.Material[]

interface Holder {
  material: MatOrArr
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

export class ShadingController {
  private root: THREE.Object3D | null = null
  private originals = new Map<Holder, MatOrArr>()
  /** 各模式的共享材质，按需创建 */
  private clay: THREE.MeshStandardMaterial | null = null
  private normals: THREE.MeshNormalMaterial | null = null
  private matcap: THREE.MeshMatcapMaterial | null = null
  private uv: THREE.MeshBasicMaterial | null = null
  private xray: THREE.MeshBasicMaterial | null = null
  /** 材质模式 + 平直着色 / 线框模式需要的克隆体，按原材质缓存 */
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
      if ((o as THREE.Mesh).isMesh && h.material) this.originals.set(h, h.material)
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
      const mapOne = (m: THREE.Material): THREE.Material => {
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
          default:
            return flat && 'flatShading' in m ? this.cloneFor(m, 'flat') : m
        }
      }
      h.material = Array.isArray(orig) ? orig.map(mapOne) : mapOne(orig)
    }
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
    this.overlayMat.dispose()
  }
}
