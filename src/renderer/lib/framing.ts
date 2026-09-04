import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { ModelStats } from '../../shared/types'

/**
 * 用 RoomEnvironment 程序化生成环境贴图 —— PBR 材质有它才有金属/粗糙质感，
 * 而且不用往绿色包里塞几 MB 的 HDR 文件。
 */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return env
}

export type LightingPreset = 'studio' | 'outdoor' | 'neutral'

/**
 * 补光。FBX/OBJ/STL 里大量是非 PBR 的老材质，光靠环境贴图会发灰发平，
 * 加一组主光/补光/轮廓光才能把形体结构打出来。
 */
export function addLights(scene: THREE.Scene, preset: LightingPreset): THREE.Light[] {
  const lights: THREE.Light[] = []
  const mk = (
    color: number,
    intensity: number,
    pos: [number, number, number]
  ): THREE.DirectionalLight => {
    const l = new THREE.DirectionalLight(color, intensity)
    l.position.set(...pos)
    return l
  }

  if (preset === 'outdoor') {
    lights.push(new THREE.HemisphereLight(0xbfd9ff, 0x6b5a44, 1.6))
    lights.push(mk(0xfff2e0, 2.2, [4, 6, 3]))
    lights.push(mk(0xaaccff, 0.6, [-4, 2, -3]))
  } else if (preset === 'neutral') {
    lights.push(new THREE.AmbientLight(0xffffff, 0.9))
    lights.push(mk(0xffffff, 1.4, [3, 5, 4]))
    lights.push(mk(0xffffff, 0.5, [-3, 1, -4]))
  } else {
    // studio：柔和三点光，最百搭，做默认。
    // 强度压得比较低是因为 scene.environment 已经提供了大部分基础照明，
    // 再叠满三点光会把中间调顶到接近纯白，模型看着发灰发飘。
    lights.push(new THREE.AmbientLight(0xffffff, 0.15))
    lights.push(mk(0xffffff, 1.4, [3, 4, 5]))
    lights.push(mk(0xdfe8ff, 0.45, [-5, 2, 2]))
    lights.push(mk(0xffffff, 0.3, [0, 3, -6]))
  }

  for (const l of lights) scene.add(l)
  return lights
}

export interface FrameResult {
  center: THREE.Vector3
  radius: number
}

/**
 * 把相机摆到能完整看到模型的位置。
 *
 * 3/4 视角（方位角 35°、仰角 22°）是缩略图最耐看的角度：
 * 正交正视看不出体积，纯侧面又丢细节。
 */
export function frameObject(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  opts: { azimuth?: number; elevation?: number; margin?: number } = {}
): FrameResult {
  const azimuth = opts.azimuth ?? THREE.MathUtils.degToRad(35)
  const elevation = opts.elevation ?? THREE.MathUtils.degToRad(22)
  const margin = opts.margin ?? 1.15

  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(2, 2, 2)
    camera.lookAt(0, 0, 0)
    return { center: new THREE.Vector3(), radius: 1 }
  }

  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 1e-4)

  const fov = THREE.MathUtils.degToRad(camera.fov)
  // 同时满足垂直和水平方向都装得下，宽画幅时不会被切边
  const vDist = radius / Math.sin(fov / 2)
  const hFov = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect)
  const hDist = radius / Math.sin(hFov / 2)
  const dist = Math.max(vDist, hDist) * margin

  const dir = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  )

  camera.position.copy(center).addScaledVector(dir, dist)
  // 模型尺度可能从 0.01 到 10000（FBX 常以厘米为单位），
  // near/far 必须跟着包围球走，否则不是被裁掉就是 z-fighting
  camera.near = Math.max(dist - radius * 4, radius / 1000)
  camera.far = dist + radius * 8
  camera.updateProjectionMatrix()
  camera.lookAt(center)

  return { center, radius }
}

/** 统计信息，详情面板用 */
export function computeStats(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[]
): ModelStats {
  let vertices = 0
  let triangles = 0
  let meshes = 0
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const countedGeo = new Set<THREE.BufferGeometry>()

  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return
    meshes++

    const geo = mesh.geometry
    if (geo && !countedGeo.has(geo)) {
      countedGeo.add(geo)
      const pos = geo.getAttribute('position')
      if (pos) vertices += pos.count
      if (geo.index) triangles += geo.index.count / 3
      else if (pos) triangles += pos.count / 3
    }

    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] })
      .material
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        materials.add(m)
        for (const v of Object.values(m as unknown as Record<string, unknown>)) {
          if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture)
        }
      }
    }
  })

  const box = new THREE.Box3().setFromObject(object)
  const size = box.isEmpty()
    ? new THREE.Vector3()
    : box.getSize(new THREE.Vector3())

  return {
    vertices,
    triangles: Math.round(triangles),
    meshes,
    materials: materials.size,
    textures: textures.size,
    animations: animations.map((a, i) => a.name || `动画 ${i + 1}`),
    dimensions: [size.x, size.y, size.z]
  }
}

