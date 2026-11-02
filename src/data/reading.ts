import { samples } from './samples'
import type { CanvasDocument, Sample } from '../core/types'

// Keep example details focused on what the supplied conversation says.
const details: Record<string, string> = {
  context: '把发散的对话整理成可修改的画布，回看时能找到最初的思路，也能回到某条支线。',
  comparison: '思维导图通过层级梳理内容；会话画布通过连线表达内容之间的关联。背景信息也可以作为普通的折叠节点保留。',
  structure: '树状层级适合沿一条支线展开内容；自由连线用于连接跨主题的共同概念。',
  'two-views': '不按每条消息分别建节点。先沿分支展开同一段对话，再把共同主题连起来。',
  relations: '只保留有助于回忆的关系，例如比较、因果、依赖和共同概念，避免画布被连线填满。',
  mixing: '这个问题尚未展开，暂无讨论内容。',
}

export const readingSample: Sample = {
  ...samples.branches,
  nodes: samples.branches.nodes.map(node => ({ ...node, details: details[node.id] })),
}

/** Refresh only known example copy, including the fixture update's suffix.
 * User edits, generated additions, positions, aliases and history stay intact. */
export function refreshSampleDetails(document: CanvasDocument): CanvasDocument {
  if (document.id !== readingSample.canvasId || document.sessionId !== readingSample.sessionId) return document
  const nodes = { ...document.generated.nodes }
  let changed = false
  for (const original of samples.branches.nodes) {
    const node = nodes[original.id]
    if (!node || node.kind !== original.kind || !node.details.startsWith(original.details)) continue
    const suffix = node.details.slice(original.details.length)
    if (!/^(?:\n增量验证 v[1-9]\d*)*$/.test(suffix)) continue
    nodes[node.id] = { ...node, details: details[node.id] + suffix }
    changed = true
  }
  return changed ? { ...document, generated: { ...document.generated, nodes } } : document
}
