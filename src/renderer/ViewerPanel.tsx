import { useMemo, useState } from 'react'
import { CHANNEL_MODES, SHADING_MODES } from './lib/shading'
import {
  BACKGROUNDS,
  TONE_MAPPINGS,
  type LoadedInfo,
  type MaterialInfo,
  type NodeInfo,
  type ViewPreset,
  type ViewerPrefs
} from './lib/viewerEngine'
import type { HdriEntry, ModelEntry, ModelStats } from '../shared/types'

export type PanelTab = 'display' | 'env' | 'camera' | 'tools' | 'anim' | 'tree' | 'info'

interface Props {
  entry: ModelEntry
  prefs: ViewerPrefs
  onPrefs: (patch: Partial<ViewerPrefs>) => void
  hdris: HdriEntry[]
  onImportHdri: () => void
  onRemoveHdri: (id: string) => void
  onOpenHdriDir: () => void
  info: LoadedInfo | null
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
  onTexture: (materialIndex: number, slot: string) => void
  variant: string | null
  onVariant: (name: string | null) => void
  onView: (p: ViewPreset) => void
  tab: PanelTab
  onTab: (t: PanelTab) => void
  measureDist: number | null
  onClearMeasure: () => void
  unit: { scale: number; name: string }
  onUnit: (u: { scale: number; name: string }) => void
}

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'display', label: '显示' },
  { key: 'env', label: '环境' },
  { key: 'camera', label: '相机' },
  { key: 'tools', label: '工具' },
  { key: 'anim', label: '动画' },
  { key: 'tree', label: '结构' },
  { key: 'info', label: '信息' }
]

const UNITS: { key: string; label: string; scale: number; name: string }[] = [
  { key: 'raw', label: '原始单位', scale: 1, name: '' },
  { key: 'm-cm', label: '米 → 厘米', scale: 100, name: 'cm' },
  { key: 'cm-m', label: '厘米 → 米', scale: 0.01, name: 'm' },
  { key: 'm-mm', label: '米 → 毫米', scale: 1000, name: 'mm' },
  { key: 'mm-m', label: '毫米 → 米', scale: 0.001, name: 'm' }
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
  hint,
  disabled
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  hint?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <label className={`prow toggle${disabled ? ' disabled' : ''}`} title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b>{fmt ? fmt(value) : value}</b>
    </div>
  )
}

