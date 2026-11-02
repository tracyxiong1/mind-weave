import { describe, expect, it } from 'vitest'
import { samples } from '../data/samples'
import { createDocument, execute, materialize, undo } from './model'
import { loadDocument, saveDocument, storageKey, validateDocument, type StoragePort } from './persistence'
import { referenceFor, resolveReference } from './references'

class MemoryStorage implements StoragePort {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
describe('持久化恢复', () => {
  it('重新加载恢复内容、位置、字段保护、合并映射、删除记录和撤销', () => {
    const storage = new MemoryStorage()
    let doc = createDocument(samples.branches)
    doc = execute(doc, { type: 'edit', id: 'comparison', title: '自己的标题', summary: '自己的摘要' })
    doc = execute(doc, { type: 'move', id: 'comparison', position: { x: 199, y: 299, pinned: true } })
    doc = execute(doc, { type: 'merge', from: 'comparison', into: 'structure' })
    doc = execute(doc, { type: 'delete', id: 'mixing' })
    doc.view.theme = 'dark'; doc.view.viewport = { x: 100, y: -80, zoom: 1.2 }
    expect(saveDocument(storage, doc).ok).toBe(true)
    const result = loadDocument(storage, samples.branches)
    expect(result.problem).toBeNull()
    expect(result.document).toEqual(doc)
    expect(resolveReference(result.document, referenceFor(doc.id, 'comparison')).status).toBe('found')
    expect(materialize(undo(result.document)).nodes.some(n => n.id === 'mixing')).toBe(true)
  })
  it('不同样例按画布 ID 隔离', () => {
    const storage = new MemoryStorage()
    const doc = createDocument(samples.learning)
    doc.view.theme = 'dark'
    saveDocument(storage, doc)
    expect(loadDocument(storage, samples.branches).document.id).toBe('mw-branches')
    expect(loadDocument(storage, samples.branches).document.view.theme).toBe('system')
  })
  it.each(['{bad-json', '{"schemaVersion":999}', JSON.stringify({ ...createDocument(samples.branches), id: 'wrong-canvas' })])('异常数据保持原样，返回可恢复问题', raw => {
    const storage = new MemoryStorage(); const key = storageKey(samples.branches.canvasId)
    storage.setItem(key, raw)
    const result = loadDocument(storage, samples.branches)
    expect(result.problem).not.toBeNull()
    expect(result.original).toBe(raw)
    expect(storage.getItem(key)).toBe(raw)
    expect(validateDocument(result.document)).toBe(true)
  })
  it('拒绝循环别名、非法坐标、缺失位置和不安全撤销负载', () => {
    const cyclic = createDocument(samples.branches)
    cyclic.user.aliases = { comparison: 'structure', structure: 'comparison' }
    expect(validateDocument(cyclic)).toBe(false)
    const badPosition = createDocument(samples.branches); badPosition.view.positions.comparison.x = Infinity
    expect(validateDocument(badPosition)).toBe(false)
    const missing = createDocument(samples.branches); delete missing.view.positions.comparison
    expect(validateDocument(missing)).toBe(false)
    const enumValue = createDocument(samples.branches)
    expect(validateDocument({ ...enumValue, view: { ...enumValue.view, theme: ['light'] } })).toBe(false)
    expect(validateDocument({ ...enumValue, generated: { ...enumValue.generated, nodes: { ...enumValue.generated.nodes, comparison: { ...enumValue.generated.nodes.comparison, kind: ['discussion'] } } } })).toBe(false)
    const doc = execute(createDocument(samples.branches), { type: 'delete', id: 'comparison' })
    doc.history.past[0].patches[0].after = { id: '__proto__' }
    expect(validateDocument(doc)).toBe(false)
  })
  it('存储被禁用或容量不足时返回错误，当前文档不丢失', () => {
    const storage: StoragePort = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
    const result = loadDocument(storage, samples.branches)
    expect(result.problem).not.toBeNull()
    expect(saveDocument(storage, result.document).ok).toBe(false)
    expect(materialize(result.document).nodes).toHaveLength(6)
  })
  it('限制撤销容量，序列化后依然可以撤销最近修改', () => {
    let doc = createDocument(samples.branches)
    for (let i = 0; i < 45; i++) doc = execute(doc, { type: 'edit', id: 'comparison', title: `标题 ${i}`, summary: '' })
    expect(doc.history.past).toHaveLength(40)
    const storage = new MemoryStorage(); expect(saveDocument(storage, doc).ok).toBe(true)
    expect(materialize(undo(loadDocument(storage, samples.branches).document)).nodes.find(n => n.id === 'comparison')?.title).toBe('标题 43')
  })
})
