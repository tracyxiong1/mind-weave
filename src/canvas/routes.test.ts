import { describe, expect, it } from 'vitest'
import { edgePath } from '../core/geometry'
import { routePoints } from './routes'

describe('原有避障路由到原生场景', () => {
  it('保留直线、负坐标与折线路径端点', () => {
    expect(routePoints('M -120 25 L 0 25 L 1.5e2 -80')).toEqual([[-120, 25], [0, 25], [150, -80]])
  })
  it('三次曲线保持端点和中点，不将弧线改成直线', () => {
    const points = routePoints('M 0 0 C 0 100 100 100 100 0')
    expect(points[0]).toEqual([0, 0]); expect(points.at(-1)).toEqual([100, 0])
    expect(points[12]).toEqual([50, 75])
  })
  it('圆角折线保留避让位置', () => {
    const points = routePoints('M 300 80 L 320 80 Q 340 80 340 100 L 340 200')
    expect(points[5]).toEqual([335, 85]); expect(points.at(-1)).toEqual([340, 200])
  })
  it('实际避障路由投影后仍绕开中间节点', () => {
    const obstacle = { position: { x: 0, y: 220, pinned: false }, height: 160 }
    const path = edgePath({ x: 0, y: 0, pinned: false }, 80, { x: 0, y: 600, pinned: false }, 80, [obstacle])
    const points = routePoints(path)
    expect(points.every(([x, y]) => !(x > 0 && x < 300 && y > 220 && y < 380))).toBe(true)
    expect(points.every(point => point.every(Number.isFinite))).toBe(true)
  })
})
