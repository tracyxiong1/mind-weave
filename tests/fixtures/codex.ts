import { applyGraphUpdate, captureThread } from '../../src/integration/update'
import type { CanvasRecord, CapturedConversation, GraphUpdate } from '../../src/integration/types'

/** Synthetic transcripts only. No captured user messages enter the test suite. */
export function capturedThread(threadId = 'test-thread'): CapturedConversation {
  return { threadId, cwd: '/test/project', title: '测试对话', conversation: { sessionId: threadId, title: '测试对话', messages: [
    { id: 'm-main', role: 'user', text: '🧵先整理对话，保留来源。' },
    { id: 'm-branch', role: 'assistant', text: '节点可以编辑、移动和合并。' },
    { id: 'm-merge', role: 'user', text: '这个主题已经讨论了。' },
    { id: 'm-removed', role: 'user', text: '这个方向暂时不需要。' },
  ] } }
}
export function proposal(record: CanvasRecord, id = 'update-initial'): GraphUpdate {
  return {
    schemaVersion: 1, id, canvasId: record.document.id, sessionId: record.document.sessionId,
    baseRevision: record.document.generated.revision,
    nodes: [
      { id: 'main', title: '整理对话', summary: '保留真实来源', details: '用于测试真实消息范围。', kind: 'discussion', sources: [{ messageId: 'm-main', quote: '先整理对话，保留来源。' }], position: { x: 0, y: 120, pinned: false } },
      { id: 'branch', title: '编辑与移动', summary: '支持人工修正', details: '', kind: 'discussion', sources: [{ messageId: 'm-branch', quote: '节点可以编辑、移动和合并。' }], position: { x: 465, y: 0, pinned: false } },
      { id: 'mergeable', title: '另一主题', summary: '', details: '', kind: 'discussion', sources: [{ messageId: 'm-merge', quote: '这个主题已经讨论了。' }], position: { x: 465, y: 160, pinned: false } },
      { id: 'removed', title: '暂不需要', summary: '', details: '', kind: 'discussion', sources: [{ messageId: 'm-removed', quote: '这个方向暂时不需要。' }], position: { x: 465, y: 320, pinned: false } },
      { id: 'suggestion', title: '可选探索方向', summary: '尚未讨论', details: '', kind: 'suggestion', sources: [], position: { x: 465, y: 480, pinned: false } },
    ],
    edges: [
      { id: 'main-branch', from: 'main', to: 'branch', label: '修正方式' },
      { id: 'main-mergeable', from: 'main', to: 'mergeable', label: '其他主题' },
    ],
  }
}
export function emptyRecord(threadId = 'test-thread') { return captureThread(capturedThread(threadId), null) }
export function recordWithGraph(threadId = 'test-thread') {
  const record = emptyRecord(threadId)
  return applyGraphUpdate(record, proposal(record))
}
