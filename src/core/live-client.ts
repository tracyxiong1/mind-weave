import { validateDocument, type LoadResult, type StoragePort } from './persistence'
import { isRecord, rebaseDraft, validateLiveCanvas, type LiveCanvas } from './live'
import type { CanvasDocument } from './types'

export const draftKey = (id: string) => `mindweave:v1:codex-draft:${id}`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function restoreLiveDraft(storage: StoragePort, record: LiveCanvas): LoadResult {
  let original: string | null = null
  try {
    original = storage.getItem(draftKey(record.document.id))
    if (!original) return { document: record.document, problem: null, original: null }
    const value: unknown = JSON.parse(original)
    if (!isRecord(value) || !validateDocument(value.base) || !validateDocument(value.draft)
      || (value.sent !== undefined && !validateDocument(value.sent))) throw new Error('浏览器草稿结构无效，原数据已保留。')
    if ([value.base, value.draft, value.sent].some(doc => doc && ((doc as CanvasDocument).id !== record.document.id
      || (doc as CanvasDocument).sessionId !== record.document.sessionId))) throw new Error('浏览器草稿属于另一画布，原数据已保留。')
    if (same(value.draft, record.document)) return { document: record.document, problem: null, original }
    for (const base of [value.base, value.sent, value.draft]) {
      if (!base) continue
      try { return { document: rebaseDraft(base as CanvasDocument, value.draft, record.document), problem: null, original } }
      catch { /* Try the acknowledged baseline or a save sent before closing. */ }
    }
    return { document: value.draft, problem: '服务器画布已在其他页面修改。浏览器草稿已恢复，请先导出，再载入最新画布。', original }
  } catch (error) {
    return { document: record.document, problem: error instanceof Error ? error.message : '浏览器草稿无法恢复，原数据已保留。', original }
  }
}

async function errorFor(response: Response) {
  try { const value: unknown = await response.json(); if (isRecord(value) && typeof value.message === 'string') return value.message } catch { /* No JSON error body. */ }
  return `本地画布服务返回 ${response.status}。`
}
export async function fetchLiveCanvas(id: string, access?: string, version?: number): Promise<LiveCanvas | null> {
  const query = new URLSearchParams()
  if (access) query.set('access', access)
  if (version !== undefined) query.set('version', String(version))
  const response = await fetch(`/api/canvases/${encodeURIComponent(id)}?${query}`, { cache: 'no-store', credentials: 'same-origin' })
  if (response.status === 204) return null
  if (!response.ok) throw new Error(await errorFor(response))
  const value: unknown = await response.json()
  if (!validateLiveCanvas(value) || value.document.id !== id) throw new Error('本地画布服务返回了无效数据。')
  return value
}

interface ClientOptions {
  storage: StoragePort
  getDocument: () => CanvasDocument
  receive: (record: LiveCanvas) => void
  problem: (message: string | null) => void
  interacting: () => boolean
}
/** Serialize browser saves and safely rebase them over Codex-only updates. */
export class LiveCanvasClient {
  private pending = false
  private busy = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private conflict = false
  constructor(private record: LiveCanvas, private readonly options: ClientOptions) {}
  private backup(sent?: CanvasDocument) {
    try {
      this.options.storage.setItem(draftKey(this.record.document.id), JSON.stringify({ base: this.record.document, draft: this.options.getDocument(), ...(sent ? { sent } : {}) }))
    } catch { this.options.problem('浏览器草稿备份失败。请保持页面打开，等待本地服务保存或导出备份。') }
  }
  documentChanged() {
    if (this.disposed || same(this.record.document, this.options.getDocument())) return
    this.pending = true; this.backup()
    if (this.conflict) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, 180)
  }
  async flush() {
    if (this.busy || this.disposed || this.conflict || !this.pending || this.options.interacting()) return
    this.busy = true
    try {
      for (let attempts = 0; this.pending && attempts < 5; attempts++) {
        if (this.options.interacting()) return
        const sent = this.options.getDocument()
        this.backup(sent)
        const response = await fetch(`/api/canvases/${this.record.document.id}`, {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: this.record.version, document: sent }),
        })
        if (this.disposed) return
        if (response.status === 409) {
          const latest = (await fetchLiveCanvas(this.record.document.id))!
          if (this.disposed || this.options.interacting()) return
          const draft = this.options.getDocument()
          let rebased: CanvasDocument
          try { rebased = rebaseDraft(this.record.document, draft, latest.document) }
          catch (error) { this.conflict = true; throw error }
          this.record = latest
          this.options.receive({ ...latest, document: rebased }); this.backup()
          continue
        }
        if (!response.ok) throw new Error(await errorFor(response))
        const saved: unknown = await response.json()
        if (!validateLiveCanvas(saved) || saved.document.id !== this.record.document.id) throw new Error('保存响应无效，浏览器草稿已保留。')
        const draft = this.options.getDocument()
        this.record = saved
        this.pending = !same(draft, sent)
        this.options.receive({ ...saved, document: this.pending ? draft : saved.document })
        this.backup(); this.options.problem(null)
      }
      if (this.pending) throw new Error('画布持续更新中。草稿已保留，请稍后重试保存。')
    } catch (error) {
      if (!this.disposed) this.options.problem(error instanceof Error ? error.message : '本地服务保存失败，当前草稿已保留。')
    } finally { this.busy = false }
  }
  async poll() {
    if (this.busy || this.disposed || this.options.interacting()) return
    if (this.pending) { await this.flush(); return }
    this.busy = true
    const base = this.record
    try {
      const latest = await fetchLiveCanvas(base.document.id, undefined, base.version)
      if (!latest || this.disposed) return
      // A user can start editing while the read is in flight.
      if (this.options.interacting() || !same(this.options.getDocument(), base.document)) return
      this.record = latest; this.options.receive(latest); this.backup(); this.options.problem(null)
    } catch (error) { if (!this.disposed) this.options.problem(error instanceof Error ? error.message : '无法读取最新画布。') }
    finally {
      this.busy = false
      // An edit can arrive after a poll starts and its debounce can fire while
      // the read is still pending. Ensure that edit still reaches the server.
      if (this.pending && !this.disposed && !this.conflict) void this.flush()
    }
  }
  retry() { this.conflict = false; this.documentChanged(); void this.flush(); if (!this.pending) void this.poll() }
  pagehide() {
    if (!this.pending) return
    const document = this.options.getDocument()
    this.backup(document)
    navigator.sendBeacon?.(`/api/canvases/${this.record.document.id}`, new Blob([JSON.stringify({ version: this.record.version, document })], { type: 'application/json' }))
  }
  async reload() {
    const latest = (await fetchLiveCanvas(this.record.document.id))!
    if (this.disposed) return
    this.record = latest; this.pending = false; this.conflict = false
    this.options.receive(latest); this.backup(); this.options.problem(null)
  }
  dispose() { this.disposed = true; clearTimeout(this.timer) }
}
