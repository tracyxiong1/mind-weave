import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import type { CanvasDocument } from '../src/core/types'
import { conversations } from '../src/data/samples'

const key = 'mindweave:v1:canvas:mw-branches'
async function stored(page: Page): Promise<CanvasDocument> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
}
async function menuAction(page: Page, id: string, action: string) {
  const node = page.getByTestId(`node-${id}`)
  await node.click()
  await node.getByRole('button', { name: /的操作$/ }).click()
  await node.getByRole('button', { name: action, exact: true }).click()
}
async function locate(page: Page, reference: string) {
  await page.getByRole('button', { name: '定位引用', exact: true }).click()
  await page.getByRole('textbox', { name: '待定位引用' }).fill(reference)
  await page.getByRole('button', { name: '定位节点', exact: true }).click()
}
async function expectNoDanglingEdges(page: Page) {
  const ids = new Set(await page.locator('[data-node]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-node'))))
  const labels = await page.locator('[data-edge] [role="button"]').evaluateAll(edges => edges.map(e => e.getAttribute('aria-label')))
  const titles = await page.locator('[data-node] > .node-heading h2').allTextContents()
  expect(ids.size).toBe(titles.length)
  for (const label of labels) {
    const [from, to] = label!.replace('关系：', '').split(' → ')
    expect(titles).toContain(from); expect(titles).toContain(to)
  }
}
async function expectCardsSeparated(page: Page) {
  await expect.poll(async () => page.locator('[data-node]').evaluateAll(nodes => {
    const boxes = nodes.map(node => ({ id: node.getAttribute('data-node'), rect: node.getBoundingClientRect() }))
    const violations: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (const b of boxes.slice(i + 1)) {
        const a = boxes[i]
        const clearance = Math.max(b.rect.left - a.rect.right, a.rect.left - b.rect.right,
          b.rect.top - a.rect.bottom, a.rect.top - b.rect.bottom)
        // Compare actual browser rectangles, with a pixel of rounding tolerance.
        if (clearance < 39 * a.rect.width / 300 - 0.5) violations.push(`${a.id} / ${b.id}`)
      }
    }
    return violations
  })).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Playwright gives each test a fresh browser context and isolated localStorage.
  await expect(page.getByTestId('node-comparison')).toBeVisible()
  await expect.poll(async () => (await stored(page)).view.viewport).not.toBeNull()
})

test('折叠时突出中心主题，支线摘要按需出现且内容不变', async ({ page }) => {
  const original = await stored(page)
  await expect(page.locator('.node.emphasized')).toHaveCount(1)
  await expect(page.getByTestId('node-comparison').locator('.node-summary')).toHaveText('层级用于梳理，连线用于关联。')
  const branch = page.getByTestId('node-structure')
  await expect(branch.locator('.node-summary')).toHaveCount(0)
  await expect(branch.locator('h2')).toHaveText('层级展开与跨主题关联')
  await expect(page.getByTestId('node-mixing')).toContainText('建议 · 尚未讨论')
  await page.screenshot({ path: 'docs/validation/initial.png' })
  await branch.getByRole('button', { name: '展开 层级展开与跨主题关联', exact: true }).click()
  await expect(branch.locator('.node-summary.full')).toHaveText('树状层级 / 自由连线')
  await expectCardsSeparated(page)
  const current = await stored(page)
  expect(current.generated).toEqual(original.generated)
  expect(current.user).toEqual(original.user)
  expect(current.history).toEqual(original.history)
})

