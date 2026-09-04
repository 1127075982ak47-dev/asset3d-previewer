import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractBlendThumb, parseHeader, readBlendVersion } from '../src/main/blendThumb'

let dir: string

/** 造一个最小的旧格式 .blend：12 字节头 + REND 块 + TEST 块 + ENDB */
function legacyBlend(w: number, h: number, version = '405'): Buffer {
  const header = Buffer.from(`BLENDER-v${version}`, 'latin1') // '-' = 8 字节指针, 'v' = 小端
  const bhead = (code: string, size: number): Buffer => {
    const b = Buffer.alloc(24)
    b.write(code, 0, 4, 'latin1')
    b.writeInt32LE(size, 4)
    return b
  }
  const rend = Buffer.alloc(72)
  const pixels = Buffer.alloc(w * h * 4)
  for (let row = 0; row < h; row++) {
    // row 0 是最底行（OpenGL 惯例）：下半蓝，上半红
    const bottom = row < h / 2
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4
      pixels[o] = bottom ? 0 : 255
      pixels[o + 2] = bottom ? 255 : 0
      pixels[o + 3] = 255
    }
  }
  const test = Buffer.alloc(8 + pixels.length)
  test.writeInt32LE(w, 0)
  test.writeInt32LE(h, 4)
  pixels.copy(test, 8)
  return Buffer.concat([header, bhead('REND', 72), rend, bhead('TEST', test.length), test, bhead('ENDB', 0)])
}

/** Blender 5.x 的新格式：17 字节头 + 32 字节块头 */
function largeBlend(w: number, h: number): Buffer {
  const header = Buffer.from('BLENDER17-01v0501', 'latin1')
  const bhead = (code: string, size: number): Buffer => {
    const b = Buffer.alloc(32)
    b.write(code, 0, 4, 'latin1')
    b.writeInt32LE(0, 4)
    b.writeBigUInt64LE(16n, 8)
    b.writeBigInt64LE(BigInt(size), 16)
    b.writeBigInt64LE(1n, 24)
    return b
  }
  const rend = Buffer.alloc(264)
  const test = Buffer.alloc(8 + w * h * 4, 0x80)
  test.writeInt32LE(w, 0)
  test.writeInt32LE(h, 4)
  return Buffer.concat([header, bhead('REND', 264), rend, bhead('TEST', test.length), test, bhead('ENDB', 0)])
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-blend-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseHeader', () => {
  it('旧格式版本号', () => {
    expect(parseHeader(Buffer.from('BLENDER-v405', 'latin1'))).toMatchObject({
      version: '4.5',
      major: 4,
      minor: 5,
      pointerSize: 8,
      littleEndian: true,
      headerSize: 12,
      bhead: 'legacy'
    })
    expect(parseHeader(Buffer.from('BLENDER_V280', 'latin1'))).toMatchObject({
      version: '2.80',
      pointerSize: 4,
      littleEndian: false
    })
  })

  it('Blender 5 新格式', () => {
    expect(parseHeader(Buffer.from('BLENDER17-01v0501', 'latin1'))).toMatchObject({
      version: '5.1',
      major: 5,
      minor: 1,
      headerSize: 17,
      bhead: 'large'
    })
  })

  it('非 blend 返回 null', () => {
    expect(parseHeader(Buffer.from('NOTABLENDFILE', 'latin1'))).toBeNull()
  })
})

describe('extractBlendThumb', () => {
  it('旧格式：抠出 TEST 块并垂直翻转', async () => {
    const f = path.join(dir, 'legacy.blend')
    fs.writeFileSync(f, legacyBlend(64, 64))
    const t = await extractBlendThumb(f)
    expect(t).not.toBeNull()
    expect(t!.width).toBe(64)
    expect(t!.windowScreenshot).toBe(false)
    const png = PNG.sync.read(t!.png)
    const px = (x: number, y: number): number[] => {
      const o = (y * png.width + x) * 4
      return [png.data[o], png.data[o + 1], png.data[o + 2]]
    }
    expect(px(32, 4)).toEqual([255, 0, 0]) // 顶部红
    expect(px(32, 60)).toEqual([0, 0, 255]) // 底部蓝
    expect((await readBlendVersion(f))!.version).toBe('4.5')
  })

  it('新格式（Blender 5）', async () => {
    const f = path.join(dir, 'large.blend')
    fs.writeFileSync(f, largeBlend(32, 32))
    const t = await extractBlendThumb(f)
    expect(t).not.toBeNull()
    expect(t!.width).toBe(32)
    expect((await readBlendVersion(f))!.version).toBe('5.1')
  })

  it('整窗截图（宽高比离谱）被标记', async () => {
    const f = path.join(dir, 'wide.blend')
    fs.writeFileSync(f, legacyBlend(128, 68))
    const t = await extractBlendThumb(f)
    expect(t!.windowScreenshot).toBe(true)
  })

  it('gzip 压缩的文件也能读', async () => {
    const f = path.join(dir, 'gz.blend')
    fs.writeFileSync(f, zlib.gzipSync(legacyBlend(16, 16)))
    const t = await extractBlendThumb(f)
    expect(t!.width).toBe(16)
  })

  it('zstd 压缩的文件走纯 JS 解压', async () => {
    const anyZlib = zlib as unknown as { zstdCompressSync?: (b: Buffer) => Buffer }
    if (typeof anyZlib.zstdCompressSync !== 'function') return
    const f = path.join(dir, 'zst.blend')
    fs.writeFileSync(f, anyZlib.zstdCompressSync(legacyBlend(16, 16)))
    const t = await extractBlendThumb(f)
    expect(t!.width).toBe(16)
    expect((await readBlendVersion(f))!.version).toBe('4.5')
  })

  it('没有 TEST 块返回 null', async () => {
    const f = path.join(dir, 'nothumb.blend')
    const header = Buffer.from('BLENDER-v405', 'latin1')
    const endb = Buffer.alloc(24)
    endb.write('ENDB', 0, 4, 'latin1')
    fs.writeFileSync(f, Buffer.concat([header, endb]))
    expect(await extractBlendThumb(f)).toBeNull()
  })
})
