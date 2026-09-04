/**
 * ASCII FBX 的缩进修复。
 *
 * three.js 的 FBXLoader 文本解析器不是按语法分析，而是按每行开头的 tab 数
 * 判断层级：节点开始行必须恰好 N 个 tab，闭合 "}" 必须恰好 N-1 个。
 * 有些导出器（Kenney 素材包里的 FBX 就是）把数组的闭合括号写成和数组内容
 * 同一层缩进：
 *
 *     UV: *848 {
 *         a: 0.1,0.2,...
 *         }            <- 多了一层
 *     UVIndex: *804 {
 *
 * 解析器认不出这个 "}"，栈没弹出，接下来 "UVIndex" 节点整行被忽略，
 * 它的 "a:" 数组反而覆盖进了 UV 节点 —— 结果就是整个素材包 329 个 FBX
 * 全部报 "Cannot read properties of undefined (reading 'a')"。
 *
 * 同一批文件还有第二个坑：数组最后一个元素后面带一个尾逗号，
 * 解析器看到逗号结尾就认为数组还有续行、一直等，紧接着的 "}" 被吞掉。
 *
 * 这里按花括号层级把缩进重新生成一遍、把尾逗号去掉，喂给解析器的永远是
 * 它期望的形状。对本来就规整的文件是等价变换。
 */
export function normalizeFbxAsciiIndent(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const out: string[] = []
  let depth = 0
  // 长数组会被拆成多行，续行以 "," 结尾；解析器要求续行顶格（不带任何缩进）
  let continuation = false

  const nextNonEmpty = (from: number): string => {
    for (let j = from; j < lines.length; j++) if (lines[j] !== '') return lines[j]
    return ''
  }

  /** 数组行以逗号结尾、但下一行就是 "}"：这是尾逗号，不是续行 */
  const stripTrailingComma = (line: string, i: number): string => {
    if (line.endsWith(',') && nextNonEmpty(i + 1).startsWith('}')) {
      return line.replace(/,+\s*$/, '')
    }
    return line
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (line === '') {
      out.push('')
      continue
    }

    if (continuation) {
      if (line.startsWith('}')) {
        // 上一行本该结束数组却带着逗号，这里补救：把上一行的尾逗号去掉
        const k = out.length - 1
        out[k] = out[k].replace(/,+\s*$/, '')
        continuation = false
        // 落到下面按闭合处理
      } else {
        line = stripTrailingComma(line, i)
        out.push(line)
        continuation = line.endsWith(',')
        continue
      }
    }

    if (line.startsWith(';')) {
      out.push(line)
      continue
    }
    if (line.startsWith('}')) {
      depth = Math.max(0, depth - 1)
      out.push('\t'.repeat(depth) + '}')
      continue
    }

    const prop = /^(\w+):/.exec(line)
    if (prop && /\{\s*$/.test(line)) {
      out.push('\t'.repeat(depth) + line)
      depth++
      continue
    }

    if (prop && prop[1] === 'a') {
      line = stripTrailingComma(line, i)
      continuation = line.endsWith(',')
    }
    out.push('\t'.repeat(depth) + line)
  }
  return out.join('\n')
}

const BINARY_MAGIC = 'Kaydara FBX Binary  '

export function isBinaryFbx(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_MAGIC.length) return false
  const head = new Uint8Array(buffer, 0, BINARY_MAGIC.length)
  for (let i = 0; i < BINARY_MAGIC.length; i++) {
    if (head[i] !== BINARY_MAGIC.charCodeAt(i)) return false
  }
  return true
}
