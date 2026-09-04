import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js'
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js'
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js'
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js'
import { VTKLoader } from 'three/examples/jsm/loaders/VTKLoader.js'
import { XYZLoader } from 'three/examples/jsm/loaders/XYZLoader.js'
import { LWOLoader } from 'three/examples/jsm/loaders/LWOLoader.js'
import { VOXLoader, VOXMesh } from 'three/examples/jsm/loaders/VOXLoader.js'
import { KMZLoader } from 'three/examples/jsm/loaders/KMZLoader.js'
import { MD2Loader } from 'three/examples/jsm/loaders/MD2Loader.js'
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js'
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js'
import { GCodeLoader } from 'three/examples/jsm/loaders/GCodeLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { isBinaryFbx, normalizeFbxAsciiIndent } from './fbxText'

export interface LoadedModel {
  object: THREE.Object3D
  animations: THREE.AnimationClip[]
}

let dracoLoader: DRACOLoader | null = null
let ktx2Loader: KTX2Loader | null = null
let rhinoLoader: Rhino3dmLoader | null = null

/**
 * 解码器一律指向本地 asset3d://decoder/…。
 *
 * three.js 官方示例默认把 DRACO/KTX2 解码器指到 CDN，
 * 绿色版离线运行时那会直接失败 —— 这里必须走打包进来的本地副本。
 */
async function ensureDecoders(renderer: THREE.WebGLRenderer): Promise<void> {
  if (!dracoLoader) {
    const base = await window.api.decoderUrl('draco/gltf/')
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(base)
    dracoLoader.preload()
  }
  if (!ktx2Loader) {
    const base = await window.api.decoderUrl('basis/')
    ktx2Loader = new KTX2Loader()
    ktx2Loader.setTranscoderPath(base)
    ktx2Loader.detectSupport(renderer)
  }
}

async function ensureRhino(manager: THREE.LoadingManager): Promise<Rhino3dmLoader> {
  if (!rhinoLoader) {
    const base = await window.api.decoderUrl('rhino3dm/')
    rhinoLoader = new Rhino3dmLoader(manager)
    rhinoLoader.setLibraryPath(base)
  }
  return rhinoLoader
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.arrayBuffer()
}

function textFrom(url: string): Promise<string> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  })
}

function baseOf(url: string): string {
  const i = url.lastIndexOf('/')
  return i < 0 ? './' : url.slice(0, i + 1)
}

/** STL / PLY / VTK 只给几何体，得自己套一个材质才能看 */
function meshFromGeometry(geo: THREE.BufferGeometry): THREE.Object3D {
  const hasColor = !!geo.getAttribute('color')
  const pos = geo.getAttribute('position')
  // 没有索引也没有法线的点云（扫描仪导出的 PLY 很常见）包成 Mesh 什么都画不出来，
  // 缩略图一片空白还被当成功缓存。这种要按点渲染。
  const faceless = !geo.index && pos && pos.count > 0 && !geo.getAttribute('normal') && isPointCloud(geo)
  if (faceless) return pointsFromGeometry(geo)

  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0xb8bcc4,
    vertexColors: hasColor,
    metalness: 0.1,
    roughness: 0.65,
    side: THREE.DoubleSide
  })
  return new THREE.Mesh(geo, mat)
}

/** 判断无索引几何体是不是点云：顶点数不是 3 的倍数，或者带 PLY 点云特有的属性 */
function isPointCloud(geo: THREE.BufferGeometry): boolean {
  const pos = geo.getAttribute('position')
  if (!pos) return false
  if (pos.count % 3 !== 0) return true
  // PLYLoader 遇到没有 face 的文件也会返回 position-only 的几何体；
  // 三角面几何体顶点数一定是 3 的倍数，但反过来不成立，这里再看一眼是否有 uv
  return !geo.getAttribute('uv') && pos.count > 30000
}

function pointsFromGeometry(geo: THREE.BufferGeometry): THREE.Points {
  const hasColor = !!geo.getAttribute('color')
  geo.computeBoundingSphere()
  const radius = geo.boundingSphere?.radius ?? 1
  const mat = new THREE.PointsMaterial({
    color: hasColor ? 0xffffff : 0xb8c4d6,
    vertexColors: hasColor,
    size: Math.max(radius / 200, 1e-4),
    sizeAttenuation: true
  })
  return new THREE.Points(geo, mat)
}

/** 收集一棵树上所有材质引用到的贴图 */
function collectTextures(root: THREE.Object3D): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>()
  root.traverse((o) => {
    const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] })
      .material
    if (!mat) return
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) {
        if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture)
      }
    }
  })
  return out
}

interface Tracker {
  manager: THREE.LoadingManager
  /** 所有经由该 manager 发起的加载都结束（成功或失败）后 resolve */
  settled: () => Promise<void>
}

