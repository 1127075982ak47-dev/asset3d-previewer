/** 由扫描结果的相对路径构建文件夹树。纯函数，方便单测。 */

export interface DirNode {
  /** 显示名 */
  name: string
  /** 相对根目录的路径，根节点为空串 */
  rel: string
  /** 本目录及所有子目录里的模型数 */
  count: number
  children: DirNode[]
}

const SEP = /[\\/]+/

export function buildTree(entries: { rel: string }[], rootName = '全部'): DirNode {
  const root: DirNode = { name: rootName, rel: '', count: 0, children: [] }
  const index = new Map<string, DirNode>([['', root]])

  for (const e of entries) {
    const parts = e.rel.split(SEP)
    parts.pop() // 文件名
    root.count++
    let rel = ''
    let node = root
    for (const part of parts) {
      if (!part) continue
      rel = rel ? `${rel}\\${part}` : part
      let child = index.get(rel)
      if (!child) {
        child = { name: part, rel, count: 0, children: [] }
        index.set(rel, child)
        node.children.push(child)
      }
      child.count++
      node = child
    }
  }

  const sortRec = (n: DirNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    for (const c of n.children) sortRec(c)
  }
  sortRec(root)
  return root
}

/** rel 指向的文件是否位于 dir（含子目录）下；dir 为空串表示根 */
export function isUnderDir(rel: string, dir: string): boolean {
  if (!dir) return true
  const r = rel.replace(/\//g, '\\').toLowerCase()
  const d = dir.replace(/\//g, '\\').toLowerCase()
  return r.startsWith(d + '\\')
}
