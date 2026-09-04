import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AccessPolicy,
  assetPathFromUrlRest,
  isWithin,
  pathToAssetUrl,
  resolveTextureFallback,
  splitAssetUrl
} from '../src/main/pathPolicy'

describe('isWithin / AccessPolicy', () => {
  it('盘符根目录下的文件被允许（1.0 的 bug）', () => {
    expect(isWithin('E:\\', 'E:\\models\\a.fbx')).toBe(true)
    expect(isWithin('E:\\', 'E:\\')).toBe(true)
  })

  it('普通目录含子目录', () => {
    expect(isWithin('D:\\素材', 'D:\\素材\\tex\\a.png')).toBe(true)
    expect(isWithin('D:\\素材', 'D:\\素材')).toBe(true)
  })

  it('前缀相同但不是子目录要拒绝', () => {
    expect(isWithin('D:\\a', 'D:\\ab\\x.fbx')).toBe(false)
  })

  it('.. 越权与跨盘符要拒绝', () => {
    expect(isWithin('D:\\a', 'D:\\a\\..\\..\\Windows\\x')).toBe(false)
    expect(isWithin('D:\\a', 'C:\\Windows\\x')).toBe(false)
  })

  it('大小写不敏感', () => {
    expect(isWithin('d:\\A', 'D:\\a\\B.FBX')).toBe(true)
  })

  it('AccessPolicy 额外根目录（缓存目录）永远放行', () => {
    const p = new AccessPolicy(() => ['C:\\cache'])
    expect(p.isAllowed('C:\\cache\\glb\\x.glb')).toBe(true)
    expect(p.isAllowed('D:\\x\\a.fbx')).toBe(false)
    p.allow('D:\\x')
    expect(p.isAllowed('D:\\x\\a.fbx')).toBe(true)
  })
})

describe('URL 编解码', () => {
  it('中文与盘符往返', () => {
    const abs = 'E:\\Desktop\\8月\\Barrel #2.gltf'
    const url = pathToAssetUrl(abs)
    expect(url.startsWith('asset3d://local/E%3A/')).toBe(true)
    expect(url).not.toContain('#')
    const parsed = splitAssetUrl(url)!
    expect(parsed.host).toBe('local')
    expect(assetPathFromUrlRest(parsed.rest)).toBe(path.normalize(abs))
  })

  it('UNC 路径保留前导双反斜杠', () => {
    const abs = '\\\\nas\\share\\models\\a.fbx'
    const url = pathToAssetUrl(abs)
    expect(url).toBe('asset3d://local/UNC/nas/share/models/a.fbx')
    expect(assetPathFromUrlRest(splitAssetUrl(url)!.rest)).toBe(abs)
  })

  it('三方加载器拼出来的相对路径能解回同目录', () => {
    const base = pathToAssetUrl('D:\\m\\Barrel.gltf').replace(/[^/]+$/, '')
    const rel = base + 'textures/ColorAtlas.png'
    expect(assetPathFromUrlRest(splitAssetUrl(rel)!.rest)).toBe(path.normalize('D:\\m\\textures\\ColorAtlas.png'))
  })

  it('query / hash 被剥离', () => {
    const p = splitAssetUrl('asset3d://thumb/abc.png?x=1#y')!
    expect(p.host).toBe('thumb')
    expect(p.rest).toBe('abc.png')
  })
})

describe('resolveTextureFallback', () => {
  const files = new Set(
    [
      'D:\\m\\ColorAtlas.png',
      'D:\\m\\textures\\Other.png',
      'D:\\m\\sub\\deep\\model.fbx',
      'C:\\outside\\ColorAtlas.png'
    ].map((f) => f.toLowerCase())
  )
  const exists = (p: string): boolean => files.has(p.toLowerCase())
  const allowed = (p: string): boolean => isWithin('D:\\m', p)

  it('.fbm 子目录不存在时在模型旁边找到同名贴图', () => {
    const cache = new Map<string, string | null>()
    const r = resolveTextureFallback('D:\\m\\Barrel.fbm\\ColorAtlas.png', allowed, cache, exists)
    expect(r?.toLowerCase()).toBe('d:\\m\\coloratlas.png')
  })

  it('从深层目录逐级向上找，且不走出允许的根', () => {
    const cache = new Map<string, string | null>()
    const r = resolveTextureFallback('D:\\m\\sub\\deep\\ColorAtlas.png', allowed, cache, exists)
    expect(r?.toLowerCase()).toBe('d:\\m\\coloratlas.png')
    const miss = resolveTextureFallback('D:\\m\\sub\\deep\\Nope.png', allowed, cache, exists)
    expect(miss).toBeNull()
  })

  it('常见贴图子目录也会试', () => {
    const cache = new Map<string, string | null>()
    const r = resolveTextureFallback('D:\\m\\Other.png', allowed, cache, exists)
    expect(r?.toLowerCase()).toBe('d:\\m\\textures\\other.png')
  })

  it('结果被记忆', () => {
    const cache = new Map<string, string | null>()
    resolveTextureFallback('D:\\m\\x\\ColorAtlas.png', allowed, cache, exists)
    expect(cache.size).toBe(1)
    let calls = 0
    resolveTextureFallback('D:\\m\\x\\ColorAtlas.png', allowed, cache, () => {
      calls++
      return false
    })
    expect(calls).toBe(0)
  })
})
