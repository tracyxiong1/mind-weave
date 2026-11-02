import { createHash, randomBytes } from 'node:crypto'
import { createDocument, materialize } from '../core/model'
import { validateDocument } from '../core/persistence'
import { isRecord, validProvider, validateLiveCanvas, type LiveCanvas } from '../core/live'
import { validId } from '../core/identifiers'
import { DEFAULT_NODE_HEIGHT, freePosition } from '../core/layout'
import type { Sample, Source } from '../core/types'
import { CanvasError, type CanvasRecord, type CapturedConversation, type GraphUpdate } from './types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
function fail(message: string): never { throw new CanvasError(message) }
export const canvasIdFor = (sessionId: string, provider = 'codex') => provider === 'codex'
  ? `mw-codex-${sessionId}` : `mw-${provider}-${digest(sessionId).slice(0, 32)}`

export function publicCanvas(record: CanvasRecord): LiveCanvas {
  const { schemaVersion, version, document, sample, conversation, connection } = record
  return { schemaVersion, version, document, sample, conversation, connection }
}
export function validateRecord(value: unknown): value is CanvasRecord {
  return validateLiveCanvas(value) && isRecord(value) && typeof value.accessToken === 'string' && /^[a-f0-9]{64}$/.test(value.accessToken)
    && isRecord(value.updates) && Object.entries(value.updates).every(([id, update]) => validId(id) && isRecord(update)
      && typeof update.digest === 'string' && /^[a-f0-9]{64}$/.test(update.digest) && Number.isSafeInteger(update.revision) && Number(update.revision) >= 1)
}

export function captureThread(captured: CapturedConversation, previous: CanvasRecord | null, at = new Date().toISOString()): CanvasRecord {
  const provider = captured.provider ?? 'codex'
  const id = canvasIdFor(captured.threadId, provider)
  if (!validProvider(provider) || !validId(id) || !validId(captured.threadId) || captured.conversation.sessionId !== captured.threadId) fail('会话身份无效。')
  if (!previous) {
    const sample: Sample = { id, canvasId: id, sessionId: captured.threadId, nodes: [], edges: [], positions: {}, sources: [] }
    const record: CanvasRecord = {
      schemaVersion: 1, version: 1, document: createDocument(sample), sample, conversation: captured.conversation,
      connection: { provider, threadId: captured.threadId, title: captured.title, capturedAt: at },
      accessToken: randomBytes(32).toString('hex'), updates: {},
    }
    if (!validateRecord(record)) fail('消息结构无效。')
    return record
  }
  if (previous.document.id !== id || previous.document.sessionId !== captured.threadId || previous.connection.provider !== provider) fail('当前画布属于另一会话。')
  const incoming = new Map(captured.conversation.messages.map(message => [message.id, message]))
  for (const message of previous.conversation.messages) {
    const next = incoming.get(message.id)
    if (next && (next.text !== message.text || next.role !== message.role)) fail('已有原始消息发生变化，保留原画布并停止更新。')
  }
  // Retain prior sources even if the host later compacts or rolls back its history.
  const messages = [...previous.conversation.messages, ...captured.conversation.messages.filter(message => !previous.conversation.messages.some(old => old.id === message.id))]
  const conversation = { ...captured.conversation, messages }
  if (same(conversation, previous.conversation) && captured.title === previous.connection.title) return previous
  const record = { ...previous, version: previous.version + 1, conversation,
    connection: { ...previous.connection, title: captured.title, capturedAt: at } }
  if (!validateRecord(record)) fail('消息结构无效。')
  return record
}

function validateUpdate(value: unknown): asserts value is GraphUpdate {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validId(value.id) || !validId(value.canvasId) || !validId(value.sessionId)
    || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 1 || !Array.isArray(value.nodes)
    || !value.nodes.length || value.nodes.length > 100 || !Array.isArray(value.edges) || value.edges.length > 200) fail('整理数据格式无效。')
  const ids = new Set<string>()
  for (const node of value.nodes) {
    if (!isRecord(node) || !validId(node.id) || ids.has(node.id) || typeof node.title !== 'string' || !node.title.trim()
      || node.title.length > 120 || typeof node.summary !== 'string' || node.summary.length > 500
      || typeof node.details !== 'string' || node.details.length > 10000 || !['discussion', 'suggestion'].includes(String(node.kind))
      || !Array.isArray(node.sources) || node.sources.length > 50 || (node.kind === 'discussion' && !node.sources.length)) fail('讨论节点必须有可核对的真实来源。')
    ids.add(node.id)
    for (const source of node.sources) {
      if (!isRecord(source) || !validId(source.messageId) || typeof source.quote !== 'string' || !source.quote.length
        || source.quote.length > 10000 || (source.start !== undefined && (!Number.isInteger(source.start) || Number(source.start) < 0))) fail('来源摘录格式无效。')
    }
    const position = node.position
    if (position !== undefined && (!isRecord(position) || !['x', 'y'].every(key => typeof position[key] === 'number'
      && Number.isFinite(position[key]) && Math.abs(Number(position[key])) <= 1e7) || typeof position.pinned !== 'boolean')) fail('节点位置无效。')
  }
  const edges = new Set<string>()
  for (const edge of value.edges) {
    if (!isRecord(edge) || !validId(edge.id) || edges.has(edge.id) || !validId(edge.from) || !validId(edge.to) || edge.from === edge.to
      || typeof edge.label !== 'string' || edge.label.length > 200) fail('关系格式无效。')
    edges.add(edge.id)
  }
}

