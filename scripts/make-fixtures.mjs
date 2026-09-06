/**
 * 生成合成测试夹具：真实素材库里凑不齐的边角情况，自己造。
 *
 *   tga-box/box.obj + box.mtl + box.tga      OBJ 引用 TGA 贴图（三方库解码）
 *   dds-box/box.obj + box.mtl + box.dds      OBJ 引用未压缩 DDS 贴图
 *   missing-bin/broken.gltf                  .gltf 引用不存在的 .bin（应失败并报缺依赖）
 *   name #1/hash.obj                         目录名带 #（URL 编码）
 *   cloud.ply                                无面点云（应按点渲染而不是空白）
 *   old.max / scene.c4d                      无法预览的私有格式（应列出但标记不支持）
 *   dupes/a/box.obj + dupes/b/box_copy.obj  内容完全相同的两个文件（重复查找）
 *   walk.bvh                                 动捕骨骼（骨架线 + 动画）
 *   variants.gltf                            KHR_materials_variants 两个材质变体
 *
 * 用法: node scripts/make-fixtures.mjs [输出目录]   默认 .fixtures/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '.fixtures'))
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const w = (rel, data) => {
  const p = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
}

/** 一个带 UV 的立方体 OBJ，材质来自同名 mtl */
function cubeObj(mtl, mat) {
  const v = [
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]
  ]
  const faces = [
    [1, 2, 3, 4], [2, 6, 7, 3], [6, 5, 8, 7], [5, 1, 4, 8], [4, 3, 7, 8], [5, 6, 2, 1]
  ]
  let s = `mtllib ${mtl}\n`
  for (const p of v) s += `v ${p.join(' ')}\n`
  s += 'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n'
  s += `usemtl ${mat}\n`
  for (const f of faces) s += `f ${f.map((i, k) => `${i}/${k + 1}`).join(' ')}\n`
  return s
}

/** 8x8 棋盘像素，RGB */
function checker(size, a, b) {
  const px = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ((x >> 3) + (y >> 3)) % 2 === 0 ? a : b
      const o = (y * size + x) * 3
      px[o] = c[0]
      px[o + 1] = c[1]
      px[o + 2] = c[2]
    }
  }
  return px
}

/** 未压缩 24 位 TGA（类型 2，BGR，左下原点） */
function tga(size, rgb) {
  const h = Buffer.alloc(18)
  h[2] = 2
  h.writeUInt16LE(size, 12)
  h.writeUInt16LE(size, 14)
  h[16] = 24
  h[17] = 0
  const body = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    body[i * 3] = rgb[i * 3 + 2]
    body[i * 3 + 1] = rgb[i * 3 + 1]
    body[i * 3 + 2] = rgb[i * 3]
  }
  return Buffer.concat([h, body])
}

/** 未压缩 32 位 DDS（A8R8G8B8，无 mipmap） */
function dds(size, rgb) {
  const h = Buffer.alloc(128)
  h.write('DDS ', 0, 'latin1')
  h.writeUInt32LE(124, 4) // dwSize
  h.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x8, 8) // CAPS|HEIGHT|WIDTH|PIXELFORMAT|PITCH
  h.writeUInt32LE(size, 12)
  h.writeUInt32LE(size, 16)
  h.writeUInt32LE(size * 4, 20) // pitch
  h.writeUInt32LE(0, 24) // depth
  h.writeUInt32LE(1, 28) // mipmaps
  // pixel format @ 76
  h.writeUInt32LE(32, 76) // dwSize
  h.writeUInt32LE(0x41, 80) // ALPHAPIXELS | RGB
  h.writeUInt32LE(0, 84) // fourCC
  h.writeUInt32LE(32, 88) // bit count
  h.writeUInt32LE(0x00ff0000, 92)
  h.writeUInt32LE(0x0000ff00, 96)
  h.writeUInt32LE(0x000000ff, 100)
  h.writeUInt32LE(0xff000000, 104)
  h.writeUInt32LE(0x1000, 108) // caps: TEXTURE
  const body = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    body[i * 4] = rgb[i * 3 + 2]
    body[i * 4 + 1] = rgb[i * 3 + 1]
    body[i * 4 + 2] = rgb[i * 3]
    body[i * 4 + 3] = 255
  }
  return Buffer.concat([h, body])
}

const S = 64
w('tga-box/box.obj', cubeObj('box.mtl', 'boxmat'))
w('tga-box/box.mtl', 'newmtl boxmat\nKd 1 1 1\nmap_Kd box.tga\n')
w('tga-box/box.tga', tga(S, checker(S, [220, 60, 60], [240, 240, 60])))

