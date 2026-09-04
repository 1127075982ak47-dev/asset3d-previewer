import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
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
import type { WorkerApi, WorkerJob } from '../preload'
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

// 上下文丢失（显卡驱动重置、显存耗尽）后这个窗口就废了，让主进程重建
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  window.workerApi.contextLost()
})

const envMap = createEnvironment(renderer)

const scene = new THREE.Scene()
scene.environment = envMap
scene.background = null
let lights: THREE.Light[] = addLights(scene, 'studio')
let currentLighting: LightingPreset = 'studio'

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)

const BG_COLORS: Record<string, number | null> = {
  transparent: null,
  dark: 0x14161a,
  light: 0xd8dade,
  white: 0xffffff
}

function applyLighting(preset: LightingPreset): void {
  if (preset === currentLighting) return
  for (const l of lights) scene.remove(l)
  lights = addLights(scene, preset)
  currentLighting = preset
}

function applyBackground(bg: string): number | null {
  const color = BG_COLORS[bg] ?? null
  scene.background = color === null ? null : new THREE.Color(color)
  return color
}

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

/**
 * 出图后检查画面里到底有没有东西。
 *
 * 加载"成功"但什么都没画出来的情况真实存在：材质全坏、几何体退化、
 * 相机没框到。1.0 会把这张空图当成功缓存起来，用户看到一张透明卡片
 * 还以为模型本身是空的。这里抽样统计非背景像素比例，太低就判失败。
 */
function coverage(px: number, bgColor: number | null): number {
  const gl = renderer.getContext()
  const buf = new Uint8Array(px * px * 4)
  gl.readPixels(0, 0, px, px, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  const step = px >= 512 ? 4 : 2
  let hit = 0
  let n = 0
  if (bgColor === null) {
    for (let y = 0; y < px; y += step) {
      for (let x = 0; x < px; x += step) {
        n++
        if (buf[(y * px + x) * 4 + 3] > 16) hit++
      }
    }
  } else {
    const br = (bgColor >> 16) & 255
    const bg = (bgColor >> 8) & 255
    const bb = bgColor & 255
    for (let y = 0; y < px; y += step) {
      for (let x = 0; x < px; x += step) {
        n++
        const i = (y * px + x) * 4
        if (
          Math.abs(buf[i] - br) > 10 ||
          Math.abs(buf[i + 1] - bg) > 10 ||
          Math.abs(buf[i + 2] - bb) > 10
        )
          hit++
      }
    }
  }
  return n === 0 ? 0 : hit / n
}

async function exportGlb(object: THREE.Object3D, animations: THREE.AnimationClip[]): Promise<Uint8Array> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(object, {
    binary: true,
    animations,
    onlyVisible: true,
    includeCustomExtensions: false
  })
  if (result instanceof ArrayBuffer) return new Uint8Array(result)
  // 理论上 binary:true 只会给 ArrayBuffer；兜一手
  return new TextEncoder().encode(JSON.stringify(result))
}

let busy = false

window.workerApi.onRender(async (job: WorkerJob) => {
  if (busy) {
    window.workerApi.result({ jobId: job.jobId, ok: false, error: 'worker 忙' })
    return
  }
  busy = true

  let loaded: Awaited<ReturnType<typeof loadModel>> | null = null
  try {
    loaded = await loadModel(job.url, job.ext, renderer)

    if (job.kind === 'export') {
      // 导出走原始材质：normalizeMaterials 是为了渲染好看，
      // 但转换成文件应该尽量保真
      const glb = await exportGlb(loaded.object, loaded.animations)
      window.workerApi.result({ jobId: job.jobId, ok: true, glb })
      return
    }

    renderer.setSize(job.px, job.px, false)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    applyLighting(job.lighting ?? 'studio')
    const bgColor = applyBackground(job.background ?? 'transparent')

    normalizeMaterials(loaded.object)
    relaxBackfaceCulling(loaded.object)
    scene.add(loaded.object)

    frameObject(loaded.object, camera)

    // 显式渲染一帧。隐藏窗口里 requestAnimationFrame 会被节流甚至不触发，
    // 所以整条链路都不能依赖 rAF。
    renderer.render(scene, camera)

    const cov = coverage(job.px, bgColor)
    if (cov < 0.001) {
      throw new Error('渲染为空：模型加载成功但画面里没有任何可见几何体')
    }

    const png = await canvasToPng()
    // 模型已经在内存里了，顺手统计一份，省得筛选时再解析一遍文件
    window.workerApi.result({
      jobId: job.jobId,
      ok: true,
      png,
      stats: computeStats(loaded.object, loaded.animations)
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