export function applyGraphUpdate(previous: CanvasRecord, input: unknown): CanvasRecord {
  validateUpdate(input)
  if (input.canvasId !== previous.document.id || input.sessionId !== previous.document.sessionId) fail('整理数据属于另一张画布。')
  const fingerprint = digest(JSON.stringify(canonical(input)))
  const replay = previous.updates[input.id]
  if (replay) {
    if (replay.digest !== fingerprint) fail('同一更新 ID 的内容不一致。')
    return previous
  }
  if (input.baseRevision !== previous.document.generated.revision) throw new CanvasError('整理基于旧版本，请重新读取画布再整理。', 409)
  const record = structuredClone(previous)
  const document = record.document
  const messages = new Map(record.conversation.messages.map(message => [message.id, message]))
  const sources = new Map(record.sample.sources.map(source => [source.id, source]))
  for (const proposed of input.nodes) {
    if (document.user.notes[proposed.id]) fail('整理节点不能覆盖用户笔记。')
    const old = document.generated.nodes[proposed.id]
    if (old?.kind === 'discussion' && proposed.kind === 'suggestion') fail('已讨论的节点不能退回未讨论建议。')
    const sourceIds = new Set(old?.sourceIds ?? [])
    for (const quote of proposed.sources) {
      const message = messages.get(quote.messageId)
      const start = quote.start ?? message?.text.indexOf(quote.quote) ?? -1
      if (!message || start < 0 || message.text.slice(start, start + quote.quote.length) !== quote.quote) fail('来源摘录与原始消息不一致。')
      const end = start + quote.quote.length
      const id = `s-${digest(`${quote.messageId}:${start}:${end}`).slice(0, 24)}`
      const source: Source = { id, sessionId: document.sessionId, messageId: message.id, start, end }
      sources.set(id, source); sourceIds.add(id)
    }
    document.generated.nodes[proposed.id] = {
      id: proposed.id, title: proposed.title.trim(), summary: proposed.summary.trim(), details: proposed.details,
      kind: proposed.kind, sourceIds: [...sourceIds],
    }
    if (!document.view.positions[proposed.id]) {
      const index = Object.keys(document.view.positions).length
      const desired = proposed.position ?? { x: index ? 465 : 0, y: index ? (index - 1) * 150 : 150, pinned: false }
      document.view.positions[proposed.id] = freePosition(desired, DEFAULT_NODE_HEIGHT,
        Object.values(materialize(document).nodes).filter(node => node.id !== proposed.id && document.view.positions[node.id])
          .map(node => ({ position: document.view.positions[node.id], height: DEFAULT_NODE_HEIGHT })))
    }
  }
  for (const edge of input.edges) {
    if (document.user.edges[edge.id]) fail('整理关系不能覆盖用户关系。')
    const old = document.generated.edges[edge.id]
    if (old && (old.from !== edge.from || old.to !== edge.to)) fail('已有关系 ID 不能改指向另一对节点。')
    document.generated.edges[edge.id] = { ...edge }
  }
  document.generated.revision++
  record.version++
  record.sample = { ...record.sample, nodes: Object.values(document.generated.nodes), edges: Object.values(document.generated.edges),
    positions: structuredClone(document.view.positions), sources: [...sources.values()] }
  record.updates[input.id] = { digest: fingerprint, revision: document.generated.revision }
  if (!validateRecord(record)) fail('整理结果存在无效身份、来源或悬空关系，整批未应用。')
  return record
}

export function saveBrowserDocument(previous: CanvasRecord, version: unknown, input: unknown): CanvasRecord {
  if (version !== previous.version) throw new CanvasError('画布已有新的整理或编辑。', 409)
  if (!validateDocument(input) || input.id !== previous.document.id || input.sessionId !== previous.document.sessionId
    || !same(input.generated, previous.document.generated)) fail('浏览器只能保存人工编辑与视图，不能改写生成内容。')
  if (same(input, previous.document)) return previous
  const record = { ...previous, version: previous.version + 1, document: structuredClone(input) }
  if (!validateRecord(record)) fail('画布编辑结构无效。')
  return record
}
