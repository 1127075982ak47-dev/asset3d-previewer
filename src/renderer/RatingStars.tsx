import { useState } from 'react'
import { COLOR_LABELS } from '../shared/labels'

interface StarsProps {
  value: number
  onChange?: (v: number) => void
  size?: number
  /** 只显示已点亮的星，没评分时整个隐藏（卡片上用） */
  compact?: boolean
  title?: string
}

/** 五星评分。再点一次当前分数就清除。 */
export function RatingStars({ value, onChange, size = 13, compact, title }: StarsProps): JSX.Element {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const interactive = !!onChange
  return (
    <span
      className={`stars${interactive ? ' interactive' : ''}${value > 0 ? ' has' : ''}${compact ? ' compact' : ''}`}
      style={{ fontSize: size }}
      title={title ?? (value > 0 ? `${value} 星` : '评分')}
      onMouseLeave={() => setHover(0)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <i
          key={i}
          className={i <= shown ? 'on' : ''}
          onMouseEnter={() => interactive && setHover(i)}
          onClick={(e) => {
            e.stopPropagation()
            if (!onChange) return
            onChange(i === value ? 0 : i)
          }}
        >
          {i <= shown ? '★' : '☆'}
        </i>
      ))}
    </span>
  )
}

interface DotsProps {
  value: string | null
  onChange: (c: string | null) => void
  size?: number
}

/** 颜色标签选择：一排色点，再点一次当前颜色就清除 */
export function ColorDots({ value, onChange, size = 14 }: DotsProps): JSX.Element {
  return (
    <span className="color-dots" onClick={(e) => e.stopPropagation()}>
      {COLOR_LABELS.map((c) => (
        <i
          key={c.key}
          className={`dot${value === c.key ? ' on' : ''}`}
          style={{ background: c.color, width: size, height: size }}
          title={c.name}
          onClick={() => onChange(value === c.key ? null : c.key)}
        />
      ))}
      <i className={`dot none${!value ? ' on' : ''}`} style={{ width: size, height: size }} title="无颜色" onClick={() => onChange(null)}>
        ×
      </i>
    </span>
  )
}
