import * as THREE from 'three'
import { disposeObject, loadModel } from './lib/loaders'
import {
  addLights,
  computeStats,
  createEnvironment,
  frameObject,
  normalizeMaterials,
  relaxBackfaceCulling
} from './lib/framing'
import type { WorkerApi } from '../preload'
import type { Api } from '../preload'

declare global {
  interface Window {
    api: Api
    workerApi: WorkerApi
  }
}

/**
 * 隐藏窗口里的离屏出图器。
 *
 * 为什么不在 Node 主进程里渲染：那需要 headless-gl 这类原生模块，
 * 编译麻烦且会把绿色包拖成一坨。放在隐藏 BrowserWindow 里
 * 直接用真实 WebGL，而且跑的是和详情查看器一模一样的代码路径，
 * 缩略图和放大后看到的效果天然一致。
 */

const canvas = document.createElement('canvas')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  // toBlob/toDataURL 要读回像素，必须保留绘制缓冲
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance'
})
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const envMap = createEnvironment(renderer)

const scene = new THREE.Scene()
scene.environment = envMap
scene.background = null
addLights(scene, 'studio')

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)

function canvasToPng(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob 返回空'))
      blob
        .arrayBuffer()
        .then((b) => resolve(new Uint8Array(b)))
        .catch(reject)
    }, 'image/png')
  })
}

/** 排查材质问题用：把每个材质的关键字段和贴图状态导出来 */
function collectDiag(root: THREE.Object3D): unknown[] {
  const out: unknown[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry
    const attrs = g ? Object.keys(g.attributes) : []
    const uv = g?.getAttribute('uv')
    let uvRange: string | null = null
    if (uv) {
      let mnU = Infinity
      let mxU = -Infinity
      let mnV = Infinity
      let mxV = -Infinity
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i)
        const v = uv.getY(i)
        if (u < mnU) mnU = u
        if (u > mxU) mxU = u
        if (v < mnV) mnV = v
        if (v > mxV) mxV = v
      }
      uvRange = `u[${mnU.toFixed(3)},${mxU.toFixed(3)}] v[${mnV.toFixed(3)},${mxV.toFixed(3)}]`
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const mm = m as THREE.MeshPhongMaterial & { map?: THREE.Texture }
      const img = mm.map?.image as { width?: number; src?: string } | undefined
      out.push({
        mesh: o.name,
        attrs,
        uvRange,
        mat: mm.name,
        type: mm.type,
        color: mm.color?.getHexString?.(),
        emissive: mm.emissive?.getHexString?.(),
        specular: (mm as THREE.MeshPhongMaterial).specular?.getHexString?.(),
        opacity: mm.opacity,
        transparent: mm.transparent,
        vertexColors: mm.vertexColors,
        hasMap: !!mm.map,
        mapLoaded: !!img?.width,
        mapSize: img?.width ? `${img.width}` : null,
        mapColorSpace: mm.map?.colorSpace,
        mapFlipY: mm.map?.flipY,
        mapImageType: mm.map?.image
          ? (mm.map.image as object).constructor?.name
          : null,
        mapWrap: mm.map ? `${mm.map.wrapS}/${mm.map.wrapT}` : null
      })
    }
  })
  return out
}

let busy = false

window.workerApi.onRender(async (job) => {
  if (busy) {
    window.workerApi.result({ jobId: job.jobId, ok: false, error: 'worker 忙' })
    return
  }
  busy = true

  let loaded: Awaited<ReturnType<typeof loadModel>> | null = null
  try {
    renderer.setSize(job.px, job.px, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()

    loaded = await loadModel(job.url, job.ext, renderer)

    // 诊断用：只把贴图原色画出来，不带任何光照，
    // 用来区分「贴图/UV 采样错了」还是「材质光照算错了」
    normalizeMaterials(loaded.object)
    relaxBackfaceCulling(loaded.object)
    scene.add(loaded.object)

    frameObject(loaded.object, camera)

    // 显式渲染一帧。隐藏窗口里 requestAnimationFrame 会被节流甚至不触发，
    // 所以整条链路都不能依赖 rAF。
    renderer.render(scene, camera)

    const png = await canvasToPng()
    // 模型已经在内存里了，顺手统计一份，省得筛选时再解析一遍文件
    window.workerApi.result({
      jobId: job.jobId,
      ok: true,
      png,
      stats: computeStats(loaded.object, loaded.animations),
      diag: job.diag ? collectDiag(loaded.object) : undefined
    })
  } catch (e) {
    window.workerApi.result({
      jobId: job.jobId,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    })
  } finally {
    if (loaded) {
      scene.remove(loaded.object)
      disposeObject(loaded.object)
    }
    // 每张图之后把 three.js 内部缓存也清掉，否则显存只增不减
    renderer.renderLists.dispose()
    busy = false
  }
})

window.workerApi.ready()
