import { describe, expect, it } from 'vitest'
import { samples, conversations, excerptFor } from '../data/samples'
import { canonicalId, createDocument, execute, materialize, redo, undo } from './model'
import { referenceFor, resolveReference, parseReference } from './references'
import { validateDocument } from './persistence'

const seed = () => createDocument(samples.branches)
const reference = referenceFor('mw-branches', 'comparison')
function expectCoherent(doc: ReturnType<typeof seed>) {
  expect(validateDocument(doc)).toBe(true)
  const graph = materialize(doc)
  const ids = new Set(graph.nodes.map(n => n.id))
  const pairs = graph.edges.map(e => [e.from, e.to].sort().join(':'))
  expect(new Set(pairs).size).toBe(pairs.length)
  for (const edge of graph.edges) { expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true); expect(edge.from).not.toBe(edge.to) }
}

describe('确定的图与对话样例', () => {
  it.each(Object.keys(samples))('%s 来源都能定位到真实消息摘录', id => {
    const sample = samples[id]
    expectCoherent(createDocument(sample))
    for (const node of sample.nodes) {
      expect(node.sourceIds.length).toBeGreaterThan(0)
      for (const sourceId of node.sourceIds) {
        const source = sample.sources.find(s => s.id === sourceId)!
        const result = excerptFor(sample, source)!
        expect(result.excerpt.length).toBeGreaterThan(0)
        expect(result.message.text.slice(source.start, source.end)).toBe(result.excerpt)
        expect(conversations[id].sessionId).toBe(source.sessionId)
      }
    }
  })
})

describe('用户内容与视图保护', () => {
  it('仅保护改过的字段，生成内容保持原样，未改摘要仍可反映新内容', () => {
    const original = seed()
    const summary = original.generated.nodes.comparison.summary
    const doc = execute(original, { type: 'edit', id: 'comparison', title: '我的标题', summary })
    expect(doc.generated).toEqual(original.generated)
    expect(doc.user.fields.comparison.title).toBe('我的标题')
    expect(doc.user.fields.comparison.summary).toBeUndefined()
    doc.generated.nodes.comparison.title = '后续生成标题'
    doc.generated.nodes.comparison.summary = '未修改字段的新摘要'
    const node = materialize(doc).nodes.find(n => n.id === 'comparison')!
    expect(node.title).toBe('我的标题')
    expect(node.summary).toBe('未修改字段的新摘要')
  })
  it('移动只记录视图位置，一次拖动对应一步撤销', () => {
    const original = seed()
    const doc = execute(original, { type: 'move', id: 'comparison', position: { x: 102, y: 209, pinned: false } })
    expect(doc.generated).toEqual(original.generated)
    expect(doc.user).toEqual(original.user)
    expect(doc.view.positions.comparison).toEqual({ x: 102, y: 209, pinned: true })
    expect(undo(doc).view.positions.comparison).toEqual(original.view.positions.comparison)
  })
  it('用户笔记没有对话来源；新增与撤销不会修改生成数据', () => {
    const original = seed()
    const doc = execute(original, { type: 'note', id: 'note-test', title: '我的补充', summary: '需要验证', position: { x: 5, y: 8, pinned: true } })
    expect(doc.user.notes['note-test'].kind).toBe('note')
    expect(doc.user.notes['note-test'].sourceIds).toEqual([])
    expect(doc.generated).toEqual(original.generated)
    expect(materialize(undo(doc)).nodes).toHaveLength(6)
    expectCoherent(doc)
  })
  it('无效编辑原子失败，不留下半个操作', () => {
    const doc = seed()
    expect(() => execute(doc, { type: 'edit', id: 'comparison', title: ' ', summary: '' })).toThrow()
    expect(() => execute(doc, { type: 'connect', id: 'bad-edge', from: 'comparison', to: 'missing' })).toThrow()
    expect(doc).toEqual(seed())
  })
})

