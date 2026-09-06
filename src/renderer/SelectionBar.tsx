import { ColorDots, RatingStars } from './RatingStars'
import {
  IconClose,
  IconCompare,
  IconCopy,
  IconCube,
  IconExport,
  IconMove,
  IconRename,
  IconSheet,
  IconStar,
  IconTag,
  IconTrash
} from './icons'

interface Props {
  count: number
  allFavorite: boolean
  hasConvertible: boolean
  canCompare: boolean
  rating: number
  color: string | null
  onFavorite: () => void
  onRate: (v: number) => void
  onColor: (c: string | null) => void
  onTags: () => void
  onRename: () => void
  onMove: () => void
  onTrash: () => void
  onCompare: () => void
  onExport: () => void
  onExportGlb: () => void
  onContactSheet: () => void
  onCopyPaths: () => void
  onClear: () => void
}

/** 选中一个或多个模型时出现在状态栏上方的批量操作条 */
export default function SelectionBar(p: Props): JSX.Element {
  return (
    <div className="selbar">
      <b>已选 {p.count} 个</b>
      <button onClick={p.onFavorite} title="Ctrl+D">
        <IconStar filled={p.allFavorite} /> {p.allFavorite ? '取消收藏' : '收藏'}
      </button>
      <span className="selbar-rate" title="评分（数字键 0–5）">
        <RatingStars value={p.rating} onChange={p.onRate} size={15} />
      </span>
      <ColorDots value={p.color} onChange={p.onColor} />
      <button onClick={p.onTags}>
        <IconTag /> 标签…
      </button>
      <span className="sep" />
      {p.count === 1 && (
        <button onClick={p.onRename} title="F2">
          <IconRename /> 重命名
        </button>
      )}
      <button onClick={p.onMove}>
        <IconMove /> 移动到…
      </button>
      <button onClick={p.onTrash} title="Delete · 删除到回收站，可以找回">
        <IconTrash /> 回收站
      </button>
      {p.canCompare && (
        <button onClick={p.onCompare} title="把两个模型并排放进查看器，相机同步">
          <IconCompare /> 对比
        </button>
      )}
      <span className="sep" />
      <button onClick={p.onExport}>
        <IconExport /> 导出到文件夹…
      </button>
      <button onClick={p.onExportGlb} disabled={!p.hasConvertible} title="用 three.js / Blender 转成 GLB 后导出">
        <IconCube /> 转为 GLB…
      </button>
      <button onClick={p.onContactSheet}>
        <IconSheet /> 接触表…
      </button>
      <button onClick={p.onCopyPaths}>
        <IconCopy /> 复制路径
      </button>
      <div className="spacer" />
      <button onClick={p.onClear} title="Esc">
        <IconClose /> 取消选择
      </button>
    </div>
  )
}