test('补充关联按需显示，选中高亮直接关系，完整关系与原数据始终保留', async ({ page }) => {
  const saved = await stored(page)
  saved.generated.edges['cross-one'] = { id: 'cross-one', from: 'structure', to: 'relations', label: '跨分支关联一' }
  saved.generated.edges['cross-two'] = { id: 'cross-two', from: 'two-views', to: 'mixing', label: '跨分支关联二' }
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved })
  await page.reload()
  const one = page.getByTestId('edge-cross-one')
  const two = page.getByTestId('edge-cross-two')
  await expect(one).toBeHidden(); await expect(two).toBeHidden()
  await page.getByTestId('node-structure').click()
  await expect(one).toBeVisible(); await expect(two).toBeHidden()
  await expect(page.getByTestId('node-mixing')).toHaveClass(/unrelated/)
  await expect(page.getByTestId('node-relations')).not.toHaveClass(/unrelated/)
  const crossedCards = await one.locator('.edge-line').evaluate(element => {
    const path = element as SVGPathElement
    const cards = [...document.querySelectorAll<HTMLElement>('[data-node]')]
      .filter(node => !['structure', 'relations'].includes(node.dataset.node!))
      .map(node => ({ id: node.dataset.node, x: parseFloat(node.style.left), y: parseFloat(node.style.top), height: node.offsetHeight }))
    const hits = new Set<string>()
    for (let length = 0; length <= path.getTotalLength(); length += 2) {
      const point = path.getPointAtLength(length)
      for (const card of cards) {
        if (point.x > card.x && point.x < card.x + 300 && point.y > card.y && point.y < card.y + card.height) hits.add(card.id!)
      }
    }
    return [...hits]
  })
  expect(crossedCards).toEqual([])
  await page.keyboard.press('Escape')
  await expect(one).toBeHidden()
  await expect(page.locator('.node.unrelated')).toHaveCount(0)
  const toggle = page.getByRole('button', { name: '显示全部关联', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(one).toBeVisible(); await expect(two).toBeVisible()
  await toggle.click()
  await expect(two).toBeHidden()
  await menuAction(page, 'relations', '管理关系')
  await expect(page.getByRole('dialog')).toContainText('跨分支关联一')
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
  await menuAction(page, 'two-views', '管理关系')
  await expect(page.getByRole('dialog')).toContainText('跨分支关联二')
  const current = await stored(page)
  expect(current.generated).toEqual(saved.generated)
  expect(current.user).toEqual(saved.user)
  expect(current.view.positions).toEqual(saved.view.positions)
  expect(current.history).toEqual(saved.history)
})

test('整理布局按分支对齐，保留完整内容，刷新后可一步撤销恢复原位置', async ({ page }) => {
  const original = await stored(page)
  await expect(page.getByTestId('canvas-root')).toHaveCount(0)
  await page.getByRole('button', { name: '整理布局', exact: true }).click()
  await expectCardsSeparated(page)
  await expect.poll(async () => (await stored(page)).history.past.at(-1)?.label).toBe('整理布局')
  const arranged = await stored(page)
  expect(arranged.generated).toEqual(original.generated)
  expect(arranged.user).toEqual(original.user)
  expect(arranged.view.positions.structure.x).toBe(arranged.view.positions['two-views'].x)
  expect(arranged.view.positions.structure.x).toBeGreaterThan(arranged.view.positions.comparison.x + 300)
  expect(arranged.view.selected).toBeNull()
  await page.reload()
  await expectCardsSeparated(page)
  expect((await stored(page)).view.positions).toEqual(arranged.view.positions)
  await page.getByRole('button', { name: '撤销整理布局', exact: true }).click()
  await expect.poll(async () => (await stored(page)).view.positions).toEqual(original.view.positions)
  await expectCardsSeparated(page)
})

