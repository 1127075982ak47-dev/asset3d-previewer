import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/types'
import { MESH_EXTS } from '../shared/formats'

interface Props {
  onClose: () => void
}

export default function AboutDialog({ onClose }: Props): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.appInfo().then(setInfo)
  }, [])

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal about" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <div className="about-logo">🧊</div>
          <div>
            <h3 style={{ margin: 0 }}>3D 资源预览器</h3>
            <div className="note">
              v{info?.version ?? '…'} · 免费软件 · MIT 许可
            </div>
          </div>
        </div>

        <p className="note">
          批量预览 3D 素材的桌面工具：指向一个文件夹，立刻得到一墙缩略图；
          双击放大查看、拖拽旋转、直接拖进 Blender / Unity / UE。
          <br />
          本软件完全免费，没有任何付费功能，也不联网。
        </p>

        <div className="about-grid">
          <span>可预览格式</span>
          <b style={{ fontWeight: 400, lineHeight: 1.7 }}>
            {MESH_EXTS.map((e) => e.slice(1)).join(' · ')} · blend（需 Blender）
          </b>
          <span>Electron</span>
          <b>{info?.electron}</b>
          <span>Chromium</span>
          <b>{info?.chrome}</b>
          <span>数据目录</span>
          <b style={{ wordBreak: 'break-all', fontWeight: 400 }}>
            {info?.dataDir}
            {info?.portable ? '（绿色版，随程序目录走）' : ''}
          </b>
        </div>

        <div className="actions">
          <button onClick={() => void window.api.openDataDir()}>打开数据目录</button>
          <button onClick={() => void window.api.openLogs()}>打开日志目录</button>
          <div className="spacer" />
          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
