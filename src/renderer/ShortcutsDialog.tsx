interface Props {
  onClose: () => void
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '网格',
    rows: [
      ['Ctrl+O', '打开文件夹'],
      ['F5', '重新扫描'],
      ['Ctrl+F', '搜索'],
      ['双击 / Enter', '放大查看'],
      ['方向键 / Home / End / PgUp / PgDn', '移动焦点'],
      ['Ctrl+点击 / Shift+点击 / Ctrl+A', '多选 / 连选 / 全选'],
      ['Ctrl+D', '收藏 / 取消收藏'],
      ['Ctrl+B', '文件夹侧栏'],
      ['Ctrl+= / Ctrl+-', '放大 / 缩小卡片'],
      ['Esc', '取消选择 / 关闭弹层'],
      ['拖拽卡片到窗口外', '拖进 Blender / Unity / 资源管理器']
    ]
  },
  {
    title: '查看器',
    rows: [
      ['左键拖拽 / 滚轮 / 右键拖拽', '旋转 / 缩放 / 平移'],
      ['← →', '上一个 / 下一个'],
      ['F', '重置视角'],
      ['1 / 3 / 7 / 5', '前视 / 侧视 / 顶视 / 等轴'],
      ['W', '线框'],
      ['G', '地面网格'],
      ['R', '自动旋转'],
      ['空格', '播放 / 暂停动画'],
      ['Esc', '返回网格']
    ]
  },
  {
    title: '全局',
    rows: [
      ['F1', '本帮助'],
      ['F11', '全屏'],
      ['Ctrl+,', '设置']
    ]
  }
]

export default function ShortcutsDialog({ onClose }: Props): JSX.Element {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal shortcuts" onClick={(e) => e.stopPropagation()}>
        <h3>快捷键</h3>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4>{g.title}</h4>
              <table>
                <tbody>
                  {g.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <kbd>{k}</kbd>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
