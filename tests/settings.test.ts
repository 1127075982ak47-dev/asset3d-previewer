import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../src/main/settings'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('sanitizeSettings', () => {
  it('空输入得到默认值', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('越界数值被钳位', () => {
    const s = sanitizeSettings({ concurrency: 99, maxDepth: 0, cacheLimitMB: -5 } as never)
    expect(s.concurrency).toBe(6)
    expect(s.maxDepth).toBe(1)
    expect(s.cacheLimitMB).toBe(0)
  })

  it('非法枚举回退默认', () => {
    const s = sanitizeSettings({ thumbSize: 333, lighting: 'disco', background: 'pink' } as never)
    expect(s.thumbSize).toBe(512)
    expect(s.lighting).toBe('studio')
    expect(s.background).toBe('transparent')
  })

  it('blenderPath 去空白，空串视为 null', () => {
    expect(sanitizeSettings({ blenderPath: '  ' }).blenderPath).toBeNull()
    expect(sanitizeSettings({ blenderPath: ' C:\\b\\blender.exe ' }).blenderPath).toBe('C:\\b\\blender.exe')
  })
})
