import { useEffect, useMemo, useRef, useState } from 'react'
import { libKey } from '../shared/filters'
import type { ModelEntry } from '../shared/types'

export { libKey }

interface Props {
  entries: ModelEntry[]
  tags: Record<string, string[]>
  allTags: string[]
  onAdd: (tag: string) => Promise<void>
  onRemove: (tag: string) => Promise<void>
  onClose: () => void
}

/** 给一批模型加/减标签的小弹层 */
export default function TagEditor({ entries, tags, allTags, onAdd, onRemove, onClose }: Props): JSX.Element {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 全部都有 / 部分有，分开显示
  const { common, partial } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      for (const t of tags[libKey(e)] ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const common: string[] = []
    const partial: string[] = []
    for (const [t, n] of counts) (n === entries.length ? common : partial).push(t)
    return { common: common.sort(), partial: partial.sort() }
  }, [entries, tags])

  const suggestions = allTags.filter((t) => !common.includes(t))

  async function commit(): Promise<void> {
    const list = input
      .split(/[,，;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length === 0) return
    setBusy(true)
    for (const t of list) await onAdd(t)
    setInput('')
    setBusy(false)
    inputRef.current?.focus()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal tag-editor" onClick={(e) => e.stopPropagation()}>
        <h3>标签 · {entries.length === 1 ? entries[0].name : `${entries.length} 个模型`}</h3>

        <div className="tag-list">
          {common.length === 0 && partial.length === 0 && (
            <span className="note">还没有标签</span>
          )}
          {common.map((t) => (
            <span key={t} className="tag on">
              {t}
              <i onClick={() => void onRemove(t)} title="移除">
                ×
              </i>
            </span>
          ))}
          {partial.map((t) => (
            <span key={t} className="tag partial" title="只有部分选中项带这个标签，点击加到全部">
              <span onClick={() => void onAdd(t)}>{t}</span>
              <i onClick={() => void onRemove(t)} title="从全部移除">
                ×
              </i>
            </span>
          ))}
        </div>

        <div className="field" style={{ borderBottom: 'none' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="输入标签，逗号分隔，回车添加"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
            }}
            style={{ flex: 1 }}
            disabled={busy}
          />
          <button onClick={() => void commit()} disabled={busy || !input.trim()}>
            添加
          </button>
        </div>

        {suggestions.length > 0 && (
          <>
            <div className="note" style={{ marginTop: 4 }}>已有标签（点击添加）</div>
            <div className="tag-list">
              {suggestions.map((t) => (
                <span key={t} className="tag" onClick={() => void onAdd(t)}>
                  {t}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="actions">
          <button className="primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
