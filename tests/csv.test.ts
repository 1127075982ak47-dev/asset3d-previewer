import { describe, expect, it } from 'vitest'
import { buildInventoryCsv, csvEscape } from '../src/shared/csv'
import type { ModelEntry } from '../src/shared/types'

const entry: ModelEntry = {
  id: '1',
  path: 'C:\\lib\\a, b\\tree.fbx',
  name: 'tree',
  ext: '.fbx',
  dir: 'C:\\lib\\a, b',
  rel: 'a, b\\tree.fbx',
  size: 1234,
  mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5),
  needsBlender: false,
  previewable: true
}

describe('csv', () => {
  it('逗号 / 引号 / 换行会被引起来', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('x')).toBe('x')
    expect(csvEscape(undefined)).toBe('')
  })

  it('带 BOM、CRLF、统计与标签', () => {
    const csv = buildInventoryCsv([
      {
        entry,
        stats: {
          vertices: 10,
          triangles: 5,
          meshes: 1,
          materials: 1,
          textures: 0,
          animations: ['走'],
          dimensions: [1.23456, 2, 3]
        },
        state: 'ready',
        favorite: true,
        tags: ['树', '低模'],
        rating: 4,
        color: 'green'
      },
      { entry: { ...entry, id: '2', name: 'plain' }, favorite: false, tags: [], rating: 0, color: null }
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines.length).toBe(4) // 表头 + 2 行 + 末尾空
    expect(lines[0].startsWith('文件名,格式,')).toBe(true)
    expect(lines[1]).toContain('"a, b\\tree.fbx"')
    expect(lines[1]).toContain(',1.2346,2,3,ready,是,4,green,树;低模')
    expect(lines[2]).toContain('plain.fbx,fbx,')
    expect(lines[2].endsWith(',,,,')).toBe(true)
  })
})
