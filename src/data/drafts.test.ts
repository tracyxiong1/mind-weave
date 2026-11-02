import { describe, expect, it } from 'vitest'
import { createDocument, execute } from '../core/model'
import { saveDocument, storageKey, type StoragePort } from '../core/persistence'
import { conversations, samples } from './samples'
import { loadSampleDraft } from './drafts'
import { readingSample, refreshSampleDetails } from './reading'

class MemoryStorage implements StoragePort {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
const key = storageKey(readingSample.canvasId), legacy = `excalidraw-experiment:${key}`

describe('默认画布迁移', () => {
  it('优先保留正式草稿，读取不改写任何原始缓存', () => {
    const storage = new MemoryStorage(), original = createDocument(readingSample)
    original.view.theme = 'dark'
    storage.setItem(key, JSON.stringify(original))
    storage.setItem(legacy, JSON.stringify(execute(original, { type: 'edit', id: 'comparison', title: '验证页修改', summary: '' })))
    const snapshot = new Map(storage.data)
    expect(loadSampleDraft(storage, readingSample).document).toEqual(original)
    expect(storage.data).toEqual(snapshot)
  })
  it('同一 origin 没有正式草稿时保留验证页修改、位置和撤销，并使用正式保存键', () => {
    const storage = new MemoryStorage()
    let original = execute(createDocument(readingSample), { type: 'edit', id: 'comparison', title: '人工标题', summary: '保留摘要' })
    original = execute(original, { type: 'move', id: 'comparison', position: { x: -900, y: 380, pinned: true } })
    storage.setItem(legacy, JSON.stringify(original))
    const loaded = loadSampleDraft(storage, readingSample)
    expect(loaded.document).toEqual(original); expect(loaded.problem).toBeNull()
    expect(saveDocument(storage, loaded.document).ok).toBe(true)
    expect(storage.getItem(key)).toBe(JSON.stringify(original))
    expect(storage.getItem(legacy)).toBe(JSON.stringify(original))
  })
  it('损坏的正式草稿不能被验证页或示例自动覆盖', () => {
    const storage = new MemoryStorage()
    storage.setItem(key, '{bad-json'); storage.setItem(legacy, JSON.stringify(createDocument(readingSample)))
    const loaded = loadSampleDraft(storage, readingSample)
    expect(loaded.problem).not.toBeNull(); expect(loaded.original).toBe('{bad-json')
    expect(storage.getItem(key)).toBe('{bad-json')
  })
  it('迁移新增来源仅接受同会话、被节点引用且原文范围有效的记录', () => {
    const storage = new MemoryStorage(), original = createDocument(readingSample), message = conversations.branches.messages[0]
    original.generated.nodes.comparison.sourceIds.push('new-source', 'bad-source')
    storage.setItem(legacy, JSON.stringify(original))
    const source = { id: 'new-source', sessionId: readingSample.sessionId, messageId: message.id, start: 0, end: message.text.length }
    storage.setItem(`excalidraw-experiment:sources:${readingSample.canvasId}`, JSON.stringify([
      source, { ...source, id: 'bad-source', end: message.text.length + 1 }, { ...source, id: 'unused' },
      { ...source, id: readingSample.sources[0].id, start: 1 },
    ]))
    expect(loadSampleDraft(storage, readingSample, conversations.branches).sample.sources).toEqual([...readingSample.sources, source])
  })
  it('只更新已知示例说明，保留人工历史、自定义正文和增量后缀', () => {
    const original = execute(createDocument(samples.branches), { type: 'edit', id: 'comparison', title: '人工标题', summary: '' })
    original.generated.nodes.comparison.details += '\n增量验证 v2'
    original.generated.nodes.structure.details = '用户或生成器的自定义正文'
    const refreshed = refreshSampleDetails(original)
    expect(refreshed.generated.nodes.comparison.details).toBe(readingSample.nodes.find(node => node.id === 'comparison')!.details + '\n增量验证 v2')
    expect(refreshed.generated.nodes.structure.details).toBe('用户或生成器的自定义正文')
    expect(refreshed.user).toEqual(original.user); expect(refreshed.view).toEqual(original.view); expect(refreshed.history).toEqual(original.history)
    expect(refreshSampleDetails({ ...original, id: 'real-canvas' }).generated).toBe(original.generated)
  })
})
