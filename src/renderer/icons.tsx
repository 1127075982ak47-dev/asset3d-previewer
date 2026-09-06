/** 内联 SVG 图标：不依赖字体、不依赖网络，深色主题下用 currentColor 跟随文字色 */

interface IconProps {
  size?: number
  className?: string
}

function base(path: JSX.Element, props: IconProps): JSX.Element {
  const s = props.size ?? 14
  return (
    <svg
      className={`ico${props.className ? ' ' + props.className : ''}`}
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const IconFolder = (p: IconProps = {}): JSX.Element =>
  base(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, p)

export const IconRefresh = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </>,
    p
  )

export const IconSidebar = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>,
    p
  )

export const IconSettings = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
    p
  )

export const IconStar = (p: IconProps & { filled?: boolean } = {}): JSX.Element => (
  <svg
    className={`ico${p.className ? ' ' + p.className : ''}`}
    width={p.size ?? 14}
    height={p.size ?? 14}
    viewBox="0 0 24 24"
    fill={p.filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
  </svg>
)

export const IconTag = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
    </>,
    p
  )

export const IconExport = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>,
    p
  )

export const IconSheet = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
    p
  )

export const IconCopy = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
    p
  )

export const IconCube = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M3 7l9 5 9-5" />
      <path d="M12 12v10" />
    </>,
    p
  )

export const IconClose = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>,
    p
  )

export const IconBack = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </>,
    p
  )

export const IconPrev = (p: IconProps = {}): JSX.Element => base(<path d="M15 18l-6-6 6-6" />, p)
export const IconNext = (p: IconProps = {}): JSX.Element => base(<path d="M9 18l6-6-6-6" />, p)

export const IconCamera = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>,
    p
  )

export const IconLocate = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>,
    p
  )

export const IconPanel = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>,
    p
  )

export const IconSearch = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>,
    p
  )

export const IconSort = (p: IconProps & { desc?: boolean } = {}): JSX.Element =>
  base(
    p.desc ? (
      <>
        <path d="M12 5v14" />
        <path d="M6 13l6 6 6-6" />
      </>
    ) : (
      <>
        <path d="M12 19V5" />
        <path d="M6 11l6-6 6 6" />
      </>
    ),
    p
  )

/* ---------------- 1.2 新增 ---------------- */

export const IconGrid = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>,
    p
  )

export const IconList = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </>,
    p
  )

export const IconTrash = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </>,
    p
  )

export const IconRename = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z" />
      <path d="M13 6l5 5" />
    </>,
    p
  )

export const IconMove = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 14h6" />
      <path d="M13 11l3 3-3 3" />
    </>,
    p
  )

export const IconPin = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M12 17v5" />
      <path d="M8 3h8l-1 7 3 3H6l3-3z" />
    </>,
    p
  )

export const IconCompare = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="4" width="8" height="16" rx="2" />
      <rect x="13" y="4" width="8" height="16" rx="2" />
      <path d="M7 9v6M17 9v6" />
    </>,
    p
  )

export const IconCsv = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </>,
    p
  )

export const IconDupes = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16V5a2 2 0 0 1 2-2h11" />
    </>,
    p
  )

export const IconSun = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
    p
  )

export const IconMoon = (p: IconProps = {}): JSX.Element =>
  base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />, p)

export const IconRuler = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <path d="M3 17L17 3l4 4L7 21z" />
      <path d="M7 11l2 2M10 8l2 2M13 5l2 2" />
    </>,
    p
  )

export const IconThumb = (p: IconProps = {}): JSX.Element =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 15l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </>,
    p
  )