/**
 * 把老式材质（Phong / Lambert）统一换成 MeshStandardMaterial。
 *
 * 为什么必须做：three.js 里只有 PBR 材质吃 scene.environment，
 * MeshPhongMaterial 完全收不到环境光照 —— 同一个模型的 glTF 版
 * 明亮通透，FBX 版却是一团发灰的黑，就是这个原因。
 *
 * 顺带清掉 FBX 导出器常见的脏数据：EmissiveColor 被写成纯白
 * （配套的 EmissiveFactor 是 0，但很多加载器不读 factor），
 * 不清掉换成 PBR 之后整个模型会直接过曝成白色。
 */
export function normalizeMaterials(root: THREE.Object3D): void {
  const converted = new Map<THREE.Material, THREE.MeshStandardMaterial>()

  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh && !(o as THREE.Points).isPoints) return

    const holder = mesh as unknown as {
      material?: THREE.Material | THREE.Material[]
    }
    if (!holder.material) return

    const convert = (m: THREE.Material): THREE.Material => {
      const t = m.type
      if (t !== 'MeshPhongMaterial' && t !== 'MeshLambertMaterial') return m

      const done = converted.get(m)
      if (done) return done

      const src = m as THREE.MeshPhongMaterial
      // FBX 的 TransparencyFactor 语义在各家导出器之间是反的，three.js 照单全收后
      // Quaternius / 部分 Blender 导出的整套模型 opacity 全是 0 —— 模型完全透明，
      // 只剩地面上一片影子。预览里一个完全不可见的材质没有任何意义，一律当不透明。
      const rawOpacity = typeof src.opacity === 'number' ? src.opacity : 1
      const opacity = rawOpacity <= 0.01 ? 1 : rawOpacity
      const transparent = opacity < 1 || !!src.alphaMap
      // Phong 的 shininess 换算成 PBR 粗糙度的经验公式
      const shininess = typeof src.shininess === 'number' ? src.shininess : 30
      const roughness = THREE.MathUtils.clamp(
        Math.sqrt(2 / (shininess + 2)),
        0.08,
        1
      )

      const std = new THREE.MeshStandardMaterial({
        name: src.name,
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        map: src.map ?? null,
        normalMap: src.normalMap ?? null,
        normalScale: src.normalScale ? src.normalScale.clone() : undefined,
        // OBJ 的 map_bump / FBX 的 Bump 贴图不能丢，否则细节全平
        bumpMap: src.bumpMap ?? null,
        bumpScale: typeof src.bumpScale === 'number' ? src.bumpScale : 1,
        aoMap: src.aoMap ?? null,
        aoMapIntensity: typeof src.aoMapIntensity === 'number' ? src.aoMapIntensity : 1,
        lightMap: src.lightMap ?? null,
        lightMapIntensity: typeof src.lightMapIntensity === 'number' ? src.lightMapIntensity : 1,
        displacementMap: src.displacementMap ?? null,
        alphaMap: src.alphaMap ?? null,
        emissiveMap: src.emissiveMap ?? null,
        // 只有真的有自发光贴图时才保留自发光色，否则一律归零
        emissive: src.emissiveMap
          ? (src.emissive?.clone() ?? new THREE.Color(0x000000))
          : new THREE.Color(0x000000),
        metalness: 0,
        roughness,
        transparent,
        opacity,
        alphaTest: src.alphaTest,
        side: src.side,
        flatShading: src.flatShading,
        vertexColors: src.vertexColors,
        depthWrite: src.depthWrite,
        wireframe: src.wireframe
      })

      converted.set(m, std)
      return std
    }

    if (Array.isArray(holder.material)) {
      holder.material = holder.material.map(convert)
    } else {
      holder.material = convert(holder.material)
    }
  })

  // 换下来的旧材质要释放，但它们的贴图被新材质接管了，不能动
  for (const old of converted.keys()) old.dispose()
}

/**
 * 有些导出器（尤其是 FBX）会把材质设成单面，从背面看就是空的；
 * 缩略图里这会表现为“模型缺了一半”，统一放宽成双面更稳妥。
 */
export function relaxBackfaceCulling(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] })
      .material
    if (!mat) return
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (m.side === THREE.FrontSide) m.side = THREE.DoubleSide
    }
  })
}