test('独立分支统一从会话主题根节点展开，视口包含总根且刷新、撤销保持正确', async ({ page }) => {
  const saved = await stored(page)
  delete saved.generated.edges['e-branches-1']
  delete saved.generated.edges['e-branches-5']
  await page.addInitScript(({ key, saved }) => {
    if (sessionStorage.getItem('root-fixture-loaded')) return
    localStorage.setItem(key, JSON.stringify(saved))
    sessionStorage.setItem('root-fixture-loaded', 'true')
  }, { key, saved })
  await page.reload()
  const root = page.getByTestId('canvas-root')
  await expect(root).toHaveCount(1)
  await expect(root.getByRole('heading')).toHaveText(conversations.branches.title)
  await expect(page.locator('[data-root-edge]')).toHaveCount(3)
  await expect(page.locator('[data-root-edge="mixing"]')).toHaveClass(/suggested-edge/)
  await page.getByRole('button', { name: '整理布局', exact: true }).click()
  await expectCardsSeparated(page)
  const rootBox = (await root.boundingBox())!
  const branchBoxes = await Promise.all(['context', 'comparison', 'mixing'].map(id => page.getByTestId(`node-${id}`).boundingBox()))
  expect(rootBox.x).toBeGreaterThanOrEqual(16)
  expect(rootBox.y).toBeGreaterThanOrEqual(76)
  for (const branch of branchBoxes) {
    expect(branch!.x).toBeGreaterThan(rootBox.x + rootBox.width)
    expect(branch!.x).toBeCloseTo(branchBoxes[0]!.x)
  }
  const arranged = await stored(page)
  expect(Object.keys(arranged.view.positions).sort()).toEqual(Object.keys(saved.view.positions).sort())
  expect(arranged.generated).toEqual(saved.generated)
  expect(arranged.user).toEqual(saved.user)
  expect(arranged.history.past).toHaveLength(saved.history.past.length + 1)
  await page.reload()
  await expect(root).toHaveCount(1)
  expect((await stored(page)).view.positions).toEqual(arranged.view.positions)
  await page.getByRole('button', { name: '撤销整理布局', exact: true }).click()
  await expect.poll(async () => (await stored(page)).view.positions).toEqual(saved.view.positions)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await expect(root).toBeInViewport()
})

test('展开原文、完整消息与多个详情均不遮挡，折叠恢复且不改保存锚点', async ({ page }) => {
  const original = await stored(page)
  const context = page.getByTestId('node-context')
  const comparison = page.getByTestId('node-comparison')
  const baselineTop = await comparison.evaluate(node => node.style.top)
  await context.getByRole('button', { name: '展开 整理发散的对话', exact: true }).click()
  await context.getByRole('button', { name: '查看原文', exact: true }).click()
  await expectCardsSeparated(page)
  const excerptHeight = (await context.boundingBox())!.height
  await context.getByText('完整原始消息', { exact: true }).click()
  await expect.poll(async () => (await context.boundingBox())!.height).toBeGreaterThan(excerptHeight)
  await expectCardsSeparated(page)
  await expect.poll(async () => comparison.evaluate(node => parseFloat(node.style.top))).toBeGreaterThan(parseFloat(baselineTop))
  await comparison.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await expectCardsSeparated(page)
  await page.getByTestId('node-structure').getByRole('button', { name: '展开 层级展开与跨主题关联', exact: true }).click()
  await expectCardsSeparated(page)
  await page.getByRole('button', { name: '主题：跟随系统', exact: true }).click()
  await page.getByRole('button', { name: '主题：浅色', exact: true }).click()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await page.screenshot({ path: 'docs/validation/avoidance-dark.png' })
  expect((await stored(page)).view.positions).toEqual(original.view.positions)
  expect((await stored(page)).history).toEqual(original.history)
  await context.getByRole('button', { name: '折叠 整理发散的对话', exact: true }).click()
  await expect.poll(async () => comparison.evaluate(node => node.style.top)).toBe(baselineTop)
  await expectCardsSeparated(page)
  await page.reload()
  await expectCardsSeparated(page)
  expect((await stored(page)).view.positions).toEqual(original.view.positions)
})

