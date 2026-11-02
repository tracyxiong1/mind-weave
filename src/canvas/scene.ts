import { convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { NODE_WIDTH } from '../core/geometry'
import { routePoints } from './routes'
import type { Position } from '../core/types'

export interface SceneBox { id: string; position: Position; height: number }
export interface SceneEdge { id: string; path: string; visible: boolean; suggested: boolean; secondary?: boolean; focused?: boolean; muted?: boolean }

/** Business data owns content and geometry; native elements are a projection.
 * HTML cards stay above transparent native boxes, with no embed URLs or frames. */
export function projectScene(boxes: SceneBox[], edges: SceneEdge[], previous: readonly ExcalidrawElement[] = [], theme: 'light' | 'dark' = 'light') {
  const next = convertToExcalidrawElements([
    ...boxes.map(box => ({ type: 'rectangle' as const, id: `mw-node-${box.id}`, x: box.position.x, y: box.position.y,
      width: NODE_WIDTH, height: box.height, roughness: 0, strokeColor: 'transparent', backgroundColor: 'transparent',
      strokeWidth: 0, locked: true, customData: { role: 'node', nodeId: box.id } })),
    ...edges.filter(edge => edge.visible).map(edge => {
      const points = routePoints(edge.path), [x, y] = points[0]
      return { type: 'line' as const, id: `mw-edge-${edge.id}`, x, y,
        points: points.map(([px, py]): [number, number] => [px - x, py - y]),
        roughness: 0, strokeColor: theme === 'dark' ? edge.focused ? '#b5b5af' : '#83837d' : edge.focused ? '#797976' : '#9b9b97', strokeWidth: edge.focused ? 1.8 : 1.5,
        strokeStyle: edge.suggested || edge.secondary ? 'dashed' as const : 'solid' as const,
        opacity: edge.muted ? 20 : 100, locked: true, customData: { role: 'edge', edgeId: edge.id } }
    }),
  ], { regenerateIds: false })
  const old = new Map(previous.map(element => [element.id, element]))
  return next.map(element => {
    const existing = old.get(element.id)
    if (!existing || existing.type !== element.type) return element
    const { x, y, width, height, strokeColor, backgroundColor, strokeWidth, strokeStyle, opacity, locked } = element
    const updates = { x, y, width, height, strokeColor, backgroundColor, strokeWidth, strokeStyle, opacity, locked,
      ...(element.type === 'line' ? { points: element.points } : {}) }
    return Object.entries(updates).some(([key, value]) => JSON.stringify(existing[key as keyof ExcalidrawElement]) !== JSON.stringify(value))
      ? newElementWith(existing, updates) : existing
  })
}
