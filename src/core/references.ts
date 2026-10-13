import { canonicalId, materialize } from './model'
import type { CanvasDocument, RenderNode } from './types'
import { validId } from './identifiers'
export { validId } from './identifiers'

export function referenceFor(canvasId: string, nodeId: string): string {
  if (!validId(canvasId) || !validId(nodeId)) throw new Error('引用 ID 无效。')
  return `mindweave://canvas/${canvasId}/node/${nodeId}`
}

export function parseReference(reference: string): { canvasId: string; nodeId: string } | null {
  try {
    const url = new URL(reference.trim())
    const path = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'mindweave:' || url.hostname !== 'canvas' || url.username || url.password ||
      url.port || url.search || url.hash || path.length !== 3 || path[1] !== 'node' ||
      url.pathname !== `/${path[0]}/node/${path[2]}` || !validId(path[0]) || !validId(path[2])) return null
    return { canvasId: path[0], nodeId: path[2] }
  } catch { return null }
}

export type ReferenceResult =
  | { status: 'found'; node: RenderNode; originalId: string; merged: boolean }
  | { status: 'invalid' | 'wrong-canvas' | 'deleted' | 'missing'; message: string }

export function resolveReference(doc: CanvasDocument, reference: string): ReferenceResult {
  const parsed = parseReference(reference)
  if (!parsed) return { status: 'invalid', message: '请输入完整的 mindweave://canvas/…/node/… 引用。' }
  if (parsed.canvasId !== doc.id) return { status: 'wrong-canvas', message: `引用属于另一张画布：${parsed.canvasId}。请打开对应画布。` }
  const id = canonicalId(doc, parsed.nodeId)
  if (doc.user.tombstones[parsed.nodeId] || (id && doc.user.tombstones[id])) {
    return { status: 'deleted', message: '此节点已删除。撤销删除后可重新定位。' }
  }
  const node = materialize(doc).nodes.find(node => node.id === id)
  if (!node) return { status: 'missing', message: '当前画布中没有这个节点。' }
  return { status: 'found', node, originalId: parsed.nodeId, merged: node.id !== parsed.nodeId }
}
