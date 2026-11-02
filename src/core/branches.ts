import { NODE_WIDTH } from './geometry'
import { DEFAULT_NODE_HEIGHT, NODE_GAP } from './layout'
import type { CanvasEdge, CanvasNode, Position } from './types'

export interface ReadingForest {
  roots: string[]
  children: Map<string, string[]>
  edgeIds: Set<string>
}

// View-only identity: '@' cannot collide with any saved node ID.
export const CANVAS_ROOT_ID = '@canvas-root'

/** Join independent reading branches under the conversation's overall theme.
 * Position is derived from the displayed cards, so saved/manual anchors stay intact.
 */
export function canvasRootPosition(forest: ReadingForest, positions: Record<string, Position>, heights: Record<string, number>): Position | null {
  if (forest.roots.length <= 1) return null
  const ids = [...forest.children.keys()]
  const left = Math.min(...ids.map(id => positions[id].x))
  const top = Math.min(...ids.map(id => positions[id].y))
  const bottom = Math.max(...ids.map(id => positions[id].y + (heights[id] ?? DEFAULT_NODE_HEIGHT)))
  return { x: left - NODE_WIDTH - 120, y: (top + bottom - (heights[CANVAS_ROOT_ID] ?? DEFAULT_NODE_HEIGHT)) / 2, pinned: false }
}

export function positionsWithRoot(forest: ReadingForest, positions: Record<string, Position>, heights: Record<string, number>): Record<string, Position> {
  const root = canvasRootPosition(forest, positions, heights)
  return root ? { ...positions, [CANVAS_ROOT_ID]: root } : positions
}

/** A reading order, not a new classification of the saved relationships.
 * Keep one incoming edge per node, preferring the shortest path from a root.
 * Other edges remain available when inspecting a node or showing all relations.
 */
export function readingForest(nodes: Pick<CanvasNode, 'id'>[], edges: CanvasEdge[]): ReadingForest {
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const outgoing = new Map(nodes.map(node => [node.id, [] as CanvasEdge[]]))
  const incoming = new Set<string>()
  for (const edge of edges) {
    if (edge.from === edge.to || !order.has(edge.from) || !order.has(edge.to)) continue
    outgoing.get(edge.from)!.push(edge)
    incoming.add(edge.to)
  }
  for (const list of outgoing.values()) list.sort((a, b) => order.get(a.to)! - order.get(b.to)! || a.id.localeCompare(b.id))
  const roots = nodes.filter(node => !incoming.has(node.id)).map(node => node.id)
  const children = new Map(nodes.map(node => [node.id, [] as string[]]))
  const edgeIds = new Set<string>()
  const visited = new Set(roots)
  const queue = [...roots]
  let cursor = 0
  const visit = () => {
    while (cursor < queue.length) {
      const id = queue[cursor++]
      for (const edge of outgoing.get(id)!) {
        if (visited.has(edge.to)) continue
        visited.add(edge.to)
        children.get(id)!.push(edge.to)
        edgeIds.add(edge.id)
        queue.push(edge.to)
      }
    }
  }
  visit()
  // Cycles can have no directed root. Start each remaining component once.
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    roots.push(node.id); visited.add(node.id); queue.push(node.id)
    visit()
  }
  return { roots, children, edgeIds }
}

/** Lay out whole subtrees in separate bands, with parents centered on children.
 * This is an explicit arrange action; saved/manual positions are restored by undo.
 */
export function arrangeBranches(forest: ReadingForest, heights: Record<string, number>): Record<string, Position> {
  const spans = new Map<string, number>()
  const height = (id: string) => heights[id] ?? DEFAULT_NODE_HEIGHT
  const measure = (id: string): number => {
    const children = forest.children.get(id)!
    const childrenHeight = children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, children.length - 1) * NODE_GAP
    const span = Math.max(height(id), childrenHeight)
    spans.set(id, span)
    return span
  }
  forest.roots.forEach(measure)
  const positions: Record<string, Position> = {}
  const place = (id: string, depth: number, top: number) => {
    const span = spans.get(id)!
    positions[id] = { x: depth * (NODE_WIDTH + 120), y: top + (span - height(id)) / 2, pinned: true }
    const children = forest.children.get(id)!
    const childrenHeight = children.reduce((sum, child) => sum + spans.get(child)!, 0) + Math.max(0, children.length - 1) * NODE_GAP
    let childTop = top + (span - childrenHeight) / 2
    for (const child of children) {
      place(child, depth + 1, childTop)
      childTop += spans.get(child)! + NODE_GAP
    }
  }
  let top = 0
  for (const root of forest.roots) {
    place(root, forest.roots.length > 1 ? 1 : 0, top)
    top += spans.get(root)! + NODE_GAP * 2
  }
  return positions
}
