import fs from 'node:fs'
import fsp from 'node:fs/promises'
import zlib from 'node:zlib'
import { PNG } from 'pngjs'
import { Decompress as ZstdDecompress } from 'fzstd'

/**
 * 从 .blend 文件里直接抠出 Blender 保存时内嵌的预览图。
 *
 * 不需要装 Blender、不需要原生模块，纯读字节，毫秒级。
 * 代价是这张图只有 128px 左右且是保存时的视口截图，
 * 所以它只作为“先让用户立刻看到东西”的第一层，
 * 真正可旋转的 3D 由 blenderService 转 GLB 提供。
 *
 * 文件结构参考 Blender 官方 blender-thumbnailer.py：
 *   头部 12 字节: "BLENDER" + 指针宽度('_'=4/'-'=8) + 字节序('v'小端/'V'大端) + 3位版本
 *   随后是一串 file-block:
 *     code[4] size[4] oldptr[4|8] sdna[4] count[4]  ← 头部 20 或 24 字节
 *     data[size]
 *   code == "TEST" 的块就是缩略图: int32 宽, int32 高, 然后 宽*高*4 的 RGBA
 */

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 找 TEST 块最多解压/读取这么多字节。实际它总在文件最前面，4MB 绰绰有余 */
const HEAD_BUDGET = 4 * 1024 * 1024

export interface BlendHeader {
  /** 保存该文件的 Blender 版本，如 "4.5" */
  version: string
  major: number
  minor: number
  pointerSize: 4 | 8
  littleEndian: boolean
  /** 文件头字节数：旧格式 12，Blender 5.x 的新格式 17 */
  headerSize: number
  /**
   * 块头布局。
   *   legacy: code[4] size[4] old[ptr] sdna[4] count[4]        （20 或 24 字节）
   *   large:  code[4] sdna[4] old[8]  size[8] count[8]         （32 字节，Blender 5.x）
   */
  bhead: 'legacy' | 'large'
}

/**
 * 只读文件开头，按需解压。
 * gzip 和 zstd 都用流式解压并在拿够字节后立刻中断，
 * 避免为了一张 128px 缩略图去解压一个 500MB 的 .blend。
 */
async function readHead(filePath: string, budget = HEAD_BUDGET): Promise<Buffer | null> {
  let fh: fsp.FileHandle | null = null
  let magic: Buffer
  try {
    fh = await fsp.open(filePath, 'r')
    magic = Buffer.alloc(4)
    await fh.read(magic, 0, 4, 0)
  } catch {
    if (fh) await fh.close().catch(() => {})
    return null
  }

  // 未压缩：直接读前 budget 字节
  if (magic.subarray(0, 4).toString('latin1').startsWith('BLEN')) {
    try {
      const stat = await fh.stat()
      const len = Math.min(budget, stat.size)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, 0)
      return buf
    } finally {
      await fh.close().catch(() => {})
    }
  }
  await fh.close().catch(() => {})

  let decompressor: NodeJS.ReadWriteStream | null = null
  if (magic.subarray(0, 2).equals(GZIP_MAGIC)) {
    decompressor = zlib.createGunzip()
  } else if (magic.equals(ZSTD_MAGIC)) {
    // Blender 3.0+ 的压缩格式是 zstd，而且写的是多帧（seekable）格式：
    // Node 自带的 zlib.createZstdDecompress 只解第一帧就报 "Unknown frame descriptor"，
    // 而 Electron 33 内置的 Node 20 压根没有 zstd。两种情况都走纯 JS 的 fzstd。
    return await readZstdHeadJs(filePath, budget)
  } else {
    return null
  }

  return await new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (v: Buffer | null): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const src = fs.createReadStream(filePath)
    const out = src.pipe(decompressor as NodeJS.ReadWriteStream)

    out.on('data', (c: Buffer) => {
      chunks.push(c)
      total += c.length
      if (total >= budget) {
        // 拿够了就掐断，别再浪费 CPU 解压剩下的几百 MB
        src.destroy()
        ;(out as unknown as { destroy: () => void }).destroy()
        finish(Buffer.concat(chunks))
      }
    })
    out.on('end', () => finish(chunks.length ? Buffer.concat(chunks) : null))
    // 主动 destroy 会触发 error（premature close），此时已有数据就照常返回
    out.on('error', () => finish(chunks.length ? Buffer.concat(chunks) : null))
    src.on('error', () => finish(chunks.length ? Buffer.concat(chunks) : null))
  })
}

