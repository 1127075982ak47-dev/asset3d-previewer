import { useMemo, useState } from 'react'
import { SHADING_MODES } from './lib/shading'
import { BACKGROUNDS, type MaterialInfo, type NodeInfo, type ViewPreset, type ViewerPrefs } from './lib/viewerEngine'
import type { HdriEntry, ModelEntry, ModelStats } from '../shared/types'

export type PanelTab = 'display' | 'env' | 'camera' | 'anim' | 'tree' | 'info'

interface Props {
  entry: ModelEntry
  prefs: ViewerPrefs
  onPrefs: (patch: Partial<ViewerPrefs>) => void
  hdris: HdriEntry[]
  onImportHdri: () => void
  onRemoveHdri: (id: string) => void
  onOpenHdriDir: () => void
  stats: ModelStats | null
  clips: string[]
  clipIdx: number
  playing: boolean
  duration: number
  onClip: (i: number) => void
  onPlay: (on: boolean) => void
  onSeek: (t: number) => void
  timeInputRef: React.RefObject<HTMLInputElement>
  timeLabelRef: React.RefObject<HTMLSpanElement>
  hierarchy: NodeInfo[]
  soloed: string | null
  onNodeVisible: (uuid: string, v: boolean) => void
  onSolo: (uuid: string | null) => void
  materials: MaterialInfo[]
  onView: (p: ViewPreset) => void
  tab: PanelTab
  onTab: (t: PanelTab) => void
}

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'display', label: '显示' },
  { key: 'env', label: '环境' },
  { key: 'camera', label: '相机' },
  { key: 'anim', label: '动画' },
  { key: 'tree', label: '结构' },
  { key: 'info', label: '信息' }
]

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

function fmtDim(d: [number, number, number], unit: number): string {
  const f = (v: number): string => {
    const x = v * unit
    return x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toFixed(4)
  }
  return `${f(d[0])} × ${f(d[1])} × ${f(d[2])}`
}

function Toggle({
  label,
  value,
  onChange,
  hint
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  hint?: string
}): JSX.Element {
  return (
    <label className="prow toggle" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
}): JSX.Element {
  return (
    <div className="prow slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>{fmt ? fmt(value) : value}</b>
    </div>
  )
}

