import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFolder } from '../src/main/scanner'

let root: string

function touch(rel: string, content = 'x'): void {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-scan-'))
  touch('Barrel.gltf')
  touch('Barrel.bin')
  touch('textures/ColorAtlas.png')
  touch('Props/crate.fbx')
  touch('Props/crate.fbx.import')
  touch('Props/old.max')
  touch('Props/notes.txt')
  touch('node_modules/junk.glb')
  touch('.hidden/secret.glb')
  touch('deep/1/2/3/leaf.obj')
  touch('scene.blend')
  touch('scene.blend1')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('scanFolder', () => {
  it('伴生文件与贴图被隐藏，模型成卡', async () => {
    const r = await scanFolder(root, { recursive: true, maxDepth: 8 })
    const names = r.entries.map((e) => e.rel.replace(/\\/g, '/')).sort()
    expect(names).toEqual(['Barrel.gltf', 'Props/crate.fbx', 'Props/old.max', 'deep/1/2/3/leaf.obj', 'scene.blend'])
    // .bin .png .import .blend1 四个被隐藏
    expect(r.hiddenCount).toBe(4)
    expect(r.scannedFiles).toBeGreaterThanOrEqual(8)
  })

  it('不支持的格式标记 previewable=false，可选择不列出', async () => {
    const r = await scanFolder(root, { recursive: true, maxDepth: 8 })
    const max = r.entries.find((e) => e.ext === '.max')!
    expect(max.previewable).toBe(false)
    expect(r.entries.find((e) => e.ext === '.fbx')!.previewable).toBe(true)
    const r2 = await scanFolder(root, { recursive: true, maxDepth: 8, includeUnsupported: false })
    expect(r2.entries.some((e) => e.ext === '.max')).toBe(false)
  })

  it('.blend 标记 needsBlender', async () => {
    const r = await scanFolder(root, { recursive: true, maxDepth: 8 })
    expect(r.entries.find((e) => e.ext === '.blend')!.needsBlender).toBe(true)
  })

  it('跳过 node_modules 和点开头目录', async () => {
    const r = await scanFolder(root, { recursive: true, maxDepth: 8 })
    expect(r.entries.some((e) => e.rel.includes('junk'))).toBe(false)
    expect(r.entries.some((e) => e.rel.includes('secret'))).toBe(false)
  })

  it('深度限制', async () => {
    const r = await scanFolder(root, { recursive: true, maxDepth: 2 })
    expect(r.entries.some((e) => e.name === 'leaf')).toBe(false)
  })

  it('非递归只看根目录', async () => {
    const r = await scanFolder(root, { recursive: false, maxDepth: 8 })
    expect(r.entries.map((e) => e.name).sort()).toEqual(['Barrel', 'scene'])
  })

  it('进度回调与取消', async () => {
    let calls = 0
    const r = await scanFolder(
      root,
      { recursive: true, maxDepth: 8 },
      {
        onProgress: () => calls++,
        isCancelled: () => calls > 0
      }
    )
    expect(calls).toBeGreaterThan(0)
    expect(r.cancelled).toBe(true)
  })

  it('根目录不存在要报错而不是返回空', async () => {
    await expect(scanFolder(path.join(root, 'nope'), { recursive: true, maxDepth: 1 })).rejects.toThrow()
  })
})
