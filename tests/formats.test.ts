import { describe, expect, it } from 'vitest'
import { classifyExt, extOf, isModelExt, isUnsupportedModelExt } from '../src/shared/formats'

describe('formats', () => {
  it('extOf 取小写扩展名', () => {
    expect(extOf('Barrel.GLTF')).toBe('.gltf')
    expect(extOf('noext')).toBe('')
    expect(extOf('a.b.FBX')).toBe('.fbx')
  })

  it('分类：网格 / blend / 不支持 / 伴生 / 贴图 / 其它', () => {
    expect(classifyExt('.glb')).toBe('mesh')
    expect(classifyExt('.pmx')).toBe('mesh')
    expect(classifyExt('.blend')).toBe('blend')
    expect(classifyExt('.max')).toBe('unsupported')
    expect(classifyExt('.bin')).toBe('companion')
    expect(classifyExt('.import')).toBe('companion')
    expect(classifyExt('.tga')).toBe('texture')
    expect(classifyExt('.txt')).toBe('other')
  })

  it('isModelExt / isUnsupportedModelExt 互斥', () => {
    for (const e of ['.fbx', '.obj', '.blend', '.usdz', '.3dm']) {
      expect(isModelExt(e)).toBe(true)
      expect(isUnsupportedModelExt(e)).toBe(false)
    }
    for (const e of ['.max', '.c4d', '.skp']) {
      expect(isModelExt(e)).toBe(false)
      expect(isUnsupportedModelExt(e)).toBe(true)
    }
  })
})
