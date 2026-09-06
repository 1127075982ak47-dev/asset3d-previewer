import { useEffect, useRef, useState } from 'react'
import type { ModelEntry } from '../shared/types'

/** 弹层通用：Esc 关闭（捕获阶段，不让网格的快捷键先拿到） */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
}

interface ConfirmProps {
  title: string
  message: React.ReactNode
  confirmLabel: string
  danger?: boolean
  details?: string[]
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmDialog(p: ConfirmProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  useEscape(p.onClose)
  return (
    <div className="modal-mask" onClick={p.onClose}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
        <h3>{p.title}</h3>
        <div className="confirm-body">{p.message}</div>
        {p.details && p.details.length > 0 && (
          <pre className="errbox small">{p.details.slice(0, 30).join('\n')}{p.details.length > 30 ? `\n… 共 ${p.details.length} 项` : ''}</pre>
        )}
        <div className="actions">
          <button onClick={p.onClose} disabled={busy}>
            取消
          </button>
          <button
            className={p.danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void Promise.resolve(p.onConfirm()).finally(() => setBusy(false))
            }}
          >
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface RenameProps {
  entry: ModelEntry
  onClose: () => void
  /** 返回错误文案；成功返回 null（并由调用方关闭） */
  onRename: (newName: string) => Promise<string | null>
}

export function RenameDialog({ entry, onClose, onRename }: RenameProps): JSX.Element {
  const [name, setName] = useState(entry.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    const err = await onRename(name)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal rename" onClick={(e) => e.stopPropagation()}>
        <h3>重命名</h3>
        <p className="note wrap">{entry.rel}</p>
        <div className="field" style={{ borderBottom: 'none' }}>
          <input
            ref={ref}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            style={{ flex: 1 }}
            disabled={busy}
          />
          <span className="note">{entry.ext}</span>
        </div>
        {error && <p className="note danger">{error}</p>}
        <p className="note">
          扩展名保持不变。.fbx 的同名 .fbm 贴图目录会一起改名；收藏、标签、评分会跟着新名字走。
        </p>
        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={() => void submit()} disabled={busy || !name.trim() || name === entry.name}>
            改名
          </button>
        </div>
      </div>
    </div>
  )
}