test('较长说明按需展开，编辑器和长摘要增长时相邻支线继续避让', async ({ page }) => {
  const saved = await stored(page)
  saved.generated.nodes.structure.details = saved.generated.nodes.structure.details.repeat(6)
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved })
  await page.reload()
  const branch = page.getByTestId('node-structure')
  const next = page.getByTestId('node-two-views')
  await branch.getByRole('button', { name: '展开 层级展开与跨主题关联', exact: true }).click()
  await expectCardsSeparated(page)
  const clampedHeight = (await branch.boundingBox())!.height
  const clampedNextTop = await next.evaluate(node => parseFloat(node.style.top))
  await branch.getByRole('button', { name: '更多说明', exact: true }).click()
  await expect.poll(async () => (await branch.boundingBox())!.height).toBeGreaterThan(clampedHeight)
  await expect.poll(async () => next.evaluate(node => parseFloat(node.style.top))).toBeGreaterThan(clampedNextTop)
  await expectCardsSeparated(page)
  await branch.getByRole('button', { name: '收起说明', exact: true }).click()
  await expect.poll(async () => next.evaluate(node => parseFloat(node.style.top))).toBe(clampedNextTop)
  await branch.locator('h2').dblclick()
  await expectCardsSeparated(page)
  const summary = '保留完整摘要，补充细节可以滚动阅读。'.repeat(20)
  await branch.getByRole('textbox', { name: '节点摘要' }).fill(summary)
  await branch.getByRole('button', { name: '保存', exact: true }).click()
  await expect(branch.locator('.node-summary.full')).toHaveText(summary)
  await expectCardsSeparated(page)
  expect((await branch.boundingBox())!.height).toBeLessThan(600)
  expect((await stored(page)).view.positions).toEqual(saved.view.positions)
  expect((await stored(page)).user.fields.structure.summary).toBe(summary)
  await branch.getByRole('button', { name: '折叠 层级展开与跨主题关联', exact: true }).click()
  await expect.poll(async () => next.evaluate(node => parseFloat(node.style.top))).toBe(saved.view.positions['two-views'].y)
  await expectCardsSeparated(page)
})

test('拖到其他节点上时预览和落点均避让，只记录一步且可刷新与撤销', async ({ page }) => {
  const original = await stored(page)
  const card = page.getByTestId('node-two-views')
  const heading = (await card.locator('h2').boundingBox())!
  const from = (await card.boundingBox())!
  const target = (await page.getByTestId('node-structure').boundingBox())!
  const otherPositions = await page.locator('[data-node]:not([data-node="two-views"])').evaluateAll(nodes => nodes.map(node => [node.id, (node as HTMLElement).style.left, (node as HTMLElement).style.top]))
  await page.mouse.move(heading.x + 35, heading.y + 10)
  await page.mouse.down()
  await page.mouse.move(heading.x + 35 + target.x - from.x, heading.y + 10 + target.y - from.y, { steps: 10 })
  await expectCardsSeparated(page)
  expect(await page.locator('[data-node]:not([data-node="two-views"])').evaluateAll(nodes => nodes.map(node => [node.id, (node as HTMLElement).style.left, (node as HTMLElement).style.top]))).toEqual(otherPositions)
  const preview = await card.evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }))
  await page.mouse.up()
  await expect.poll(async () => (await stored(page)).history.past.length).toBe(original.history.past.length + 1)
  const moved = await stored(page)
  expect(moved.view.positions['two-views']).toEqual({ ...preview, pinned: true })
  for (const id of Object.keys(original.view.positions).filter(id => id !== 'two-views')) expect(moved.view.positions[id]).toEqual(original.view.positions[id])
  await expectCardsSeparated(page)
  await page.reload()
  await expectCardsSeparated(page)
  expect((await stored(page)).view.positions['two-views']).toEqual(moved.view.positions['two-views'])
  await page.getByRole('button', { name: '撤销移动节点', exact: true }).click()
  await expect.poll(async () => (await stored(page)).view.positions).toEqual(original.view.positions)
  await expectCardsSeparated(page)
})

test('已保存的重叠位置恢复后可读，引用定位与适应画布使用避让后的坐标', async ({ page }) => {
  const saved = await stored(page)
  saved.view.positions.structure = { x: 0, y: 0, pinned: true }
  saved.view.positions['two-views'] = { x: 0, y: 0, pinned: true }
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved })
  await page.reload()
  await expectCardsSeparated(page)
  await locate(page, 'mindweave://canvas/mw-branches/node/comparison')
  const node = page.getByTestId('node-comparison')
  await expect(node).toBeFocused()
  await expect.poll(async () => (await node.boundingBox())!.y).toBeGreaterThanOrEqual(76)
  const box = (await node.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(16); expect(box.x + box.width).toBeLessThanOrEqual(1424)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await expectCardsSeparated(page)
  const boxes = await page.locator('[data-node]').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }
  }))
  expect(Math.min(...boxes.map(box => box.top))).toBeGreaterThanOrEqual(76)
  expect(Math.max(...boxes.map(box => box.bottom))).toBeLessThanOrEqual(824)
  expect((await stored(page)).view.positions).toEqual(saved.view.positions)
})

