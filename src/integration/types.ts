import type { LiveCanvas } from '../core/live'
import type { CanvasEdge, CanvasNode, Conversation, Position } from '../core/types'

export interface CanvasRecord extends LiveCanvas {
  accessToken: string
  updates: Record<string, { digest: string; revision: number }>
}
export interface SourceQuote { messageId: string; quote: string; start?: number }
export interface ProposedNode extends Omit<CanvasNode, 'sourceIds' | 'kind'> {
  kind: 'discussion' | 'suggestion'
  sources: SourceQuote[]
  position?: Position
}
export interface GraphUpdate {
  schemaVersion: 1
  id: string
  canvasId: string
  sessionId: string
  baseRevision: number
  nodes: ProposedNode[]
  edges: CanvasEdge[]
}
export interface CapturedConversation {
  provider?: string
  threadId: string
  title: string
  cwd: string
  conversation: Conversation
}
export class CanvasError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'CanvasError' }
}
