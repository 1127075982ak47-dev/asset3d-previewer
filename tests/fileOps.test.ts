import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { companionsOf, moveModels, relocateEntry, renameModel, validateName } from '../src/main/fileOps'
import type { ModelEntry } from '../src/shared/types'

let root: string

function touch(rel: string, content = 'x'): string {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-fileops-'))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('validateName', () => {
  it('拒绝非法字符、保留名与空名', () => {
    expect(validateName('')).not.toBeNull()
    expect(validateName('a/b')).not.toBeNull()
    expect(validateName('con')).not.toBeNull()
    expect(validateName('name.')).not.toBeNull()
    expect(validateName('正常 名字_01')).toBeNull()
  })
})

describe('companionsOf', () => {
  it('fbx 带同名 .fbm 目录', async () => {
    const fbx = touch('a/tree.fbx')
    touch('a/tree.fbm/bark.png')
    const c = await companionsOf(fbx)
    expect(c.map((p) => path.basename(p))).toEqual(['tree.fbm'])
  })

  it('gltf 带 buffers / images，越出目录的不算', async () => {
    const gltf = touch(
      'b/scene.gltf',
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'scene.bin' }, { uri: '../outside.bin' }],
        images: [{ uri: 'textures/atlas.png' }, { uri: 'missing.png' }]
      })
    )
    touch('b/scene.bin')
    touch('b/textures/atlas.png')
    touch('outside.bin')
    const c = (await companionsOf(gltf)).map((p) => path.relative(root, p).replace(/\\/g, '/')).sort()
    expect(c).toEqual(['b/scene.bin', 'b/textures/atlas.png'])
  })

  it('obj 带 mtl 与贴图', async () => {
    const obj = touch('c/box.obj', 'mtllib box.mtl\nv 0 0 0\n')
    touch('c/box.mtl', 'newmtl m\nmap_Kd box.tga\n')
    touch('c/box.tga')
    const c = (await companionsOf(obj)).map((p) => path.basename(p)).sort()
    expect(c).toEqual(['box.mtl', 'box.tga'])
  })
})

describe('renameModel', () => {
  it('改名并带上 .fbm', async () => {
    const fbx = touch('d/old.fbx')
    touch('d/old.fbm/t.png')
    const r = await renameModel(fbx, 'new')
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'd/new.fbx'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'd/new.fbm/t.png'))).toBe(true)
    expect(r.companions?.length).toBe(1)
  })

  it('目标已存在时拒绝', async () => {
    const a = touch('e/a.obj')
    touch('e/b.obj')
    const r = await renameModel(a, 'b')
    expect(r.ok).toBe(false)
    expect(fs.existsSync(a)).toBe(true)
  })

  it('同名不动', async () => {
    const a = touch('f/same.obj')
    const r = await renameModel(a, 'same')
    expect(r.ok).toBe(true)
    expect(r.newPath).toBe(a)
  })
})

describe('moveModels', () => {
  it('移动模型连同伴生文件，保留子目录结构；同名不覆盖', async () => {
    const gltf = touch(
      'g/src/m.gltf',
      JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'm.bin' }], images: [{ uri: 'tex/a.png' }] })
    )
    touch('g/src/m.bin')
    touch('g/src/tex/a.png')
    const clash = touch('g/src/clash.obj')
    touch('g/dst/clash.obj')
    const dest = path.join(root, 'g/dst')
    const r = await moveModels([gltf, clash], dest)
    expect(r.moved.length).toBe(1)
    expect(r.failed.length).toBe(1)
    expect(fs.existsSync(path.join(dest, 'm.gltf'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'm.bin'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'tex/a.png'))).toBe(true)
    expect(fs.existsSync(gltf)).toBe(false)
    expect(fs.existsSync(clash)).toBe(true)
  })
})

describe('relocateEntry', () => {
  it('重算 id / name / ext / rel', () => {
    const e: ModelEntry = {
      id: 'x',
      path: 'C:\\lib\\a\\old.FBX',
      name: 'old',
      ext: '.fbx',
      dir: 'C:\\lib\\a',
      rel: 'a\\old.FBX',
      size: 1,
      mtimeMs: 1,
      needsBlender: false,
      previewable: true
    }
    const n = relocateEntry(e, 'C:\\lib\\b\\new.FBX', 'C:\\lib')
    expect(n.name).toBe('new')
    expect(n.ext).toBe('.fbx')
    expect(n.rel).toBe('b\\new.FBX')
    expect(n.id).not.toBe('x')
    expect(n.dir).toBe('C:\\lib\\b')
  })
})
