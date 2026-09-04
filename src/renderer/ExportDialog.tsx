import type { ExportBatchResult } from '../shared/types'

export interface ExportState {
  total: number
  done: number
  name: string
  dir: string
  result?: ExportBatchResult
}

interface Props {
  state: ExportState
  onClose: () => void
  onOpenDir: (dir: string) => void
}

/** 批量导出的进度 / 结果弹层 */
export default function ExportDialog({ state, onClose, onOpenDir }: Props): JSX.Element {
  const r = state.result
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0
  return (
    <div className="modal-mask" onClick={r ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 420 }}>
        <h3>{r ? '导出完成' : '正在导出…'}</h3>
        {!r && (
          <>
            <div className="progress" style={{ flex: 'none', width: '100%', height: 8 }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="note">
              {state.done} / {state.total} · {state.name}
            </p>
            <p className="note">.blend 需要调用 Blender 转换，转为 GLB 需要重新编码贴图，会慢一些。</p>
          </>
        )}
        {r && (
          <>
            <p>
              成功 {r.done ?? 0} / {r.total ?? state.total}
              {r.failed && r.failed.length > 0 && (
                <span style={{ color: 'var(--danger)' }}> · 失败 {r.failed.length}</span>
              )}
            </p>
            <p className="note" style={{ wordBreak: 'break-all' }}>
              {state.dir}
            </p>
            {r.failed && r.failed.length > 0 && (
              <pre className="errbox">{r.failed.join('\n')}</pre>
            )}
            {r.error && <pre className="errbox">{r.error}</pre>}
            <div className="actions">
              <button onClick={() => onOpenDir(state.dir)}>打开目录</button>
              <button className="primary" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
