import { describe, expect, it } from 'vitest'
import { edgePath, fitView, NODE_WIDTH, zoomAt } from './geometry'
describe('视口', () => {
  it('缩放保持鼠标下的世界坐标不变', () => {
    const view = { x: 40, y: 80, zoom: 0.8 }; const point = { x: 300, y: 200 }
    const next = zoomAt(view, 1.2, point)
    expect((point.x - next.x) / next.zoom).toBeCloseTo((point.x - view.x) / view.zoom)
    expect((point.y - next.y) / next.zoom).toBeCloseTo((point.y - view.y) / view.zoom)
  })
  it('窄视口保留可读字号，完整图可平移查看', () => {
    const view = fitView([{ x: 0, y: 0, pinned: false }, { x: 465, y: 445, pinned: false }], [100, 100], { width: 390, height: 720 })
    expect(view.zoom).toBeGreaterThanOrEqual(0.88)
    expect(view.x).toBe(24)
  })
  it('限制缩放，空图仍返回有效视口', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 100, { x: 0, y: 0 }).zoom).toBe(2)
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0.001, { x: 0, y: 0 }).zoom).toBe(0.3)
    expect(fitView([], [], { width: 800, height: 600 }).zoom).toBe(1)
  })
})

describe('分支连线', () => {
  const position = (x: number, y: number) => ({ x, y, pinned: false })
  it('相邻列即使相差多行，仍从卡片侧边连接，控制点留在列间', () => {
    for (const [a, b] of [[position(0, 0), position(420, 900)], [position(420, 900), position(0, 0)]]) {
      const values = edgePath(a, 100, b, 100).match(/-?\d+(?:\.\d+)?/g)!.map(Number)
      const [startX, startY, controlAX, , controlBX, , endX, endY] = values
      expect(startX).toBe(a.x < b.x ? a.x + NODE_WIDTH : a.x)
      expect(endX).toBe(a.x < b.x ? b.x : b.x + NODE_WIDTH)
      expect(startY).toBe(a.y + 50); expect(endY).toBe(b.y + 50)
      for (const x of [controlAX, controlBX]) {
        expect(x).toBeGreaterThanOrEqual(Math.min(startX, endX))
        expect(x).toBeLessThanOrEqual(Math.max(startX, endX))
      }
    }
  })
})
