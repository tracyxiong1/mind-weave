import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposal, recordWithGraph } from '../../tests/fixtures/codex'
import { applyGraphUpdate, publicCanvas, saveBrowserDocument } from '../integration/update'
import type { CanvasRecord } from '../integration/types'
import { execute } from './model'
import { rebaseDraft, validateLiveCanvas } from './live'
import { draftKey, LiveCanvasClient, restoreLiveDraft } from './live-client'

const clients: LiveCanvasClient[] = []
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup(record = recordWithGraph()) {
  vi.useFakeTimers()
  let doc = record.document, interacting = false
  const values = new Map<string, string>(), problems: (string | null)[] = []
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const client = new LiveCanvasClient(publicCanvas(record), {
    storage, getDocument: () => doc, receive: value => { doc = value.document },
    problem: value => problems.push(value), interacting: () => interacting,
  })
  clients.push(client)
  return { client, storage, problems, getDoc: () => doc, setDoc: (value: typeof doc) => { doc = value }, setInteracting: (value: boolean) => { interacting = value } }
}
const response = (record: CanvasRecord) => new Response(JSON.stringify(publicCanvas(record)), { status: 200 })
function service(initial: CanvasRecord) {
  let record = initial
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      try { record = saveBrowserDocument(record, body.version, body.document); return response(record) }
      catch { return new Response(JSON.stringify({ message: '版本冲突' }), { status: 409 }) }
    }
    const url = new URL(input, 'http://localhost')
    if (url.searchParams.get('version') === String(record.version)) return new Response(null, { status: 204 })
    return response(record)
  })
  return { fetch, get: () => record }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('live drafts and browser save synchronization', () => {
  it('rebases a pending edit over new generated content, preserving positions of new nodes', () => {
    const base = recordWithGraph(), draft = execute(base.document, { type: 'edit', id: 'main', title: '人工标题', summary: '保留真实来源' })
    const update = proposal(base, 'new-generation')
    update.nodes[0].summary = '生成摘要更新'
    update.nodes.push({ ...update.nodes[1], id: 'new-topic' })
    const latest = applyGraphUpdate(base, update)
    const result = rebaseDraft(base.document, draft, latest.document)
    expect(result.user.fields.main.title).toBe('人工标题')
    expect(result.generated.nodes.main.summary).toBe('生成摘要更新')
    expect(result.view.positions['new-topic']).toEqual(latest.document.view.positions['new-topic'])
    expect(validateLiveCanvas({ ...publicCanvas(latest), document: result })).toBe(true)
    const otherUser = saveBrowserDocument(base, base.version, execute(base.document, { type: 'edit', id: 'main', title: '其他页面', summary: '保留真实来源' }))
    expect(() => rebaseDraft(base.document, draft, otherUser.document)).toThrow('其他页面修改')
  })
  it('restores offline drafts, accepted pagehide saves, corrupt backups and detects another canvas', () => {
    const base = recordWithGraph(), { storage } = setup(base), key = draftKey(base.document.id)
    const draft = execute(base.document, { type: 'edit', id: 'main', title: '未保存的标题', summary: '保留真实来源' })
    storage.setItem(key, JSON.stringify({ base: base.document, draft }))
    const latest = applyGraphUpdate(base, proposal(base, 'next'))
    expect(restoreLiveDraft(storage, publicCanvas(latest)).document.user.fields.main.title).toBe('未保存的标题')
    const accepted = saveBrowserDocument(base, base.version, draft)
    const newerDraft = execute(draft, { type: 'edit', id: 'branch', title: '又一处修改', summary: '支持人工修正' })
    storage.setItem(key, JSON.stringify({ base: base.document, sent: draft, draft: newerDraft }))
    expect(restoreLiveDraft(storage, publicCanvas(accepted))).toMatchObject({ problem: null, document: { user: { fields: { branch: { title: '又一处修改' } } } } })
    const other = recordWithGraph('wrong-thread')
    storage.setItem(key, JSON.stringify({ base: other.document, draft: other.document }))
    expect(restoreLiveDraft(storage, publicCanvas(base)).problem).toContain('另一画布')
    storage.setItem(key, '{bad')
    expect(restoreLiveDraft(storage, publicCanvas(base)).original).toBe('{bad')
    expect(storage.getItem(key)).toBe('{bad')
  })
  it('uses compare-and-swap to rebase concurrent Codex updates before saving a browser edit', async () => {
    const base = recordWithGraph(), h = setup(base)
    const update = proposal(base, 'codex-update'); update.nodes[0].summary = 'Codex 新摘要'
    const server = service(applyGraphUpdate(base, update)); vi.stubGlobal('fetch', server.fetch)
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '人工标题', summary: '保留真实来源' }))
    h.client.documentChanged(); await h.client.flush()
    expect(server.get().document.user.fields.main.title).toBe('人工标题')
    expect(server.get().document.generated.nodes.main.summary).toBe('Codex 新摘要')
    expect(h.problems.at(-1)).toBeNull()
    expect(server.fetch.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['PUT', 'GET', 'PUT'])
  })
  it('retains edits made during an in-flight save and serializes the next save', async () => {
    const base = recordWithGraph(), h = setup(base), first = deferred<Response>()
    const server = service(base)
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (++requests === 1) { const saved = await server.fetch(input, init); return first.promise.then(() => saved) }
      return server.fetch(input, init)
    }))
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '第一次修改', summary: '保留真实来源' }))
    h.client.documentChanged(); const saving = h.client.flush()
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '保存过程中继续修改', summary: '保留真实来源' }))
    h.client.documentChanged(); first.resolve(response(base)); await saving
    expect(server.get().document.user.fields.main.title).toBe('保存过程中继续修改')
    expect(h.getDoc()).toEqual(server.get().document)
    expect(requests).toBe(2)
  })
  it('quietly continues saving when view changes arrive throughout the request budget', async () => {
    const base = recordWithGraph(), h = setup(base), server = service(base)
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const result = await server.fetch(input, init)
      if (init?.method === 'PUT' && ++writes <= 7) {
        h.setDoc({ ...h.getDoc(), view: { ...h.getDoc().view, viewport: { x: writes * 20, y: 0, zoom: 1 } } })
        h.client.documentChanged()
      }
      return result
    }))
    h.setDoc({ ...h.getDoc(), view: { ...h.getDoc().view, viewport: { x: 0, y: 0, zoom: 1 } } })
    h.client.documentChanged(); await h.client.flush()
    expect(writes).toBe(5)
    expect(h.problems.filter(Boolean)).toEqual([])
    // Release the pointer/wheel burst: the continuation must save the final view
    // without waiting for another edit or the 2.5-second polling interval.
    await vi.advanceTimersByTimeAsync(180)
    expect(writes).toBe(8)
    expect(server.get().document.view.viewport).toEqual({ x: 140, y: 0, zoom: 1 })
    expect(h.getDoc()).toEqual(server.get().document)
    expect(h.problems.filter(Boolean)).toEqual([])
  })
  it('yields and retries a burst of generated revisions without reporting a save failure', async () => {
    const base = recordWithGraph(), h = setup(base)
    let record = base, writes = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return response(record)
      if (++writes <= 5) record = applyGraphUpdate(record, proposal(record, `burst-${writes}`))
      const body = JSON.parse(String(init.body))
      try { record = saveBrowserDocument(record, body.version, body.document); return response(record) }
      catch { return new Response(null, { status: 409 }) }
    }))
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '保留我的标题', summary: '保留真实来源' }))
    h.client.documentChanged(); await h.client.flush()
    expect(writes).toBe(5)
    expect(h.problems.filter(Boolean)).toEqual([])
    await vi.advanceTimersByTimeAsync(180)
    expect(writes).toBe(6)
    expect(record.document.user.fields.main.title).toBe('保留我的标题')
    expect(h.getDoc()).toEqual(record.document)
    expect(h.problems.filter(Boolean)).toEqual([])
  })
  it('saves an edit whose debounce fired while polling and never overwrites it with the poll result', async () => {
    const base = recordWithGraph(), h = setup(base), read = deferred<Response>()
    const server = service(applyGraphUpdate(base, proposal(base, 'poll-update')))
    let first = true
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      if (first) { first = false; return read.promise }
      return server.fetch(input, init)
    }))
    const polling = h.client.poll()
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '读取过程中修改', summary: '保留真实来源' }))
    h.client.documentChanged(); await vi.advanceTimersByTimeAsync(180)
    read.resolve(response(server.get())); await polling
    await vi.waitFor(() => expect(server.get().document.user.fields.main.title).toBe('读取过程中修改'))
    expect(h.getDoc().generated.revision).toBe(server.get().document.generated.revision)
  })
  it('preserves a local draft on network failure and saves successfully on retry', async () => {
    const base = recordWithGraph(), h = setup(base)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('服务已断开')))
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '离线修改', summary: '保留真实来源' }))
    h.client.documentChanged(); await h.client.flush()
    expect(h.problems.at(-1)).toBe('服务已断开')
    expect(restoreLiveDraft(h.storage, publicCanvas(base)).document.user.fields.main.title).toBe('离线修改')
    const server = service(base); vi.stubGlobal('fetch', server.fetch)
    await h.client.flush()
    expect(server.get().document.user.fields.main.title).toBe('离线修改')
    expect(h.problems.at(-1)).toBeNull()
  })
  it('refuses a competing human edit, retaining the draft until explicit reload', async () => {
    const base = recordWithGraph(), h = setup(base)
    const other = saveBrowserDocument(base, base.version, execute(base.document, { type: 'edit', id: 'main', title: '其他页面先保存', summary: '保留真实来源' }))
    const server = service(other); vi.stubGlobal('fetch', server.fetch)
    h.setDoc(execute(h.getDoc(), { type: 'edit', id: 'main', title: '本页草稿', summary: '保留真实来源' }))
    h.client.documentChanged(); await h.client.flush()
    expect(h.problems.at(-1)).toContain('其他页面修改')
    expect(h.getDoc().user.fields.main.title).toBe('本页草稿')
    expect(server.get().document.user.fields.main.title).toBe('其他页面先保存')
    expect(restoreLiveDraft(h.storage, publicCanvas(other)).problem).toContain('其他页面修改')
    await h.client.reload()
    expect(h.getDoc().user.fields.main.title).toBe('其他页面先保存')
  })
  it('does not poll while the user edits and does not steal selection or viewport on a generated update', async () => {
    const base = recordWithGraph(); base.document.view.viewport = { x: 10, y: 20, zoom: 1 }; base.document.view.selected = 'main'
    const h = setup(base), latest = applyGraphUpdate(base, proposal(base, 'quiet-update')), server = service(latest)
    vi.stubGlobal('fetch', server.fetch)
    h.setInteracting(true); await h.client.poll(); expect(server.fetch).not.toHaveBeenCalled()
    h.setInteracting(false); await h.client.poll()
    expect(h.getDoc().generated.revision).toBe(latest.document.generated.revision)
    expect(h.getDoc().view.viewport).toEqual(base.document.view.viewport)
    expect(h.getDoc().view.selected).toBe('main')
  })
  it('defers a pending view save during an edit form, then resumes on the next idle poll', async () => {
    const base = recordWithGraph(), h = setup(base), server = service(applyGraphUpdate(base, proposal(base, 'while-editing')))
    vi.stubGlobal('fetch', server.fetch)
    h.setDoc({ ...h.getDoc(), view: { ...h.getDoc().view, selected: 'main' } })
    h.client.documentChanged(); h.setInteracting(true)
    await vi.advanceTimersByTimeAsync(180)
    expect(server.fetch).not.toHaveBeenCalled()
    expect(h.getDoc().generated.revision).toBe(base.document.generated.revision)
    h.setInteracting(false); await h.client.poll()
    expect(server.get().document.view.selected).toBe('main')
    expect(h.getDoc().generated.revision).toBe(server.get().document.generated.revision)
  })
})
