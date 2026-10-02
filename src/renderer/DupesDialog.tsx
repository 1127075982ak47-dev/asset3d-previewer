import { useEffect, useMemo, useState } from 'react'
import { fmtSize } from './Grid'
import { useEscape } from './Dialogs'
import type { DupeGroup, DupeProgress, ModelEntry, TrashResult } from '../shared/types'

interface Props {
  entries: ModelEntry[]
  getThumbUrl: (id: string) => string | undefined
  onClose: () => void
  onTrash: (paths: string[]) => Promise<TrashResult>
  onTag: (paths: string[], tag: string) => Promise<void>
  onReveal: (path: string) => void
}

type Phase = 'scanning' | 'done' | 'trashing' | 'trashed'

/** 重复文件查找：按内容哈希分组，默认勾选每组第一个以外的副本 */
export default function DupesDialog({ entries, getThumbUrl, onClose, onTrash, onTag, onReveal }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('scanning')
  const [progress, setProgress] = useState<DupeProgress>({ done: 0, total: 0 })
  const [groups, setGroups] = useState<DupeGroup[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<TrashResult | null>(null)
  useEscape(onClose)

  const byPath = useMemo(() => {
    const m = new Map<string, ModelEntry>()
    for (const e of entries) m.set(e.path.toLowerCase(), e)
    return m
  }, [entries])

  useEffect(() => {
    const off = window.api.onDupeProgress(setProgress)
    let alive = true
    void window.api
      .findDuplicates(entries.map((e) => ({ path: e.path, size: e.size })))
      .then((r) => {
        if (!alive) return
        setGroups(r.groups)
        const def = new Set<string>()
        for (const g of r.groups) for (const p of g.paths.slice(1)) def.add(p)
        setChecked(def)
        setPhase('done')
      })
    return () => {
      alive = false
      off()
      void window.api.cancelDuplicates()
    }
  }, [entries])

  const wasted = useMemo(() => groups.reduce((n, g) => n + g.size * (g.paths.length - 1), 0), [groups])
  const checkedBytes = useMemo(() => {
    let n = 0
    for (const g of groups) for (const p of g.paths) if (checked.has(p)) n += g.size
    return n
  }, [groups, checked])

  const toggle = (p: string): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  async function trash(): Promise<void> {
    setConfirm(false)
    setPhase('trashing')
    try {
      const r = await onTrash([...checked])
      setResult(r)
      const gone = new Set(r.removedPaths)
      setGroups((gs) => gs.map((g) => ({ ...g, paths: g.paths.filter((p) => !gone.has(p)) })).filter((g) => g.paths.length > 1))
      setChecked(prev => new Set([...prev].filter(p => !gone.has(p))))
    } catch (err) {
      setResult({ ok: false, done: 0, removedPaths: [], failed: [err instanceof Error ? err.message : String(err)] })
    } finally {
      setPhase('trashed')
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dupes" onClick={(e) => e.stopPropagation()}>
        <h3>查找重复文件</h3>
        {phase === 'scanning' && (
          <div className="dupes-scanning">
            <span className="spinner" />
            <div>
              先按大小分组，再对大小相同的文件计算完整哈希…
              <br />
              <span className="note">
                {progress.total > 0 ? `${progress.done} / ${progress.total} 个候选文件` : `${entries.length} 个文件`}
              </span>
            </div>
          </div>
        )}

        {phase !== 'scanning' && groups.length === 0 && (
          <p className="note">
            {phase === 'trashed' ? '重复文件已清理完毕。' : `${entries.length} 个模型里没有内容完全相同的文件。`}
          </p>
        )}

        {groups.length > 0 && (
          <>
            <p className="note">
              找到 {groups.length} 组重复，共占用多余空间 {fmtSize(wasted)}。默认勾选每组除第一个以外的副本，删除会进回收站，可以找回。
            </p>
            <div className="dupes-list">
              {groups.map((g) => (
                <div key={g.hash} className="dupe-group">
                  <div className="dupe-head">
                    {g.paths.length} 个相同文件 · {fmtSize(g.size)}
                  </div>
                  {g.paths.map((p) => {
                    const e = byPath.get(p.toLowerCase())
                    const url = e ? getThumbUrl(e.id) : undefined
                    return (
                      <label key={p} className={`dupe-row${checked.has(p) ? ' on' : ''}`}>
                        <input type="checkbox" checked={checked.has(p)} onChange={() => toggle(p)} />
                        <span className="dupe-thumb">{url ? <img src={url} alt="" /> : <span className="mini">—</span>}</span>
                        <span className="dupe-path" title={p}>
                          {e?.rel ?? p}
                        </span>
                        <i
                          className="link"
                          onClick={(ev) => {
                            ev.preventDefault()
                            onReveal(p)
                          }}
                        >
                          定位
                        </i>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        {result && (
          <p className={`note${result.failed.length ? ' danger' : ''}`}>
            已删除 {result.done} 个到回收站{result.failed.length ? `，${result.failed.length} 个失败：${result.failed.join('；')}` : ''}
          </p>
        )}

        <div className="actions">
          {groups.length > 0 && !confirm && (
            <>
              <button
                onClick={() => {
                  const def = new Set<string>()
                  for (const g of groups) for (const p of g.paths.slice(1)) def.add(p)
                  setChecked(def)
                }}
              >
                只留每组第一个
              </button>
              <button onClick={() => setChecked(new Set())}>清空勾选</button>
              <button
                disabled={checked.size === 0}
                onClick={() => void onTag([...checked], '重复').then(() => setResult({ ok: true, done: 0, failed: [], removedPaths: [] }))}
                title="给勾选的文件加上「重复」标签，之后再决定"
              >
                打标签「重复」
              </button>
              <button className="danger" disabled={checked.size === 0 || phase === 'trashing'} onClick={() => setConfirm(true)}>
                删除勾选 {checked.size} 个（{fmtSize(checkedBytes)}）
              </button>
            </>
          )}
          {confirm && (
            <>
              <span className="note">确定把 {checked.size} 个文件移到回收站？</span>
              <button onClick={() => setConfirm(false)}>取消</button>
              <button className="danger" onClick={() => void trash()}>
                确定删除
              </button>
            </>
          )}
          <div className="spacer" />
          <button className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
