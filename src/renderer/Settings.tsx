import { useEffect, useState } from 'react'
import type { AppSettings, BlenderInfo } from '../shared/types'

interface Props {
  settings: AppSettings
  blender: BlenderInfo | null
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => Promise<void>
  onBlenderRedetect: () => Promise<BlenderInfo>
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function Settings({
  settings,
  blender,
  onClose,
  onSave,
  onBlenderRedetect
}: Props): JSX.Element {
  const [local, setLocal] = useState<AppSettings>(settings)
  const [cache, setCache] = useState<{ dir: string; files: number; bytes: number } | null>(
    null
  )
  const [bl, setBl] = useState<BlenderInfo | null>(blender)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.cacheInfo().then(setCache)
  }, [])

  function patch(p: Partial<AppSettings>): void {
    setLocal((v) => ({ ...v, ...p }))
  }

  async function save(): Promise<void> {
    setBusy(true)
    const diff: Partial<AppSettings> = {}
    for (const k of Object.keys(local) as (keyof AppSettings)[]) {
      if (local[k] !== settings[k]) (diff as Record<string, unknown>)[k] = local[k]
    }
    await onSave(diff)
    setBusy(false)
    onClose()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>设置</h3>

        <div className="field">
          <label>缩略图分辨率</label>
          <div className="ctl">
            <select
              value={local.thumbSize}
              onChange={(e) => patch({ thumbSize: Number(e.target.value) })}
            >
              <option value={256}>256 px（快）</option>
              <option value={512}>512 px（推荐）</option>
              <option value={768}>768 px</option>
              <option value={1024}>1024 px（慢、占空间）</option>
            </select>
            <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>
              改动后会清空缓存重出
            </span>
          </div>
        </div>

        <div className="field">
          <label>并行渲染窗口</label>
          <div className="ctl">
            <input
              type="range"
              min={1}
              max={6}
              value={local.concurrency}
              onChange={(e) => patch({ concurrency: Number(e.target.value) })}
            />
            <b>{local.concurrency}</b>
            <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>
              越多越快，但更吃显存
            </span>
          </div>
        </div>

        <div className="field">
          <label>递归扫描子文件夹</label>
          <div className="ctl">
            <input
              type="checkbox"
              checked={local.recursive}
              onChange={(e) => patch({ recursive: e.target.checked })}
            />
            <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>最大深度</span>
            <input
              type="text"
              value={String(local.maxDepth)}
              onChange={(e) => patch({ maxDepth: Number(e.target.value) || 1 })}
              style={{ width: 52 }}
            />
          </div>
        </div>

        <div className="field">
          <label>.blend 自动转换</label>
          <div className="ctl">
            <input
              type="checkbox"
              checked={local.blendAutoConvert}
              onChange={(e) => patch({ blendAutoConvert: e.target.checked })}
            />
            <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>
              后台调 Blender 转 GLB，换取完整 3D 交互
            </span>
          </div>
        </div>

        <div className="field">
          <label>Blender 路径</label>
          <div className="ctl">
            <input
              type="text"
              placeholder="留空则自动探测"
              value={local.blenderPath ?? ''}
              onChange={(e) => patch({ blenderPath: e.target.value || null })}
              style={{ flex: 1 }}
            />
            <button
              onClick={() => {
                setBusy(true)
                void onBlenderRedetect().then((i) => {
                  setBl(i)
                  setBusy(false)
                })
              }}
              disabled={busy}
            >
              重新探测
            </button>
          </div>
        </div>

        <p className="note">
          {bl?.available ? (
            <>
              已检测到 {bl.installs.length} 个 Blender：
              {bl.installs.map((i) => i.version).join(' / ')}
              <br />
              转换时会自动挑选版本不低于该 .blend 保存版本的那个（高版本存的文件低版本打不开）。
            </>
          ) : (
            <>
              未检测到 Blender。.blend 文件将只能显示保存时内嵌的静态预览图，
              无法进入 3D 旋转查看 —— 这是 .blend 格式本身的限制，
              没有任何 JS 库能解析它的几何体。
            </>
          )}
        </p>

        <div className="field" style={{ marginTop: 10 }}>
          <label>缓存</label>
          <div className="ctl">
            <span style={{ color: 'var(--fg-dim)', fontSize: 12 }}>
              {cache ? `${cache.files} 个文件 · ${fmtBytes(cache.bytes)}` : '统计中…'}
            </span>
            <button
              onClick={() => {
                setBusy(true)
                void window.api.clearCache().then(async () => {
                  setCache(await window.api.cacheInfo())
                  setBusy(false)
                })
              }}
              disabled={busy}
            >
              清空缓存
            </button>
          </div>
        </div>

        {cache && (
          <p className="note" style={{ wordBreak: 'break-all' }}>
            缓存位置：{cache.dir}
            <br />
            绿色版会优先把缓存和配置写在程序同级的 data 目录，整个文件夹可以直接拷走。
          </p>
        )}

        <div className="actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
