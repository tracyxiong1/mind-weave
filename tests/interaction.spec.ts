import { expect, test } from './fixtures/browser'
import { createDocument } from '../src/core/model'
import { readingSample } from '../src/data/reading'
import type { Page } from '@playwright/test'

const key = 'mindweave:v1:canvas:mw-branches'
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)

async function openAt(page: Page, width: number, height: number, x: number, y: number, zoom: number, long = false) {
  await page.setViewportSize({ width, height })
  const saved = createDocument(readingSample)
  const position = saved.view.positions.comparison
  saved.view.viewport = { x: x - position.x * zoom, y: y - position.y * zoom, zoom }
  if (long) saved.generated.nodes.comparison.details = saved.generated.nodes.comparison.details.repeat(40)
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved })
  await page.goto('/')
  await expect(page.locator('[data-engine="excalidraw"]')).toHaveAttribute('data-ready', 'true')
  return page.getByTestId('node-comparison')
}

test('窄窗口展开和折叠保持视口与标题位置，不自动居中或缩放', async ({ page }) => {
  const node = await openAt(page, 596, 830, 30, 300, .88)
  const before = (await stored(page)).view.viewport
  const heading = await node.locator('h2').boundingBox()
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await expect(node.locator('.node-details')).toBeVisible()
  expect((await stored(page)).view.viewport).toEqual(before)
  expect((await node.locator('h2').boundingBox())!.y).toBeCloseTo(heading!.y, 0)
  await node.getByRole('button', { name: '折叠 与思维导图比较', exact: true }).click()
  expect((await stored(page)).view.viewport).toEqual(before)
})

test('点击标题直接阅读，拖动结束不误触折叠，双击仍可编辑', async ({ page }) => {
  const node = await openAt(page, 1440, 900, 150, 300, 1)
  await node.locator('h2').click()
  await expect(node.locator('.node-details')).toBeVisible()
  const before = (await stored(page)).view.positions.comparison
  const heading = (await node.locator('h2').boundingBox())!
  await page.mouse.move(heading.x + 20, heading.y + 10)
  await page.mouse.down()
  await page.mouse.move(heading.x + 80, heading.y + 50, { steps: 8 })
  await page.mouse.up()
  await expect(node.locator('.node-details')).toBeVisible()
  expect((await stored(page)).view.positions.comparison).not.toEqual(before)
  await node.locator('h2').dblclick()
  await expect(node.getByRole('textbox', { name: '节点标题' })).toBeFocused()
  await node.getByRole('button', { name: '取消', exact: true }).click()
  await expect(node.locator('.node-details')).toBeVisible()
  await node.getByRole('button', { name: '查看原文', exact: true }).click()
  await node.locator('.source-excerpt blockquote').first().dblclick()
  await expect(node.getByRole('textbox', { name: '节点标题' })).toHaveCount(0)
  await expect(node.locator('.sources')).toBeVisible()
})

test('放大后靠近窗口底部的节点菜单保持可见、原尺寸且可用键盘关闭', async ({ page }) => {
  const node = await openAt(page, 596, 480, 60, 260, 1.6)
  const before = (await stored(page)).view.viewport
  const button = node.getByRole('button', { name: '与思维导图比较 的操作', exact: true })
  await node.hover()
  await button.click()
  const menu = page.getByRole('group', { name: '节点操作', exact: true })
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.y).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(584)
  expect(box.y + box.height).toBeLessThanOrEqual(468)
  expect(box.width).toBeLessThanOrEqual(240)
  expect((await stored(page)).view.viewport).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('短详情上的滚轮继续平移画布，长详情内部滚动不移动画布', async ({ page }) => {
  const node = await openAt(page, 1440, 900, 150, 230, 1)
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  const details = node.locator('.node-details')
  const before = (await stored(page)).view.viewport
  await details.hover()
  await page.mouse.wheel(0, 70)
  await expect.poll(async () => (await stored(page)).view.viewport.y).toBeCloseTo(before.y - 70, 0)
  await page.close()
  const other = await page.context().newPage()
  const longNode = await openAt(other, 1440, 900, 150, 230, 1, true)
  await longNode.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await longNode.getByRole('button', { name: '更多说明', exact: true }).click()
  const longDetails = longNode.locator('.node-details')
  const view = (await stored(other)).view.viewport
  await longDetails.hover()
  await other.mouse.wheel(0, 140)
  await expect.poll(() => longDetails.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect((await stored(other)).view.viewport).toEqual(view)
})

test('从连线上开始拖动可以平移，单击连线仍可查看关系', async ({ page }) => {
  await openAt(page, 1440, 900, 150, 300, 1)
  const edge = page.getByTestId(`edge-${readingSample.edges[0].id}`).locator('.edge-hit')
  const point = await edge.evaluate(element => {
    const path = element as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  const before = (await stored(page)).view.viewport
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 80, point.y + 40, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await stored(page)).view.viewport.x).toBeCloseTo(before.x + 80, 0)
  expect((await stored(page)).view.viewport.y).toBeCloseTo(before.y + 40, 0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.mouse.click(point.x + 80, point.y + 40)
  await expect(page.getByRole('dialog', { name: '节点关系', exact: true })).toBeVisible()
})
