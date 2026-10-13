import type { ButtonHTMLAttributes } from 'react'

export type IconName = 'plus' | 'minus' | 'fit' | 'undo' | 'redo' | 'sun' | 'moon' | 'system' | 'link' | 'close' | 'more' | 'chevron' | 'copy' | 'source' | 'edit' | 'merge' | 'trash' | 'help' | 'download' | 'note'
const paths: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />,
  undo: <><path d="m8 4-4 4 4 4" /><path d="M4 8h9a6 6 0 0 1 0 12" /></>,
  redo: <><path d="m16 4 4 4-4 4" /><path d="M20 8h-9a6 6 0 0 0 0 12" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
  system: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  link: <><path d="m10 13 4-4m-7 6-1 1a4 4 0 0 0 6 6l3-3a4 4 0 0 0 0-6m2-4 1-1a4 4 0 0 0-6-6L9 5a4 4 0 0 0 0 6" transform="translate(0 -1)" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>,
  source: <><path d="M14 3H5v18h14V8Zm0 0v5h5" /><path d="M8 12h8m-8 4h6" /></>,
  edit: <><path d="m4 16-1 5 5-1L20 8l-4-4Z" /><path d="m13 7 4 4" /></>,
  merge: <><path d="M5 3v4c0 6 14 4 14 10v4M19 3v4c0 6-14 4-14 10v4" /><path d="m16 18 3 3 3-3" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3v.1" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" /></>,
  note: <><path d="M14 3H4v18h16V9M17 3v6m-3-3h6M8 12h8m-8 4h5" /></>,
}
export function Icon({ name }: { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
export function IconButton({ icon, label, ...props }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon name={icon} /></button>
}
