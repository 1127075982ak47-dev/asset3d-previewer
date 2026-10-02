import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readJsonRecover, writeJsonAtomic } from '../src/main/jsonStore'
import { prepareAsset, assetFileChanged } from '../src/main/assetRevision'
import { AccessPolicy, isWithin } from '../src/main/pathPolicy'
import { transferModel } from '../src/main/fileTransfer'
import { thumbKey } from '../src/main/cache'
import { checkDependencies, materialTexture } from '../src/main/dependencies'
import { csvEscape } from '../src/shared/csv'
import { JobQueue } from '../src/main/jobQueue'
import type { ModelEntry } from '../src/shared/types'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-product-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
function file(rel: string, contents: string | Uint8Array): string {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contents); return p
}
function entry(p: string): ModelEntry {
  const s = fs.statSync(p)
  return { id: p, path: p, dir: path.dirname(p), name: path.basename(p, path.extname(p)), ext: path.extname(p), rel: path.relative(root, p), size: s.size, mtimeMs: s.mtimeMs, previewable: true, needsBlender: false }
}

describe('用户数据的可靠保存', () => {
  it('中断损坏的主文件可以从上一份合法备份读取', () => {
    const p = path.join(root, 'store/data.json')
    writeJsonAtomic(p, { tags: ['saved'] }); writeJsonAtomic(p, { tags: ['new'] })
    fs.writeFileSync(p, '{incomplete')
    expect(readJsonRecover(p, () => ({}))).toEqual({ tags: ['saved'] })
    writeJsonAtomic(p, { tags: ['recovered'] })
    expect(JSON.parse(fs.readFileSync(p + '.bak', 'utf8'))).toEqual({ tags: ['saved'] })
  })
  it('无法写入时抛错且不会留下半份 JSON', () => {
    const p = path.join(root, 'store/directory.json'); fs.mkdirSync(p)
    expect(() => writeJsonAtomic(p, { ok: true })).toThrow()
    expect(fs.readdirSync(path.dirname(p)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('依赖和文件转移', () => {
  it('MTL 选项、空格文件名、子目录贴图按实际路径解析', async () => {
    const p = file('mtl/scene.obj', 'mtllib materials/my material.mtl\n')
    file('mtl/materials/my material.mtl', 'map_Kd -s 1 1 1 "textures/base color.png"\nbump -bm 0.3 normal.png\n')
    file('mtl/materials/textures/base color.png', 'image'); file('mtl/materials/normal.png', 'normal')
    expect(materialTexture('map_Kd -o 1 2 3 base color.png')).toBe('base color.png')
    const deps = await checkDependencies(p)
    expect(deps.missing).toEqual([])
    expect(deps.required.map(p => p.replace(/\\/g, '/'))).toContain('materials/textures/base color.png')
  })
  it('目标存在不同内容的同名贴图时，源模型和所有依赖完整保留', async () => {
    const src = file('conflict/src/m.gltf', JSON.stringify({ images: [{ uri: 'tex.png' }] }))
    file('conflict/src/tex.png', 'source'); const target = file('conflict/dst/tex.png', 'different')
    await expect(transferModel(src, path.join(root, 'conflict/dst/m.gltf'), true)).rejects.toThrow('内容不同')
    expect(fs.existsSync(src)).toBe(true); expect(fs.readFileSync(target, 'utf8')).toBe('different')
    expect(fs.existsSync(path.join(root, 'conflict/dst/m.gltf'))).toBe(false)
  })
  it('共享依赖在移动后仍供源目录的另一个模型使用', async () => {
    const contents = JSON.stringify({ buffers: [{ uri: 'shared.bin' }] })
    const src = file('shared/src/a.gltf', contents); const other = file('shared/src/b.gltf', contents)
    const bin = file('shared/src/shared.bin', 'geometry')
    const dest = path.join(root, 'shared/dst/a.gltf')
    await transferModel(src, dest, true)
    expect(fs.existsSync(src)).toBe(false); expect(fs.existsSync(other)).toBe(true); expect(fs.existsSync(bin)).toBe(true)
    expect((await checkDependencies(dest)).missing).toEqual([])
    expect((await checkDependencies(other)).missing).toEqual([])
  })
  it('复制导出带齐 bin 和贴图并保留源模型', async () => {
    const src = file('copy/src/a.gltf', JSON.stringify({ buffers: [{ uri: 'a.bin' }], images: [{ uri: 'tex/a.png' }] }))
    file('copy/src/a.bin', 'buffer'); file('copy/src/tex/a.png', 'texture')
    const dest = path.join(root, 'copy/dst/a.gltf')
    await transferModel(src, dest, false)
    expect(fs.existsSync(src)).toBe(true); expect((await checkDependencies(dest)).missing).toEqual([])
  })
  it('依赖缺失时拒绝转移，不生成一个无法使用的模型', async () => {
    const src = file('missing/a.gltf', JSON.stringify({ buffers: [{ uri: 'missing.bin' }] }))
    await expect(transferModel(src, path.join(root, 'missing-dst/a.gltf'), true)).rejects.toThrow('缺少依赖')
    expect(fs.existsSync(src)).toBe(true)
  })
})

describe('缓存与真实路径', () => {
  it('首次访问未读取过的老文件不误报，随后内容修改会报告', async () => {
    const p = file('watch/t.png', 'old')
    fs.utimesSync(p, new Date(0), new Date(0))
    expect(await assetFileChanged(p, Date.now())).toBe(false)
    fs.writeFileSync(p, 'changed texture')
    expect(await assetFileChanged(p, Date.now())).toBe(true)
  })
  it('GLB 外部图片进入依赖检查和缓存版本', async () => {
    const raw = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 't.png' }] }).padEnd(128))
    const buf = Buffer.alloc(20 + raw.length)
    buf.writeUInt32LE(0x46546c67, 0); buf.writeUInt32LE(2, 4); buf.writeUInt32LE(buf.length, 8)
    buf.writeUInt32LE(raw.length, 12); buf.writeUInt32LE(0x4e4f534a, 16); raw.copy(buf, 20)
    const p = file('glbdeps/a.glb', buf)
    const t = file('glbdeps/t.png', 'first')
    expect((await checkDependencies(p)).required).toEqual(['t.png'])
    const before = await prepareAsset(entry(p))
    fs.writeFileSync(t, 'changed')
    expect((await prepareAsset(entry(p))).cacheRevision).not.toBe(before.cacheRevision)
  })
  it('DAE 图片引用保留空格与 XML 转义', async () => {
    const p = file('daedeps/a.dae', '<COLLADA><library_images><image id="tex"><init_from>tex/base &amp; color.png</init_from></image></library_images></COLLADA>')
    file('daedeps/tex/base & color.png', 'texture')
    expect(await checkDependencies(p)).toEqual({ required: ['tex/base & color.png'], missing: [] })
  })
  it('单独更新贴图会改变缩略图版本，源模型不必重新保存', async () => {
    const p = file('revision/a.gltf', JSON.stringify({ images: [{ uri: 't.png' }] }))
    const texture = file('revision/t.png', 'old')
    const a = await prepareAsset(entry(p))
    fs.writeFileSync(texture, 'updated texture')
    const b = await prepareAsset(entry(p))
    expect(a.cacheRevision).not.toBe(b.cacheRevision)
    expect(thumbKey(a, 512, 'studio', 'transparent')).not.toBe(thumbKey(b, 512, 'studio', 'transparent'))
  })
  it('不同目录同名同大小同修改时间不会串图', () => {
    const a = entry(file('identity/a/model.obj', 'a')); const b = entry(file('identity/b/model.obj', 'b'))
    b.mtimeMs = a.mtimeMs
    expect(thumbKey(a, 512, 'studio', 'transparent')).not.toBe(thumbKey(b, 512, 'studio', 'transparent'))
  })
  it('junction 指向目录外时拒绝读取，正常内部路径允许', () => {
    const inside = file('policy/open/a.obj', 'a'); const outside = file('policy/out/secret.txt', 'secret')
    fs.symlinkSync(path.dirname(outside), path.join(root, 'policy/open/link'), 'junction')
    const policy = new AccessPolicy(); policy.allow(path.join(root, 'policy/open'))
    expect(policy.isAllowed(inside)).toBe(true)
    expect(policy.isAllowed(path.join(root, 'policy/open/link/secret.txt'))).toBe(false)
    expect(isWithin(path.join(root, 'policy/open'), path.join(root, 'policy/open/..textures/a.png'))).toBe(true)
  })
})

describe('任务和清单导出', () => {
  it('暂停出图仍可提取导出任务，切换目录保留导出', () => {
    const q = new JobQueue<string>(1)
    q.push({ id: 'thumb', priority: 0, epoch: 0, payload: 'thumb' })
    q.push({ id: 'export', priority: -1, epoch: 0, payload: 'export' })
    expect(q.setVisible([]).map(j => j.id)).toEqual(['thumb'])
    expect(q.bumpEpoch(j => j.payload === 'export')).toEqual([])
    expect(q.next(j => j.payload === 'export')?.id).toBe('export')
  })
  it('CSV 文件名和标签不会被 Excel 当成公式执行', () => {
    expect(csvEscape('=HYPERLINK("https://x", "x")')).toContain("'=HYPERLINK")
    expect(csvEscape(-123)).toBe('-123')
  })
})
