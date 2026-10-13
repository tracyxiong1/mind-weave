import { describe, expect, it } from 'vitest'
import { capturedThread, emptyRecord, proposal, recordWithGraph } from '../../tests/fixtures/codex'
import { execute, materialize, undo } from '../core/model'
import { referenceFor, resolveReference } from '../core/references'
import { applyGraphUpdate, captureThread, publicCanvas, saveBrowserDocument, validateRecord } from './update'

describe('Codex capture and generated updates', () => {
  it('captures a stable identity and preserves original messages over compaction', () => {
    const first = recordWithGraph()
    expect(captureThread(capturedThread(), first)).toBe(first)
    const next = capturedThread()
    next.conversation.messages = [{ id: 'm-new', role: 'user', text: '补充一个问题。' }]
    const updated = captureThread(next, first)
    expect(updated.conversation.messages.map(m => m.id)).toEqual(['m-main', 'm-branch', 'm-merge', 'm-removed', 'm-new'])
    expect(updated.document).toBe(first.document)
    expect(updated.accessToken).toBe(first.accessToken)
    const changed = capturedThread(); changed.conversation.messages[0].text = '原文被改写'
    expect(() => captureThread(changed, first)).toThrow('原始消息发生变化')
    expect(first.conversation.messages[0].text).toBe('🧵先整理对话，保留来源。')
  })
  it('anchors exact UTF-16 ranges, rejects fake excerpts and applies a batch atomically', () => {
    const record = emptyRecord()
    const update = proposal(record)
    const result = applyGraphUpdate(record, update)
    const source = result.sample.sources.find(s => s.messageId === 'm-main')!
    expect(source.start).toBe(2)
    expect(result.conversation.messages[0].text.slice(source.start, source.end)).toBe(update.nodes[0].sources[0].quote)
    expect(validateRecord(result)).toBe(true)
    expect(publicCanvas(result)).not.toHaveProperty('accessToken')
    expect(publicCanvas(result)).not.toHaveProperty('updates')
    update.nodes[1].sources[0].quote = '虚构的原文'
    expect(() => applyGraphUpdate(record, update)).toThrow('原始消息不一致')
    expect(record.document.generated.nodes).toEqual({})
    expect(record.sample.sources).toEqual([])
  })
  it('protects field edits, manual positions, notes, relations, deletions, merge aliases and undo over a new update', () => {
    let record = recordWithGraph()
    let doc = record.document
    doc = execute(doc, { type: 'edit', id: 'main', title: '我的标题', summary: '保留真实来源' })
    doc = execute(doc, { type: 'edit', id: 'branch', title: '我的支线', summary: '支持人工修正' })
    doc = execute(doc, { type: 'move', id: 'main', position: { x: -200, y: 120, pinned: true } })
    doc = execute(doc, { type: 'note', id: 'note', title: '人工笔记', summary: '用户记录', position: { x: -200, y: 300, pinned: true } })
    doc = execute(doc, { type: 'connect', id: 'user-edge', from: 'note', to: 'main' })
    doc = execute(doc, { type: 'remove-edge', id: 'main-branch' })
    doc = execute(doc, { type: 'merge', from: 'mergeable', into: 'main' })
    doc = execute(doc, { type: 'delete', id: 'removed' })
    record = saveBrowserDocument(record, record.version, doc)
    const user = structuredClone(record.document.user), history = structuredClone(doc.history), positions = structuredClone(doc.view.positions)
    const update = proposal(record, 'update-second')
    update.nodes[0].title = '新的生成标题'; update.nodes[0].summary = '新的未保护摘要'
    update.nodes[1].summary = '新的支线摘要'
    update.nodes[0].position = { x: 5000, y: 5000, pinned: false }
    update.nodes.push({ ...update.nodes[3], id: 'removed-replay' })
    update.edges.push({ id: 'same-pair-new-id', from: 'main', to: 'branch', label: '重放关系' })
    const result = applyGraphUpdate(record, update)
    expect(result.document.user).toEqual(user)
    expect(result.document.history).toEqual(history)
    for (const [id, position] of Object.entries(positions)) expect(result.document.view.positions[id]).toEqual(position)
    const graph = materialize(result.document)
    // Merge explicitly protects the destination title and summary.
    expect(graph.nodes.find(n => n.id === 'main')).toMatchObject({ title: '我的标题', summary: '保留真实来源' })
    expect(graph.nodes.find(n => n.id === 'branch')).toMatchObject({ title: '我的支线', summary: '新的支线摘要' })
    expect(graph.nodes.find(n => n.id === 'note')).toMatchObject({ kind: 'note', sourceIds: [] })
    expect(graph.nodes.map(n => n.id)).not.toContain('removed')
    expect(graph.nodes.map(n => n.id)).not.toContain('removed-replay')
    expect(graph.edges.map(e => e.id)).toContain('user-edge')
    expect(graph.edges.some(e => e.from === 'main' && e.to === 'branch')).toBe(false)
    expect(resolveReference(result.document, referenceFor(doc.id, 'mergeable'))).toMatchObject({ status: 'found', merged: true, node: { id: 'main' } })
    expect(materialize(undo(result.document)).nodes.map(n => n.id)).toContain('removed')
    expect(undo(result.document).generated).toEqual(result.document.generated)
  })
  it('replays identical content without a revision bump and rejects changed IDs or stale revisions', () => {
    const record = emptyRecord(), update = proposal(record)
    const saved = applyGraphUpdate(record, update)
    expect(applyGraphUpdate(saved, update)).toBe(saved)
    const reordered = { edges: update.edges, nodes: update.nodes, ...Object.fromEntries(Object.entries(update).filter(([k]) => k !== 'nodes' && k !== 'edges')) }
    expect(applyGraphUpdate(saved, reordered)).toBe(saved)
    expect(() => applyGraphUpdate(saved, { ...update, nodes: update.nodes.map(n => ({ ...n, summary: '变化' })) })).toThrow('更新 ID')
    expect(() => applyGraphUpdate(saved, { ...update, id: 'different-update' })).toThrow('旧版本')
  })
  it('rejects dangling relations, note collisions, rewritten endpoints and discussion demotion', () => {
    let record = recordWithGraph()
    expect(() => applyGraphUpdate(record, { ...proposal(record, 'bad-edge'), edges: [{ id: 'bad', from: 'main', to: 'missing', label: '' }] })).toThrow('整批未应用')
    const demoted = proposal(record, 'demotion'); demoted.nodes[0].kind = 'suggestion'
    expect(() => applyGraphUpdate(record, demoted)).toThrow('不能退回')
    const changed = proposal(record, 'change-edge'); changed.edges[0].to = 'removed'
    expect(() => applyGraphUpdate(record, changed)).toThrow('不能改指向')
    record = saveBrowserDocument(record, record.version, execute(record.document, { type: 'note', id: 'personal', title: '笔记', summary: '', position: { x: -400, y: 0, pinned: true } }))
    const collision = proposal(record, 'collision'); collision.nodes[0].id = 'personal'
    expect(() => applyGraphUpdate(record, collision)).toThrow('不能覆盖用户笔记')
  })
  it('browser saves use compare-and-swap and cannot modify generated content', () => {
    const record = recordWithGraph(), draft = execute(record.document, { type: 'edit', id: 'main', title: '新标题', summary: '保留真实来源' })
    const saved = saveBrowserDocument(record, record.version, draft)
    expect(saved.version).toBe(record.version + 1)
    expect(saveBrowserDocument(saved, saved.version, draft)).toBe(saved)
    expect(() => saveBrowserDocument(saved, record.version, draft)).toThrow('新的整理或编辑')
    draft.generated.nodes.main.title = '伪装生成内容'
    expect(() => saveBrowserDocument(saved, saved.version, draft)).toThrow('不能改写生成内容')
  })
})
