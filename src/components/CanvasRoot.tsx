import { useEffect, useRef } from 'react'
import { CANVAS_ROOT_ID } from '../core/branches'
import type { Position } from '../core/types'

export function CanvasRoot({ title, position, onMeasure }: {
  title: string
  position: Position
  onMeasure: (id: string, height: number) => void
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = ref.current!
    const observer = new ResizeObserver(() => onMeasure(CANVAS_ROOT_ID, element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [onMeasure])
  return <section ref={ref} className="node canvas-root emphasized" data-testid="canvas-root" aria-label={`会话主题：${title}`}
    style={{ left: position.x, top: position.y }}>
    <p className="root-caption">会话主题</p>
    <h2 title={title}>{title}</h2>
  </section>
}
