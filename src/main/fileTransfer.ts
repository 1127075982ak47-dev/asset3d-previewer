import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { checkDependencies } from './dependencies'
import { isRealWithin, isWithin } from './pathPolicy'

async function exists(p: string): Promise<boolean> {
  try { await fsp.lstat(p); return true } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/** 依赖保持内部文件名不变，保留相对引用。 */
export async function companionsOf(file: string): Promise<string[]> {
  const dir = path.dirname(file)
  const deps = await checkDependencies(file)
  const files = new Set<string>()
  for (const r of deps.required) {
    const abs = path.resolve(dir, r)
    if (isWithin(dir, abs) && await exists(abs)) {
      if (!isRealWithin(dir, abs)) throw new Error(`依赖链接指向目录外：${r}`)
      files.add(abs)
    }
  }
  if (['.fbx', '.lwo', '.md2', '.pmx', '.pmd'].includes(path.extname(file).toLowerCase())) {
    const fbm = path.join(dir, `${path.basename(file, path.extname(file))}.fbm`)
    if (await exists(fbm)) files.add(fbm)
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory() && /^(textures?|maps?|images?|tex|.*\.fbm)$/i.test(item.name)) files.add(path.join(dir, item.name))
      if (item.isFile() && /\.(png|jpe?g|tga|dds|bmp|tiff?|webp|ktx2)$/i.test(item.name)) files.add(path.join(dir, item.name))
    }
  }
  return [...files]
}

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)])
  return sa.isFile() && sb.isFile() && sa.size === sb.size && await digest(a) === await digest(b)
}

async function flatten(root: string, item: string): Promise<string[]> {
  if (!isRealWithin(root, item)) throw new Error(`依赖位于资源目录外：${item}`)
  const st = await fsp.lstat(item)
  if (st.isSymbolicLink()) throw new Error(`请先把依赖链接复制为实际文件：${item}`)
  if (st.isFile()) return [item]
  if (!st.isDirectory()) throw new Error(`依赖不是普通文件：${item}`)
  const out: string[] = []
  for (const child of await fsp.readdir(item)) out.push(...await flatten(root, path.join(item, child)))
  return out
}

/** 复制依赖后最后提交模型，失败时撤回本次文件。源共享贴图保留。 */
export async function transferModel(src: string, dest: string, move: boolean): Promise<void> {
  const sourceDir = path.dirname(src)
  const destDir = path.dirname(dest)
  if (path.resolve(src).toLowerCase() === path.resolve(dest).toLowerCase()) return
  if (await exists(dest)) throw new Error('目标目录已有同名模型')
  const deps = await checkDependencies(src)
  if (deps.missing.length) throw new Error(`模型缺少依赖：${deps.missing.join('、')}`)
  if (deps.required.some(r => !isWithin(sourceDir, path.resolve(sourceDir, r)))) {
    throw new Error('模型引用了父目录资源，请先导出为 GLB 后再移动或导出')
  }
  const plans: { src: string; dest: string }[] = []
  const seen = new Set<string>()
  for (const c of await companionsOf(src)) {
    for (const f of await flatten(sourceDir, c)) {
      if (seen.has(f.toLowerCase())) continue
      seen.add(f.toLowerCase())
      const target = path.join(destDir, path.relative(sourceDir, f))
      if (!isWithin(destDir, target)) throw new Error('依赖目标越出所选目录')
      if (await exists(target)) {
        if (!isRealWithin(destDir, target) || !(await sameFile(f, target))) {
          throw new Error(`依赖同名但内容不同：${path.relative(destDir, target)}。请选择空目录或导出 GLB`)
        }
      } else plans.push({ src: f, dest: target })
    }
  }
  await fsp.mkdir(destDir, { recursive: true })
  const stage = path.join(destDir, `.asset3d-stage-${randomUUID()}`)
  const created: string[] = []
  await fsp.mkdir(stage)
  try {
    const all = [...plans, { src, dest }]
    for (let i = 0; i < all.length; i++) {
      const p = all[i]
      const temp = path.join(stage, String(i))
      const before = await fsp.stat(p.src)
      await fsp.copyFile(p.src, temp, fs.constants.COPYFILE_EXCL)
      const after = await fsp.stat(p.src)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('源文件在复制过程中发生变化，请重试')
      if (!(await sameFile(p.src, temp))) throw new Error('复制校验失败，源文件已保留')
      await fsp.mkdir(path.dirname(p.dest), { recursive: true })
      if (!isRealWithin(destDir, path.dirname(p.dest))) throw new Error('目标目录链接指向所选目录外')
      const output = await fsp.open(p.dest, 'wx')
      created.push(p.dest)
      try {
        for await (const chunk of fs.createReadStream(temp)) await output.writeFile(chunk)
        await output.sync()
      } finally { await output.close() }
      await fsp.utimes(p.dest, before.atime, before.mtime)
    }
    if (move) await fsp.unlink(src)
  } catch (err) {
    const rollbackErrors: string[] = []
    for (const p of created.reverse()) {
      try { await fsp.unlink(p) } catch { rollbackErrors.push(p) }
    }
    if (rollbackErrors.length) throw new Error(`源文件已保留；部分目标需要手动清理：${rollbackErrors.join('、')}。${String(err)}`)
    throw err
  } finally {
    if (isWithin(destDir, stage)) await fsp.rm(stage, { recursive: true, force: true })
  }
}
