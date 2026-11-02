import { isRecord, validProvider } from '../core/live'
import { validId } from '../core/identifiers'
import type { Message } from '../core/types'
import { CanvasError, type CapturedConversation } from './types'

/** Host-neutral interchange. Import only supplied user/assistant text, never scan a host. */
export function normalizeConversation(value: unknown): CapturedConversation {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validProvider(value.provider) || !validId(value.sessionId)
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 500
    || !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 10000) {
    throw new CanvasError('会话 JSON 需要 schemaVersion: 1、provider、sessionId、title 和非空 messages。')
  }
  const ids = new Set<string>(), messages: Message[] = []
  for (const message of value.messages) {
    if (!isRecord(message) || !validId(message.id) || ids.has(message.id)
      || (message.role !== 'user' && message.role !== 'assistant') || typeof message.text !== 'string'
      || !message.text.trim() || message.text.length > 1_000_000) throw new CanvasError('会话消息需要唯一稳定 ID、user/assistant 角色和原始文本。')
    ids.add(message.id)
    messages.push({ id: message.id, role: message.role, text: message.text })
  }
  return { provider: value.provider, threadId: value.sessionId, title: value.title, cwd: '',
    conversation: { sessionId: value.sessionId, title: value.title, messages } }
}
