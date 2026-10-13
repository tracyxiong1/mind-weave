import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from './Icon'

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = ref.current!
    element.showModal()
    return () => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-content">
      <header className="dialog-heading"><h2 id={titleId}>{title}</h2><IconButton icon="close" label="关闭对话框" onClick={onClose} /></header>
      {children}
    </div>
  </dialog>
}