describe('关系、删除与合并', () => {
  it('手动移除关系有记录；重建、撤销、重做保持一致且不产生副本', () => {
    const original = seed()
    const edgeId = original.generated.edges['e-branches-2'].id
    let doc = execute(original, { type: 'remove-edge', id: edgeId })
    expect(materialize(doc).edges).toHaveLength(4)
    expect(doc.user.removedEdges[edgeId]).toBeDefined()
    // Different producer ID for the same relationship still respects removal.
    doc.generated.edges['replayed-edge'] = { ...doc.generated.edges[edgeId], id: 'replayed-edge' }
    expect(materialize(doc).edges).toHaveLength(4)
    doc = execute(doc, { type: 'connect', id: 'manual-edge', from: 'comparison', to: 'structure' })
    expect(materialize(doc).edges).toHaveLength(5)
    expectCoherent(doc)
    expect(materialize(undo(doc)).edges).toHaveLength(4)
    expect(materialize(redo(undo(doc))).edges).toHaveLength(5)
  })
  it('删除后没有悬空关系；同来源换 ID 重放仍被删除记录抑制', () => {
    const original = seed()
    const doc = execute(original, { type: 'delete', id: 'comparison' })
    expect(materialize(doc).edges).toHaveLength(0)
    expect(resolveReference(doc, reference).status).toBe('deleted')
    const replay = structuredClone(doc)
    replay.generated.nodes.replayed = { ...replay.generated.nodes.comparison, id: 'replayed' }
    replay.view.positions.replayed = { x: 300, y: 300, pinned: false }
    expect(materialize(replay).nodes.some(n => n.id === 'replayed')).toBe(false)
    expect(materialize(undo(doc)).edges).toHaveLength(5)
    expectCoherent(replay)
  })
  it('连续合并保留旧引用、来源、笔记与修改，去除自环和重复关系', () => {
    let doc = execute(seed(), { type: 'edit', id: 'comparison', title: '修正后的标题', summary: '用户修正的摘要' })
    doc = execute(doc, { type: 'merge', from: 'comparison', into: 'structure' })
    doc = execute(doc, { type: 'merge', from: 'structure', into: 'two-views' })
    expect(canonicalId(doc, 'comparison')).toBe('two-views')
    const resolved = resolveReference(doc, reference)
    expect(resolved.status).toBe('found')
    if (resolved.status !== 'found') throw new Error('引用未解析')
    expect(resolved.merged).toBe(true)
    expect(resolved.node.members.find(n => n.id === 'comparison')?.summary).toBe('用户修正的摘要')
    expect(resolved.node.sourceIds).toEqual(expect.arrayContaining(seed().generated.nodes.comparison.sourceIds))
    doc = execute(doc, { type: 'note', id: 'note-test', title: '手动想法', summary: '不是对话原文', position: { x: 0, y: 0, pinned: true } })
    doc = execute(doc, { type: 'merge', from: 'note-test', into: 'two-views' })
    expect(materialize(doc).nodes.find(n => n.id === 'two-views')?.hasNotes).toBe(true)
    expectCoherent(doc)
    const deleted = execute(doc, { type: 'delete', id: 'two-views' })
    expect(resolveReference(deleted, reference).status).toBe('deleted')
    expect(resolveReference(undo(deleted), reference).status).toBe('found')
    expectCoherent(undo(deleted))
  })
  it('撤销只修改对应字段，保留无关的新内容、视口和主题', () => {
    const original = seed()
    const doc = execute(original, { type: 'edit', id: 'comparison', title: '新标题', summary: '新摘要' })
    doc.generated.revision = 2
    doc.generated.nodes.addition = { id: 'addition', title: '后来的内容', summary: '', details: '', sourceIds: [], kind: 'discussion' }
    doc.view.positions.addition = { x: 100, y: 300, pinned: false }
    doc.view.theme = 'dark'
    doc.view.viewport = { x: 22, y: 44, zoom: 1.2 }
    const restored = undo(doc)
    expect(restored.generated.nodes.addition).toEqual(doc.generated.nodes.addition)
    expect(restored.view.positions.addition).toEqual(doc.view.positions.addition)
    expect(restored.view.theme).toBe('dark')
    expect(restored.view.viewport).toEqual(doc.view.viewport)
    expect(materialize(restored).nodes.find(n => n.id === 'comparison')?.title).toBe(original.generated.nodes.comparison.title)
  })
})

describe('稳定引用', () => {
  it('改标题后原引用仍解析到相同 ID', () => {
    const doc = execute(seed(), { type: 'edit', id: 'comparison', title: '完全不同的标题', summary: '' })
    const result = resolveReference(doc, reference)
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.node.id).toBe('comparison')
  })
  it.each(['', 'https://canvas/mw-branches/node/comparison', 'mindweave://canvas/mw-branches/node/comparison?x=1', 'mindweave://canvas/mw-branches/node/comparison/extra', 'mindweave://canvas/mw-branches//node/comparison', 'mindweave://canvas/mw-branches/node/__proto__'])('拒绝非规范或无效引用 %s', value => {
    expect(parseReference(value)).toBeNull()
    expect(resolveReference(seed(), value).status).toBe('invalid')
  })
  it('区分不存在的节点和其他画布', () => {
    expect(resolveReference(seed(), referenceFor('mw-learning', 'flow')).status).toBe('wrong-canvas')
    expect(resolveReference(seed(), referenceFor('mw-branches', 'missing')).status).toBe('missing')
  })
})
