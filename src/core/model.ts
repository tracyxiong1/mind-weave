import type {
  CanvasDocument, CanvasNode, Command, EditArea, HistoryEntry,
  HistoryPatch, RenderEdge, RenderNode, Sample,
} from './types'
import { validId } from './identifiers'

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const areas: EditArea[] = ['fields', 'notes', 'edges', 'removedEdges', 'tombstones', 'aliases', 'positions']
const labels: Record<Command['type'], string> = {
  edit: '编辑节点', note: '新增笔记', move: '移动节点', connect: '建立关系',
  'remove-edge': '移除关系', merge: '合并节点', delete: '删除节点', arrange: '整理布局',
}

export function createDocument(sample: Sample): CanvasDocument {
  return {
    schemaVersion: 1, id: sample.canvasId, sessionId: sample.sessionId,
    generated: {
      revision: 1,
      nodes: Object.fromEntries(sample.nodes.map(node => [node.id, structuredClone(node)])),
      edges: Object.fromEntries(sample.edges.map(edge => [edge.id, structuredClone(edge)])),
    },
    user: { fields: {}, notes: {}, edges: {}, removedEdges: {}, tombstones: {}, aliases: {} },
    view: { positions: structuredClone(sample.positions), expanded: [], selected: null, viewport: null, theme: 'system' },
    history: { past: [], future: [] },
  }
}

export function canonicalId(doc: CanvasDocument, id: string): string | null {
  const seen = new Set<string>()
  while (doc.user.aliases[id]) {
    if (seen.has(id)) return null
    seen.add(id)
    id = doc.user.aliases[id]
  }
  return id
}

const pair = (a: string, b: string) => [a, b].sort().join(':')

export function materialize(doc: CanvasDocument): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const all = { ...doc.generated.nodes, ...doc.user.notes }
  const deletedSources = new Set(Object.values(doc.user.tombstones).flatMap(t => t.sourceIds))
  const groups = new Map<string, CanvasNode[]>()
  for (const original of Object.values(all)) {
    const id = canonicalId(doc, original.id)
    if (!id || doc.user.tombstones[id] || doc.user.tombstones[original.id]) continue
    // Source anchors stay stable even if a later producer assigns a different node ID.
    if (original.sourceIds.some(source => deletedSources.has(source))) continue
    if (!all[id]) continue
    const fields = doc.user.fields[original.id]
    const edited = { ...original, title: fields?.title ?? original.title, summary: fields?.summary ?? original.summary }
    groups.set(id, [...(groups.get(id) ?? []), edited])
  }
  const nodes: RenderNode[] = []
  for (const [id, members] of groups) {
    const head = members.find(node => node.id === id)
    if (!head) continue
    nodes.push({
      ...head, members,
      sourceIds: [...new Set(members.flatMap(node => node.sourceIds))],
      modified: members.some(node => Boolean(doc.user.fields[node.id])) || members.length > 1,
      hasNotes: members.some(node => node.kind === 'note'),
    })
  }
  const visible = new Map(nodes.map(node => [node.id, node]))
  const removed = new Set(Object.values(doc.user.removedEdges).map(edge =>
    pair(canonicalId(doc, edge.from) ?? edge.from, canonicalId(doc, edge.to) ?? edge.to)))
  const edges = new Map<string, RenderEdge>()
  for (const edge of [...Object.values(doc.generated.edges), ...Object.values(doc.user.edges)]) {
    const from = canonicalId(doc, edge.from)
    const to = canonicalId(doc, edge.to)
    if (!from || !to || from === to || !visible.has(from) || !visible.has(to) || removed.has(pair(from, to))) continue
    const key = pair(from, to)
    const existing = edges.get(key)
    if (existing) {
      existing.memberIds.push(edge.id)
      existing.userCreated ||= Boolean(doc.user.edges[edge.id])
    } else {
      edges.set(key, {
        ...edge, from, to, memberIds: [edge.id],
        suggested: visible.get(from)?.kind === 'suggestion' || visible.get(to)?.kind === 'suggestion',
        userCreated: Boolean(doc.user.edges[edge.id]),
      })
    }
  }
  return { nodes, edges: [...edges.values()] }
}

function mapFor(doc: CanvasDocument, area: EditArea): Record<string, unknown> {
  return area === 'positions' ? doc.view.positions : doc.user[area]
}

function diff(before: CanvasDocument, after: CanvasDocument): HistoryPatch[] {
  const patches: HistoryPatch[] = []
  for (const area of areas) {
    const a = mapFor(before, area)
    const b = mapFor(after, area)
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        patches.push({ area, key, before: a[key] ?? null, after: b[key] ?? null })
      }
    }
  }
  return patches
}