/** 查看器右侧的设置/信息面板 */
export default function ViewerPanel(p: Props): JSX.Element {
  const [treeFilter, setTreeFilter] = useState('')
  const unitKey = UNITS.find((u) => u.scale === p.unit.scale && u.name === p.unit.name)?.key ?? 'raw'

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
                <button key={m.key} className={p.prefs.mode === m.key ? 'on' : ''} onClick={() => p.onPrefs({ mode: m.key })} title={m.hint}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="psection">贴图通道</div>
            <div className="mode-grid">
              {CHANNEL_MODES.map((m) => (
                <button key={m.key} className={p.prefs.mode === m.key ? 'on' : ''} onClick={() => p.onPrefs({ mode: m.key })} title={m.hint}>
                  {m.label}
                </button>
              ))}
            </div>
            {p.info && !p.info.hasVertexColors && p.prefs.mode === 'vertexcolor' && <p className="pnote">这个模型没有顶点色。</p>}
            <div className="psection">着色</div>
            <div className="prow seg">
              <button className={!p.prefs.flat ? 'on' : ''} onClick={() => p.onPrefs({ flat: false })}>
                平滑
              </button>
              <button className={p.prefs.flat ? 'on' : ''} onClick={() => p.onPrefs({ flat: true })}>
                平直
              </button>
            </div>
            <Toggle label="线框叠加" value={p.prefs.wireOverlay} onChange={(v) => p.onPrefs({ wireOverlay: v })} hint="在当前模式上叠加一层边线" />
            <Toggle
              label="环境光遮蔽 (AO)"
              value={p.prefs.ao}
              onChange={(v) => p.onPrefs({ ao: v })}
              hint="屏幕空间 AO（GTAO），缝隙和接触处会变暗，更有体积感"
            />
            <Toggle label="地面阴影" value={p.prefs.shadow} onChange={(v) => p.onPrefs({ shadow: v })} hint="模型底部投一片柔和阴影" />
            <div className="psection">辅助</div>
            <Toggle label="地面网格 (G)" value={p.prefs.grid} onChange={(v) => p.onPrefs({ grid: v })} />
            <Toggle label="坐标轴" value={p.prefs.axes} onChange={(v) => p.onPrefs({ axes: v })} />
            <Toggle label="包围盒" value={p.prefs.bbox} onChange={(v) => p.onPrefs({ bbox: v })} />
            <Toggle label="导航球（右下角）" value={p.prefs.viewHelper} onChange={(v) => p.onPrefs({ viewHelper: v })} hint="点击轴向即可切换到对应视角" />
            <div className="psection">背景色</div>
            <div className="prow seg swatches">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.key}
                  className={p.prefs.bg === b.key && !p.prefs.envVisible ? 'on' : ''}
                  onClick={() => p.onPrefs({ bg: b.key, envVisible: false })}
                  title={b.label}
                  style={{ background: `#${b.color.toString(16).padStart(6, '0')}` }}
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
              <div className={`hdri-item${p.prefs.envId === 'room' ? ' on' : ''}`} onClick={() => p.onPrefs({ envId: 'room' })} title="程序化的室内环境，零文件、最快">
                <span className="hdri-swatch room" />
                <span className="hdri-name">程序化房间（默认）</span>
              </div>
              {p.hdris.map((h) => (
                <div key={h.id} className={`hdri-item${p.prefs.envId === h.id ? ' on' : ''}`} onClick={() => p.onPrefs({ envId: h.id })} title={h.builtin ? '内置（Poly Haven，CC0）' : '自定义'}>
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
            <div className="prow gap">
              <button onClick={p.onImportHdri}>导入 .hdr / .exr…</button>
              <button onClick={p.onOpenHdriDir} title="自定义 HDRI 存放目录">
                打开目录
              </button>
            </div>
            <Toggle label="显示为背景" value={p.prefs.envVisible} onChange={(v) => p.onPrefs({ envVisible: v })} hint="把 HDRI 直接画在场景背景上（程序化房间没有可见背景）" />
            <Slider label="强度" value={p.prefs.envIntensity} min={0} max={3} step={0.05} onChange={(v) => p.onPrefs({ envIntensity: v })} fmt={(v) => v.toFixed(2)} />
            <Slider label="旋转" value={p.prefs.envRotation} min={0} max={360} step={1} onChange={(v) => p.onPrefs({ envRotation: v })} fmt={(v) => `${v}°`} />
            <Slider label="背景模糊" value={p.prefs.envBlur} min={0} max={1} step={0.02} onChange={(v) => p.onPrefs({ envBlur: v })} fmt={(v) => v.toFixed(2)} />

            <div className="psection">补光</div>
            <div className="prow">
              <select value={p.prefs.lighting} onChange={(e) => p.onPrefs({ lighting: e.target.value as ViewerPrefs['lighting'] })} style={{ flex: 1 }}>
                <option value="studio">影棚三点光</option>
                <option value="outdoor">室外光</option>
                <option value="neutral">中性光</option>
                <option value="none">无（只用环境光）</option>
              </select>
            </div>
            <Slider label="光方向" value={p.prefs.lightRotation} min={0} max={360} step={1} onChange={(v) => p.onPrefs({ lightRotation: v })} fmt={(v) => `${v}°`} />
            <Slider label="光强度" value={p.prefs.lightIntensity} min={0} max={3} step={0.05} onChange={(v) => p.onPrefs({ lightIntensity: v })} fmt={(v) => v.toFixed(2)} />

            <div className="psection">曝光与色调</div>
            <Slider label="曝光" value={p.prefs.exposure} min={0.2} max={3} step={0.05} onChange={(v) => p.onPrefs({ exposure: v })} fmt={(v) => v.toFixed(2)} />
            <div className="prow">
              <span className="plabel">色调映射</span>
              <select value={p.prefs.toneMapping} onChange={(e) => p.onPrefs({ toneMapping: e.target.value as ViewerPrefs['toneMapping'] })} style={{ flex: 1 }}>
                {TONE_MAPPINGS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="pnote">内置 HDRI 来自 Poly Haven（CC0，1k）。自定义的放进「打开目录」里的文件夹即可，绿色版随程序目录一起走。</p>
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
            <Slider label="视场角" value={p.prefs.fov} min={10} max={100} step={1} onChange={(v) => p.onPrefs({ fov: v })} fmt={(v) => `${v}°`} />
            <Toggle label="自动旋转 (R)" value={p.prefs.autoRotate} onChange={(v) => p.onPrefs({ autoRotate: v })} />
            <p className="pnote">左键旋转 · 滚轮缩放 · 右键平移 · F 重置视角 · 双击画布重置 · 右下角导航球点轴切视角</p>
          </>
        )}

        {p.tab === 'tools' && (
          <>
            <div className="psection">剖切 (X)</div>
            <Toggle label="启用剖切平面" value={p.prefs.clipEnabled} onChange={(v) => p.onPrefs({ clipEnabled: v })} hint="沿一个轴切开模型看内部" />
            <div className="prow seg">
              {(['x', 'y', 'z'] as const).map((a) => (
                <button key={a} className={p.prefs.clipAxis === a ? 'on' : ''} onClick={() => p.onPrefs({ clipAxis: a, clipEnabled: true })}>
                  {a.toUpperCase()} 轴
                </button>
              ))}
            </div>
            <Slider label="位置" value={p.prefs.clipPos} min={0} max={1} step={0.005} onChange={(v) => p.onPrefs({ clipPos: v, clipEnabled: true })} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="翻转保留侧" value={p.prefs.clipFlip} onChange={(v) => p.onPrefs({ clipFlip: v })} />
            <p className="pnote">剖切只作用于模型，网格和阴影不受影响。开着 AO 时遮蔽按未剖切的深度计算。</p>

            <div className="psection">测量 (M)</div>
            <Toggle label="两点测距" value={p.prefs.measure} onChange={(v) => p.onPrefs({ measure: v })} hint="在模型表面点两个点，显示直线距离" />
            <div className="prow">
              <span className="plabel">结果</span>
              <b style={{ flex: 1 }}>{p.measureDist === null ? '—' : `${(p.measureDist * p.unit.scale).toFixed(4)} ${p.unit.name || '(原始单位)'}`}</b>
              <button onClick={p.onClearMeasure} disabled={p.measureDist === null && !p.prefs.measure}>
                清除
              </button>
            </div>
            <div className="prow">
              <span className="plabel">单位假设</span>
              <select
                value={unitKey}
                onChange={(e) => {
                  const u = UNITS.find((x) => x.key === e.target.value)!
                  p.onUnit({ scale: u.scale, name: u.name })
                }}
                style={{ flex: 1 }}
              >
                {UNITS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="psection">检查</div>
            <Toggle
              label="骨骼 (B)"
              value={p.prefs.skeleton}
              onChange={(v) => p.onPrefs({ skeleton: v })}
              hint="画出绑定骨骼"
              disabled={!!p.info && !p.info.hasSkeleton}
            />
            {p.info && !p.info.hasSkeleton && <p className="pnote">这个模型没有骨骼。</p>}
            <Toggle label="顶点法线 (N)" value={p.prefs.normals} onChange={(v) => p.onPrefs({ normals: v })} hint="每个顶点画一根法线短线，检查法线方向；顶点太多会跳过" />
            <Toggle label="性能 HUD" value={p.prefs.statsHud} onChange={(v) => p.onPrefs({ statsHud: v })} hint="帧率、绘制调用、三角面数" />
            {p.info?.isPointCloud && (
              <Slider label="点大小" value={p.prefs.pointSize} min={0.2} max={6} step={0.1} onChange={(v) => p.onPrefs({ pointSize: v })} fmt={(v) => `${v.toFixed(1)}×`} />
            )}
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
                <div className="prow gap">
                  <button className={p.playing ? 'primary' : ''} onClick={() => p.onPlay(!p.playing)}>
                    {p.playing ? '⏸ 暂停' : '▶ 播放'}
                  </button>
                  <button onClick={() => p.onSeek(0)}>⏮</button>
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
                    <button key={s} className={p.prefs.animSpeed === s ? 'on' : ''} onClick={() => p.onPrefs({ animSpeed: s })}>
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
            {p.info && p.info.variants.length > 0 && (
              <>
                <div className="psection">材质变体 · {p.info.variants.length}</div>
                <div className="prow">
                  <select value={p.variant ?? ''} onChange={(e) => p.onVariant(e.target.value || null)} style={{ flex: 1 }}>
                    <option value="">默认</option>
                    {p.info.variants.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="psection">
              节点 · {p.hierarchy.length}
              {p.hierarchy.length >= 3000 ? '+（只显示前 3000 个）' : ''}
            </div>
            <div className="prow">
              <input type="search" placeholder="筛选节点名…" value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} style={{ flex: 1 }} />
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
                  style={{ paddingLeft: 8 + Math.min(n.depth, 12) * 10 }}
                  onDoubleClick={() => p.onSolo(p.soloed === n.uuid ? null : n.uuid)}
                  title={`${n.type}${n.isMesh ? ` · △${fmtNum(n.tris)}` : ''}\n双击：只看这个节点`}
                >
                  <input type="checkbox" checked={n.visible} onChange={(e) => p.onNodeVisible(n.uuid, e.target.checked)} />
                  <span className={`nname${n.isMesh ? ' mesh' : ''}`}>{n.name}</span>
                  {n.isMesh && <span className="ntris">△{fmtNum(n.tris)}</span>}
                </div>
              ))}
            </div>
            <div className="psection">材质 · {p.materials.length}</div>
            <div className="mlist">
              {p.materials.map((m) => (
                <div key={m.index} className="mrow">
                  <span className="mswatch" style={{ background: m.color ?? 'transparent' }} />
                  <div className="mbody">
                    <div className="mname">
                      {m.name} <span className="mtype">{m.type.replace('Mesh', '').replace('Material', '')}</span>
                      {m.transparent && <span className="mtype">透明</span>}
                    </div>
                    <div className="mmaps">
                      {m.maps.length === 0
                        ? '无贴图'
                        : m.maps.map((x) => (
                            <span key={x.slot} className="mmap" onClick={() => p.onTexture(m.index, x.slot)} title="点击查看贴图">
                              {x.slot.replace('Map', '')} {x.size}
                            </span>
                          ))}
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
                  {p.info && (
                    <>
                      <span>骨骼</span>
                      <b>{p.info.hasSkeleton ? '有' : '无'}</b>
                      <span>顶点色</span>
                      <b>{p.info.hasVertexColors ? '有' : '无'}</b>
                    </>
                  )}
                </div>
                <div className="psection">尺寸</div>
                <div className="prow">
                  <b style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtDim(p.stats.dimensions, p.unit.scale)}</b>
                  <select
                    value={unitKey}
                    onChange={(e) => {
                      const u = UNITS.find((x) => x.key === e.target.value)!
                      p.onUnit({ scale: u.scale, name: u.name })
                    }}
                    title="假设文件单位"
                  >
                    {UNITS.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="pnote">3D 文件不记录真实单位，这里按你选择的假设换算；测量工具沿用同一假设。FBX 常以厘米为单位。</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
