import { describe, expect, it } from 'vitest'
import { execute } from '../core/model'
import { normalizeConversation } from './conversation'
import { applyGraphUpdate, canvasIdFor, captureThread, saveBrowserDocument, validateRecord } from './update'
import { capturedThread } from '../../tests/fixtures/codex'

const transcript = () => ({ schemaVersion: 1, provider: 'generic', sessionId: 'shared-session', title: '导入对话', messages: [
  { id: 'message-1', role: 'user', text: '  🧵保留原文与人工修改。\n第二行。 ' },
  { id: 'message-2', role: 'assistant', text: '使用稳定引用继续讨论。' },
] })

describe('portable conversation import', () => {
  it('preserves exact text and keeps independent hosts apart without changing legacy Codex IDs', () => {
    const input = transcript(), captured = normalizeConversation(input)
    expect(captured.conversation.messages[0].text).toBe(input.messages[0].text)
    const generic = captureThread(captured, null)
    const other = captureThread(normalizeConversation({ ...input, provider: 'claude' }), null)
    const codex = captureThread(capturedThread(input.sessionId), null)
    expect(new Set([generic.document.id, other.document.id, codex.document.id]).size).toBe(3)
    expect(codex.document.id).toBe(`mw-codex-${input.sessionId}`)
    expect(generic.connection.provider).toBe('generic')
    expect(validateRecord(generic)).toBe(true)
    expect(canvasIdFor('s'.repeat(100), 'h'.repeat(32)).length).toBeLessThanOrEqual(100)
    expect(() => captureThread({ ...captured, provider: 'claude' }, generic)).toThrow('另一会话')
  })
  it('appends imported messages while protecting edits and rejecting rewritten source IDs', () => {
    const input = transcript()
    let record = captureThread(normalizeConversation(input), null)
    record = applyGraphUpdate(record, { schemaVersion: 1, id: 'first', canvasId: record.document.id,
      sessionId: input.sessionId, baseRevision: 1, nodes: [{ id: 'main', title: '原文', summary: '', details: '',
        kind: 'discussion', sources: [{ messageId: 'message-1', quote: '保留原文与人工修改。' }] }], edges: [] })
    record = saveBrowserDocument(record, record.version, execute(record.document, { type: 'edit', id: 'main', title: '人工标题', summary: '' }))
    input.messages.push({ id: 'message-3', role: 'user', text: '新增讨论。' })
    const next = captureThread(normalizeConversation(input), record)
    expect(next.document.user.fields.main.title).toBe('人工标题')
    expect(next.conversation.messages).toHaveLength(3)
    expect(next.accessToken).toBe(record.accessToken)
    expect(captureThread(normalizeConversation({ ...input, messages: [input.messages[2]] }), next)).toBe(next)
    input.messages[0].text = '改写原文'
    expect(() => captureThread(normalizeConversation(input), next)).toThrow('原始消息发生变化')
  })
  it.each([
    { schemaVersion: 2 }, { provider: '../escape' }, { sessionId: '../escape' }, { title: '' }, { messages: [] },
    { messages: [{ id: 'a', role: 'tool', text: '工具输出' }] },
    { messages: [{ id: 'constructor', role: 'user', text: '原文' }] },
    { messages: [{ id: 'a', role: 'user', text: '   ' }] },
    { messages: [{ id: 'a', role: 'user', text: '一' }, { id: 'a', role: 'assistant', text: '二' }] },
  ])('rejects malformed or ambiguous supplied conversation: %j', change => {
    expect(() => normalizeConversation({ ...transcript(), ...change })).toThrow()
  })
})
