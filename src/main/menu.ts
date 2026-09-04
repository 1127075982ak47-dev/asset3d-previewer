import { Menu, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/types'

export interface MenuDeps {
  getWindow: () => BrowserWindow | null
  recent: () => string[]
  send: (action: MenuAction) => void
  openFolder: (dir: string) => void
  openLogs: () => void
  openData: () => void
}

/**
 * 应用菜单。窗口仍然 autoHideMenuBar（按 Alt 才显示），界面不变，
 * 但加速键从此生效；同时把默认菜单里的 reload / devtools 从打包版拿掉 ——
 * 1.0 用的是 Electron 默认菜单，Ctrl+R 一按整个渲染进程重载、状态全丢。
 */
export function installMenu(deps: MenuDeps): void {
  const recent = deps.recent()
  const recentItems: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: '（空）', enabled: false }]
      : recent.map((dir) => ({
          label: dir.length > 60 ? '…' + dir.slice(-58) : dir,
          click: () => deps.openFolder(dir)
        }))

  const viewItems: MenuItemConstructorOptions[] = [
    { label: '放大卡片', accelerator: 'CmdOrCtrl+=', click: () => deps.send('zoom-in') },
    { label: '缩小卡片', accelerator: 'CmdOrCtrl+-', click: () => deps.send('zoom-out') },
    { type: 'separator' },
    {
      label: '文件夹侧栏',
      accelerator: 'CmdOrCtrl+B',
      click: () => deps.send('toggle-sidebar')
    },
    {
      label: '全屏',
      accelerator: 'F11',
      click: () => {
        const w = deps.getWindow()
        if (w) w.setFullScreen(!w.isFullScreen())
      }
    }
  ]
  if (!app.isPackaged) {
    viewItems.push(
      { type: 'separator' },
      { role: 'reload', label: '重新加载（开发）' },
      { role: 'toggleDevTools', label: '开发者工具' }
    )
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+O', click: () => deps.send('open-folder') },
        { label: '最近打开', submenu: recentItems },
        { label: '重新扫描', accelerator: 'F5', click: () => deps.send('rescan') },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => deps.send('settings') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    { label: '查看', submenu: viewItems },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', accelerator: 'F1', click: () => deps.send('shortcuts') },
        { type: 'separator' },
        { label: '打开数据目录', click: () => deps.openData() },
        { label: '打开日志目录', click: () => deps.openLogs() },
        { type: 'separator' },
        { label: '关于', click: () => deps.send('about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
