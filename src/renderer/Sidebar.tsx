import { useState } from 'react'
import type { DirNode } from './lib/tree'

interface Props {
  tree: DirNode
  selected: string
  onSelect: (rel: string) => void
}

function Node({
  node,
  depth,
  selected,
  expanded,
  onSelect,
  onToggle
}: {
  node: DirNode
  depth: number
  selected: string
  expanded: Set<string>
  onSelect: (rel: string) => void
  onToggle: (rel: string) => void
}): JSX.Element {
  const hasKids = node.children.length > 0
  const open = depth === 0 || expanded.has(node.rel)
  return (
    <>
      <div
        className={`tree-row${selected === node.rel ? ' on' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.rel)}
        title={node.rel || node.name}
      >
        <span
          className={`tree-arrow${hasKids ? '' : ' none'}${open ? ' open' : ''}`}
          onClick={(e) => {
            if (!hasKids) return
            e.stopPropagation()
            onToggle(node.rel)
          }}
        >
          ▸
        </span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-count">{node.count}</span>
      </div>
      {open &&
        node.children.map((c) => (
          <Node
            key={c.rel}
            node={c}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

/** 左侧文件夹树：点一个目录只看它（含子目录）里的模型 */
export default function Sidebar({ tree, selected, onSelect }: Props): JSX.Element {
  // 默认展开第一层，别一上来就全折着
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.children.map((c) => c.rel))
  )
  const toggle = (rel: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })

  return (
    <div className="sidebar">
      <div className="sidebar-title">文件夹</div>
      <div className="tree">
        <Node
          node={tree}
          depth={0}
          selected={selected}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={toggle}
        />
      </div>
    </div>
  )
}
