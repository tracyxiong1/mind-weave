import { NODE_WIDTH } from './geometry'
import type { Position } from './types'

// Leave room for the contextual button above each card as well as reading space.
export const NODE_GAP = 40
export const DEFAULT_NODE_HEIGHT = 100
export interface NodeBox { position: Pick<Position, 'x' | 'y'>; height: number }

function overlaps(a: NodeBox, b: NodeBox): boolean {
  return a.position.x < b.position.x + NODE_WIDTH + NODE_GAP
    && a.position.x + NODE_WIDTH + NODE_GAP > b.position.x
    && a.position.y < b.position.y + b.height + NODE_GAP
    && a.position.y + a.height + NODE_GAP > b.position.y
}

/** Derive display positions without rewriting saved anchors or undo history.
 * Growing cards push later cards down locally; collapsing returns to the anchors.
 */
export function layoutNodes(ids: string[], anchors: Record<string, Position>, heights: Record<string, number>): Record<string, Position> {
  const sorted = [...ids].sort((a, b) => anchors[a].y - anchors[b].y || anchors[a].x - anchors[b].x || (a < b ? -1 : a > b ? 1 : 0))
  const result: Record<string, Position> = {}
  const placed: NodeBox[] = []
  for (const id of sorted) {
    const box = { position: { ...anchors[id] }, height: heights[id] ?? DEFAULT_NODE_HEIGHT }
    while (true) {
      const blockers = placed.filter(other => overlaps(box, other))
      if (!blockers.length) break
      box.position.y = Math.max(...blockers.map(other => other.position.y + other.height + NODE_GAP))
    }
    result[id] = box.position
    placed.push(box)
  }
  return result
}

/** The nearest vacant point for a dragged, keyboard-moved or newly added card.
 * Free-space boundaries lie on obstacle edges, so their Cartesian intersections
 * plus the desired coordinates include the closest possible placement.
 */
export function freePosition(desired: Position, height: number, obstacles: NodeBox[]): Position {
  if (!obstacles.some(other => overlaps({ position: desired, height }, other))) return { ...desired }
  const xs = new Set([desired.x])
  const ys = new Set([desired.y])
  for (const other of obstacles) {
    xs.add(other.position.x - NODE_WIDTH - NODE_GAP)
    xs.add(other.position.x + NODE_WIDTH + NODE_GAP)
    ys.add(other.position.y - height - NODE_GAP)
    ys.add(other.position.y + other.height + NODE_GAP)
  }
  const candidates = [...xs].flatMap(x => [...ys].map(y => ({
    x, y, distance: (x - desired.x) ** 2 + (y - desired.y) ** 2,
  })))
  candidates.sort((a, b) => a.distance - b.distance
    || Number(a.y < desired.y) - Number(b.y < desired.y)
    || Math.abs(a.x - desired.x) - Math.abs(b.x - desired.x)
    || a.y - b.y || a.x - b.x)
  const point = candidates.find(candidate => !obstacles.some(other => overlaps({ position: candidate, height }, other)))!
  return { x: point.x, y: point.y, pinned: desired.pinned }
}
