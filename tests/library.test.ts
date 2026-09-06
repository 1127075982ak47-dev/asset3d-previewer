import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addTagTo,
  forget,
  getLibrary,
  libraryPayload,
  rekey,
  setColor,
  setFavorites,
  setLibraryFile,
  setRating,
  setTags
} from '../src/main/library'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-lib-'))
  setLibraryFile(path.join(dir, 'library.json'))
})

afterAll(() => {
  setLibraryFile(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('library', () => {
  it('评分钳位到 0–5，0 清除', () => {
    setRating(['C:\\A\\x.fbx'], 9)
    expect(getLibrary().ratings['c:\\a\\x.fbx']).toBe(5)
    setRating(['C:\\A\\x.fbx'], 3.4)
    expect(getLibrary().ratings['c:\\a\\x.fbx']).toBe(3)
    setRating(['C:\\A\\x.fbx'], 0)
    expect(getLibrary().ratings['c:\\a\\x.fbx']).toBeUndefined()
  })

  it('颜色标签只接受已知值', () => {
    setColor(['C:\\A\\x.fbx'], 'blue')
    expect(getLibrary().colors['c:\\a\\x.fbx']).toBe('blue')
    setColor(['C:\\A\\x.fbx'], 'rainbow')
    expect(getLibrary().colors['c:\\a\\x.fbx']).toBeUndefined()
  })

  it('改名后收藏 / 标签 / 评分 / 颜色跟着走', () => {
    setFavorites(['C:\\A\\old.fbx'], true)
    setTags('C:\\A\\old.fbx', ['树', '低模'])
    setRating(['C:\\A\\old.fbx'], 4)
    setColor(['C:\\A\\old.fbx'], 'green')
    rekey('C:\\A\\old.fbx', 'C:\\A\\new.fbx')
    const lib = getLibrary()
    expect(lib.favorites).toContain('c:\\a\\new.fbx')
    expect(lib.favorites).not.toContain('c:\\a\\old.fbx')
    expect(lib.tags['c:\\a\\new.fbx']).toEqual(['树', '低模'])
    expect(lib.ratings['c:\\a\\new.fbx']).toBe(4)
    expect(lib.colors['c:\\a\\new.fbx']).toBe('green')
    expect(lib.tags['c:\\a\\old.fbx']).toBeUndefined()
  })

  it('删除后记录被清掉', () => {
    addTagTo(['C:\\A\\gone.obj'], '临时')
    setFavorites(['C:\\A\\gone.obj'], true)
    forget(['C:\\A\\gone.obj'])
    const lib = getLibrary()
    expect(lib.favorites).not.toContain('c:\\a\\gone.obj')
    expect(lib.tags['c:\\a\\gone.obj']).toBeUndefined()
  })

  it('payload 带全部标签列表并落盘', () => {
    const p = libraryPayload()
    expect(p.allTags).toContain('树')
    expect(typeof p.ratings).toBe('object')
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'))
    expect(onDisk.ratings['c:\\a\\new.fbx']).toBe(4)
  })

  it('损坏的评分 / 颜色在读取时被过滤', () => {
    fs.writeFileSync(
      path.join(dir, 'library.json'),
      JSON.stringify({ favorites: ['a'], tags: { a: ['x'] }, ratings: { a: 7, b: 2 }, colors: { a: 'nope', b: 'red' } })
    )
    setLibraryFile(path.join(dir, 'library.json'))
    const lib = getLibrary()
    expect(lib.ratings).toEqual({ b: 2 })
    expect(lib.colors).toEqual({ b: 'red' })
  })
})
