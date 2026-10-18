import { describe, expect, it } from 'vitest'
import { arrangeBranches, CANVAS_ROOT_ID, positionsWithRoot, readingForest } from './branches'
import { NODE_WIDTH } from './geometry'
import { DEFAULT_NODE_HEIGHT, NODE_GAP } from './layout'
import type { CanvasEdge } from './types'

const nodes = (...ids: string[]) => ids.map(id => ({ id }))
const edge = (from: string, to: string): CanvasEdge => ({ id: `${from}-${to}`, from, to, label: '关联' })

describe('用于阅读的分支', () => {
  it('保留真实方向，每个节点只选一条主干；补充关系不被改写', () => {
    const list = nodes('root', 'a', 'b', 'shared', 'isolated')
    const edges = [edge('root', 'a'), edge('root', 'b'), edge('a', 'shared'), edge('b', 'shared'), edge('shared', 'root')]
    const snapshot = structuredClone(edges)
    const forest = readingForest(list, edges)
    expect(forest.roots).toEqual(['isolated', 'root'])
    expect([...forest.edgeIds]).toEqual(['root-a', 'root-b', 'a-shared'])
    expect(forest.children.get('b')).toEqual([])
    expect(readingForest(list, [...edges].reverse())).toEqual(forest)
    expect(edges).toEqual(snapshot)
  })

  it('多个起点优先短路径，循环、独立节点和无效端点都不会遗漏或重复节点', () => {
    const list = nodes('root', 'a', 'other-root', 'shared', 'cycle-a', 'cycle-b', 'isolated')
    const edges = [edge('root', 'a'), edge('a', 'shared'), edge('other-root', 'shared'),
      edge('cycle-a', 'cycle-b'), edge('cycle-b', 'cycle-a'), edge('missing', 'root'), edge('a', 'a')]
    const forest = readingForest(list, edges)
    expect(forest.children.get('other-root')).toEqual(['shared'])
    const reached: string[] = []
    const visit = (id: string) => { reached.push(id); forest.children.get(id)!.forEach(visit) }
    forest.roots.forEach(visit)
    expect(reached.sort()).toEqual(list.map(node => node.id).sort())
    expect(forest.edgeIds.size).toBe(list.length - forest.roots.length)
  })

  it('按真实高度给整个子树留出空间，同级与独立分支互不重叠', () => {
    const list = nodes('root', 'a', 'b', 'c', 'd', 'other-root', 'other-child')
    const forest = readingForest(list, [edge('root', 'a'), edge('root', 'b'), edge('a', 'c'), edge('a', 'd'), edge('other-root', 'other-child')])
    const heights: Record<string, number> = { root: 300, a: 80, b: 410, c: 62, d: 270, 'other-root': 140 }
    const positions = arrangeBranches(forest, heights)
    for (let i = 0; i < list.length; i++) {
      const a = positions[list[i].id]
      for (const node of list.slice(i + 1)) {
        const b = positions[node.id]
        expect(a.x + NODE_WIDTH + NODE_GAP <= b.x || b.x + NODE_WIDTH + NODE_GAP <= a.x
          || a.y + (heights[list[i].id] ?? DEFAULT_NODE_HEIGHT) + NODE_GAP <= b.y
          || b.y + (heights[node.id] ?? DEFAULT_NODE_HEIGHT) + NODE_GAP <= a.y).toBe(true)
      }
    }
    expect(positions.a.x).toBe(positions.b.x)
    expect(positions.c.x).toBeGreaterThan(positions.a.x + NODE_WIDTH)
    expect(positions['other-root'].y).toBeGreaterThan(positions.b.y + heights.b)
    expect(positions.root.y + heights.root / 2).toBe((positions.c.y + positions.b.y + heights.b) / 2)
  })

  it('空图和单节点均可整理', () => {
    expect(arrangeBranches(readingForest([], []), {})).toEqual({})
    expect(arrangeBranches(readingForest(nodes('single'), []), { single: 900 })).toEqual({ single: { x: 0, y: 0, pinned: true } })
  })

  it('多个分支共用一个总根，适应视口包含总根，保存位置仍只包含真实节点', () => {
    const list = nodes('topic', 'child', 'delivery', 'isolated')
    const forest = readingForest(list, [edge('topic', 'child')])
    const heights = { topic: 80, child: 400, delivery: 80, isolated: 60, [CANVAS_ROOT_ID]: 110 }
    const positions = arrangeBranches(forest, heights)
    const snapshot = structuredClone(positions)
    const view = positionsWithRoot(forest, positions, heights)
    expect(Object.keys(positions).sort()).toEqual(list.map(node => node.id).sort())
    expect(Object.keys(view)).toHaveLength(list.length + 1)
    const root = view[CANVAS_ROOT_ID]
    expect(root.x).toBe(0)
    for (const id of forest.roots) expect(view[id].x).toBeGreaterThanOrEqual(root.x + NODE_WIDTH + NODE_GAP)
    const top = Math.min(...Object.values(positions).map(position => position.y))
    const bottom = Math.max(...list.map(node => positions[node.id].y + heights[node.id as keyof typeof heights]))
    expect(root.y + heights[CANVAS_ROOT_ID] / 2).toBe((top + bottom) / 2)
    expect(positions).toEqual(snapshot)
  })

  it('已有单一根节点或空图时不添加总根，拖动后的负坐标也不被改写', () => {
    const tree = readingForest(nodes('topic', 'child'), [edge('topic', 'child')])
    const positions = { topic: { x: -820, y: 300, pinned: true }, child: { x: 200, y: -400, pinned: true } }
    expect(positionsWithRoot(tree, positions, {})).toBe(positions)
    expect(positionsWithRoot(readingForest([], []), {}, {})).toEqual({})
    const forest = readingForest(nodes('topic', 'child'), [])
    const view = positionsWithRoot(forest, positions, { [CANVAS_ROOT_ID]: 700 })
    expect(view[CANVAS_ROOT_ID].x + NODE_WIDTH + NODE_GAP).toBeLessThanOrEqual(positions.topic.x)
    expect(view.topic).toEqual(positions.topic)
    expect(view.child).toEqual(positions.child)
  })
})
