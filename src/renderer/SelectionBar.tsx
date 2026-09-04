import { IconClose, IconCopy, IconCube, IconExport, IconSheet, IconStar, IconTag } from './icons'

interface Props {
  count: number
  allFavorite: boolean
  hasConvertible: boolean
  onFavorite: () => void
  onTags: () => void
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
      <button onClick={p.onTags}>
        <IconTag /> 标签…
      </button>
      <span className="sep" />
      <button onClick={p.onExport}>
        <IconExport /> 导出到文件夹…
      </button>
      <button onClick={p.onExportGlb} disabled={!p.hasConvertible} title="用 three.js / Blender 转成 GLB 后导出">
        <IconCube /> 转为 GLB 导出…
      </button>
      <button onClick={p.onContactSheet}>
        <IconSheet /> 生成接触表…
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