test('同一画布明暗布局一致，详情按需展开，主题刷新恢复', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  expect(await page.locator('[data-node]').count()).toBe(6)
  await expect(page.locator('.node-details')).toHaveCount(0)
  await expect(page.locator('input, textarea')).toHaveCount(0)
  await page.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await page.getByRole('button', { name: '主题：跟随系统', exact: true }).click()
  const light = await page.getByTestId('node-comparison').boundingBox()
  mkdirSync('docs/validation', { recursive: true })
  await page.screenshot({ path: 'docs/validation/light.png' })
  await page.getByRole('button', { name: '主题：浅色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.getByTestId('node-comparison').boundingBox()).toEqual(light)
  await page.screenshot({ path: 'docs/validation/dark.png' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: '折叠 与思维导图比较', exact: true })).toBeVisible()
  const beforeZoom = (await stored(page)).view.viewport!.zoom
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect.poll(async () => (await stored(page)).view.viewport!.zoom).toBeCloseTo(beforeZoom * 1.2)
  expect((await page.getByTestId('node-comparison').boundingBox())!.width).toBeCloseTo(300 * beforeZoom * 1.2)
  await page.mouse.move(720, 790)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
  await expect.poll(async () => (await stored(page)).view.viewport!.zoom).toBeGreaterThan(beforeZoom * 1.2)
  const zoomed = (await stored(page)).view.viewport!
  await page.reload()
  expect((await stored(page)).view.viewport).toEqual(zoomed)
  expect(errors).toEqual([])
})

test('编辑和真实拖动在刷新、关闭并重新打开后保持，拖动只记一步撤销', async ({ page, context }) => {
  const node = page.getByTestId('node-comparison')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('编辑后的比较')
  await page.getByRole('textbox', { name: '节点摘要' }).fill('我的人工修正')
  await page.screenshot({ path: 'docs/validation/editing.png' })
  await node.getByRole('button', { name: '保存', exact: true }).click()
  const before = await stored(page)
  const box = (await node.locator('h2').boundingBox())!
  await page.mouse.move(box.x + 40, box.y + 12)
  await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 62, { steps: 8 }); await page.mouse.up()
  await expect.poll(async () => (await stored(page)).view.positions.comparison.x).toBeCloseTo(before.view.positions.comparison.x + 100 / before.view.viewport!.zoom)
  const moved = await stored(page)
  expect(moved.view.positions.comparison.y).toBeCloseTo(before.view.positions.comparison.y + 50 / before.view.viewport!.zoom)
  expect(moved.view.positions.comparison.pinned).toBe(true)
  expect(moved.history.past.length).toBe(before.history.past.length + 1)
  await page.reload()
  await expect(page.getByTestId('node-comparison')).toContainText('编辑后的比较')
  expect((await stored(page)).view.positions.comparison).toEqual(moved.view.positions.comparison)
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/')
  await expect(reopened.getByTestId('node-comparison')).toContainText('我的人工修正')
  expect((await stored(reopened)).view.positions.comparison).toEqual(moved.view.positions.comparison)
  await reopened.close()
})

