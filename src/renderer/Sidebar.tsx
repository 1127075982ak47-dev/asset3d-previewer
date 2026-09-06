import { useState } from 'react'
import type { DirNode } from './lib/tree'
import { IconPin } from './icons'

interface Props {
  tree: DirNode | null
  selected: string
  onSelect: (rel: string) => void
  /** 固定的文件夹（资源库） */
  pinned: string[]
  current: string | null
  onOpen: (dir: string) => void
  onPin: (dir: string) => void
  onUnpin: (dir: string) => void
}

function basename(p: string): string {
  const m = /[^\\/]+[\\/]?$/.exec(p)
  return (m ? m[0] : p).replace(/[\\/]$/, '')
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
        style={{ paddingLeft: 10 + depth * 14 }}
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

/** 左侧栏：上面是固定的资源库文件夹，下面是当前文件夹的子目录树 */
export default function Sidebar({ tree, selected, onSelect, pinned, current, onOpen, onPin, onUnpin }: Props): JSX.Element {
  // 默认展开第一层，别一上来就全折着
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree?.children.map((c) => c.rel) ?? []))
  const toggle = (rel: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  const isPinned = !!current && pinned.some((p) => p.toLowerCase() === current.toLowerCase())

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">
          资源库
          {current && !isPinned && (
            <button className="mini-btn" onClick={() => onPin(current)} title="把当前文件夹固定到资源库，下次一键切换">
              <IconPin size={12} /> 固定当前
            </button>
          )}
        </div>
        {pinned.length === 0 ? (
          <div className="sidebar-empty">把常用的素材文件夹固定在这里，随时一键切换。</div>
        ) : (
          <div className="pinned">
            {pinned.map((dir) => {
              const active = !!current && current.toLowerCase() === dir.toLowerCase()
              return (
                <div key={dir} className={`pin-row${active ? ' on' : ''}`} title={dir} onClick={() => !active && onOpen(dir)}>
                  <span className="pin-ico">▣</span>
                  <span className="pin-name">{basename(dir)}</span>
                  <i
                    className="pin-remove"
                    title="取消固定"
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnpin(dir)
                    }}
                  >
                    ×
                  </i>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {tree && (
        <div className="sidebar-section grow">
          <div className="sidebar-title">文件夹</div>
          <div className="tree">
            <Node node={tree} depth={0} selected={selected} expanded={expanded} onSelect={onSelect} onToggle={toggle} />
          </div>
        </div>
      )}
    </div>
  )
}
