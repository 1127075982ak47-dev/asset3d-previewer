import { createHash } from 'node:crypto'

/** 不依赖 electron，方便在纯 Node 环境下测试扫描逻辑 */
export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}