/** 纯 JS 的 zstd 流式解压，拿够 budget 字节就停 */
function readZstdHeadJs(filePath: string, budget: number): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve(chunks.length ? Buffer.concat(chunks) : null)
    }
    const src = fs.createReadStream(filePath)
    const dec = new ZstdDecompress((chunk) => {
      chunks.push(Buffer.from(chunk))
      total += chunk.length
      if (total >= budget) {
        src.destroy()
        finish()
      }
    })
    src.on('data', (c: Buffer | string) => {
      if (settled) return
      try {
        dec.push(new Uint8Array(typeof c === 'string' ? Buffer.from(c) : c))
      } catch {
        src.destroy()
        finish()
      }
    })
    src.on('end', () => {
      try {
        dec.push(new Uint8Array(0), true)
      } catch {
        /* 尾帧不完整也无所谓，前面的数据已经够了 */
      }
      finish()
    })
    src.on('error', finish)
    src.on('close', finish)
  })
}

export function parseHeader(buf: Buffer): BlendHeader | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 7).toString('latin1') !== 'BLENDER') return null

  // Blender 5.0 起的新文件头：
  //   "BLENDER" + 头长度两位数字("17") + 指针宽度('-') + 块头版本("01") + 字节序('v') + 四位版本("0501")
  // 旧文件头：
  //   "BLENDER" + 指针宽度('_'/'-') + 字节序('v'/'V') + 三位版本("405")
  const c7 = String.fromCharCode(buf[7])
  const c8 = String.fromCharCode(buf[8])
  if (/\d/.test(c7) && /\d/.test(c8)) {
    const headerSize = parseInt(buf.subarray(7, 9).toString('latin1'), 10)
    if (!Number.isFinite(headerSize) || buf.length < headerSize) return null
    const pointerSize: 4 | 8 = String.fromCharCode(buf[9]) === '_' ? 4 : 8
    const littleEndian = String.fromCharCode(buf[12]) === 'v'
    const verNum = parseInt(buf.subarray(13, 17).toString('latin1'), 10)
    if (!Number.isFinite(verNum)) return null
    const major = Math.floor(verNum / 100)
    const minor = verNum % 100
    return {
      version: `${major}.${minor}`,
      major,
      minor,
      pointerSize,
      littleEndian,
      headerSize,
      bhead: 'large'
    }
  }

  const pointerSize: 4 | 8 = c7 === '_' ? 4 : 8
  const littleEndian = c8 === 'v'

  const verRaw = buf.subarray(9, 12).toString('latin1')
  const verNum = parseInt(verRaw, 10)
  if (!Number.isFinite(verNum)) return null

  // "405" -> 4.5, "280" -> 2.80。Blender 4.0 起小版本是个位数
  const major = Math.floor(verNum / 100)
  const minorRaw = verNum % 100
  const minor = major >= 3 ? Math.floor(minorRaw / 10) || minorRaw : minorRaw

  return {
    version: `${major}.${minor}`,
    major,
    minor,
    pointerSize,
    littleEndian,
    headerSize: 12,
    bhead: 'legacy'
  }
}

interface BlockHead {
  code: string
  size: number
  dataOff: number
}

