import { describe, expect, it } from 'vitest'
import { fitView, zoomAt } from './geometry'
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
