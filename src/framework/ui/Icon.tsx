import type { ReactNode } from 'react'
import type { IconName } from '../types'

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" {...STROKE} />
      <path d="M16.5 16.5 21 21" {...STROKE} />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="9" rx="1.5" {...STROKE} />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" {...STROKE} />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h13l-3-3" {...STROKE} />
      <path d="M20 16H7l3 3" {...STROKE} />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M3 12h18" {...STROKE} />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" {...STROKE} />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" {...STROKE} />
      <circle cx="8.5" cy="9.5" r="1.5" {...STROKE} />
      <path d="M21 16.5 16 11.5 7 20.5" {...STROKE} />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" {...STROKE} />
      <path d="M7 9.5 10 12.5 7 15.5" {...STROKE} />
      <path d="M13 15.5h4" {...STROKE} />
    </>
  ),
  star: (
    <path
      d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"
      {...STROKE}
    />
  ),
  'star-filled': (
    <path
      d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M12 7v5.2l3.4 2" {...STROKE} />
    </>
  ),
  'chevron-right': <path d="M9.5 6 15.5 12l-6 6" {...STROKE} />,
  'chevron-down': <path d="M6 9.5 12 15.5l6-6" {...STROKE} />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="1.5" {...STROKE} />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" {...STROKE} />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 7" {...STROKE} />,
  download: (
    <>
      <path d="M12 3v12" {...STROKE} />
      <path d="M7.5 10.5 12 15l4.5-4.5" {...STROKE} />
      <path d="M4 20h16" {...STROKE} />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" {...STROKE} />
      <path d="M9.5 7V5h5v2" {...STROKE} />
      <path d="M6.5 7l1 13h9l1-13" {...STROKE} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" {...STROKE} />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" {...STROKE} />
    </>
  ),
  moon: (
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" {...STROKE} />
  ),
  monitor: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" {...STROKE} />
      <path d="M9 21h6M12 17v4" {...STROKE} />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 20.5 19.5H3.5z" {...STROKE} />
      <path d="M12 10v4" {...STROKE} />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" {...STROKE} />,
  close: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" {...STROKE} />,
}

export interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