/** 读一个 file-block 的头，返回 null 表示越界或非法 */
function readBlockHead(buf: Buffer, off: number, h: BlendHeader): BlockHead | null {
  if (h.bhead === 'large') {
    if (off + 32 > buf.length) return null
    const code = buf.subarray(off, off + 4).toString('latin1')
    const size = Number(h.littleEndian ? buf.readBigInt64LE(off + 16) : buf.readBigInt64BE(off + 16))
    if (!Number.isFinite(size) || size < 0) return null
    return { code, size, dataOff: off + 32 }
  }
  const headSize = 16 + h.pointerSize
  if (off + headSize > buf.length) return null
  const code = buf.subarray(off, off + 4).toString('latin1')
  const size = h.littleEndian ? buf.readInt32LE(off + 4) : buf.readInt32BE(off + 4)
  if (size < 0) return null
  return { code, size, dataOff: off + headSize }
}

/** 只读 .blend 头部拿版本号，用于挑选合适的 Blender 去转换 */
export async function readBlendVersion(filePath: string): Promise<BlendHeader | null> {
  const head = await readHead(filePath, 64 * 1024)
  return head ? parseHeader(head) : null
}

export interface EmbeddedThumb {
  width: number
  height: number
  /** 已转正、可直接写盘的 PNG */
  png: Buffer
  /**
   * true 表示这张图是整个 Blender 窗口的截图，而不是模型本身的预览。
   * 这种图拿来当缩略图毫无意义 —— 满屏都是大纲视图和属性面板，
   * 模型只是正中间的一个小点。
   */
  windowScreenshot: boolean
}

/**
 * 判断内嵌预览是不是「整窗截图」。
 *
 * Blender 的 Preferences > Save & Load > File Preview Type 有三种：
 *   Camera View / Auto  -> 渲染模型，输出接近正方形（128x128）
 *   Screenshot          -> 截整个应用窗口，输出是窗口比例（如 128x70）
 *
 * 所以宽高比就是最干脆的判据：明显偏离正方形的一律当整窗截图。
 * 实测某素材包 128 个 .blend 全是 128x70，正是这种情况。
 */
function isWindowScreenshot(width: number, height: number): boolean {
  if (height === 0) return false
  const ratio = width / height
  return ratio > 1.5 || ratio < 0.667
}

/**
 * 提取内嵌缩略图。返回 null 表示这个 .blend 保存时关掉了
 * Preferences > Save & Load > Save Preview Images，文件里根本没有这张图。
 */
export async function extractBlendThumb(filePath: string): Promise<EmbeddedThumb | null> {
  const buf = await readHead(filePath)
  if (!buf) return null

  const header = parseHeader(buf)
  if (!header) return null

  const { littleEndian } = header
  const readI32 = (b: Buffer, o: number): number =>
    littleEndian ? b.readInt32LE(o) : b.readInt32BE(o)

  let off = header.headerSize
  // TEST 块总在文件最前面（紧跟 REND），扫几十个块还没有就是真没有
  for (let guard = 0; guard < 256; guard++) {
    const bh = readBlockHead(buf, off, header)
    if (!bh) return null
    const { code, size, dataOff } = bh

    if (code === 'ENDB') return null

    if (code === 'TEST') {
      if (dataOff + 8 > buf.length) return null
      const width = readI32(buf, dataOff)
      const height = readI32(buf, dataOff + 4)
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null

      const pixOff = dataOff + 8
      const need = width * height * 4
      if (pixOff + need > buf.length) return null

      const png = new PNG({ width, height })
      // Blender 按 OpenGL 惯例自下而上存行，写进 PNG 时要垂直翻转
      for (let y = 0; y < height; y++) {
        const srcRow = pixOff + (height - 1 - y) * width * 4
        buf.copy(png.data, y * width * 4, srcRow, srcRow + width * 4)
      }

      return {
        width,
        height,
        png: PNG.sync.write(png, { colorType: 6 }),
        windowScreenshot: isWindowScreenshot(width, height)
      }
    }

    off = dataOff + size
  }
  return null
}