/**
 * 带完成信号的 LoadingManager。
 *
 * 之所以需要它：GLTFLoader 会等所有贴图 Promise 落地才 resolve，
 * 但 FBXLoader / ColladaLoader / MTLLoader 是 TextureLoader.load()
 * 发出去就不管了 —— loadAsync 返回时贴图往往还没开始解码，
 * 此时 texture.image 还是 undefined。直接渲染的话 WebGL 拿到一张空贴图，
 * 整个模型渲染成纯黑。
 *
 * 用 manager 而不是轮询贴图，是因为加载失败时它同样会结束计数，
 * 不会让一个坏贴图把整批出图卡到超时。
 *
 * 顺带在这里注册 TGA / DDS 解码器：FBX/OBJ 素材包里 .tga 贴图极其常见，
 * 浏览器原生解不了，FBXLoader / MTLLoader / ColladaLoader 都会先问
 * manager.getHandler 有没有对应的加载器。
 */
function createTracker(onProgress?: (loaded: number, total: number) => void): Tracker {
  const manager = new THREE.LoadingManager()
  manager.addHandler(/\.tga$/i, new TGALoader(manager))
  manager.addHandler(/\.dds$/i, new DDSLoader(manager))
  // 文件名里的 # 和 ? 会被当成 URL 的 hash/query 截掉；相对引用是加载器
  // 原样拼接的，这里统一编码。我们自己生成的 URL 已经编码过，不会重复。
  manager.setURLModifier((url) =>
    url.startsWith('asset3d://') ? url.replace(/#/g, '%23').replace(/\?/g, '%3F') : url
  )

  let idle = true
  let waiters: (() => void)[] = []
  let loaded = 0
  let total = 0

  const finish = (): void => {
    idle = true
    const ws = waiters
    waiters = []
    for (const w of ws) w()
  }

  manager.onStart = (_url, itemsLoaded, itemsTotal): void => {
    idle = false
    loaded = itemsLoaded
    total = itemsTotal
    onProgress?.(loaded, total)
  }
  manager.onProgress = (_url, itemsLoaded, itemsTotal): void => {
    loaded = itemsLoaded
    total = itemsTotal
    onProgress?.(loaded, total)
  }
  manager.onLoad = finish
  // 出错时 three.js 仍会调 itemEnd，onLoad 正常会触发；
  // 这里兜一层，防止个别加载器漏掉 itemEnd 让我们永远等下去
  manager.onError = (): void => {
    if (loaded >= total) finish()
  }

  return {
    manager,
    settled: () =>
      new Promise<void>((resolve) => {
        if (idle) return resolve()
        waiters.push(resolve)
      })
  }
}

const TEXTURE_TIMEOUT_MS = 20000

/** 等贴图真正就位，再补一次 needsUpdate 保证重新上传 GPU */
async function waitForTextures(root: THREE.Object3D, tracker: Tracker): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    tracker.settled(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TEXTURE_TIMEOUT_MS)
    })
  ])
  if (timer) clearTimeout(timer)

  // 贴图可能已被当成空图上传过一次，强制重新上传
  for (const tex of collectTextures(root)) {
    if (tex.image) tex.needsUpdate = true
  }
}

export interface LoadOptions {
  onProgress?: (loaded: number, total: number) => void
}

export async function loadModel(
  url: string,
  ext: string,
  renderer: THREE.WebGLRenderer,
  opts: LoadOptions = {}
): Promise<LoadedModel> {
  const tracker = createTracker(opts.onProgress)
  const model = await loadRaw(url, ext, renderer, tracker.manager)
  await waitForTextures(model.object, tracker)
  return model
}

