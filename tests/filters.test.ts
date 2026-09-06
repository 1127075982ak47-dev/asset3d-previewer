import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, filterEntries, hasActiveFilter, needsThumbs, sortEntries, type LibView } from '../src/shared/filters'
import type { ModelEntry, ThumbResult } from '../src/shared/types'

function mk(rel: string, size = 1, mtimeMs = 1): ModelEntry {
  const name = rel.split(/[\\/]/).pop()!
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return {
    id: rel,
    path: `C:\\lib\\${rel}`,
    name: name.slice(0, name.length - ext.length),
    ext,
    dir: 'C:\\lib',
    rel,
    size,
    mtimeMs,
    needsBlender: false,
    previewable: true
  }
}

const all = [mk('a\\tree.fbx', 300, 3), mk('a\\rock.glb', 100, 1), mk('b\\house.obj', 200, 2), mk('b\\cat.fbx', 50, 9)]
const lib: LibView = {
  favorites: new Set(['c:\\lib\\a\\rock.glb']),
  tags: { 'c:\\lib\\a\\tree.fbx': ['植物'], 'c:\\lib\\b\\cat.fbx': ['动物', '角色'] },
  ratings: { 'c:\\lib\\a\\tree.fbx': 5, 'c:\\lib\\b\\house.obj': 2 },
  colors: { 'c:\\lib\\b\\cat.fbx': 'red' }
}
const stats = (t: number, anim = 0): ThumbResult => ({
  id: 'x',
  state: 'ready',
  stats: { vertices: t * 3, triangles: t, meshes: 1, materials: 1, textures: 0, animations: Array(anim).fill('a'), dimensions: [1, 1, 1] }
})
const thumbs = new Map<string, ThumbResult>([
  ['a\\tree.fbx', stats(500)],
  ['a\\rock.glb', stats(5000, 1)],
  ['b\\house.obj', stats(50000)],
  ['b\\cat.fbx', { id: 'x', state: 'failed', error: 'bad' }]
])

describe('filterEntries', () => {
  it('搜索匹配名称、路径与标签', () => {
    expect(filterEntries(all, { ...EMPTY_FILTER, query: '角色' }, lib, null).map((e) => e.name)).toEqual(['cat'])
    expect(filterEntries(all, { ...EMPTY_FILTER, query: 'b\\' }, lib, null).length).toBe(2)
  })
  it('评分 / 颜色 / 收藏', () => {
    expect(filterEntries(all, { ...EMPTY_FILTER, minRating: 3 }, lib, null).map((e) => e.name)).toEqual(['tree'])
    expect(filterEntries(all, { ...EMPTY_FILTER, colors: new Set(['red']) }, lib, null).map((e) => e.name)).toEqual(['cat'])
    expect(filterEntries(all, { ...EMPTY_FILTER, fav: true }, lib, null).map((e) => e.name)).toEqual(['rock'])
  })
  it('面数区间与动画 / 失败依赖缩略图统计', () => {
    expect(filterEntries(all, { ...EMPTY_FILTER, triRange: '1k-10k' }, lib, thumbs).map((e) => e.name)).toEqual(['rock'])
    expect(filterEntries(all, { ...EMPTY_FILTER, triRange: 'gt100k' }, lib, thumbs)).toEqual([])
    expect(filterEntries(all, { ...EMPTY_FILTER, anim: true }, lib, thumbs).map((e) => e.name)).toEqual(['rock'])
    expect(filterEntries(all, { ...EMPTY_FILTER, failed: true }, lib, thumbs).map((e) => e.name)).toEqual(['cat'])
    expect(needsThumbs({ ...EMPTY_FILTER, triRange: 'lt1k' }, 'name')).toBe(true)
    expect(needsThumbs(EMPTY_FILTER, 'tris')).toBe(true)
    expect(needsThumbs(EMPTY_FILTER, 'rating')).toBe(false)
    expect(hasActiveFilter(EMPTY_FILTER)).toBe(false)
    expect(hasActiveFilter({ ...EMPTY_FILTER, minRating: 1 })).toBe(true)
  })
})

describe('sortEntries', () => {
  it('评分排序：高分在前，没评分的永远最后', () => {
    const names = sortEntries(all, 'rating', 'desc', lib, null).map((e) => e.name)
    expect(names).toEqual(['tree', 'house', 'rock', 'cat'])
    const asc = sortEntries(all, 'rating', 'asc', lib, null).map((e) => e.name)
    expect(asc).toEqual(['house', 'tree', 'rock', 'cat'])
  })
  it('面数排序：未知的永远最后', () => {
    const names = sortEntries(all, 'tris', 'asc', lib, thumbs).map((e) => e.name)
    expect(names).toEqual(['tree', 'rock', 'house', 'cat'])
  })
  it('大小 / 时间 / 名称', () => {
    expect(sortEntries(all, 'size', 'desc', lib, null).map((e) => e.name)).toEqual(['tree', 'house', 'rock', 'cat'])
    expect(sortEntries(all, 'date', 'asc', lib, null).map((e) => e.name)).toEqual(['rock', 'house', 'tree', 'cat'])
    expect(sortEntries(all, 'name', 'asc', lib, null).map((e) => e.name)).toEqual(['rock', 'tree', 'cat', 'house'])
  })
})
