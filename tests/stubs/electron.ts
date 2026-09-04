/** 单测用的 electron 桩：只提供被纯逻辑模块间接引用到的最小表面 */
import os from 'node:os'
import path from 'node:path'

const userData = path.join(os.tmpdir(), 'asset3d-test-userdata')

export const app = {
  isPackaged: false,
  getPath: (_name: string): string => userData,
  setPath: (): void => {},
  getAppPath: (): string => process.cwd(),
  getVersion: (): string => '0.0.0-test'
}

export const dialog = {}
export const shell = {}
export const net = {}
export const protocol = {}
export const ipcMain = { handle: (): void => {}, on: (): void => {} }
export const BrowserWindow = class {}
export const nativeImage = {}
export const Menu = { setApplicationMenu: (): void => {}, buildFromTemplate: (): unknown => ({}) }
export const screen = { getAllDisplays: (): unknown[] => [] }
