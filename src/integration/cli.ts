import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { CanvasStore } from './store'
import { readCodexThread } from './codex'
import { normalizeConversation } from './conversation'
import { applyGraphUpdate, canvasIdFor, captureThread, publicCanvas } from './update'
import { CanvasError, type CanvasRecord } from './types'
import { parseReference, referenceFor, resolveReference } from '../core/references'
import { materialize } from '../core/model'
import { isRecord } from '../core/live'
import { runtimePaths, packaged } from './runtime'
import { ensureServer, serverUrl, serve, stopServer } from './daemon'
import { setupSkill } from './setup'

const paths = runtimePaths()
const store = new CanvasStore(paths.canvases)
const args = process.argv.slice(2)
const command = args.shift()
function option(name: string) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new CanvasError(`${name} 缺少参数。`)
  args.splice(index, 2); return value
}
async function requireCanvas(id: string): Promise<CanvasRecord> {
  const record = await store.read(id)
  if (!record) throw new CanvasError('画布不存在。请先捕获并整理当前会话。', 404)
  return record
}
const summary = (record: CanvasRecord) => ({ canvasId: record.document.id, sessionId: record.document.sessionId, provider: record.connection.provider,
  baseRevision: record.document.generated.revision, version: record.version, messages: record.conversation.messages.length,
  nodes: materialize(record.document).nodes.length, edges: materialize(record.document).edges.length })

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log('Mindweave\n\n使用 mindweave skill 整理当前对话并打开画布；Codex 中可用 $mindweave。\n\n  mindweave capture --input FILE    导入通用会话 JSON；- 表示标准输入\n  mindweave capture [--thread ID]   只读当前 Codex 对话\n  mindweave apply FILE.json         应用整理结果\n  mindweave open CANVAS_ID          获取预览链接，安装版自动启动服务\n  mindweave read REFERENCE          读取节点的最新内容\n  mindweave status CANVAS_ID        查看画布状态\n  mindweave stop                    停止安装版服务\n  mindweave setup [--force]          配置 Codex 用户 skill\n\n需要 Node.js 22.12+；仅 Codex 自动读取需要 Codex CLI。\n源码开发入口：npm run mindweave -- COMMAND\n整理不会打开页面；open 返回链接，由宿主明确打开。')
    return
  }
  if (command === 'setup') {
    if (args.length > 1 || (args.length && args[0] !== '--force')) throw new CanvasError('setup 只接受可选 --force。')
    console.log(JSON.stringify(await setupSkill(args[0] === '--force'), null, 2)); return
  }
  if (command === 'serve') {
    if (args.length || !process.env.MINDWEAVE_DAEMON_SECRET) throw new CanvasError('本地服务由 mindweave open 自动管理。')
    await serve(); return
  }
  if (command === 'stop') { if (args.length) throw new CanvasError('stop 不接受参数。'); console.log(JSON.stringify(await stopServer())); return }
  if (command === 'capture') {
    const input = option('--input'), requestedThread = option('--thread')
    if (args.length || (input && requestedThread)) throw new CanvasError('capture 使用 --input FILE 或 --thread ID，不能混用。')
    let captured
    if (input) {
      const maximum = 32 * 1024 * 1024
      let text: string
      if (input === '-') {
        const chunks: Buffer[] = []; let bytes = 0
        for await (const chunk of process.stdin) {
          bytes += chunk.length
          if (bytes > maximum) throw new CanvasError('会话 JSON 超过 32 MiB，本轮未导入。')
          chunks.push(Buffer.from(chunk))
        }
        text = Buffer.concat(chunks).toString('utf8')
      } else {
        if ((await stat(resolve(input))).size > maximum) throw new CanvasError('会话 JSON 超过 32 MiB，本轮未导入。')
        text = await readFile(resolve(input), 'utf8')
      }
      captured = normalizeConversation(JSON.parse(text))
    } else {
      const threadId = requestedThread ?? process.env.CODEX_THREAD_ID
      if (!threadId) throw new CanvasError('请用 capture --input 导入会话 JSON；Codex 中可使用当前 CODEX_THREAD_ID 或 --thread。')
      captured = await readCodexThread(threadId)
    }
    const record = await store.change(canvasIdFor(captured.threadId, captured.provider), previous => captureThread(captured, previous))
    const directory = paths.captures
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${record.document.id}.json`)
    await writeFile(path, JSON.stringify(publicCanvas(record), null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ ...summary(record), capturePath: path }, null, 2)); return
  }
  if (command === 'apply') {
    if (args.length !== 1) throw new CanvasError('apply 需要一份整理 JSON 文件。')
    const value: unknown = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
    if (!isRecord(value) || typeof value.canvasId !== 'string') throw new CanvasError('整理文件缺少画布 ID。')
    const record = await store.change(value.canvasId, previous => {
      if (!previous) throw new CanvasError('请先 capture 当前会话。', 404)
      return applyGraphUpdate(previous, value)
    })
    console.log(JSON.stringify({ ...summary(record), references: materialize(record.document).nodes.map(node => ({ title: node.title, reference: referenceFor(record.document.id, node.id) })) }, null, 2)); return
  }
  if (command === 'open' || command === 'status') {
    const requestedUrl = option('--url')
    const id = args.shift() ?? (process.env.CODEX_THREAD_ID ? canvasIdFor(process.env.CODEX_THREAD_ID) : undefined)
    if (!id || args.length) throw new CanvasError('请指定画布 ID。')
    const record = await requireCanvas(id)
    if (command === 'status') { console.log(JSON.stringify(summary(record), null, 2)); return }
    const base = requestedUrl ?? (packaged ? serverUrl(await ensureServer(paths)) : 'http://localhost:5173')
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new CanvasError('预览使用本地服务或 SSH 转发的 localhost 地址。')
    url.pathname = '/'; url.search = ''; url.hash = ''
    url.searchParams.set('canvas', id); url.searchParams.set('access', record.accessToken)
    if (packaged && requestedUrl) await ensureServer(paths)
    console.log(JSON.stringify({ ...summary(record), previewUrl: url.toString() }, null, 2)); return
  }
  if (command === 'read') {
    if (args.length !== 1) throw new CanvasError('read 需要一个完整的稳定引用。')
    const parsed = parseReference(args[0])
    if (!parsed) throw new CanvasError('稳定引用格式无效。')
    const record = await requireCanvas(parsed.canvasId)
    const result = resolveReference(record.document, args[0])
    if (result.status !== 'found') throw new CanvasError(result.message, 404)
    const graph = materialize(record.document)
    const excerpts = result.node.sourceIds.map(id => {
      const source = record.sample.sources.find(source => source.id === id)!
      const message = record.conversation.messages.find(message => message.id === source.messageId)!
      return { ...source, role: message.role, excerpt: message.text.slice(source.start, source.end) }
    })
    console.log(JSON.stringify({ reference: args[0], provider: record.connection.provider, sessionId: record.document.sessionId,
      threadId: record.connection.threadId, revision: record.document.generated.revision,
      merged: result.merged, node: result.node, excerpts,
      relations: graph.edges.filter(edge => edge.from === result.node.id || edge.to === result.node.id)
        .map(edge => ({ ...edge, fromTitle: graph.nodes.find(node => node.id === edge.from)!.title, toTitle: graph.nodes.find(node => node.id === edge.to)!.title })) }, null, 2)); return
  }
  throw new CanvasError('未知操作。运行 mindweave help 查看命令；源码开发用 npm run mindweave -- help。')
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Mindweave 操作失败。'); process.exitCode = 1 })