test('新增用户笔记、建立与移除关系、删除和撤销，始终没有悬空连线', async ({ page }) => {
  await page.getByRole('button', { name: '新增笔记', exact: true }).click()
  await page.getByRole('textbox', { name: '笔记标题' }).fill('手动补充')
  await page.getByRole('textbox', { name: '笔记摘要' }).fill('我的想法，尚待验证')
  await page.getByRole('dialog').getByRole('button', { name: '新增笔记', exact: true }).click()
  const note = page.getByRole('article', { name: '手动补充', exact: true })
  await expect(note).toBeVisible()
  const id = (await note.getAttribute('data-node'))!
  expect((await stored(page)).user.notes[id].sourceIds).toEqual([])
  await expect(note).toContainText('用户笔记')
  await expect(note.getByRole('button', { name: '查看原文', exact: true })).toHaveCount(0)
  await menuAction(page, id, '连接到…')
  await page.getByLabel('目标节点', { exact: true }).selectOption('comparison')
  await page.getByRole('button', { name: '建立关系', exact: true }).click()
  await expect(page.locator('[data-edge]')).toHaveCount(6)
  await menuAction(page, id, '管理关系')
  await page.getByRole('button', { name: /^移除关系/ }).click()
  await expect(page.getByRole('dialog')).toContainText('这个节点还没有关系')
  await expect(page.locator('[data-edge]')).toHaveCount(5)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '撤销移除关系', exact: true }).click()
  await expect(page.locator('[data-edge]')).toHaveCount(6)
  await menuAction(page, id, '删除节点')
  await expect(note).toHaveCount(0)
  await expect(page.locator('[data-edge]')).toHaveCount(5)
  await expectNoDanglingEdges(page)
  await page.getByRole('button', { name: '撤销删除节点', exact: true }).click()
  await expect(page.locator('[data-edge]')).toHaveCount(6)
  await page.reload()
  await expect(page.getByTestId(`node-${id}`)).toContainText('手动补充')
  await expectNoDanglingEdges(page)
})

test('真正复制的旧引用在改标题、合并与刷新后仍能定位', async ({ page }) => {
  const node = page.getByTestId('node-comparison')
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await node.getByRole('button', { name: '复制引用', exact: true }).click()
  const reference = await page.evaluate(() => navigator.clipboard.readText())
  expect(reference).toBe('mindweave://canvas/mw-branches/node/comparison')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('改标题仍保留身份')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  await locate(page, reference)
  await expect(node).toBeFocused()
  await menuAction(page, 'comparison', '合并到…')
  await page.getByLabel('目标节点', { exact: true }).selectOption('structure')
  await page.getByRole('button', { name: '合并并保留引用', exact: true }).click()
  await expect(node).toHaveCount(0)
  await locate(page, reference)
  const merged = page.getByTestId('node-structure')
  await expect(merged).toBeFocused()
  await expect(merged).toContainText('改标题仍保留身份')
  expect((await stored(page)).user.aliases.comparison).toBe('structure')
  await page.reload()
  await locate(page, reference)
  await expect(page.getByTestId('node-structure')).toBeFocused()
  await expectNoDanglingEdges(page)
})

test('来源显示可定位摘录和完整原消息，原始内容不受编辑影响', async ({ page }) => {
  const node = page.getByTestId('node-comparison')
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await node.getByRole('button', { name: '查看原文', exact: true }).click()
  const quote = node.locator('[data-source="s-comparison-1"]')
  await expect(quote.locator('blockquote')).toHaveText('层级用于梳理，连线用于关联。')
  await quote.getByText('完整原始消息', { exact: true }).click()
  await expect(quote.locator('details p')).toHaveText(conversations.branches.messages[1].text)
  await expect(quote.locator('mark')).toHaveText('层级用于梳理，连线用于关联。')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点摘要' }).fill('我的新摘要')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  await expect(quote.locator('details p')).toHaveText(conversations.branches.messages[1].text)
  await expect(node.locator('.node-summary')).toHaveText('我的新摘要')
})

test('键盘可展开、编辑取消、移动、删除、撤销与重做', async ({ page }) => {
  const node = page.getByTestId('node-comparison')
  await node.focus(); await page.keyboard.press('Enter')
  await expect(node.getByRole('button', { name: '查看原文', exact: true })).toBeVisible()
  await page.keyboard.press('F2')
  const title = page.getByRole('textbox', { name: '节点标题' })
  await expect(title).toBeFocused()
  await title.fill('不保存的标题'); await page.keyboard.press('Escape')
  await expect(node).toContainText('与思维导图比较'); await expect(node).toBeFocused()
  await page.keyboard.press('F2'); await title.fill('按钮聚焦时也可取消')
  await node.getByRole('button', { name: '保存', exact: true }).focus(); await page.keyboard.press('Escape')
  await expect(node).toContainText('与思维导图比较'); await expect(node).toBeFocused()
  const before = (await stored(page)).view.positions.comparison
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await stored(page)).view.positions.comparison.x).toBe(before.x + 10)
  await page.keyboard.press('Delete'); await expect(node).toHaveCount(0)
  await page.keyboard.press('Control+z'); await expect(node).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z'); await expect(node).toHaveCount(0)
  await page.keyboard.press('Control+z'); await expect(node).toHaveCount(1)
})

