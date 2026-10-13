import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { recordWithGraph, proposal } from './fixtures/codex'
import { CanvasStore } from '../src/integration/store'
import { applyGraphUpdate, publicCanvas } from '../src/integration/update'
import { referenceFor } from '../src/core/references'
import type { CanvasRecord } from '../src/integration/types'

const store = new CanvasStore(), ownedIds: string[] = [], run = promisify(execFile)
async function seed(page: Page) {
  const record = recordWithGraph(`e2e-${randomUUID()}`)
  ownedIds.push(record.document.id)
  await store.change(record.document.id, () => record)
  await page.goto(`/?canvas=${record.document.id}&access=${record.accessToken}`)
  await expect(page.getByTestId('node-main')).toBeVisible()
  await expect(page).not.toHaveURL(/access=/)
  await expect.poll(async () => (await store.read(record.document.id))!.document.view.viewport).not.toBeNull()
  return record
}
async function read(record: CanvasRecord) { return (await store.read(record.document.id))! }
async function locate(page: Page, reference: string) {
  await page.getByRole('button', { name: '定位引用', exact: true }).click()
  await page.getByRole('textbox', { name: '待定位引用' }).fill(reference)
  await page.getByRole('button', { name: '定位节点', exact: true }).click()
}
test.afterEach(async ({ page }) => {
  await page.close()
  await Promise.all(ownedIds.splice(0).map(id => unlink(join(store.directory, `${id}.json`))))
})

test('Codex 画布：浏览器人工修改回读、再次整理保留、刷新与引用定位', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const record = await seed(page), main = page.getByTestId('node-main')
  await expect(page.locator('[data-node]')).toHaveCount(5)
  await main.getByRole('button', { name: '展开 整理对话', exact: true }).click()
  await main.getByRole('button', { name: '查看原文', exact: true }).click()
  await expect(main.getByRole('region', { name: '对话来源' })).toBeVisible()
  await expect(main.locator('blockquote')).toHaveText('先整理对话，保留来源。')
  await main.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('人工修正的标题')
  await main.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await read(record)).document.user.fields.main?.title).toBe('人工修正的标题')
  await main.focus(); await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(async () => (await read(record)).document.view.positions.main.pinned).toBe(true)
  const position = (await read(record)).document.view.positions.main
  await main.getByRole('button', { name: '复制引用', exact: true }).click()
  const reference = await page.evaluate(() => navigator.clipboard.readText())
  expect(reference).toBe(referenceFor(record.document.id, 'main'))
  const { stdout } = await run('npm', ['run', '--silent', 'mindweave', '--', 'read', reference])
  expect(JSON.parse(stdout)).toMatchObject({ node: { title: '人工修正的标题', sourceIds: expect.any(Array) }, excerpts: [{ excerpt: '先整理对话，保留来源。' }] })
  // Save focus/viewport before the generated update so polling has no draft.
  await expect.poll(async () => (await read(record)).document.view.selected).toBe('main')
  const current = await read(record), viewport = current.document.view.viewport
  const update = proposal(current, 'update-followup')
  update.nodes[0].title = 'Codex 重新提炼的标题'; update.nodes[0].summary = '这次整理的新摘要'
  update.nodes.push({ ...update.nodes[1], id: 'followup', title: '补充支线', position: { x: -465, y: 120, pinned: false } })
  await store.change(record.document.id, latest => applyGraphUpdate(latest!, update))
  await expect(page.getByTestId('node-followup')).toBeVisible({ timeout: 10000 })
  await expect(main.locator('h2')).toHaveText('人工修正的标题')
  await expect(main.locator('.node-summary')).toHaveText('这次整理的新摘要')
  expect((await read(record)).document.view.positions.main).toEqual(position)
  expect((await read(record)).document.view.viewport).toEqual(viewport)
  await page.reload()
  await expect(page.getByTestId('node-followup')).toBeVisible()
  await expect(main.locator('h2')).toHaveText('人工修正的标题')
  await locate(page, reference)
  await expect(main).toBeFocused()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(`/?canvas=${record.document.id}`)
  await expect(reopened.getByTestId('node-main').locator('h2')).toHaveText('人工修正的标题')
  await reopened.close()
  expect(errors).toEqual([])
})

test('真实画布离线编辑保留草稿，重新连接后保存；无访问凭据不退回样例', async ({ page, context }) => {
  const record = await seed(page), node = page.getByTestId('node-main')
  await page.route('**/api/canvases/**', route => route.abort())
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('断网时的修改')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await read(record)).document.user.fields.main).toBeUndefined()
  const draft = await page.evaluate(id => JSON.parse(localStorage.getItem(`mindweave:v1:codex-draft:${id}`)!), record.document.id)
  expect(draft.draft.user.fields.main.title).toBe('断网时的修改')
  await page.unroute('**/api/canvases/**')
  await page.reload()
  await expect(node.locator('h2')).toHaveText('断网时的修改')
  await expect.poll(async () => (await read(record)).document.user.fields.main?.title).toBe('断网时的修改')
  await expect(page.getByRole('alert')).toHaveCount(0)
  const isolated = await context.browser()!.newContext()
  const untrusted = await isolated.newPage()
  await untrusted.goto(`http://127.0.0.1:5173/?canvas=${record.document.id}`)
  await expect(untrusted.getByRole('alert')).toContainText('尚未获得画布访问权限')
  await expect(untrusted.locator('[data-node]')).toHaveCount(0)
  await isolated.close()
})

test('编辑表单打开时不应用新整理，关闭后安静更新，浏览器不能改写生成层', async ({ page }) => {
  const record = await seed(page), node = page.getByTestId('node-main')
  await node.locator('h2').dblclick()
  await page.getByRole('textbox', { name: '节点标题' }).fill('还在编辑')
  const current = await read(record), update = proposal(current, 'update-while-editing')
  update.nodes.push({ ...update.nodes[1], id: 'arriving', title: '新到的主题' })
  await store.change(record.document.id, latest => applyGraphUpdate(latest!, update))
  await page.waitForTimeout(2700)
  await expect(page.getByTestId('node-arriving')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '节点标题' })).toHaveValue('还在编辑')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByTestId('node-arriving')).toBeVisible({ timeout: 10000 })
  await expect.poll(async () => (await read(record)).document.user.fields.main?.title).toBe('还在编辑')
  const latest = await read(record), fake = publicCanvas(latest).document
  fake.generated.nodes.main.title = '伪造生成内容'
  const response = await page.request.put(`/api/canvases/${record.document.id}`, { data: { version: latest.version, document: fake } })
  expect(response.status()).toBe(400)
  expect((await read(record)).document.generated.nodes.main.title).toBe('整理对话')
})