w('dds-box/box.obj', cubeObj('box.mtl', 'boxmat'))
w('dds-box/box.mtl', 'newmtl boxmat\nKd 1 1 1\nmap_Kd box.dds\n')
w('dds-box/box.dds', dds(S, checker(S, [60, 120, 220], [60, 220, 120])))

// .fbm 目录不存在，贴图在模型旁边 —— 验证贴图兜底
w('fbm-fallback/box.obj', cubeObj('box.mtl', 'boxmat'))
w('fbm-fallback/box.mtl', 'newmtl boxmat\nKd 1 1 1\nmap_Kd box.fbm/tex.tga\n')
w('fbm-fallback/tex.tga', tga(S, checker(S, [200, 100, 200], [100, 200, 200])))

w(
  'missing-bin/broken.gltf',
  JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'broken.bin', byteLength: 72 }],
    bufferViews: [{ buffer: 0, byteLength: 72 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  })
)

w('name #1/hash.obj', cubeObj('hash.mtl', 'm'))
w('name #1/hash.mtl', 'newmtl m\nKd 0.9 0.5 0.2\n')

// 点云 PLY：5000 个随机点，没有面
{
  const n = 5000
  let s = `ply\nformat ascii 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  for (let i = 0; i < n; i++) s += `${rnd().toFixed(4)} ${rnd().toFixed(4)} ${rnd().toFixed(4)}\n`
  w('cloud.ply', s)
}

// 重复文件：内容完全一致，只是名字和目录不同
{
  const same = cubeObj('box.mtl', 'm')
  w('dupes/a/box.obj', same)
  w('dupes/a/box.mtl', 'newmtl m\nKd 0.2 0.6 0.9\n')
  w('dupes/b/box_copy.obj', same)
  w('dupes/b/box.mtl', 'newmtl m\nKd 0.2 0.6 0.9\n')
}

// BVH 动捕：4 个关节、10 帧
{
  const frames = []
  for (let i = 0; i < 10; i++) {
    const t = i / 10
    const sway = (Math.sin(t * Math.PI * 2) * 20).toFixed(2)
    frames.push(`0 30 0 0 0 0  0 0 ${sway}  0 0 0  ${sway} 0 0`)
  }
  w(
    'walk.bvh',
    [
      'HIERARCHY',
      'ROOT Hips',
      '{',
      '  OFFSET 0 0 0',
      '  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation',
      '  JOINT Spine',
      '  {',
      '    OFFSET 0 10 0',
      '    CHANNELS 3 Zrotation Xrotation Yrotation',
      '    JOINT Head',
      '    {',
      '      OFFSET 0 10 0',
      '      CHANNELS 3 Zrotation Xrotation Yrotation',
      '      End Site',
      '      {',
      '        OFFSET 0 5 0',
      '      }',
      '    }',
      '  }',
      '  JOINT LeftLeg',
      '  {',
      '    OFFSET 3 0 0',
      '    CHANNELS 3 Zrotation Xrotation Yrotation',
      '    End Site',
      '    {',
      '      OFFSET 0 -10 0',
      '    }',
      '  }',
      '}',
      'MOTION',
      `Frames: ${frames.length}`,
      'Frame Time: 0.1',
      ...frames,
      ''
    ].join('\n')
  )
}

// glTF 材质变体：一个四边形，红 / 蓝两个变体
{
  const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3])
  const buf = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)])
  w(
    'variants.gltf',
    JSON.stringify({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_materials_variants'],
      extensions: { KHR_materials_variants: { variants: [{ name: '红色' }, { name: '蓝色' }] } },
      buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 48 },
        { buffer: 0, byteOffset: 48, byteLength: 12 }
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }
      ],
      materials: [
        { name: 'red', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.2, 0.2, 1] } },
        { name: 'blue', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.9, 1] } }
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              indices: 1,
              material: 0,
              extensions: {
                KHR_materials_variants: {
                  mappings: [
                    { material: 0, variants: [0] },
                    { material: 1, variants: [1] }
                  ]
                }
              }
            }
          ]
        }
      ],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0
    })
  )
}

w('old.max', 'not really a max file')
w('scene.c4d', 'not really a c4d file')
w('noise.bin', 'companion')
w('noise.import', 'godot')

console.log('夹具已生成:', OUT)
for (const f of fs.readdirSync(OUT, { recursive: true })) console.log('  ', f)
