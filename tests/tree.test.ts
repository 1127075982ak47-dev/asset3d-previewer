import { describe, expect, it } from 'vitest'
import { buildTree, isUnderDir } from '../src/renderer/lib/tree'
import { layoutSheet } from '../src/renderer/lib/contactSheet'
import { planEviction } from '../src/main/cacheEvict'

describe('buildTree', () => {
  it('按相对路径建树并递归计数', () => {
    const t = buildTree([
      { rel: 'a.glb' },
      { rel: 'Props\\b.glb' },
      { rel: 'Props\\Wood\\c.fbx' },
      { rel: 'Props/Wood/d.fbx' },
      { rel: 'Trees\\e.obj' }
    ])
    expect(t.count).toBe(5)
    expect(t.children.map((c) => c.name)).toEqual(['Props', 'Trees'])
    const props = t.children[0]
    expect(props.count).toBe(3)
    expect(props.children[0].name).toBe('Wood')
    expect(props.children[0].count).toBe(2)
    expect(props.children[0].rel).toBe('Props\\Wood')
  })

  it('isUnderDir 前缀匹配且不误伤同名前缀', () => {
    expect(isUnderDir('Props\\Wood\\c.fbx', 'Props')).toBe(true)
    expect(isUnderDir('Props\\Wood\\c.fbx', 'Props\\Wood')).toBe(true)
    expect(isUnderDir('Propsx\\c.fbx', 'Props')).toBe(false)
    expect(isUnderDir('a.glb', '')).toBe(true)
  })
})

describe('layoutSheet', () => {
  it('接近正方形，容纳全部条目', () => {
    for (const n of [1, 5, 12, 100, 500]) {
      const L = layoutSheet(n)
      expect(L.cols * L.rows).toBeGreaterThanOrEqual(n)
      expect(L.cols).toBeLessThanOrEqual(n)
      expect(L.width).toBeGreaterThan(0)
      expect(L.height).toBeGreaterThan(L.headerH)
    }
  })
})

describe('planEviction', () => {
  const files = [
    { path: 'a', bytes: 100, mtimeMs: 3 },
    { path: 'b', bytes: 100, mtimeMs: 1 },
    { path: 'c', bytes: 100, mtimeMs: 2 }
  ]
  it('不超限不删', () => {
    expect(planEviction(files, 1000)).toEqual([])
    expect(planEviction(files, 0)).toEqual([])
  })
  it('超限时从最旧的删起，删到够为止', () => {
    const v = planEviction(files, 150)
    expect(v.map((f) => f.path)).toEqual(['b', 'c'])
  })
  it('受保护的文件不删', () => {
    const v = planEviction(files, 150, new Set(['b']))
    expect(v.map((f) => f.path)).toEqual(['c', 'a'])
  })
})
