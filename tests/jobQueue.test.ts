import { describe, expect, it } from 'vitest'
import { JobQueue } from '../src/main/jobQueue'

function q(cap = 600): JobQueue<string> {
  return new JobQueue<string>(cap)
}

describe('JobQueue', () => {
  it('按优先级取，数字小的先', () => {
    const j = q()
    j.push({ id: 'a', priority: 3, epoch: 0, payload: 'a' })
    j.push({ id: 'b', priority: 1, epoch: 0, payload: 'b' })
    j.push({ id: 'c', priority: 2, epoch: 0, payload: 'c' })
    expect(j.next()!.id).toBe('b')
    expect(j.next()!.id).toBe('c')
    expect(j.next()!.id).toBe('a')
    expect(j.next()).toBeUndefined()
  })

  it('可见的永远排在不可见的前面，哪怕优先级数字更大', () => {
    const j = q()
    j.push({ id: 'far-but-visible', priority: 9, epoch: 0, payload: '' })
    j.push({ id: 'near-but-hidden', priority: 0, epoch: 0, payload: '' })
    j.setVisible(['far-but-visible'])
    expect(j.next()!.id).toBe('far-but-visible')
    expect(j.next()!.id).toBe('near-but-hidden')
  })

  it('bumpEpoch 清空并返回被清掉的任务', () => {
    const j = q()
    j.push({ id: 'a', priority: 0, epoch: 0, payload: '' })
    j.push({ id: 'b', priority: 0, epoch: 0, payload: '' })
    const removed = j.bumpEpoch()
    expect(removed.map((x) => x.id)).toEqual(['a', 'b'])
    expect(j.size).toBe(0)
    expect(j.epoch).toBe(1)
  })

  it('超过上限时退回最远的不可见任务，可见的保留', () => {
    const j = q(3)
    for (let i = 0; i < 6; i++) j.push({ id: `j${i}`, priority: i, epoch: 0, payload: '' })
    const dropped = j.setVisible(['j5'])
    expect(j.size).toBe(3)
    expect(dropped.map((x) => x.id).sort()).toEqual(['j2', 'j3', 'j4'])
    // 可见的 j5 还在
    const ids: string[] = []
    let n
    while ((n = j.next())) ids.push(n.id)
    expect(ids[0]).toBe('j5')
    expect(ids.sort()).toEqual(['j0', 'j1', 'j5'])
  })

  it('unshift 放回队头后仍按分数取', () => {
    const j = q()
    j.push({ id: 'a', priority: 5, epoch: 0, payload: '' })
    j.unshift({ id: 'inflight', priority: 0, epoch: 0, payload: '' })
    expect(j.next()!.id).toBe('inflight')
  })

  it('remove 按 id 踢出', () => {
    const j = q()
    j.push({ id: 'a', priority: 0, epoch: 0, payload: '' })
    j.push({ id: 'b', priority: 0, epoch: 0, payload: '' })
    expect(j.remove('a').length).toBe(1)
    expect(j.size).toBe(1)
    expect(j.next()!.id).toBe('b')
  })
})
