import { screen, type BrowserWindow } from 'electron'
import path from 'node:path'
import { cacheDir } from './cache'
import { readJsonRecover, writeJsonAtomic } from './jsonStore'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

const DEFAULT_STATE: WindowState = {
  width: 1440,
  height: 900,
  maximized: false
}

function file(): string {
  return path.join(cacheDir(), 'window.json')
}

/**
 * 判断窗口是否至少有一部分落在某块显示器上。
 *
 * 必须查：用户可能上次在副屏最大化，这次副屏没接，
 * 直接套用旧坐标窗口就跑到屏幕外面去了，看起来像"打不开"。
 */
function isOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false
  const visible = { x: state.x, y: state.y, width: state.width, height: state.height }
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return (
      visible.x < b.x + b.width &&
      visible.x + visible.width > b.x &&
      visible.y < b.y + b.height &&
      visible.y + visible.height > b.y
    )
  })
}

export function loadWindowState(): WindowState {
  const saved = readJsonRecover<Partial<WindowState>>(file(), () => ({})) ?? {}
  const dimension = (value: unknown, fallback: number, min: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(7680, Math.max(min, Math.round(value))) : fallback

  const state: WindowState = {
    width: dimension(saved.width, DEFAULT_STATE.width, 900),
    height: dimension(saved.height, DEFAULT_STATE.height, 600),
    x: typeof saved.x === 'number' && Number.isFinite(saved.x) ? Math.round(saved.x) : undefined,
    y: typeof saved.y === 'number' && Number.isFinite(saved.y) ? Math.round(saved.y) : undefined,
    maximized: !!saved.maximized
  }

  if (!isOnSomeDisplay(state)) {
    // 落在屏幕外就交给系统居中
    delete state.x
    delete state.y
  }
  return state
}

/**
 * 开始跟踪窗口的位置与大小。
 * 只记录非最大化时的几何尺寸，否则还原之后窗口会变成全屏那么大。
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const persist = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    let geom: Electron.Rectangle
    try {
      geom = maximized ? win.getNormalBounds() : win.getBounds()
    } catch {
      return
    }
    const state: WindowState = {
      width: geom.width,
      height: geom.height,
      x: geom.x,
      y: geom.y,
      maximized
    }
    try {
      writeJsonAtomic(file(), state)
    } catch {
      // 只读介质上跑绿色版时写不了，不该因此崩溃
    }
  }

  // 拖动/缩放会疯狂触发事件，防抖一下别把磁盘写爆
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 400)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  // close 时同步写一次，防抖的那次可能还没落盘
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })
}
