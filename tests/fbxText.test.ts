import { describe, expect, it } from 'vitest'
import { isBinaryFbx, normalizeFbxAsciiIndent } from '../src/renderer/lib/fbxText'

describe('normalizeFbxAsciiIndent', () => {
  it('把多缩进一层的闭合括号拉回正确层级', () => {
    const src = [
      'Objects:  {',
      '\tGeometry: 1, "Geometry::", "Mesh" {',
      '\t\tVertices: *6 {',
      '\t\t\ta: 1,2,3,4,5,6',
      '\t\t\t}',
      '\t\tPolygonVertexIndex: *3 {',
      '\t\t\ta: 0,1,-3',
      '\t\t\t}',
      '\t}',
      '}'
    ].join('\n')
    const out = normalizeFbxAsciiIndent(src).split('\n')
    expect(out[2]).toBe('\t\tVertices: *6 {')
    expect(out[3]).toBe('\t\t\ta: 1,2,3,4,5,6')
    expect(out[4]).toBe('\t\t}')
    expect(out[5]).toBe('\t\tPolygonVertexIndex: *3 {')
    expect(out[7]).toBe('\t\t}')
    expect(out[8]).toBe('\t}')
    expect(out[9]).toBe('}')
  })

  it('尾逗号后面紧跟 } 时把逗号去掉', () => {
    const src = ['Materials: *3 {', '\ta: 0,0,0,', '\t}'].join('\n')
    const out = normalizeFbxAsciiIndent(src).split('\n')
    expect(out[1]).toBe('\ta: 0,0,0')
    expect(out[2]).toBe('}')
  })

  it('多行数组的续行顶格输出', () => {
    const src = ['V: *6 {', '\t\ta: 1,2,3,', '\t\t4,5,6', '\t}'].join('\n')
    const out = normalizeFbxAsciiIndent(src).split('\n')
    expect(out[1]).toBe('\ta: 1,2,3,')
    expect(out[2]).toBe('4,5,6')
    expect(out[3]).toBe('}')
  })

  it('注释与空行原样保留，规整文件是等价变换', () => {
    const src = ['; comment', '', 'A: {', '\tB: 1', '\tC: "x" {', '\t\tD: 2', '\t}', '}'].join('\n')
    expect(normalizeFbxAsciiIndent(src)).toBe(src)
  })
})

describe('isBinaryFbx', () => {
  it('识别二进制魔数', () => {
    const magic = new TextEncoder().encode('Kaydara FBX Binary  \0\x1a\0')
    expect(isBinaryFbx(magic.buffer)).toBe(true)
    expect(isBinaryFbx(new TextEncoder().encode('; FBX 7.3.0 project file').buffer)).toBe(false)
    expect(isBinaryFbx(new ArrayBuffer(3))).toBe(false)
  })
})
