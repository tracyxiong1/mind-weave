import type { Position, Viewport } from './types'

export const NODE_WIDTH = 300
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 2
export interface Size { width: number; height: number }
export function zoomAt(view: Viewport, factor: number, point: { x: number; y: number }): Viewport {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor))
  const ratio = zoom / view.zoom
  return { zoom, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }
}
export function fitView(positions: Position[], heights: number[], size: Size): Viewport {
  if (!positions.length) return { x: size.width / 2 - NODE_WIDTH / 2, y: size.height / 2, zoom: 1 }
  const left = Math.min(...positions.map(p => p.x))
  const top = Math.min(...positions.map(p => p.y))
  const right = Math.max(...positions.map(p => p.x + NODE_WIDTH))
  const bottom = Math.max(...positions.map((p, i) => p.y + (heights[i] ?? 100)))
  // Narrow previews keep legible text; the rest of the graph can be panned into view.
  const minimum = size.width < 700 ? 0.88 : 0.5
  const zoom = Math.max(minimum, Math.min(1, (size.width - 112) / (right - left), (size.height - 180) / (bottom - top)))
  return {
    zoom,
    x: size.width < 700 ? 24 - left * zoom : (size.width - (right - left) * zoom) / 2 - left * zoom,
    y: (size.height - (bottom - top) * zoom) / 2 - top * zoom,
  }
}
export function edgePath(a: Position, aHeight: number, b: Position, bHeight: number): string {
  const ac = { x: a.x + NODE_WIDTH / 2, y: a.y + aHeight / 2 }
  const bc = { x: b.x + NODE_WIDTH / 2, y: b.y + bHeight / 2 }
  if (Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y)) {
    const direction = bc.x > ac.x ? 1 : -1
    const ax = ac.x + direction * NODE_WIDTH / 2
    const bx = bc.x - direction * NODE_WIDTH / 2
    const bend = Math.max(60, Math.abs(bx - ax) * 0.5)
    return `M ${ax} ${ac.y} C ${ax + direction * bend} ${ac.y}, ${bx - direction * bend} ${bc.y}, ${bx} ${bc.y}`
  }
  const direction = bc.y > ac.y ? 1 : -1
  const ay = ac.y + direction * aHeight / 2
  const by = bc.y - direction * bHeight / 2
  const bend = Math.max(45, Math.abs(by - ay) * 0.5)
  return `M ${ac.x} ${ay} C ${ac.x} ${ay + direction * bend}, ${bc.x} ${by - direction * bend}, ${bc.x} ${by}`
}