export function execute(doc: CanvasDocument, command: Command): CanvasDocument {
  const next = structuredClone(doc)
  const graph = materialize(doc)
  const opId = newId('op')
  const at = new Date().toISOString()
  const find = (id: string) => {
    const canonical = canonicalId(doc, id)
    const node = graph.nodes.find(node => node.id === canonical)
    if (!node) throw new Error('节点不存在或已被删除。')
    return node
  }
  switch (command.type) {
    case 'edit': {
      const node = find(command.id)
      const title = command.title.trim()
      const summary = command.summary.trim()
      if (!title) throw new Error('标题不能为空。')
      if (title.length > 120 || summary.length > 500) throw new Error('标题或摘要过长。')
      const old = next.user.fields[node.id]
      const fields = { ...old, operationId: opId, updatedAt: at, baseRevision: doc.generated.revision }
      // Protect only fields the user actually changed.
      if (title !== node.title) fields.title = title
      if (summary !== node.summary) fields.summary = summary
      if (title === node.title && summary === node.summary) return doc
      next.user.fields[node.id] = fields
      break
    }
    case 'note': {
      if (!validId(command.id)) throw new Error('笔记 ID 无效。')
      if (next.generated.nodes[command.id] || next.user.notes[command.id] || next.user.tombstones[command.id]) {
        throw new Error('笔记 ID 已存在。')
      }
      const title = command.title.trim()
      if (!title) throw new Error('标题不能为空。')
      if (title.length > 120 || command.summary.trim().length > 500) throw new Error('标题或摘要过长。')
      next.user.notes[command.id] = {
        id: command.id, title, summary: command.summary.trim(), details: '', kind: 'note', sourceIds: [],
      }
      next.view.positions[command.id] = command.position
      break
    }
    case 'move': {
      const node = find(command.id)
      if (![command.position.x, command.position.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7)) throw new Error('位置无效。')
      next.view.positions[node.id] = { ...command.position, pinned: true }
      break
    }
    case 'arrange': {
      for (const [id, position] of Object.entries(command.positions)) {
        const node = find(id)
        if (![position.x, position.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7)) throw new Error('位置无效。')
        next.view.positions[node.id] = { x: position.x, y: position.y, pinned: true }
      }
      break
    }
    case 'connect': {
      if (!validId(command.id)) throw new Error('关系 ID 无效。')
      const from = find(command.from).id
      const to = find(command.to).id
      if (from === to) throw new Error('请选择另一个节点。')
      if (graph.edges.some(edge => pair(edge.from, edge.to) === pair(from, to))) return doc
      if (next.generated.edges[command.id] || next.user.edges[command.id]) throw new Error('关系 ID 已存在。')
      for (const [id, removed] of Object.entries(next.user.removedEdges)) {
        if (pair(canonicalId(next, removed.from) ?? removed.from, canonicalId(next, removed.to) ?? removed.to) === pair(from, to)) {
          delete next.user.removedEdges[id]
        }
      }
      next.user.edges[command.id] = { id: command.id, from, to, label: '关联' }
      break
    }
    case 'remove-edge': {
      const edge = graph.edges.find(edge => edge.id === command.id || edge.memberIds.includes(command.id))
      if (!edge) return doc
      next.user.removedEdges[edge.id] = {
        id: edge.id, from: edge.from, to: edge.to, memberIds: edge.memberIds, removedAt: at,
      }
      break
    }
    case 'merge': {
      const from = find(command.from)
      const target = find(command.into)
      if (from.id === target.id) throw new Error('请选择另一个节点。')
      next.user.aliases[from.id] = target.id
      next.user.fields[target.id] = {
        ...next.user.fields[target.id], title: target.title, summary: target.summary,
        operationId: opId, baseRevision: doc.generated.revision, updatedAt: at,
      }
      break
    }
    case 'delete': {
      const node = find(command.id)
      for (const member of node.members) {
        next.user.tombstones[member.id] = { id: member.id, sourceIds: member.sourceIds, deletedAt: at }
      }
      break
    }
  }
  const patches = diff(doc, next)
  if (!patches.length) return doc
  next.history.past.push({ id: opId, label: labels[command.type], baseRevision: doc.generated.revision, createdAt: at, patches })
  next.history.past = next.history.past.slice(-40)
  next.history.future = []
  cleanSelection(next)
  return next
}

function cleanSelection(doc: CanvasDocument) {
  const visible = new Set(materialize(doc).nodes.map(node => node.id))
  if (doc.view.selected) {
    const canonical = canonicalId(doc, doc.view.selected)
    doc.view.selected = canonical && visible.has(canonical) ? canonical : null
  }
  doc.view.expanded = [...new Set(doc.view.expanded.map(id => canonicalId(doc, id)).filter((id): id is string => Boolean(id && visible.has(id))))]
}

function restore(doc: CanvasDocument, entry: HistoryEntry, direction: 'before' | 'after') {
  for (const patch of entry.patches) {
    const map = mapFor(doc, patch.area)
    const value = patch[direction]
    if (value === null) delete map[patch.key]
    else map[patch.key] = structuredClone(value)
  }
  cleanSelection(doc)
}

export function undo(doc: CanvasDocument): CanvasDocument {
  if (!doc.history.past.length) return doc
  const next = structuredClone(doc)
  const entry = next.history.past.pop()!
  restore(next, entry, 'before')
  next.history.future.push(entry)
  return next
}

export function redo(doc: CanvasDocument): CanvasDocument {
  if (!doc.history.future.length) return doc
  const next = structuredClone(doc)
  const entry = next.history.future.pop()!
  restore(next, entry, 'after')
  next.history.past.push(entry)
  return next
}