async function loadRaw(
  url: string,
  ext: string,
  renderer: THREE.WebGLRenderer,
  manager: THREE.LoadingManager
): Promise<LoadedModel> {
  switch (ext) {
    case '.glb':
    case '.gltf':
    case '.vrm': {
      await ensureDecoders(renderer)
      const loader = new GLTFLoader(manager)
      loader.setDRACOLoader(dracoLoader!)
      loader.setKTX2Loader(ktx2Loader!)
      loader.setMeshoptDecoder(MeshoptDecoder)
      // 相对的 Barrel.bin / textures/ColorAtlas.png 由 three.js 自己
      // 按 url base 拼接，走 asset3d:// 协议读盘
      const gltf = await loader.loadAsync(url)
      return { object: gltf.scene, animations: gltf.animations ?? [] }
    }

    case '.fbx': {
      // 自己取字节再 parse：ASCII 格式先把缩进规整一遍（见 fbxText.ts）
      const buf = await fetchBuffer(url)
      const loader = new FBXLoader(manager)
      const base = baseOf(url)
      loader.setPath(base)
      let input = buf
      if (!isBinaryFbx(buf)) {
        const text = new TextDecoder('utf-8').decode(buf)
        input = new TextEncoder().encode(normalizeFbxAsciiIndent(text)).buffer as ArrayBuffer
      }
      const obj = loader.parse(input, base)
      return { object: obj, animations: obj.animations ?? [] }
    }

    case '.obj': {
      const loader = new OBJLoader(manager)
      // 只读一次文本：先把 mtllib 抠出来加载材质库，再直接 parse，
      // 不让 OBJLoader 再下载一遍（大 OBJ 动辄几百 MB）
      const text = await textFrom(url)
      const m = /^\s*mtllib\s+(.+?)\s*$/im.exec(text)
      if (m) {
        try {
          const mtl = await new MTLLoader(manager).setPath(baseOf(url)).loadAsync(m[1].trim())
          mtl.preload()
          loader.setMaterials(mtl)
        } catch {
          /* 没有或加载不了 mtl 就用默认材质 */
        }
      }
      const obj = loader.parse(text)
      return { object: obj, animations: [] }
    }

    case '.stl': {
      const geo = await new STLLoader(manager).loadAsync(url)
      return { object: meshFromGeometry(geo), animations: [] }
    }

    case '.ply': {
      const geo = await new PLYLoader(manager).loadAsync(url)
      return { object: meshFromGeometry(geo), animations: [] }
    }

    case '.vtk':
    case '.vtp': {
      const geo = await new VTKLoader(manager).loadAsync(url)
      return { object: meshFromGeometry(geo), animations: [] }
    }

    case '.drc': {
      await ensureDecoders(renderer)
      const geo = await dracoLoader!.loadAsync(url)
      return { object: meshFromGeometry(geo), animations: [] }
    }

    case '.xyz': {
      const geo = await new XYZLoader(manager).loadAsync(url)
      return { object: pointsFromGeometry(geo), animations: [] }
    }

    case '.pcd': {
      const pts = await new PCDLoader(manager).loadAsync(url)
      const mat = pts.material as THREE.PointsMaterial
      pts.geometry.computeBoundingSphere()
      mat.size = Math.max((pts.geometry.boundingSphere?.radius ?? 1) / 200, 1e-4)
      mat.sizeAttenuation = true
      return { object: pts, animations: [] }
    }

    case '.dae': {
      const c = await new ColladaLoader(manager).loadAsync(url)
      return { object: c.scene, animations: c.scene.animations ?? [] }
    }

    case '.kmz': {
      const c = await new KMZLoader(manager).loadAsync(url)
      return { object: c.scene, animations: c.scene.animations ?? [] }
    }

    case '.3ds': {
      const obj = await new TDSLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.3mf': {
      const obj = await new ThreeMFLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.amf': {
      const obj = await new AMFLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.wrl': {
      const obj = await new VRMLLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.usdz': {
      const obj = await new USDZLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.lwo': {
      const r = await new LWOLoader(manager).loadAsync(url)
      const group = new THREE.Group()
      for (const m of r.meshes ?? []) group.add(m)
      return { object: group, animations: [] }
    }

    case '.vox': {
      const chunks = await new VOXLoader(manager).loadAsync(url)
      const group = new THREE.Group()
      for (const chunk of chunks) group.add(new VOXMesh(chunk))
      return { object: group, animations: [] }
    }

    case '.md2': {
      const geo = await new MD2Loader(manager).loadAsync(url)
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.7, side: THREE.DoubleSide })
      )
      return {
        object: mesh,
        animations: (geo as unknown as { animations?: THREE.AnimationClip[] }).animations ?? []
      }
    }

    case '.pmx':
    case '.pmd': {
      const mesh = await new MMDLoader(manager).loadAsync(url)
      return { object: mesh, animations: [] }
    }

    case '.3dm': {
      const loader = await ensureRhino(manager)
      const obj = await loader.loadAsync(url)
      return { object: obj, animations: [] }
    }

    case '.gcode': {
      const obj = await new GCodeLoader(manager).loadAsync(url)
      return { object: obj, animations: [] }
    }

    default:
      throw new Error(`不支持的格式: ${ext}`)
  }
}

/**
 * 彻底释放一棵模型树占的 GPU 资源。
 *
 * 不做这件事的话，worker 连续渲染几百个模型必然显存爆掉 ——
 * three.js 不会自动回收 geometry/material/texture。
 */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()

  root.traverse((o) => {
    const any = o as THREE.Mesh
    if (any.geometry) geometries.add(any.geometry)
    const mat = (any as unknown as { material?: THREE.Material | THREE.Material[] })
      .material
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) materials.add(m)
    }
  })

  for (const m of materials) {
    for (const v of Object.values(m as unknown as Record<string, unknown>)) {
      if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture)
    }
  }

  for (const t of textures) t.dispose()
  for (const m of materials) m.dispose()
  for (const g of geometries) g.dispose()

  root.removeFromParent()
}
