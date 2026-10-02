/**
 * 出图任务的优先级队列。纯逻辑、不依赖 electron，方便单测。
 *
 * 设计要点：
 *  - 优先级数字越小越先出（代表离视口中心的行距）。
 *  - 可见集合实时更新：可见的任务永远排在不可见的前面，
 *    快速滚过几千张卡片后，当前屏幕上的永远先出，而不是按入队顺序死等。
 *  - epoch 用于换文件夹时批量作废；作废的任务由调用方以 pending 状态退回。
 *  - 队列超过上限时把最远的不可见任务退回，避免一次滚动把几千个任务全压进来。
 */
export interface QueuedJob<T> {
  id: string
  priority: number
  epoch: number
  payload: T
}

export class JobQueue<T> {
  private items: QueuedJob<T>[] = []
  private visible = new Set<string>()
  epoch = 0

  constructor(public cap = 600) {}

  get size(): number {
    return this.items.length
  }

  push(job: QueuedJob<T>): void {
    this.items.push(job)
  }

  /** 放回队头，供 worker 被销毁时把在途任务还回来 */
  unshift(job: QueuedJob<T>): void {
    this.items.unshift(job)
  }

  isVisible(id: string): boolean {
    return this.visible.has(id)
  }

  /**
   * 更新可见集合。返回因为超出上限而被退回的任务（都是不可见的、最远的）。
   */
  setVisible(ids: Iterable<string>): QueuedJob<T>[] {
    this.visible = new Set(ids)
    if (this.items.length <= this.cap) return []

    const keep: QueuedJob<T>[] = []
    const others: QueuedJob<T>[] = []
    for (const j of this.items) (this.visible.has(j.id) || j.priority < 0 ? keep : others).push(j)
    // 远的排后面，超出的部分退回
    others.sort((a, b) => a.priority - b.priority)
    const room = Math.max(0, this.cap - keep.length)
    const dropped = others.splice(room)
    this.items = keep.concat(others)
    return dropped
  }

  private score(j: QueuedJob<T>): number {
    return (this.visible.has(j.id) ? 0 : 1_000_000) + j.priority
  }

  /** 取出当前最该做的一个 */
  next(eligible: (j: QueuedJob<T>) => boolean = () => true): QueuedJob<T> | undefined {
    if (this.items.length === 0) return undefined
    let bi = -1
    let bs = Infinity
    for (let i = 0; i < this.items.length; i++) {
      if (!eligible(this.items[i])) continue
      const s = this.score(this.items[i])
      if (s < bs) {
        bs = s
        bi = i
      }
    }
    return bi >= 0 ? this.items.splice(bi, 1)[0] : undefined
  }

  /** 让所有排队中的任务失效并清空，返回被清掉的 */
  bumpEpoch(keep: (j: QueuedJob<T>) => boolean = () => false): QueuedJob<T>[] {
    this.epoch++
    const removed = this.items.filter(j => !keep(j))
    this.items = this.items.filter(keep)
    return removed
  }

  /** 按 id 移除（重新生成时先把旧的排队项踢掉） */
  remove(id: string): QueuedJob<T>[] {
    const removed = this.items.filter((j) => j.id === id)
    if (removed.length) this.items = this.items.filter((j) => j.id !== id)
    return removed
  }
}
