import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { isRecord } from '../core/live'
import { validId } from '../core/identifiers'
import type { Message } from '../core/types'
import { CanvasError, type CapturedConversation } from './types'

/** Minimal, validated subset of the installed Codex app-server 0.159 protocol.
 * Never resume a thread or start a turn; read-only requests need no model API key.
 */
export interface CodexThread { id: string; name: string | null; cwd: string; turns: unknown[] }
export function normalizeThread(value: unknown): CapturedConversation {
  if (!isRecord(value) || !validId(value.id) || typeof value.cwd !== 'string' || !Array.isArray(value.turns)
    || (value.name !== null && value.name !== undefined && typeof value.name !== 'string')) throw new CanvasError('Codex thread/read 返回了不支持的结构。')
  const messages: Message[] = []
  const ids = new Set<string>()
  for (const turn of value.turns) {
    if (!isRecord(turn) || typeof turn.id !== 'string' || !Array.isArray(turn.items)) throw new CanvasError('Codex 轮次未完整加载。')
    for (const item of turn.items) {
      if (!isRecord(item)) throw new CanvasError('Codex 消息结构无效。')
      let text: string
      let role: Message['role']
      if (item.type === 'userMessage') {
        if (!Array.isArray(item.content)) throw new CanvasError('Codex 用户消息结构无效。')
        const parts = item.content.filter(part => isRecord(part) && part.type === 'text')
        if (parts.some(part => typeof part.text !== 'string')) throw new CanvasError('Codex 用户消息不是文本。')
        text = parts.map(part => part.text).join('\n\n'); role = 'user'
      } else if (item.type === 'agentMessage' && turn.status === 'completed' && (item.phase === 'final_answer' || item.phase == null)) {
        if (typeof item.text !== 'string') throw new CanvasError('Codex 回复结构无效。')
        text = item.text; role = 'assistant'
      } else continue
      if (!text.trim()) continue
      if (typeof item.id !== 'string') throw new CanvasError('Codex 消息缺少稳定 ID。')
      const id = `m-${createHash('sha256').update(`${turn.id}:${item.id}`).digest('hex').slice(0, 24)}`
      if (ids.has(id)) throw new CanvasError('Codex 消息 ID 重复。')
      ids.add(id)
      // Preserve exact text; environment/UI wrappers are not discussion content.
      // The skill selects quotes from the user request, not those wrappers.
      messages.push({ id, role, text })
    }
  }
  if (!messages.length) throw new CanvasError('当前 Codex 会话没有可整理的文本消息。')
  const title = typeof value.name === 'string' ? value.name : 'Codex 会话'
  return { provider: 'codex', threadId: value.id, title, cwd: value.cwd, conversation: { sessionId: value.id, title, messages } }
}

export async function readCodexThread(threadId: string, options: { binary?: string; timeoutMs?: number } = {}): Promise<CapturedConversation> {
  if (!validId(threadId)) throw new CanvasError('请提供当前 Codex 会话 ID，或在 Codex 中使用 CODEX_THREAD_ID。')
  const child = spawn(options.binary ?? process.env.MINDWEAVE_CODEX_BIN ?? 'codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  let sequence = 0
  let stopped: Error | null = null
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const stop = (error: Error) => {
    stopped = error
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
  }
  child.on('error', () => stop(new CanvasError('无法启动 Codex CLI。请安装 Codex，或设置 MINDWEAVE_CODEX_BIN。')))
  child.on('exit', () => stop(new CanvasError('Codex app-server 已退出，未修改会话。')))
  lines.on('line', line => {
    if (line.length > 64 * 1024 * 1024) { stop(new CanvasError('Codex 会话响应过大，未导入部分历史。')); return }
    let value: unknown
    try { value = JSON.parse(line) } catch { stop(new CanvasError('Codex app-server 返回了无效 JSON。')); return }
    if (!isRecord(value) || typeof value.id !== 'number') return
    const item = pending.get(value.id)
    if (!item) return
    pending.delete(value.id); clearTimeout(item.timer)
    if (value.error) item.reject(new CanvasError(isRecord(value.error) && typeof value.error.message === 'string' ? `Codex: ${value.error.message}` : 'Codex 读取失败。'))
    else item.resolve(value.result)
  })
  function request(method: string, params: unknown): Promise<unknown> {
    if (stopped) return Promise.reject(stopped)
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); reject(new CanvasError('读取 Codex 会话超时，未修改会话。'))
      }, options.timeoutMs ?? 15000)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => { if (error) stop(new CanvasError('Codex app-server 连接中断。')) })
    })
  }
  try {
    await request('initialize', { clientInfo: { name: 'mindweave', title: 'Mindweave', version: '0.3.1' }, capabilities: { experimentalApi: true } })
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    const summary = await request('thread/read', { threadId, includeTurns: false })
    if (!isRecord(summary) || !isRecord(summary.thread)) throw new CanvasError('Codex 会话摘要无效。')
    let thread: unknown
    if (summary.thread.historyMode === 'paginated') {
      const turns: unknown[] = []
      let cursor: string | null = null
      const cursors = new Set<string>()
      do {
        const page = await request('thread/turns/list', { threadId, limit: 50, itemsView: 'full', sortDirection: 'asc', cursor })
        if (!isRecord(page) || !Array.isArray(page.data) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new CanvasError('Codex 分页历史无效。')
        if (page.data.some(turn => !isRecord(turn) || turn.itemsView !== 'full')) throw new CanvasError('Codex 历史只有摘要，不能作为原文来源。')
        turns.push(...page.data)
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new CanvasError('Codex 分页游标重复，停止读取。')
        if (cursor) cursors.add(cursor)
        if (turns.length > 5000) throw new CanvasError('当前会话超过 5000 轮，本轮未导入部分历史。')
      } while (cursor)
      thread = { ...summary.thread, turns }
    } else {
      const response = await request('thread/read', { threadId, includeTurns: true })
      thread = isRecord(response) ? response.thread : null
    }
    const captured = normalizeThread(thread)
    if (captured.threadId !== threadId) throw new CanvasError('Codex 返回了另一会话的数据。')
    return captured
  } finally {
    lines.close(); child.stdin.destroy(); child.stdout.destroy(); child.kill()
    stop(new CanvasError('Codex 读取连接已关闭。'))
  }
}
