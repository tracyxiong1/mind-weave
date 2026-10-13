import { describe, expect, it } from 'vitest'
import { NODE_WIDTH } from './geometry'
import { freePosition, layoutNodes, NODE_GAP, type NodeBox } from './layout'
import type { Position } from './types'

const position = (x: number, y: number, pinned = false): Position => ({ x, y, pinned })
function expectSeparated(boxes: NodeBox[]) {
  for (let i = 0; i < boxes.length; i++) {
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i]
      expect(a.position.x + NODE_WIDTH + NODE_GAP <= b.position.x
        || b.position.x + NODE_WIDTH + NODE_GAP <= a.position.x
        || a.position.y + a.height + NODE_GAP <= b.position.y
        || b.position.y + b.height + NODE_GAP <= a.position.y).toBe(true)
    }
  }
}

describe('按实际节点尺寸避让', () => {
  it('展开原文只推开同列后续节点，折叠返回保存的锚点', () => {
    const anchors = { context: position(0, 0), comparison: position(0, 175, true), branch: position(465, 145) }
    const snapshot = structuredClone(anchors)
    const collapsed = layoutNodes(Object.keys(anchors), anchors, { context: 80, comparison: 100, branch: 80 })
    expect(collapsed).toEqual(anchors)
    const expanded = layoutNodes(Object.keys(anchors), anchors, { context: 420, comparison: 100, branch: 80 })
    expect(expanded.context).toEqual(anchors.context)
    expect(expanded.comparison).toEqual(position(0, 460, true))
    expect(expanded.branch).toEqual(anchors.branch)
    expect(layoutNodes(Object.keys(anchors), anchors, { context: 80, comparison: 100, branch: 80 })).toEqual(collapsed)
    expect(anchors).toEqual(snapshot)
  })
  it('多个详情同时增高时逐个避让，顺序与节点输入顺序无关', () => {
    const anchors = { a: position(0, 0), b: position(0, 150), c: position(0, 300), d: position(465, 0) }
    const heights = { a: 350, b: 260, c: 200, d: 280 }
    const layout = layoutNodes(['a', 'b', 'c', 'd'], anchors, heights)
    expect(layout).toEqual(layoutNodes(['d', 'c', 'a', 'b'], anchors, heights))
    expect(layout.c.y).toBe(350 + 260 + NODE_GAP * 2)
    expectSeparated(Object.keys(anchors).map(id => ({ position: layout[id], height: heights[id as keyof typeof heights] })))
  })
  it('恢复相同坐标、跨列交叠与缺少测量的布局也能避让', () => {
    const anchors = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`n-${i}`, position(i % 3 * 190, Math.floor(i / 3) * 25, i % 2 === 0)]))
    const heights = Object.fromEntries(Object.keys(anchors).slice(0, 20).map((id, i) => [id, 60 + i * 19]))
    const layout = layoutNodes(Object.keys(anchors).reverse(), anchors, heights)
    expectSeparated(Object.keys(layout).map(id => ({ position: layout[id], height: heights[id] ?? 100 })))
    for (const id of Object.keys(anchors)) expect(layout[id].pinned).toBe(anchors[id].pinned)
  })
  it('只剩单个节点或空图时不引入偏移', () => {
    expect(layoutNodes([], {}, {})).toEqual({})
    expect(layoutNodes(['a'], { a: position(-800, -120) }, { a: 900 })).toEqual({ a: position(-800, -120) })
  })
})

describe('移动与新增节点避让', () => {
  it('空闲位置完全保留，触及安全间距的边界不再被推出', () => {
    const obstacle = { position: position(0, 0), height: 100 }
    for (const desired of [position(465, 12, true), position(340, 0, true), position(0, 140, true)]) {
      expect(freePosition(desired, 100, [obstacle])).toEqual(desired)
    }
  })
  it('重叠时选择最近空位，等距离时向下；不移动其他节点', () => {
    const obstacles = [{ position: position(0, 0, true), height: 100 }]
    const snapshot = structuredClone(obstacles)
    const next = freePosition(position(0, 0, true), 100, obstacles)
    expect(next).toEqual(position(0, 140, true))
    expect(freePosition(position(290, 0, true), 100, obstacles)).toEqual(position(340, 0, true))
    expect(obstacles).toEqual(snapshot)
    expectSeparated([...obstacles, { position: next, height: 100 }])
  })
  it('大小不一、负坐标的密集障碍中找到空位，并与障碍顺序无关', () => {
    const obstacles = [
      { position: position(-360, -230), height: 310 }, { position: position(0, -230), height: 180 },
      { position: position(360, -230), height: 550 }, { position: position(0, -10), height: 390 },
    ]
    const next = freePosition(position(120, 80, true), 270, obstacles)
    expect(next).toEqual(freePosition(position(120, 80, true), 270, [...obstacles].reverse()))
    expectSeparated([...obstacles, { position: next, height: 270 }])
  })
})
