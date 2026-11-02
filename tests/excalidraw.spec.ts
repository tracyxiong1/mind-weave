import { expect, test } from './fixtures/browser'
import { createDocument, execute } from '../src/core/model'
import { readingSample } from '../src/data/reading'

const key = 'mindweave:v1:canvas:mw-branches'

test('编辑器仍在初始化时可切换主题并恢复损坏草稿，随后正常缩放', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(key => localStorage.setItem(key, '{broken'), key)
  let release!: () => void, held = false
  const loading = new Promise<void>(resolve => { release = resolve })
  await page.route('**/*zh-CN*', async route => { held = true; await loading; await route.continue() })
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('alert')).toContainText('原数据已保留')
    await page.getByRole('button', { name: '主题：跟随系统', exact: true }).click()
    await page.getByRole('button', { name: '查看保存选项', exact: true }).click()
    await page.getByRole('button', { name: '用示例覆盖本地数据', exact: true }).click()
    expect(held).toBe(true)
    release()
    await expect(page.locator('[data-engine="excalidraw"]')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.canvas-editor canvas')).toHaveCount(2)
    await expect(page.getByTestId('node-comparison')).toBeVisible()
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.zoom, key)
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.zoom, key)).toBeCloseTo(before * 1.2, 3)
  } finally { release() }
})

test('保留验证页的标题与摘要查找，结果可展开并定位到节点', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-engine="excalidraw"]')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('main', { name: '会话画布' }).focus()
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: '待定位引用' }).fill('层级展开')
  await page.getByRole('dialog').getByRole('button', { name: /层级展开与跨主题关联/ }).click()
  await expect(page.getByTestId('node-structure')).toBeFocused()
  await expect(page.getByTestId('node-structure').locator('.node-details')).toBeVisible()
  await page.getByRole('button', { name: '定位引用', exact: true }).click()
  await page.getByRole('textbox', { name: '待定位引用' }).fill('有助于回忆的联系')
  await page.getByRole('button', { name: '定位节点', exact: true }).click()
  await expect(page.getByTestId('node-relations')).toBeFocused()
})

test('正式画布由原生画布绘制连线，直接阅读且不显示嵌入提示或原生选框', async ({ page }) => {
  const external: string[] = []
  await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort() })
  await page.goto('/')
  await expect(page.locator('[data-engine="excalidraw"]')).toHaveAttribute('data-ready', 'true')
  const node = page.getByTestId('node-comparison')
  await expect(node).toBeVisible()
  await expect(page.locator('.canvas-editor canvas')).toHaveCount(2)
  // The HTML/SVG layer carries card text and accessible edge hit targets;
  // connections must actually be drawn by the new engine beneath it.
  await expect(page.locator('.edge-line').first()).toHaveCSS('stroke', 'rgba(0, 0, 0, 0)')
  await expect.poll(() => page.locator('.excalidraw__canvas').evaluateAll(canvases => canvases.reduce((count, element) => {
    const canvas = element as HTMLCanvasElement, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 80 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) < 230) count++
    }
    return count
  }, 0))).toBeGreaterThan(100)
  await node.hover(); await node.click()
  await expect(page.getByText('点击以开始交互', { exact: true })).toHaveCount(0)
  await expect(page.locator('.excalidraw-hyperlinkContainer:visible')).toHaveCount(0)
  await expect(page.locator('.excalidraw .layer-ui__wrapper')).toBeHidden()
  const purple = await page.locator('.excalidraw__canvas.interactive').evaluate(element => {
    const canvas = element as HTMLCanvasElement, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 60 && pixels[index + 2] > 150 && pixels[index] > 80 && pixels[index + 1] < pixels[index + 2] - 20) count++
    }
    return count
  })
  expect(purple).toBe(0)
  await node.getByRole('button', { name: '展开 与思维导图比较', exact: true }).click()
  await expect(node.locator('.node-details')).toContainText('思维导图通过层级梳理内容')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => page.locator('.excalidraw__canvas.static').evaluate(element => {
    const pixel = (element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data
    return Array.from(pixel)
  })).toEqual([25, 25, 25, 255])
  expect(external).toEqual([])
})

test('同地址的验证页草稿进入正式画布，平移缩放不改变节点或业务历史', async ({ page }) => {
  let saved = execute(createDocument(readingSample), { type: 'edit', id: 'comparison', title: '验证页中保留的标题', summary: '人工摘要' })
  saved = execute(saved, { type: 'move', id: 'comparison', position: { x: 100, y: 300, pinned: true } })
  await page.addInitScript(({ key, saved }) => localStorage.setItem(`excalidraw-experiment:${key}`, JSON.stringify(saved)), { key, saved })
  await page.goto('/')
  await expect(page.locator('[data-engine="excalidraw"]')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('node-comparison').locator('h2')).toHaveText('验证页中保留的标题')
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
  await page.mouse.move(48, 780); await page.mouse.down()
  await page.mouse.move(168, 700, { steps: 10 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.x, key)).toBeCloseTo(original.view.viewport.x + 120, 1)
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.zoom, key)).toBeCloseTo(original.view.viewport.zoom * 1.2, 3)
  const current = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
  expect(current.user).toEqual(saved.user); expect(current.generated).toEqual(saved.generated)
  expect(current.history).toEqual(saved.history); expect(current.view.positions).toEqual(saved.view.positions)
  // Native canvas focus must retain business undo and arrow-key panning, and
  // must not expose incomplete native shape/image commands through right-click.
  await page.mouse.click(48, 780)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.positions.comparison, key)).toEqual(createDocument(readingSample).view.positions.comparison)
  const panBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.x, key)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.viewport.x, key)).toBeCloseTo(panBefore - 60, 2)
  await page.mouse.click(48, 780, { button: 'right' })
  await expect(page.locator('.excalidraw .context-menu')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('node-comparison').locator('h2')).toHaveText('验证页中保留的标题')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(`excalidraw-experiment:${key}`)!).user, key)).toEqual(saved.user)
})
