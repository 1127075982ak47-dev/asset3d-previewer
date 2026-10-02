import fsp from 'node:fs/promises'
import path from 'node:path'

export interface Dependencies { required: string[]; missing: string[] }
const MAX_TEXT_BYTES = 64 * 1024 * 1024

function localUri(uri: string): string | null {
  if (/^(data:|https?:|blob:)/i.test(uri)) return null
  try { return decodeURIComponent(uri) } catch { return uri }
}

/** MTL 的贴图文件名允许空格，先去除已知选项，不能只取最后一个单词。 */
export function materialTexture(line: string): string | null {
  const match = /^\s*(?:map_\w+|bump|disp|decal|norm)\s+(.+?)\s*$/i.exec(line)
  if (!match) return null
  const tokens = match[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  let i = 0
  while (tokens[i]?.startsWith('-')) {
    const option = tokens[i++].toLowerCase()
    if (['-o', '-s', '-t'].includes(option)) {
      for (let n = 0; n < 3 && /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(tokens[i] ?? ''); n++) i++
    } else i += option === '-mm' ? 2 : 1
  }
  const name = tokens.slice(i).join(' ').replace(/^("|')|("|')$/g, '')
  return name ? localUri(name) : null
}

async function textOf(file: string): Promise<string> {
  const stat = await fsp.stat(file)
  if (stat.size > MAX_TEXT_BYTES) throw new Error('依赖清单超过 64 MB')
  return await fsp.readFile(file, 'utf8')
}

async function glbJson(file: string): Promise<any> {
  const handle = await fsp.open(file, 'r')
  try {
    const header = Buffer.alloc(20)
    if ((await handle.read(header, 0, 20, 0)).bytesRead !== 20 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB 头无效')
    const length = header.readUInt32LE(12)
    if (length > MAX_TEXT_BYTES) throw new Error('GLB JSON 超过 64 MB')
    const json = Buffer.alloc(length)
    if ((await handle.read(json, 0, length, 20)).bytesRead !== length) throw new Error('GLB JSON 不完整')
    return JSON.parse(json.toString('utf8').replace(/\0+$/, ''))
  } finally { await handle.close() }
}

/** 返回相对模型目录的依赖；MTL 内的路径以 MTL 自己所在目录解析。 */
export async function checkDependencies(file: string): Promise<Dependencies> {
  const dir = path.dirname(file)
  const required = new Set<string>()
  const ext = path.extname(file).toLowerCase()
  try {
    if (ext === '.gltf' || ext === '.glb') {
      const json = ext === '.glb' ? await glbJson(file) : JSON.parse(await textOf(file))
      for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
        if (typeof item?.uri !== 'string') continue
        const uri = localUri(item.uri)
        if (uri) required.add(uri)
      }
    } else if (ext === '.dae') {
      const text = await textOf(file)
      for (const image of text.matchAll(/<image\b[^>]*>([\s\S]*?)<\/image>/gi)) {
        const match = /<init_from\b[^>]*>([\s\S]*?)<\/init_from>/i.exec(image[1])
        if (!match) continue
        const value = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        const uri = localUri(value)
        if (uri) required.add(uri)
      }
    } else if (ext === '.obj') {
      const text = await textOf(file)
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*mtllib\s+(.+?)\s*$/i.exec(line)
        if (!m) continue
        const whole = m[1].replace(/^"|"$/g, '')
        let names = [whole]
        try { await fsp.access(path.resolve(dir, whole)) } catch {
          names = (m[1].match(/"[^"]*"|\S+/g) ?? []).map(n => n.replace(/^"|"$/g, ''))
        }
        for (const name of names) {
          required.add(name)
          const mtl = path.resolve(dir, name)
          try {
            for (const l of (await textOf(mtl)).split(/\r?\n/)) {
              const texture = materialTexture(l)
              if (texture) required.add(path.relative(dir, path.resolve(path.dirname(mtl), texture)))
            }
          } catch { /* 缺失的 MTL 本身保留在清单中 */ }
        }
      }
    }
  } catch { /* 损坏的模型由加载器报告，依赖检查保留已知部分 */ }
  const missing: string[] = []
  for (const ref of required) {
    try { await fsp.access(path.resolve(dir, ref)) } catch { missing.push(ref) }
  }
  return { required: [...required], missing }
}
