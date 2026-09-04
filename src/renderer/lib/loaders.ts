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
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export interface LoadedModel {
  object: THREE.Object3D
  animations: THREE.AnimationClip[]
}

let dracoLoader: DRACOLoader | null = null
let ktx2Loader: KTX2Loader | null = null

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

/** STL / PLY 只给几何体，得自己套一个材质才能看 */
function meshFromGeometry(geo: THREE.BufferGeometry): THREE.Mesh {
  geo.computeVertexNormals()
  const hasColor = !!geo.getAttribute('color')
  const mat = new THREE.MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0xb8bcc4,
    vertexColors: hasColor,
    metalness: 0.1,
    roughness: 0.65,
    side: THREE.DoubleSide
  })
  return new THREE.Mesh(geo, mat)
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
 * 整个模型渲染成纯黑（控制台会报 "Texture marked for update but no image data found"）。
 *
 * 本机这套 FBX 正是如此：贴图数据完全正确，缩略图却全黑。
 * 用 manager 而不是轮询贴图，是因为加载失败时它同样会结束计数，
 * 不会让一个坏贴图把整批出图卡到超时。
 */
function createTracker(): Tracker {
  const manager = new THREE.LoadingManager()
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
  }
  manager.onProgress = (_url, itemsLoaded, itemsTotal): void => {
    loaded = itemsLoaded
    total = itemsTotal
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
async function waitForTextures(
  root: THREE.Object3D,
  tracker: Tracker
): Promise<void> {
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

export async function loadModel(
  url: string,
  ext: string,
  renderer: THREE.WebGLRenderer
): Promise<LoadedModel> {
  const tracker = createTracker()
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
      const obj = await new FBXLoader(manager).loadAsync(url)
      return { object: obj, animations: obj.animations ?? [] }
    }

    case '.obj': {
      const loader = new OBJLoader(manager)
      // 先把 .obj 里的 mtllib 抠出来，有材质库就先加载，否则模型是灰的
      try {
        const text = await textFrom(url)
        const m = /^\s*mtllib\s+(.+)\s*$/im.exec(text)
        if (m) {
          const mtlName = m[1].trim()
          const mtl = await new MTLLoader(manager)
            .setPath(baseOf(url))
            .loadAsync(mtlName)
          mtl.preload()
          loader.setMaterials(mtl)
        }
      } catch {
        /* 没有或加载不了 mtl 就用默认材质 */
      }
      const obj = await loader.loadAsync(url)
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

    case '.dae': {
      const c = await new ColladaLoader(manager).loadAsync(url)
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

    case '.wrl': {
      const obj = await new VRMLLoader(manager).loadAsync(url)
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
