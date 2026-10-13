import { validateDocument } from './persistence'
import { validId } from './identifiers'
import type { CanvasDocument, Conversation, Sample } from './types'

export interface CodexConnection {
  provider: 'codex'
  threadId: string
  title: string
  capturedAt: string
}
export interface LiveCanvas {
  schemaVersion: 1
  version: number
  document: CanvasDocument
  sample: Sample
  conversation: Conversation
  connection: CodexConnection
}
export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

export function validateLiveCanvas(value: unknown): value is LiveCanvas {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !validateDocument(value.document) || !isRecord(value.sample) || !isRecord(value.conversation) || !isRecord(value.connection)) return false
  const { document, sample, conversation, connection } = value
  if (sample.id !== document.id || sample.canvasId !== document.id || sample.sessionId !== document.sessionId
    || conversation.sessionId !== document.sessionId || connection.provider !== 'codex' || connection.threadId !== document.sessionId
    || typeof connection.title !== 'string' || typeof connection.capturedAt !== 'string' || typeof conversation.title !== 'string'
    || !Array.isArray(conversation.messages) || !Array.isArray(sample.sources) || !Array.isArray(sample.nodes) || !Array.isArray(sample.edges)) return false
  const messages = new Map<string, string>()
  for (const message of conversation.messages) {
    if (!isRecord(message) || !validId(message.id) || messages.has(message.id) || !['user', 'assistant'].includes(String(message.role))
      || typeof message.text !== 'string' || message.text.length > 1_000_000) return false
    messages.set(message.id, message.text)
  }
  const sources = new Set<string>()
  for (const source of sample.sources) {
    if (!isRecord(source) || !validId(source.id) || sources.has(source.id) || source.sessionId !== document.sessionId
      || typeof source.messageId !== 'string' || !Number.isInteger(source.start) || !Number.isInteger(source.end)) return false
    const text = messages.get(source.messageId)
    if (!text || Number(source.start) < 0 || Number(source.end) > text.length || Number(source.start) >= Number(source.end)) return false
    sources.add(source.id)
  }
  return Object.values(document.generated.nodes).every(node => node.sourceIds.every(id => sources.has(id)))
    && JSON.stringify(sample.nodes) === JSON.stringify(Object.values(document.generated.nodes))
    && JSON.stringify(sample.edges) === JSON.stringify(Object.values(document.generated.edges))
}

/** Rebase a local edit over a new generated revision, without losing the draft.
 * A second human writer is a conflict; a Codex update preserves our user layer.
 */
export function rebaseDraft(base: CanvasDocument, draft: CanvasDocument, latest: CanvasDocument): CanvasDocument {
  if ([draft, latest].some(doc => doc.id !== base.id || doc.sessionId !== base.sessionId)) throw new Error('画布身份不一致。')
  if (JSON.stringify(base.user) !== JSON.stringify(latest.user)
    || JSON.stringify(base.history) !== JSON.stringify(latest.history)
    || JSON.stringify(Object.fromEntries(Object.keys(base.view.positions).map(id => [id, latest.view.positions[id]]))) !== JSON.stringify(base.view.positions)) {
    throw new Error('画布已在其他页面修改。当前草稿已保留，请先导出，再重新载入。')
  }
  const document: CanvasDocument = {
    ...latest, user: draft.user, history: draft.history,
    view: { ...draft.view, positions: { ...latest.view.positions, ...draft.view.positions } },
  }
  if (!validateDocument(document)) throw new Error('当前草稿无法合并到最新画布，草稿已保留。')
  return document
}
