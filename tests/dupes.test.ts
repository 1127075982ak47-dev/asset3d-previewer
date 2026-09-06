import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findDuplicates } from '../src/main/dupes'

let root: string
const files: { path: string; size: number }[] = []

function add(rel: string, content: string): void {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  files.push({ path: p, size: fs.statSync(p).size })
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset3d-dupes-'))
  add('a/tree.fbx', 'SAME-CONTENT-1234567890')
  add('b/tree_copy.fbx', 'SAME-CONTENT-1234567890')
  add('c/tree (2).fbx', 'SAME-CONTENT-1234567890')
  add('d/other.fbx', 'DIFF-CONTENT-1234567890') // 同大小不同内容
  add('e/small.obj', 'tiny')
  add('f/big.obj', 'x'.repeat(5000))
  add('g/big2.obj', 'x'.repeat(5000))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('findDuplicates', () => {
  it('同大小不同内容不算重复；只对大小相同的算哈希', async () => {
    const progress: number[] = []
    const r = await findDuplicates(files, { onProgress: (p) => progress.push(p.total) })
    expect(r.groups.length).toBe(2)
    const tree = r.groups.find((g) => g.paths.length === 3)!
    expect(tree.paths.map((p) => path.basename(p)).sort()).toEqual(['tree (2).fbx', 'tree.fbx', 'tree_copy.fbx'])
    const big = r.groups.find((g) => g.size === 5000)!
    expect(big.paths.length).toBe(2)
    // 只有 4 + 2 = 6 个文件需要算哈希（small.obj 独一份不用）
    expect(progress[0]).toBe(6)
    // 浪费空间大的排前面
    expect(r.groups[0].size).toBe(5000)
  })

  it('可以取消', async () => {
    const r = await findDuplicates(files, { isCancelled: () => true })
    expect(r.cancelled).toBe(true)
  })

  it('消失的文件被跳过', async () => {
    const r = await findDuplicates([...files, { path: path.join(root, 'nope.fbx'), size: 23 }])
    expect(r.groups.find((g) => g.paths.length === 3)).toBeTruthy()
  })
})
