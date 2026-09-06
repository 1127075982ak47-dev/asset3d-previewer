import { useEffect, useState } from 'react'
import { useEscape } from './Dialogs'
import { THUMB_ANGLES, THUMB_SHADINGS, type AppSettings, type BlenderInfo } from '../shared/types'

interface Props {
  settings: AppSettings
  blender: BlenderInfo | null
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => Promise<void>
  onBlenderRedetect: (path: string | null) => Promise<BlenderInfo>
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

type Section = 'thumb' | 'scan' | 'blender' | 'system'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'thumb', label: '缩略图' },
  { key: 'scan', label: '扫描与界面' },
  { key: 'blender', label: 'Blender' },
  { key: 'system', label: '缓存与系统' }
]

export default function Settings({ settings, blender, onClose, onSave, onBlenderRedetect }: Props): JSX.Element {
  const [local, setLocal] = useState<AppSettings>(settings)
  const [cache, setCache] = useState<{ dir: string; files: number; bytes: number } | null>(null)
  const [bl, setBl] = useState<BlenderInfo | null>(blender)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [section, setSection] = useState<Section>('thumb')
  useEscape(onClose)

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

  const note = (text: string): JSX.Element => <span className="hint">{text}</span>

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-layout">
          <div className="settings-nav">
            <h3>设置</h3>
            {SECTIONS.map((s) => (
              <div key={s.key} className={`snav${section === s.key ? ' on' : ''}`} onClick={() => setSection(s.key)}>
                {s.label}
              </div>
            ))}
          </div>

          <div className="settings-body">
            {section === 'thumb' && (
              <>
                <div className="field">
                  <label>分辨率</label>
                  <div className="ctl">
                    <select value={local.thumbSize} onChange={(e) => patch({ thumbSize: Number(e.target.value) })}>
                      <option value={256}>256 px（快）</option>
                      <option value={512}>512 px（推荐）</option>
                      <option value={768}>768 px</option>
                      <option value={1024}>1024 px（慢、占空间）</option>
                    </select>
                    {note('改动后按新分辨率重新出图，旧缓存保留')}
                  </div>
                </div>

                <div className="field">
                  <label>光照与背景</label>
                  <div className="ctl">
                    <select
                      value={local.lighting}
                      onChange={(e) => patch({ lighting: e.target.value as AppSettings['lighting'] })}
                    >
                      <option value="studio">影棚光（默认）</option>
                      <option value="outdoor">室外光</option>
                      <option value="neutral">中性光</option>
                    </select>
                    <select
                      value={local.background}
                      onChange={(e) => patch({ background: e.target.value as AppSettings['background'] })}
                    >
                      <option value="transparent">透明背景</option>
                      <option value="dark">深灰背景</option>
                      <option value="light">浅灰背景</option>
                      <option value="white">纯白背景</option>
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>相机角度</label>
                  <div className="ctl">
                    <select
                      value={local.thumbAngle}
                      onChange={(e) => patch({ thumbAngle: e.target.value as AppSettings['thumbAngle'] })}
                    >
                      {THUMB_ANGLES.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {note('也可以在查看器里把任意视角设为某个模型的缩略图')}
                  </div>
                </div>

                <div className="field">
                  <label>着色</label>
                  <div className="ctl">
                    <select
                      value={local.thumbShading}
                      onChange={(e) => patch({ thumbShading: e.target.value as AppSettings['thumbShading'] })}
                    >
                      {THUMB_SHADINGS.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {note('白膜 / 雕塑更能看清结构，适合挑选布线')}
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
                    {note('越多越快，但更吃显存')}
                  </div>
                </div>
              </>
            )}

            {section === 'scan' && (
              <>
                <div className="field">
                  <label>递归子文件夹</label>
                  <div className="ctl">
                    <input type="checkbox" checked={local.recursive} onChange={(e) => patch({ recursive: e.target.checked })} />
                    {note('最大深度')}
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={local.maxDepth}
                      onChange={(e) => patch({ maxDepth: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
                      style={{ width: 72 }}
                    />
                  </div>
                </div>

                <div className="field">
                  <label>列出无法预览的格式</label>
                  <div className="ctl">
                    <input
                      type="checkbox"
                      checked={local.showUnsupported}
                      onChange={(e) => patch({ showUnsupported: e.target.checked })}
                    />
                    {note('.max / .c4d / .ma / .skp 等私有格式也显示成卡片，可拖出和用默认程序打开')}
                  </div>
                </div>

                <div className="field">
                  <label>启动时打开上次的文件夹</label>
                  <div className="ctl">
                    <input type="checkbox" checked={local.reopenLast} onChange={(e) => patch({ reopenLast: e.target.checked })} />
                    {note('带参数启动或拖文件夹到图标上时不受影响')}
                  </div>
                </div>

                <div className="field">
                  <label>外观</label>
                  <div className="ctl">
                    <div className="seg">
                      <button className={local.theme === 'light' ? 'on' : ''} onClick={() => patch({ theme: 'light' })}>
                        浅色
                      </button>
                      <button className={local.theme === 'dark' ? 'on' : ''} onClick={() => patch({ theme: 'dark' })}>
                        深色
                      </button>
                    </div>
                    {note('保存后立即生效')}
                  </div>
                </div>
              </>
            )}

            {section === 'blender' && (
              <>
                <div className="field">
                  <label>.blend 自动转换</label>
                  <div className="ctl">
                    <input
                      type="checkbox"
                      checked={local.blendAutoConvert}
                      onChange={(e) => patch({ blendAutoConvert: e.target.checked })}
                    />
                    {note('后台调 Blender 转 GLB，换取完整 3D 交互')}
                  </div>
                </div>

                <div className="field">
                  <label>Blender 路径</label>
                  <div className="ctl">
                    <input
                      type="text"
                      placeholder="留空则自动探测（blender.exe 或其所在目录）"
                      value={local.blenderPath ?? ''}
                      onChange={(e) => patch({ blenderPath: e.target.value || null })}
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={() => {
                        setBusy(true)
                        void onBlenderRedetect(local.blenderPath).then((i) => {
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
                      已检测到 {bl.installs.length} 个 Blender：{bl.installs.map((i) => i.version).join(' / ')}
                      <br />
                      转换时会自动挑选版本不低于该 .blend 保存版本的那个（高版本存的文件低版本打不开）。
                    </>
                  ) : (
                    <>
                      未检测到 Blender。.blend 文件将只能显示保存时内嵌的静态预览图，无法进入 3D 旋转查看 ——
                      这是 .blend 格式本身的限制，没有任何 JS 库能解析它的几何体。
                    </>
                  )}
                </p>
              </>
            )}

            {section === 'system' && (
              <>
                <div className="field">
                  <label>缓存上限</label>
                  <div className="ctl">
                    <select value={local.cacheLimitMB} onChange={(e) => patch({ cacheLimitMB: Number(e.target.value) })}>
                      <option value={512}>512 MB</option>
                      <option value={1024}>1 GB</option>
                      <option value={2048}>2 GB</option>
                      <option value={4096}>4 GB</option>
                      <option value={8192}>8 GB</option>
                      <option value={0}>不限制</option>
                    </select>
                    {note('超出后自动删除最久没用的缩略图')}
                  </div>
                </div>

                <div className="field">
                  <label>缓存</label>
                  <div className="ctl">
                    <span className="hint">{cache ? `${cache.files} 个文件 · ${fmtBytes(cache.bytes)}` : '统计中…'}</span>
                    {!confirmClear ? (
                      <button onClick={() => setConfirmClear(true)} disabled={busy}>
                        清空缓存
                      </button>
                    ) : (
                      <>
                        {note('所有缩略图和转换结果都要重新生成，确定？')}
                        <button
                          className="danger"
                          onClick={() => {
                            setBusy(true)
                            setConfirmClear(false)
                            void window.api.clearCache().then(async () => {
                              setCache(await window.api.cacheInfo())
                              setBusy(false)
                            })
                          }}
                          disabled={busy}
                        >
                          确定清空
                        </button>
                        <button onClick={() => setConfirmClear(false)}>取消</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="field">
                  <label>GPU 硬件加速</label>
                  <div className="ctl">
                    <input type="checkbox" checked={!local.disableGpu} onChange={(e) => patch({ disableGpu: !e.target.checked })} />
                    <span className={`hint${local.disableGpu ? ' warn' : ''}`}>
                      {local.disableGpu
                        ? '已关闭：3D 全部由 CPU 软件渲染，会非常卡。只在显卡驱动异常导致花屏 / 崩溃时才关闭；改动后需重启'
                        : '推荐开启。关闭后 3D 全部由 CPU 软件渲染，会非常卡；改动后需重启程序'}
                    </span>
                  </div>
                </div>

                {cache && (
                  <p className="note wrap">
                    缓存位置：{cache.dir}
                    <br />
                    绿色版会优先把缓存和配置写在程序同级的 data 目录，整个文件夹可以直接拷走。
                  </p>
                )}
              </>
            )}
          </div>
        </div>

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
