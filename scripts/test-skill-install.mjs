import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, cp, rename, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { chromium, expect } from '@playwright/test'
import { buildSkill } from './build-skill.mjs'

const exec = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sandbox = await mkdtemp(join(tmpdir(), 'mindweave portable skill '))
const project = join(sandbox, 'existing project'), home = join(sandbox, 'data'), codexHome = join(sandbox, 'codex')
const skills = join(codexHome, 'skills'), installed = join(skills, 'mindweave')
let helper = join(installed, 'scripts/mindweave.mjs'), browser, legacy
const env = { ...process.env, CODEX_HOME: codexHome, MINDWEAVE_HOME: home, MINDWEAVE_PORT: '0',
  CODEX_THREAD_ID: 'unrelated-codex-thread', MINDWEAVE_CODEX_BIN: join(sandbox, 'no-codex-here') }
const run = async (args, input) => JSON.parse(await new Promise((resolve, reject) => {
  const child = execFile(process.execPath, [helper, ...args], { cwd: project, env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
    (error, stdout) => error ? reject(error) : resolve(stdout))
  child.stdin.end(input ?? '')
}))
async function fingerprint(directory) {
  const result = {}
  async function walk(path, prefix = '') {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (item.isDirectory()) await walk(join(path, item.name), prefix + item.name + '/')
      else result[prefix + item.name] = createHash('sha256').update(await readFile(join(path, item.name))).digest('hex')
    }
  }
  await walk(directory); return result
}
async function discoverSkill() {
  const child = spawn(process.env.MINDWEAVE_TEST_CODEX_BIN ?? 'codex', ['app-server'], { cwd: project, env, stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout }), pending = new Map()
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }; pending.clear() }
  child.on('error', fail); child.on('exit', () => fail(new Error('Codex discovery exited')))
  lines.on('line', line => {
    const value = JSON.parse(line), item = pending.get(value.id)
    if (item) { pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result) }
  })
  const request = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timeout`)) }, 10000)
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  try {
    await request(1, 'initialize', { clientInfo: { name: 'mindweave-portable-validation', version: '0.3.0' } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const loaded = await request(2, 'skills/list', { cwds: [project], forceReload: true })
    const skill = loaded.data.flatMap(entry => entry.skills).find(skill => skill.name === 'mindweave' && skill.path.startsWith(skills))
    assert(skill?.enabled, 'real Codex must discover and enable the standalone installed skill')
  } finally { fail(new Error('done')); lines.close(); child.kill() }
}

try {
  await mkdir(project, { recursive: true }); await mkdir(skills, { recursive: true })
  await writeFile(join(project, 'README.md'), 'Existing project; the skill must not modify this directory.\n')
  await exec('git', ['init', '--quiet'], { cwd: project })
  await exec('git', ['add', 'README.md'], { cwd: project })
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'existing project'], { cwd: project })
  const ref = process.env.MINDWEAVE_SKILL_TEST_REF
  if (ref) {
    const installer = process.env.MINDWEAVE_SKILL_INSTALLER ?? join(homedir(), '.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py')
    await exec('python3', [installer, '--repo', 'tracyxiong1/mind-weave', '--ref', ref, '--path', '.agents/skills/mindweave',
      '--dest', skills, '--method', 'download'], { env, timeout: 120000, maxBuffer: 2 * 1024 * 1024 })
  } else {
    await buildSkill(root)
    await cp(join(root, '.agents/skills/mindweave'), installed, { recursive: true })
  }
  assert(existsSync(join(installed, 'scripts/runtime/cli.mjs')))
  assert(existsSync(join(installed, 'assets/web/index.html')))
  assert(!existsSync(join(installed, 'runtime.json')))
  assert(!existsSync(join(installed, 'node_modules')))
  const originalSkill = await fingerprint(installed)
  if (process.env.MINDWEAVE_TEST_REAL_CODEX === '1') await discoverSkill()
  console.log(`PASS ${ref ? 'official GitHub installer' : 'standalone folder copy'}, self-contained runtime, no npm/development dependencies${process.env.MINDWEAVE_TEST_REAL_CODEX === '1' ? ', real Codex discovery' : ''}`)

  const transcript = { schemaVersion: 1, provider: 'generic', sessionId: 'portable-session', title: '安装验证：回看分叉讨论', messages: [
    { id: 'user-1', role: 'user', text: '🧵我想回看最初的思路，并保留人工修正。' },
    { id: 'assistant-1', role: 'assistant', text: '用主题与关系整理讨论，原文作为来源。' },
  ] }
  const input = join(sandbox, 'conversation.json'); await writeFile(input, JSON.stringify(transcript))
  const capture = await run(['capture', '--input', input])
  assert.equal(capture.provider, 'generic')
  const other = await run(['capture', '--input', '-'], JSON.stringify({ ...transcript, provider: 'claude' }))
  assert.notEqual(other.canvasId, capture.canvasId)
  assert(capture.capturePath.startsWith(home))
  const snapshot = JSON.parse(await readFile(capture.capturePath, 'utf8'))
  assert.deepEqual(snapshot.conversation.messages, transcript.messages)
  const proposal = { schemaVersion: 1, id: 'portable-first', canvasId: capture.canvasId, sessionId: capture.sessionId,
    baseRevision: capture.baseRevision, nodes: [
      { id: 'main', title: '回到最初的思路', summary: '保留讨论来源与人工修正', details: '', kind: 'discussion',
        sources: [{ messageId: 'user-1', quote: '我想回看最初的思路，并保留人工修正。' }] },
      { id: 'branch', title: '主题与关系', summary: '原文作为可回看的来源', details: '', kind: 'discussion',
        sources: [{ messageId: 'assistant-1', quote: '用主题与关系整理讨论，原文作为来源。' }] },
    ], edges: [{ id: 'main-branch', from: 'main', to: 'branch', label: '整理方式' }] }
  await mkdir(join(home, 'updates'), { recursive: true })
  const update = join(home, 'updates/proposal.json'); await writeFile(update, JSON.stringify(proposal))
  await run(['apply', update])
  assert(!existsSync(join(home, 'server.json')), 'capture and apply must stay quiet')
  await assert.rejects(run(['capture', '--input', input, '--thread', 'another']), /不能混用/)

  // Simulate an authenticated old daemon to verify automatic upgrade instead of
  // reusing a 0.2 server that can only validate Codex records.
  const secret = randomBytes(32).toString('hex')
  legacy = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${secret}`) { response.statusCode = 403; response.end(); return }
    if (request.url === '/api/mindweave/stop' && request.method === 'POST') {
      response.end('stopping')
      setImmediate(() => { legacy.close(); legacy.closeIdleConnections(); setTimeout(() => legacy.closeAllConnections(), 100).unref() })
      return
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ service: 'mindweave', protocol: 1 }))
  })
  legacy.listen(0, '127.0.0.1'); await once(legacy, 'listening')
  const oldPort = legacy.address().port
  await writeFile(join(home, 'server.json'), JSON.stringify({ schemaVersion: 1, pid: process.pid, port: oldPort, secret }), { mode: 0o600 })
  const [opened, reused] = await Promise.all([run(['open', capture.canvasId]), run(['open', capture.canvasId])])
  assert.equal(new URL(opened.previewUrl).port, new URL(reused.previewUrl).port)
  assert.notEqual(Number(new URL(opened.previewUrl).port), oldPort)
  assert.equal(legacy.listening, false)
  console.log('PASS host-neutral file/stdin import with Codex unavailable, host isolation, quiet updates, legacy daemon upgrade')

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(opened.previewUrl)
  const node = page.getByTestId('node-main')
  await expect(node).toBeVisible(); await expect(page).not.toHaveURL(/access=/)
  await node.getByRole('button', { name: '展开 回到最初的思路', exact: true }).click()
  await node.getByRole('button', { name: '查看原文', exact: true }).click()
  await expect(node.locator('blockquote')).toHaveText('我想回看最初的思路，并保留人工修正。')
  await node.locator('h2').dblclick(); await page.getByRole('textbox', { name: '节点标题' }).fill('人工标题：保留决定')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  const file = join(home, 'canvases', `${capture.canvasId}.json`), record = async () => JSON.parse(await readFile(file, 'utf8'))
  await expect.poll(async () => (await record()).document.user.fields.main?.title).toBe('人工标题：保留决定')
  await node.focus(); await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(async () => (await record()).document.view.positions.main.pinned).toBe(true)
  const position = (await record()).document.view.positions.main
  await node.getByRole('button', { name: '复制引用', exact: true }).click()
  const reference = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(reference, `mindweave://canvas/${capture.canvasId}/node/main`)
  assert.equal((await run(['read', reference])).node.title, '人工标题：保留决定')
  transcript.messages.push({ id: 'user-2', role: 'user', text: '再次整理时保留我的修改。' })
  await run(['capture', '--input', '-'], JSON.stringify(transcript))
  proposal.id = 'portable-second'; proposal.baseRevision = (await record()).document.generated.revision
  proposal.nodes[0].title = '新的生成标题'; proposal.nodes[0].summary = '再次整理保留人工标题与位置'
  await writeFile(update, JSON.stringify(proposal)); await run(['apply', update])
  await expect(node.locator('.node-summary')).toHaveText('再次整理保留人工标题与位置', { timeout: 10000 })
  await expect(node.locator('h2')).toHaveText('人工标题：保留决定')
  assert.deepEqual((await record()).document.view.positions.main, position)
  const before = await readFile(file, 'utf8')
  transcript.messages[0].text = '改写原文'
  await assert.rejects(run(['capture', '--input', '-'], JSON.stringify(transcript)), /原始消息发生变化/)
  assert.equal(await readFile(file, 'utf8'), before)
  await page.reload(); await expect(node.locator('h2')).toHaveText('人工标题：保留决定')
  if (process.env.MINDWEAVE_SKILL_SCREENSHOTS) {
    await mkdir(process.env.MINDWEAVE_SKILL_SCREENSHOTS, { recursive: true })
    await page.emulateMedia({ colorScheme: 'light' }); await page.screenshot({ path: join(process.env.MINDWEAVE_SKILL_SCREENSHOTS, 'portable-skill-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(process.env.MINDWEAVE_SKILL_SCREENSHOTS, 'portable-skill-dark.png') })
  }
  assert.deepEqual(errors, [])
  await context.close(); await browser.close(); browser = undefined
  await run(['stop'])
  const moved = join(sandbox, 'moved skills with spaces', 'mindweave'); await mkdir(dirname(moved), { recursive: true })
  await rename(installed, moved); helper = join(moved, 'scripts/mindweave.mjs')
  assert.equal((await run(['read', reference])).node.title, '人工标题：保留决定')
  const reopened = await run(['open', capture.canvasId]); assert.equal((await fetch(reopened.previewUrl)).status, 200)
  await run(['stop'])
  assert.deepEqual(await fingerprint(moved), originalSkill, 'skill files must stay immutable during use')
  assert.equal((await exec('git', ['status', '--porcelain=v1'], { cwd: project })).stdout, '')
  console.log('PASS real installed UI, source quotes, edit/move, clipboard reference read-back, append/protect/reload, relocation/restart, untouched project/skill')
  console.log(JSON.stringify({ source: ref ? `github:${ref}` : 'local-folder', provider: capture.provider,
    installedFiles: Object.keys(originalSkill).length, messages: (await record()).conversation.messages.length }))
} finally {
  await browser?.close(); legacy?.close()
  if (existsSync(helper)) await run(['stop']).catch(() => {})
  await rm(sandbox, { recursive: true, force: true })
}
