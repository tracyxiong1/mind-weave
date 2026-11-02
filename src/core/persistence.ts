import { createDocument, canonicalId } from './model'
import { validId } from './references'
import type { CanvasDocument, EditArea, Sample } from './types'

export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const storageKey = (id: string) => `mindweave:v1:canvas:${id}`
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const str = (v: unknown, max = 10000): v is string => typeof v === 'string' && v.length <= max
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(validId)
const recordOf = (v: unknown, predicate: (v: unknown, key: string) => boolean) =>
  isRecord(v) && Object.entries(v).every(([key, value]) => validId(key) && predicate(value, key))
const node = (v: unknown, key: string) => isRecord(v) && v.id === key && str(v.title, 120) && Boolean(v.title.trim()) &&
  str(v.summary, 500) && str(v.details) && typeof v.kind === 'string' && ['discussion', 'suggestion', 'note'].includes(v.kind) && ids(v.sourceIds) &&
  (v.kind !== 'note' || v.sourceIds.length === 0)
const edge = (v: unknown, key: string) => isRecord(v) && v.id === key && validId(v.from) && validId(v.to) && v.from !== v.to && str(v.label, 200)
const position = (v: unknown) => isRecord(v) && finite(v.x) && finite(v.y) && typeof v.pinned === 'boolean'
const revision = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1
const fields = (v: unknown) => isRecord(v) && (v.title === undefined || (str(v.title, 120) && Boolean(v.title.trim()))) &&
  (v.summary === undefined || str(v.summary, 500)) && validId(v.operationId) && revision(v.baseRevision) && str(v.updatedAt, 50)
const tombstone = (v: unknown, key: string) => isRecord(v) && v.id === key && ids(v.sourceIds) && str(v.deletedAt, 50)
const removed = (v: unknown, key: string) => isRecord(v) && v.id === key && validId(v.from) && validId(v.to) && ids(v.memberIds) && str(v.removedAt, 50)
const validators: Record<EditArea, (v: unknown, key: string) => boolean> = {
  fields, notes: node, edges: edge, removedEdges: removed, tombstones: tombstone,
  aliases: v => validId(v), positions: position,
}

export function validateDocument(value: unknown): value is CanvasDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validId(value.id) || !validId(value.sessionId)) return false
  const { generated, user, view, history } = value
  if (!isRecord(generated) || !revision(generated.revision) || !recordOf(generated.nodes, node) || !recordOf(generated.edges, edge)) return false
  if (!isRecord(user) || Object.entries(validators).some(([area, validator]) =>
    area !== 'positions' && !recordOf(user[area], validator))) return false
  if (!isRecord(view) || !recordOf(view.positions, position) || !ids(view.expanded) ||
    (view.selected !== null && !validId(view.selected)) || typeof view.theme !== 'string' || !['system', 'light', 'dark'].includes(view.theme)) return false
  if (view.viewport !== null && (!isRecord(view.viewport) || !finite(view.viewport.x) || !finite(view.viewport.y) ||
    !finite(view.viewport.zoom) || view.viewport.zoom < 0.3 || view.viewport.zoom > 2)) return false
  if (!isRecord(history)) return false
  for (const entries of [history.past, history.future]) {
    if (!Array.isArray(entries) || entries.length > 40) return false
    for (const entry of entries) {
      if (!isRecord(entry) || !validId(entry.id) || !str(entry.label, 100) || !str(entry.createdAt, 50) ||
        !revision(entry.baseRevision) || !Array.isArray(entry.patches) || !entry.patches.length) return false
      for (const patch of entry.patches) {
        if (!isRecord(patch) || !validId(patch.key) || !Object.hasOwn(validators, String(patch.area))) return false
        const validate = validators[patch.area as EditArea]
        if (![patch.before, patch.after].every(v => v === null || validate(v, patch.key as string))) return false
      }
    }
  }
  const doc = value as unknown as CanvasDocument
  const all = { ...doc.generated.nodes, ...doc.user.notes }
  if (Object.keys(all).some(id => !doc.view.positions[id])) return false
  for (const [id, alias] of Object.entries(doc.user.aliases)) {
    if (!all[id] || !all[alias] || !canonicalId(doc, id)) return false
  }
  if (Object.keys(doc.user.fields).some(id => !all[id])) return false
  if (Object.values({ ...doc.generated.edges, ...doc.user.edges }).some(edge => !all[edge.from] || !all[edge.to])) return false
  if (Object.values(doc.user.notes).some(node => node.kind !== 'note')) return false
  if (Object.values(doc.generated.nodes).some(node => node.kind === 'note')) return false
  return true
}

export interface LoadResult { document: CanvasDocument; problem: string | null; original: string | null }
export function loadDocument(storage: StoragePort, sample: Sample): LoadResult {
  let original: string | null = null
  try {
    original = storage.getItem(storageKey(sample.canvasId))
    if (original === null) return { document: createDocument(sample), problem: null, original }
    const value: unknown = JSON.parse(original)
    if (!validateDocument(value) || value.id !== sample.canvasId || value.sessionId !== sample.sessionId) {
      throw new Error('版本或结构不匹配')
    }
    return { document: value, problem: null, original }
  } catch {
    return { document: createDocument(sample), problem: '本地数据无法读取，原数据已保留。可先下载备份，再选择是否用示例覆盖。', original }
  }
}

export function saveDocument(storage: StoragePort, document: CanvasDocument): { ok: true } | { ok: false; message: string } {
  try {
    if (!validateDocument(document)) throw new Error('数据无效')
    storage.setItem(storageKey(document.id), JSON.stringify(document))
    return { ok: true }
  } catch {
    return { ok: false, message: '本地保存失败。当前编辑仍在页面内，请导出备份或释放浏览器存储后重试。' }
  }
}