test('390px 窄预览保持可读，可编辑、查看来源、平移到其他支线', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 })
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  const node = page.getByTestId('node-comparison')
  let box = (await node.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect((await stored(page)).view.viewport!.zoom).toBeGreaterThanOrEqual(0.88)
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await node.getByRole('button', { name: '查看原文', exact: true }).click()
  await expect(node.locator('blockquote')).toHaveText('层级用于梳理，连线用于关联。')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('窄预览里的比较')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  box = (await node.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'docs/validation/narrow.png' })
  // Pan the background instead of shrinking the graph to unreadable text.
  await page.mouse.move(360, 510); await page.mouse.down(); await page.mouse.move(-50, 670, { steps: 10 }); await page.mouse.up()
  const branch = (await page.getByTestId('node-structure').boundingBox())!
  expect(branch.x).toBeGreaterThanOrEqual(0); expect(branch.x).toBeLessThan(390)
  expect(branch.y).toBeGreaterThanOrEqual(0)
  await page.getByTestId('node-structure').getByRole('button', { name: '展开 层级展开与跨主题关联', exact: true }).click()
  await expect(page.getByTestId('node-structure').getByRole('button', { name: '查看原文', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await page.getByTestId('node-mixing').focus()
  const focused = (await page.getByTestId('node-mixing').boundingBox())!
  expect(focused.x).toBeGreaterThanOrEqual(16); expect(focused.x + focused.width).toBeLessThanOrEqual(374)
  expect(focused.y).toBeGreaterThanOrEqual(76); expect(focused.y + focused.height).toBeLessThanOrEqual(644)
})

test('引用错误明确区分；URL hash 也能定位到节点', async ({ page }) => {
  await locate(page, 'mindweave://canvas/mw-learning/node/flow')
  await expect(page.getByRole('alert')).toContainText('另一张画布')
  await page.getByRole('textbox', { name: '待定位引用' }).fill('mindweave://canvas/mw-branches/node/missing')
  await page.getByRole('button', { name: '定位节点', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('没有这个节点')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByTestId('node-mixing').focus(); await page.keyboard.press('Delete')
  await locate(page, 'mindweave://canvas/mw-branches/node/mixing')
  await expect(page.getByRole('alert')).toContainText('已删除')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.goto('/#ref=' + encodeURIComponent('mindweave://canvas/mw-branches/node/structure'))
  await expect(page.getByTestId('node-structure')).toBeFocused()
})

test('损坏的本地数据不被自动覆盖，可下载后明确恢复', async ({ page }, testInfo) => {
  // Inject corruption before app initialization, after the previous page has flushed on pagehide.
  await page.addInitScript(key => localStorage.setItem(key, '{broken'), key)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('原数据已保留')
  await page.getByRole('button', { name: '主题：跟随系统', exact: true }).click()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{broken')
  await page.getByRole('button', { name: '查看保存选项', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原始数据', exact: true }).click()
  const download = await downloaded; const path = testInfo.outputPath('recovery.json')
  await download.saveAs(path); expect(await readFile(path, 'utf8')).toBe('{broken')
  await page.getByRole('button', { name: '用示例覆盖本地数据', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect((await stored(page)).schemaVersion).toBe(1)
})

test('实际模拟容量不足会提示失败，编辑仍可导出完整备份', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota exceeded', 'QuotaExceededError') }
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('本地保存失败')
  const node = page.getByTestId('node-comparison')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('存储失败时的编辑')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '使用说明与保存', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前画布', exact: true }).click()
  const download = await downloaded; const path = testInfo.outputPath('export.json')
  await download.saveAs(path)
  const data = JSON.parse(await readFile(path, 'utf8')) as CanvasDocument
  expect(data.user.fields.comparison.title).toBe('存储失败时的编辑')
  expect(data.generated.nodes.comparison.title).toBe('与思维导图比较')
})
