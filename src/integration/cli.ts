import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CanvasStore, storeDirectory } from './store'
import { readCodexThread } from './codex'
import { applyGraphUpdate, canvasIdFor, captureThread, publicCanvas } from './update'
import { CanvasError, type CanvasRecord } from './types'
import { parseReference, referenceFor, resolveReference } from '../core/references'
import { materialize } from '../core/model'
import { isRecord } from '../core/live'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const store = new CanvasStore(storeDirectory(root))
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
  if (!record) throw new CanvasError('画布不存在。请先在 Codex 中整理当前会话。', 404)
  return record
}
const summary = (record: CanvasRecord) => ({ canvasId: record.document.id, sessionId: record.document.sessionId,
  baseRevision: record.document.generated.revision, version: record.version, messages: record.conversation.messages.length,
  nodes: materialize(record.document).nodes.length, edges: materialize(record.document).edges.length })

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log('Mindweave Codex bridge\n\n  npm run mindweave -- capture [--thread ID]\n  npm run mindweave -- apply .mindweave/update.json\n  npm run mindweave -- open [CANVAS_ID] [--url http://localhost:5173]\n  npm run mindweave -- read mindweave://canvas/CANVAS_ID/node/NODE_ID\n  npm run mindweave -- status [CANVAS_ID]\n\n整理不会打开页面；open 只返回链接，由宿主明确打开。')
    return
  }
  if (command === 'capture') {
    const threadId = option('--thread') ?? process.env.CODEX_THREAD_ID
    if (args.length || !threadId) throw new CanvasError('请在当前 Codex 会话中执行 capture，或明确传入 --thread。')
    const captured = await readCodexThread(threadId)
    const record = await store.change(canvasIdFor(threadId), previous => captureThread(captured, previous))
    const directory = join(root, '.mindweave', 'captures')
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
    const base = option('--url') ?? 'http://localhost:5173'
    const id = args.shift() ?? (process.env.CODEX_THREAD_ID ? canvasIdFor(process.env.CODEX_THREAD_ID) : undefined)
    if (!id || args.length) throw new CanvasError('请指定画布 ID。')
    const record = await requireCanvas(id)
    if (command === 'status') { console.log(JSON.stringify(summary(record), null, 2)); return }
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new CanvasError('预览使用本地服务或 SSH 转发的 localhost 地址。')
    url.pathname = '/'; url.search = ''; url.hash = ''
    url.searchParams.set('canvas', id); url.searchParams.set('access', record.accessToken)
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
    console.log(JSON.stringify({ reference: args[0], threadId: record.connection.threadId, revision: record.document.generated.revision,
      merged: result.merged, node: result.node, excerpts,
      relations: graph.edges.filter(edge => edge.from === result.node.id || edge.to === result.node.id)
        .map(edge => ({ ...edge, fromTitle: graph.nodes.find(node => node.id === edge.from)!.title, toTitle: graph.nodes.find(node => node.id === edge.to)!.title })) }, null, 2)); return
  }
  throw new CanvasError('未知操作。运行 npm run mindweave -- help 查看命令。')
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Mindweave 操作失败。'); process.exitCode = 1 })
