import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLaunchArgs, type PathKind } from '../src/main/argv'

const fsMap: Record<string, PathKind> = {
  [path.resolve('D:\\素材')]: 'dir',
  [path.resolve('D:\\素材\\a.fbx')]: 'file',
  [path.resolve('E:\\')]: 'dir'
}
const kindOf = (p: string): PathKind => fsMap[p] ?? null

describe('parseLaunchArgs', () => {
  it('--folder=X', () => {
    expect(parseLaunchArgs(['app.exe', '--folder=D:\\素材'], { isPackaged: true, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
  })

  it('--folder="X" 带引号', () => {
    expect(parseLaunchArgs(['app.exe', '--folder="D:\\素材"'], { isPackaged: true, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
  })

  it('--folder X 空格分隔', () => {
    expect(parseLaunchArgs(['app.exe', '--folder', 'D:\\素材'], { isPackaged: true, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
  })

  it('位置参数：拖文件夹到 exe 上', () => {
    expect(parseLaunchArgs(['app.exe', 'D:\\素材'], { isPackaged: true, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
  })

  it('位置参数是文件时取所在目录', () => {
    expect(parseLaunchArgs(['app.exe', 'D:\\素材\\a.fbx'], { isPackaged: true, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
  })

  it('盘符根目录', () => {
    expect(parseLaunchArgs(['app.exe', 'E:\\'], { isPackaged: true, kindOf })).toBe(path.resolve('E:\\'))
  })

  it('忽略 Chromium 开关和不存在的路径', () => {
    expect(
      parseLaunchArgs(['app.exe', '--no-sandbox', '--disable-gpu', 'Z:\\nope'], {
        isPackaged: true,
        kindOf
      })
    ).toBeNull()
  })

  it('开发模式跳过入口脚本参数', () => {
    expect(parseLaunchArgs(['electron.exe', '.', 'D:\\素材'], { isPackaged: false, kindOf })).toBe(
      path.resolve('D:\\素材')
    )
    expect(parseLaunchArgs(['electron.exe', '.'], { isPackaged: false, kindOf })).toBeNull()
  })
})