/** 查看器右侧的设置/信息面板 */
export default function ViewerPanel(p: Props): JSX.Element {
  const [unit, setUnit] = useState<number>(1)
  const [treeFilter, setTreeFilter] = useState('')

  const tree = useMemo(() => {
    const q = treeFilter.trim().toLowerCase()
    return q ? p.hierarchy.filter((n) => n.name.toLowerCase().includes(q)) : p.hierarchy
  }, [p.hierarchy, treeFilter])

  return (
    <div className="vpanel">
      <div className="vtabs">
        {TABS.map((t) => (
          <span key={t.key} className={`vtab${p.tab === t.key ? ' on' : ''}`} onClick={() => p.onTab(t.key)}>
            {t.label}
          </span>
        ))}
      </div>

      <div className="vpanel-body">
        {p.tab === 'display' && (
          <>
            <div className="psection">显示模式</div>
            <div className="mode-grid">
              {SHADING_MODES.map((m) => (
                <button
                  key={m.key}
                  className={p.prefs.mode === m.key ? 'on' : ''}
                  onClick={() => p.onPrefs({ mode: m.key })}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="psection">着色</div>
            <div className="prow seg">
              <button className={!p.prefs.flat ? 'on' : ''} onClick={() => p.onPrefs({ flat: false })}>
                平滑
              </button>
              <button className={p.prefs.flat ? 'on' : ''} onClick={() => p.onPrefs({ flat: true })}>
                平直
              </button>
            </div>
            <Toggle
              label="线框叠加"
              value={p.prefs.wireOverlay}
              onChange={(v) => p.onPrefs({ wireOverlay: v })}
              hint="在当前模式上叠加一层边线"
            />
            <Toggle
              label="环境光遮蔽 (AO)"
              value={p.prefs.ao}
              onChange={(v) => p.onPrefs({ ao: v })}
              hint="屏幕空间 AO（GTAO），缝隙和接触处会变暗，更有体积感"
            />
            <Toggle
              label="地面阴影"
              value={p.prefs.shadow}
              onChange={(v) => p.onPrefs({ shadow: v })}
              hint="模型底部投一片柔和阴影"
            />
            <div className="psection">辅助</div>
            <Toggle label="地面网格 (G)" value={p.prefs.grid} onChange={(v) => p.onPrefs({ grid: v })} />
            <Toggle label="坐标轴" value={p.prefs.axes} onChange={(v) => p.onPrefs({ axes: v })} />
            <Toggle label="包围盒" value={p.prefs.bbox} onChange={(v) => p.onPrefs({ bbox: v })} />
            <div className="psection">背景色</div>
            <div className="prow seg">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.key}
                  className={p.prefs.bg === b.key && !p.prefs.envVisible ? 'on' : ''}
                  onClick={() => p.onPrefs({ bg: b.key, envVisible: false })}
                  title={b.label}
                  style={{ background: `#${b.color.toString(16).padStart(6, '0')}`, minWidth: 28 }}
                >
                  &nbsp;
                </button>
              ))}
            </div>
          </>
        )}

        {p.tab === 'env' && (
          <>
            <div className="psection">环境光 (HDRI)</div>
            <div className="hdri-list">
              <div
                className={`hdri-item${p.prefs.envId === 'room' ? ' on' : ''}`}
                onClick={() => p.onPrefs({ envId: 'room' })}
                title="程序化的室内环境，零文件、最快"
              >
                <span className="hdri-swatch room" />
                <span className="hdri-name">程序化房间（默认）</span>
              </div>
              {p.hdris.map((h) => (
                <div
                  key={h.id}
                  className={`hdri-item${p.prefs.envId === h.id ? ' on' : ''}`}
                  onClick={() => p.onPrefs({ envId: h.id })}
                  title={h.builtin ? '内置（Poly Haven，CC0）' : '自定义'}
                >
                  <span className={`hdri-swatch${h.builtin ? ' builtin' : ' user'}`} />
                  <span className="hdri-name">{h.name}</span>
                  {!h.builtin && (
                    <i
                      className="hdri-remove"
                      title="删除这张 HDRI"
                      onClick={(e) => {
                        e.stopPropagation()
                        p.onRemoveHdri(h.id)
                      }}
                    >
                      ×
                    </i>
                  )}
                </div>
              ))}
            </div>
            <div className="prow" style={{ gap: 6 }}>
              <button onClick={p.onImportHdri}>导入 .hdr / .exr…</button>
              <button onClick={p.onOpenHdriDir} title="自定义 HDRI 存放目录">
                打开目录
              </button>
            </div>
            <Toggle
              label="显示为背景"
              value={p.prefs.envVisible}
              onChange={(v) => p.onPrefs({ envVisible: v })}
              hint="把 HDRI 直接画在场景背景上（程序化房间没有可见背景）"
            />
            <Slider
              label="强度"
              value={p.prefs.envIntensity}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => p.onPrefs({ envIntensity: v })}
              fmt={(v) => v.toFixed(2)}
            />
            <Slider
              label="旋转"
              value={p.prefs.envRotation}
              min={0}
              max={360}
              step={1}
              onChange={(v) => p.onPrefs({ envRotation: v })}
              fmt={(v) => `${v}°`}
            />
            <Slider
              label="背景模糊"
              value={p.prefs.envBlur}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) => p.onPrefs({ envBlur: v })}
              fmt={(v) => v.toFixed(2)}
            />
            <div className="psection">补光</div>
            <div className="prow">
              <select
                value={p.prefs.lighting}
                onChange={(e) => p.onPrefs({ lighting: e.target.value as ViewerPrefs['lighting'] })}
                style={{ flex: 1 }}
              >
                <option value="studio">影棚三点光</option>
                <option value="outdoor">室外光</option>
                <option value="neutral">中性光</option>
                <option value="none">无（只用环境光）</option>
              </select>
            </div>
            <p className="pnote">
              内置 HDRI 来自 Poly Haven（CC0，1k）。自定义的放进「打开目录」里的文件夹即可，绿色版随程序目录一起走。
            </p>
          </>
        )}

        {p.tab === 'camera' && (
          <>
            <div className="psection">视角</div>
            <div className="mode-grid">
              {(
                [
                  ['iso', '等轴 (5)'],
                  ['front', '前 (1)'],
                  ['back', '后'],
                  ['left', '左'],
                  ['right', '右 (3)'],
                  ['top', '顶 (7)'],
                  ['bottom', '底']
                ] as [ViewPreset, string][]
              ).map(([k, label]) => (
                <button key={k} onClick={() => p.onView(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="psection">投影</div>
            <div className="prow seg">
              <button className={!p.prefs.ortho ? 'on' : ''} onClick={() => p.onPrefs({ ortho: false })}>
                透视
              </button>
              <button className={p.prefs.ortho ? 'on' : ''} onClick={() => p.onPrefs({ ortho: true })}>
                正交
              </button>
            </div>
            <Slider
              label="视场角"
              value={p.prefs.fov}
              min={10}
              max={100}
              step={1}
              onChange={(v) => p.onPrefs({ fov: v })}
              fmt={(v) => `${v}°`}
            />
            <Toggle
              label="自动旋转 (R)"
              value={p.prefs.autoRotate}
              onChange={(v) => p.onPrefs({ autoRotate: v })}
            />
            <p className="pnote">左键旋转 · 滚轮缩放 · 右键平移 · F 重置视角 · 双击画布重置</p>
          </>
        )}

        {p.tab === 'anim' && (
          <>
            {p.clips.length === 0 ? (
              <p className="pnote">这个模型没有动画。</p>
            ) : (
              <>
                <div className="psection">动画片段 · {p.clips.length}</div>
                <div className="prow">
                  <select value={p.clipIdx} onChange={(e) => p.onClip(Number(e.target.value))} style={{ flex: 1 }}>
                    {p.clips.map((n, i) => (
                      <option key={i} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="prow" style={{ gap: 6 }}>
                  <button className={p.playing ? 'primary' : ''} onClick={() => p.onPlay(!p.playing)}>
                    {p.playing ? '⏸ 暂停' : '▶ 播放'}
                  </button>
                  <button
                    onClick={() => {
                      p.onSeek(0)
                    }}
                  >
                    ⏮
                  </button>
                  <span ref={p.timeLabelRef} className="anim-time">
                    0.00 / {p.duration.toFixed(2)}s
                  </span>
                </div>
                <input
                  ref={p.timeInputRef}
                  className="anim-scrub"
                  type="range"
                  min={0}
                  max={p.duration}
                  step={0.001}
                  defaultValue={0}
                  onInput={(e) => p.onSeek(Number((e.target as HTMLInputElement).value))}
                />
                <div className="prow seg">
                  {[0.25, 0.5, 1, 2].map((s) => (
                    <button
                      key={s}
                      className={p.prefs.animSpeed === s ? 'on' : ''}
                      onClick={() => p.onPrefs({ animSpeed: s })}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <Toggle label="循环播放" value={p.prefs.animLoop} onChange={(v) => p.onPrefs({ animLoop: v })} />
                <p className="pnote">空格键播放 / 暂停</p>
              </>
            )}
          </>
        )}

        {p.tab === 'tree' && (
          <>
            <div className="psection">
              节点 · {p.hierarchy.length}
              {p.hierarchy.length >= 3000 ? '+（只显示前 3000 个）' : ''}
            </div>
            <div className="prow">
              <input
                type="search"
                placeholder="筛选节点名…"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                style={{ flex: 1 }}
              />
              {p.soloed && (
                <button onClick={() => p.onSolo(null)} title="取消单独显示">
                  全部显示
                </button>
              )}
            </div>
            <div className="ntree">
              {tree.map((n) => (
                <div
                  key={n.uuid}
                  className={`nrow${p.soloed === n.uuid ? ' solo' : ''}${n.visible ? '' : ' hidden'}`}
                  style={{ paddingLeft: 6 + Math.min(n.depth, 12) * 10 }}
                  onDoubleClick={() => p.onSolo(p.soloed === n.uuid ? null : n.uuid)}
                  title={`${n.type}${n.isMesh ? ` · △${fmtNum(n.tris)}` : ''}\n双击：只看这个节点`}
                >
                  <input
                    type="checkbox"
                    checked={n.visible}
                    onChange={(e) => p.onNodeVisible(n.uuid, e.target.checked)}
                  />
                  <span className={`nname${n.isMesh ? ' mesh' : ''}`}>{n.name}</span>
                  {n.isMesh && <span className="ntris">△{fmtNum(n.tris)}</span>}
                </div>
              ))}
            </div>
            <div className="psection">材质 · {p.materials.length}</div>
            <div className="mlist">
              {p.materials.map((m, i) => (
                <div key={i} className="mrow">
                  <span className="mswatch" style={{ background: m.color ?? 'transparent' }} />
                  <div className="mbody">
                    <div className="mname">
                      {m.name} <span className="mtype">{m.type.replace('Mesh', '').replace('Material', '')}</span>
                      {m.transparent && <span className="mtype">透明</span>}
                    </div>
                    <div className="mmaps">
                      {m.maps.length === 0
                        ? '无贴图'
                        : m.maps.map((x) => `${x.slot.replace('Map', '')} ${x.size}`).join(' · ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {p.tab === 'info' && (
          <>
            <div className="psection">文件</div>
            <div className="kv">
              <span>名称</span>
              <b>
                {p.entry.name}
                {p.entry.ext}
              </b>
              <span>路径</span>
              <b className="wrap">{p.entry.rel}</b>
              <span>大小</span>
              <b>{(p.entry.size / 1024 / 1024).toFixed(2)} MB</b>
              <span>修改</span>
              <b>{new Date(p.entry.mtimeMs).toLocaleString('zh-CN')}</b>
            </div>
            {p.stats && (
              <>
                <div className="psection">几何</div>
                <div className="kv">
                  <span>顶点</span>
                  <b>{fmtNum(p.stats.vertices)}</b>
                  <span>三角面</span>
                  <b>{fmtNum(p.stats.triangles)}</b>
                  <span>网格</span>
                  <b>{fmtNum(p.stats.meshes)}</b>
                  <span>材质</span>
                  <b>{fmtNum(p.stats.materials)}</b>
                  <span>贴图</span>
                  <b>{fmtNum(p.stats.textures)}</b>
                  <span>动画</span>
                  <b>{p.stats.animations.length}</b>
                </div>
                <div className="psection">尺寸</div>
                <div className="prow">
                  <b style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtDim(p.stats.dimensions, unit)}</b>
                  <select value={unit} onChange={(e) => setUnit(Number(e.target.value))} title="假设文件单位">
                    <option value={1}>原始单位</option>
                    <option value={100}>米 → 厘米</option>
                    <option value={0.01}>厘米 → 米</option>
                    <option value={1000}>米 → 毫米</option>
                    <option value={0.001}>毫米 → 米</option>
                  </select>
                </div>
                <p className="pnote">3D 文件不记录真实单位，这里按你选择的假设换算。FBX 常以厘米为单位。</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
