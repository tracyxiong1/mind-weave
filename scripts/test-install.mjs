import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const exec = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run with npm run test:install.')
const sandbox = await mkdtemp(join(tmpdir(), 'mindweave install '))
const prefix = join(sandbox, 'prefix with spaces'), project = join(sandbox, 'existing project'), home = join(sandbox, 'data')
const codexHome = join(sandbox, 'codex'), packages = join(root, '.mindweave/packages')
const env = { ...process.env, CODEX_HOME: codexHome, MINDWEAVE_HOME: home, MINDWEAVE_SKILLS_DIR: join(codexHome, 'skills'),
  PATH: `${process.platform === 'win32' ? prefix : join(prefix, 'bin')}${delimiter}${process.env.PATH}`, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' }
const runNpm = (args, cwd = root) => exec(process.execPath, [npm, ...args], { cwd, env, maxBuffer: 2 * 1024 * 1024 })
const executable = join(prefix, 'lib/node_modules/mind-weave/bin/mindweave.mjs')
const run = async args => JSON.parse((await exec(process.execPath, [executable, ...args], { cwd: project, env })).stdout)
const helper = join(codexHome, 'skills/mindweave/scripts/mindweave.mjs')
const skill = async args => JSON.parse((await exec(process.execPath, [helper, ...args], { cwd: project, env })).stdout)
let browser
try {
  await mkdir(project, { recursive: true }); await mkdir(packages, { recursive: true, mode: 0o700 })
  await writeFile(join(project, 'README.md'), 'existing project; do not modify')
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'existing-project', private: true, scripts: { build: 'echo existing' } }))
  await exec('git', ['init', '--quiet'], { cwd: project })
  await exec('git', ['add', 'README.md', 'package.json'], { cwd: project })
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'existing project'], { cwd: project })
  await runNpm(['run', 'prepare'])
  const pack = JSON.parse((await runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', packages])).stdout)[0]
  assert(pack.files.some(file => file.path === 'lib/cli.mjs'))
  assert(pack.files.some(file => file.path === 'dist/index.html'))
  assert(pack.files.some(file => file.path === 'skills/mindweave/scripts/mindweave.mjs'))
  assert(pack.files.some(file => file.path === 'licenses/react.txt'))
  assert(!pack.files.some(file => /^(src|tests|\.mindweave|node_modules|\.git)\//.test(file.path)))
  const tarball = join(packages, pack.filename)
  await runNpm(['install', '--global', '--prefix', prefix, tarball], project)
  assert(existsSync(executable))
  assert(existsSync(process.platform === 'win32' ? join(prefix, 'mindweave.cmd') : join(prefix, 'bin/mindweave')))
  const metadata = JSON.parse(await readFile(join(prefix, 'lib/node_modules/mind-weave/package.json'), 'utf8'))
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0)
  assert(!existsSync(join(prefix, 'lib/node_modules/mind-weave/node_modules/tsx')))
  assert(existsSync(helper), 'npm postinstall must configure the user skill')
  const help = await exec(process.execPath, [helper, 'help'], { cwd: project, env })
  assert(help.stdout.includes('$mindweave'))
  if (process.platform !== 'win32') {
    const globalHelp = await exec('mindweave', ['help'], { cwd: project, env })
    assert(globalHelp.stdout.includes('Mindweave'))
  }
  console.log('PASS packed assets, global command, automatic skill setup, no dev dependencies')

  if (process.env.MINDWEAVE_TEST_REAL_CODEX === '1') {
    const child = spawn(process.env.MINDWEAVE_TEST_CODEX_BIN ?? 'codex', ['app-server'], { cwd: project, env, stdio: ['pipe', 'pipe', 'ignore'] })
    const lines = createInterface({ input: child.stdout })
    const waiting = new Map()
    lines.on('line', line => {
      const value = JSON.parse(line), item = waiting.get(value.id)
      if (item) { waiting.delete(value.id); clearTimeout(item.timeout); value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result) }
    })
    const request = (id, method, params) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Codex ${method} timeout`)), 10000)
      waiting.set(id, { resolve, reject, timeout }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
    try {
      await request(1, 'initialize', { clientInfo: { name: 'mindweave-install-validation', version: '0.2.0' } })
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
      const loaded = await request(2, 'skills/list', { cwds: [project], forceReload: true })
      const installed = loaded.data.flatMap(entry => entry.skills).find(skill => skill.name === 'mindweave' && skill.path.startsWith(codexHome))
      assert(installed?.enabled, 'Codex must discover the installed skill outside the source repo')
      console.log('PASS installed user skill discovered by real Codex in an existing project')
    } finally { for (const item of waiting.values()) clearTimeout(item.timeout); lines.close(); child.kill() }
  }

  const fakeCodex = join(sandbox, 'codex-test.mjs')
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
  const r=JSON.parse(line); if(r.id===undefined)return;
  let result;
  if(r.method==='initialize')result={};
  else if(r.method==='thread/read') result={thread:{id:r.params.threadId,name:'安装验证对话',cwd:${JSON.stringify(project)},historyMode:'legacy',turns:r.params.includeTurns?[{id:'old-turn',status:'completed',items:[
    {id:'user-message',type:'userMessage',content:[{type:'text',text:'🧵请整理已有对话，保留真实来源。'}]},
    {id:'assistant-message',type:'agentMessage',phase:'final_answer',text:'节点标题可以修改。'}
  ]}]:[]}};
  else {process.stdout.write(JSON.stringify({id:r.id,error:{message:'unexpected mutation'}})+'\\n');return;}
  process.stdout.write(JSON.stringify({id:r.id,result})+'\\n');
});`, { mode: 0o700 })
  // This executable fixture simulates only the read protocol, never an agent/model.
  env.MINDWEAVE_CODEX_BIN = fakeCodex; env.CODEX_THREAD_ID = 'install-test-thread'
  const capture = await skill(['capture'])
  const snapshot = JSON.parse(await readFile(capture.capturePath, 'utf8'))
  assert.equal(snapshot.conversation.messages.length, 2)
  assert(capture.capturePath.startsWith(home)); assert(!existsSync(join(project, '.mindweave')))
  const messages = snapshot.conversation.messages
  const update = { schemaVersion: 1, id: 'install-first-update', canvasId: capture.canvasId, sessionId: capture.sessionId, baseRevision: capture.baseRevision,
    nodes: [
      { id: 'main', title: '保留会话来源', summary: '首次使用读取已有历史', details: '', kind: 'discussion', sources: [{ messageId: messages[0].id, quote: '请整理已有对话，保留真实来源。' }] },
      { id: 'editing', title: '人工修正', summary: '', details: '', kind: 'discussion', sources: [{ messageId: messages[1].id, quote: '节点标题可以修改。' }] },
    ], edges: [{ id: 'main-editing', from: 'main', to: 'editing', label: '支持' }] }
  await mkdir(join(home, 'updates'), { recursive: true }); const proposal = join(home, 'updates/install-test.json')
  await writeFile(proposal, JSON.stringify(update)); await skill(['apply', proposal])
  assert(!existsSync(join(home, 'server.json')), 'capture/apply must not start a preview')
  const [opened, reused] = await Promise.all([skill(['open']), skill(['open'])])
  assert.equal(new URL(opened.previewUrl).port, new URL(reused.previewUrl).port)
  assert.equal((await stat(join(home, 'server.json'))).mode & 0o777, 0o600)
  console.log('PASS existing conversation capture, external storage, atomic apply, auto-start and concurrent reuse')

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(opened.previewUrl)
  const node = page.getByTestId('node-main')
  await expect(node).toBeVisible(); await expect(page).not.toHaveURL(/access=/)
  await node.locator('h2').dblclick(); await page.getByRole('textbox', { name: '节点标题' }).fill('用户修改的标题')
  await node.getByRole('button', { name: '保存', exact: true }).click()
  const file = join(home, 'canvases', `${capture.canvasId}.json`)
  const record = async () => JSON.parse(await readFile(file, 'utf8'))
  await expect.poll(async () => (await record()).document.user.fields.main?.title).toBe('用户修改的标题')
  await node.focus(); await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(async () => (await record()).document.view.positions.main.pinned).toBe(true)
  const position = (await record()).document.view.positions.main
  const reference = `mindweave://canvas/${capture.canvasId}/node/main`
  assert.equal((await skill(['read', reference])).node.title, '用户修改的标题')
  update.id = 'install-second-update'; update.baseRevision = (await record()).document.generated.revision
  update.nodes[0].title = '新的生成标题'; update.nodes[0].summary = '再次整理更新摘要'
  await writeFile(proposal, JSON.stringify(update)); await skill(['apply', proposal])
  await node.getByRole('button', { name: '展开 用户修改的标题', exact: true }).click()
  await expect(node.locator('.node-summary')).toHaveText('再次整理更新摘要', { timeout: 10000 })
  await expect(node.locator('h2')).toHaveText('用户修改的标题')
  assert.deepEqual((await record()).document.view.positions.main, position)
  await page.reload(); await expect(node.locator('h2')).toHaveText('用户修改的标题')
  assert.deepEqual(errors, []); await context.close(); await browser.close(); browser = undefined
  assert.equal((await exec('git', ['status', '--porcelain=v1'], { cwd: project })).stdout, '')
  const readback = await skill(['read', reference]); assert.equal(readback.excerpts[0].excerpt, '请整理已有对话，保留真实来源。')
  await run(['stop']); await assert.rejects(fetch(opened.previewUrl))
  const restarted = await run(['open']); assert.equal((await fetch(restarted.previewUrl)).status, 200)
  assert.equal((await run(['read', reference])).node.title, '用户修改的标题')
  await run(['stop'])
  console.log('PASS installed UI edit, generated update protection, reload, reference read-back, stop/restart, untouched project')
  console.log(JSON.stringify({ tarball, version: pack.version, packedFiles: pack.files.length, unpackedBytes: pack.unpackedSize }))
} finally {
  await browser?.close()
  if (existsSync(executable)) await run(['stop']).catch(() => {})
  await rm(sandbox, { recursive: true, force: true })
}
