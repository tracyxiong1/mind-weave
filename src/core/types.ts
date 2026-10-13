export type NodeKind = 'discussion' | 'suggestion' | 'note'
export type Theme = 'system' | 'light' | 'dark'
export interface CanvasNode {
  id: string
  title: string
  summary: string
  details: string
  kind: NodeKind
  sourceIds: string[]
}
export interface CanvasEdge {
  id: string
  from: string
  to: string
  label: string
}
export interface Position { x: number; y: number; pinned: boolean }
export interface Viewport { x: number; y: number; zoom: number }
export interface FieldEdit {
  title?: string
  summary?: string
  operationId: string
  baseRevision: number
  updatedAt: string
}
export interface Tombstone { id: string; sourceIds: string[]; deletedAt: string }
export interface RemovedRelation {
  id: string
  from: string
  to: string
  memberIds: string[]
  removedAt: string
}
export interface UserState {
  fields: Record<string, FieldEdit>
  notes: Record<string, CanvasNode>
  edges: Record<string, CanvasEdge>
  removedEdges: Record<string, RemovedRelation>
  tombstones: Record<string, Tombstone>
  aliases: Record<string, string>
}
export type EditArea = keyof UserState | 'positions'
export interface HistoryPatch {
  area: EditArea
  key: string
  before: unknown | null
  after: unknown | null
}
export interface HistoryEntry {
  id: string
  label: string
  baseRevision: number
  createdAt: string
  patches: HistoryPatch[]
}
export interface CanvasDocument {
  schemaVersion: 1
  id: string
  sessionId: string
  generated: {
    revision: number
    nodes: Record<string, CanvasNode>
    edges: Record<string, CanvasEdge>
  }
  user: UserState
  view: {
    positions: Record<string, Position>
    expanded: string[]
    selected: string | null
    viewport: Viewport | null
    theme: Theme
  }
  history: { past: HistoryEntry[]; future: HistoryEntry[] }
}
export interface RenderNode extends CanvasNode {
  members: CanvasNode[]
  modified: boolean
  hasNotes: boolean
}
export interface RenderEdge extends CanvasEdge {
  memberIds: string[]
  suggested: boolean
  userCreated: boolean
}
export interface Message { id: string; role: 'user' | 'assistant'; text: string }
export interface Conversation { sessionId: string; title: string; messages: Message[] }
export interface Source {
  id: string
  sessionId: string
  messageId: string
  start: number
  end: number
}
export interface Sample {
  id: string
  canvasId: string
  sessionId: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  positions: Record<string, Position>
  sources: Source[]
}
export type Command =
  | { type: 'edit'; id: string; title: string; summary: string }
  | { type: 'note'; id: string; title: string; summary: string; position: Position }
  | { type: 'move'; id: string; position: Position }
  | { type: 'connect'; id: string; from: string; to: string }
  | { type: 'remove-edge'; id: string }
  | { type: 'merge'; from: string; into: string }
  | { type: 'delete'; id: string }
