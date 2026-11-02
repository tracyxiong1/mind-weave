import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type FocusEvent } from 'react'
import { createDocument, execute, materialize, newId, redo, undo } from './core/model'
import { saveDocument, storageKey, type StoragePort } from './core/persistence'
import { referenceFor, resolveReference } from './core/references'
import { edgePath, fitView, NODE_WIDTH, zoomAt, type Size } from './core/geometry'
import { DEFAULT_NODE_HEIGHT, freePosition, layoutNodes } from './core/layout'
import { arrangeBranches, CANVAS_ROOT_ID, positionsWithRoot, readingForest } from './core/branches'
import type { CanvasDocument, Command, Conversation, Position, RenderNode, Sample, Viewport } from './core/types'
import type { LiveCanvas } from './core/live'
import { LiveCanvasClient, restoreLiveDraft } from './core/live-client'
import { Dialog } from './components/Dialog'
import { Icon, IconButton } from './components/Icon'
import { NodeCard, type NodeAction } from './components/NodeCard'
import { CanvasRoot } from './components/CanvasRoot'
import { ExcalidrawSurface } from './canvas/ExcalidrawSurface'
import type { SceneBox, SceneEdge } from './canvas/scene'
import { loadSampleDraft } from './data/drafts'

const storage: StoragePort = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
}
type Panel =
  | { type: 'help' }
  | { type: 'resolve' }
  | { type: 'copy'; reference: string }
  | { type: 'note'; parent?: string }
  | { type: 'target'; operation: 'connect' | 'merge'; nodeId: string }
  | { type: 'relations'; nodeId: string }
  | { type: 'edge'; edgeId: string }
type Gesture =
  | { type: 'node'; pointerId: number; x: number; y: number; id: string; position: Position; positions: Record<string, Position>; zoom: number; moved: boolean }
  | { type: 'pan'; pointerId: number; x: number; y: number; viewport: Viewport; moved: boolean }
type CanvasKey = Pick<globalThis.KeyboardEvent, 'target' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'>

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CanvasApp({ sample, conversation, live }: { sample: Sample; conversation?: Conversation; live?: LiveCanvas }) {
  const [initial] = useState(() => live ? { ...restoreLiveDraft(storage, live), sample } : loadSampleDraft(storage, sample, conversation))
  const [sourceData, setSourceData] = useState({ sample: initial.sample, conversation })
  const [doc, setDoc] = useState(initial.document)
  const docRef = useRef(doc)
  docRef.current = doc
  const [blocked, setBlocked] = useState(Boolean(initial.problem))
  const [saveProblem, setSaveProblem] = useState<string | null>(initial.problem)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [showAllRelations, setShowAllRelations] = useState(false)
  const [closed, setClosed] = useState(false)
  const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>(() => initial.document.view.theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : initial.document.view.theme)
  const surfaceInteracting = useRef(false)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [size, setSize] = useState<Size>({ width: window.innerWidth, height: window.innerHeight })
  const [drag, setDrag] = useState<{ id: string; position: Position; positions: Record<string, Position> } | null>(null)
  const [toast, setToast] = useState('')
  const canvasRef = useRef<HTMLElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const draggedClick = useRef<string | null>(null)
  const pannedEdge = useRef(false)
  const liveClient = useRef<LiveCanvasClient | null>(null)
  const interaction = useRef({ blocked, panel, editing })
  interaction.current = { blocked, panel, editing }
  const graph = useMemo(() => materialize(doc), [doc.generated, doc.user])
  const forest = useMemo(() => readingForest(graph.nodes, graph.edges), [graph])
  const relatedIds = useMemo(() => {
    if (!doc.view.selected) return null
    return new Set([doc.view.selected, ...graph.edges.filter(edge => edge.from === doc.view.selected || edge.to === doc.view.selected)
      .flatMap(edge => [edge.from, edge.to])])
  }, [doc.view.selected, graph.edges])
  const layout = useMemo(() => layoutNodes(graph.nodes.map(node => node.id), doc.view.positions, heights), [graph.nodes, doc.view.positions, heights])
  const displayPositions = useMemo(() => positionsWithRoot(forest, drag ? { ...drag.positions, [drag.id]: drag.position } : layout, heights), [forest, drag, layout, heights])
  const canvasRoot = displayPositions[CANVAS_ROOT_ID]
  const canvasTitle = (sourceData.conversation?.title ?? live?.connection.title ?? '').replace(/^\d{4}｜[^｜]+｜/, '').trim() || '会话总览'
  const emphasizedId = useMemo(() => {
    // A structural reading anchor, rather than an inferred importance score.
    const degrees = new Map<string, number>()
    for (const edge of graph.edges.filter(edge => !edge.suggested)) {
      for (const id of [edge.from, edge.to]) degrees.set(id, (degrees.get(id) ?? 0) + 1)
    }
    return graph.nodes.filter(node => node.kind === 'discussion' && (degrees.get(node.id) ?? 0) >= 2)
      .sort((a, b) => degrees.get(b.id)! - degrees.get(a.id)! || a.id.localeCompare(b.id))[0]?.id
  }, [graph])
  // Restoring a document briefly clears its viewport before fit() runs. Keep
  // the last visible view until that fit is ready, rather than echoing a reset
  // through the native editor and back into the document being restored.
  const lastView = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const view = doc.view.viewport ?? lastView.current
  lastView.current = view
  const positionFor = (id: string): Position => displayPositions[id]
  function vacantPosition(id: string, desired: Position, positions = displayPositions, height = heights[id] ?? DEFAULT_NODE_HEIGHT) {
    return freePosition(desired, height, Object.entries(positions).filter(([other]) => other !== id)
      .map(([other, position]) => ({ position, height: heights[other] ?? DEFAULT_NODE_HEIGHT })))
  }

  useEffect(() => {
    if (!live) return
    const client = new LiveCanvasClient(live, {
      storage, getDocument: () => docRef.current, problem: setSaveProblem,
      receive: record => {
        docRef.current = record.document; setDoc(record.document)
        setSourceData({ sample: record.sample, conversation: record.conversation })
      },
      interacting: () => Boolean(interaction.current.blocked || interaction.current.panel || interaction.current.editing || gesture.current || surfaceInteracting.current),
    })
    liveClient.current = client
    const poll = setInterval(() => { void client.poll() }, 2500)
    return () => { clearInterval(poll); client.dispose(); liveClient.current = null }
  }, [live])
  useEffect(() => {
    if (blocked) return
    if (live) { liveClient.current?.documentChanged(); return }
    const result = saveDocument(storage, doc)
    setSaveProblem(result.ok ? null : result.message)
  }, [doc, blocked, live])
  useEffect(() => {
    const save = () => { if (!blocked) { if (live) liveClient.current?.pagehide(); else saveDocument(storage, docRef.current) } }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [blocked, live])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = doc.view.theme === 'system' ? media.matches ? 'dark' : 'light' : doc.view.theme
      setEditorTheme(theme)
      document.documentElement.dataset.theme = theme
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191919' : '#f8f8f7')
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [doc.view.theme])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    if (closed || !canvasRef.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [closed])
  const measure = useCallback((id: string, height: number) => {
    setHeights(old => old[id] === height ? old : { ...old, [id]: height })
  }, [])
  useEffect(() => {
    const cancel = () => { gesture.current = null; setDrag(null) }
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [])
  const fit = useCallback(() => {
    setDoc(current => {
      const { nodes, edges } = materialize(current)
      const positions = positionsWithRoot(readingForest(nodes, edges), layoutNodes(nodes.map(node => node.id), current.view.positions, heights), heights)
      const ids = Object.keys(positions)
      const viewport = fitView(ids.map(id => positions[id]), ids.map(id => heights[id] ?? DEFAULT_NODE_HEIGHT), size)
      return { ...current, view: { ...current.view, viewport } }
    })
  }, [heights, size])
  useEffect(() => { if (!doc.view.viewport && !closed) fit() }, [doc.view.viewport, closed, fit])
  const changeView = useCallback((update: (view: CanvasDocument['view']) => CanvasDocument['view']) => {
    setDoc(current => ({ ...current, view: update(current.view) }))
  }, [])
  const run = useCallback((command: Command) => {
    try {
      const next = execute(docRef.current, command)
      docRef.current = next
      setDoc(next)
      return true
    } catch (error) { setToast(error instanceof Error ? error.message : '操作未完成。'); return false }
  }, [])
  function arrange() {
    const current = docRef.current
    const currentGraph = materialize(current)
    const currentForest = readingForest(currentGraph.nodes, currentGraph.edges)
    const positions = arrangeBranches(currentForest, heights)
    if (!run({ type: 'arrange', positions })) return
    const viewPositions = positionsWithRoot(currentForest, positions, heights)
    const ids = Object.keys(viewPositions)
    const viewport = fitView(ids.map(id => viewPositions[id]), ids.map(id => heights[id] ?? DEFAULT_NODE_HEIGHT), size)
    changeView(view => ({ ...view, selected: null, viewport }))
    setToast('已按分支整理布局，可一步撤销。')
  }
  const focusNode = useCallback((node: RenderNode) => {
    const current = docRef.current
    const position = layoutNodes(materialize(current).nodes.map(node => node.id), current.view.positions, heights)[node.id]
    const zoom = size.width < 700 ? 0.95 : Math.max(0.85, current.view.viewport?.zoom ?? 1)
    changeView(view => ({
      ...view, selected: node.id, expanded: [...new Set([...view.expanded, node.id])],
      viewport: { zoom, x: (size.width - NODE_WIDTH * zoom) / 2 - position.x * zoom, y: 86 - position.y * zoom },
    }))
    requestAnimationFrame(() => document.getElementById(`node-${node.id}`)?.focus({ preventScroll: true }))
  }, [changeView, size, heights])
  const resolve = useCallback((reference: string) => {
    const result = resolveReference(docRef.current, reference)
    if (result.status !== 'found') return result.message
    focusNode(result.node)
    setToast(result.merged ? '已定位到合并后的节点，旧引用仍然有效。' : '已定位到引用节点。')
    return null
  }, [focusNode])
  const hashHandled = useRef(false)
  useEffect(() => {
    const handle = () => {
      const reference = new URLSearchParams(window.location.hash.slice(1)).get('ref')
      if (reference) { const error = resolve(reference); if (error) setToast(error) }
    }
    if (!hashHandled.current && doc.view.viewport) { handle(); hashHandled.current = true }
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [resolve, doc.view.viewport])
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.context-menu, .more-button')) setMenu(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const handleShortcut = useCallback((event: CanvasKey) => {
    if (!panel && editing && event.key === 'Escape') {
      setEditing(null)
      requestAnimationFrame(() => document.getElementById(`node-${editing}`)?.focus({ preventScroll: true }))
      return
    }
    if ((event.target as HTMLElement).closest('input, textarea, dialog') || panel || editing) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); setPanel({ type: 'resolve' })
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); setDoc(current => event.shiftKey ? redo(current) : undo(current))
    }
    if (event.key === 'Escape') { setMenu(null); setEditing(null); changeView(view => ({ ...view, selected: null })) }
  }, [panel, editing, changeView])
  useEffect(() => {
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [handleShortcut])
  function panKey(event: CanvasKey) {
    const delta: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }
    if (!delta[event.key]) return false
    event.preventDefault()
    const [x, y] = delta[event.key]
    changeView(state => ({ ...state, viewport: { ...view, x: view.x + x, y: view.y + y } }))
    return true
  }

  function startNodeDrag(event: PointerEvent<HTMLElement>, node: RenderNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, details, .node-details, .context-menu')) return
    event.stopPropagation()
    draggedClick.current = null
    changeView(view => ({ ...view, selected: node.id }))
    if (editing) return
    gesture.current = { type: 'node', pointerId: event.pointerId, x: event.clientX, y: event.clientY, id: node.id, position: positionFor(node.id), positions: displayPositions, zoom: view.zoom, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function movePointer(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (Math.hypot(dx, dy) > 3 || active.moved) {
      active.moved = true
      if (active.type === 'pan') {
        changeView(state => ({ ...state, viewport: { ...active.viewport, x: active.viewport.x + dx, y: active.viewport.y + dy } }))
        return
      }
      const desired = { x: active.position.x + dx / active.zoom, y: active.position.y + dy / active.zoom, pinned: true }
      setDrag({ id: active.id, position: vacantPosition(active.id, desired, active.positions), positions: active.positions })
    }
  }
  function endPointer(event: PointerEvent<HTMLElement>, cancelled = false) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    if (active.type === 'pan') pannedEdge.current = active.moved || cancelled
    else if (active.moved) draggedClick.current = active.id
    if (active.type === 'node' && active.moved && !cancelled) {
      const desired = { x: active.position.x + (event.clientX - active.x) / active.zoom, y: active.position.y + (event.clientY - active.y) / active.zoom, pinned: true }
      run({ type: 'move', id: active.id, position: vacantPosition(active.id, desired, active.positions) })
    }
    gesture.current = null; setDrag(null)
  }
  function toggleExpanded(node: RenderNode) {
    changeView(state => ({ ...state, selected: node.id, expanded: state.expanded.includes(node.id) ? state.expanded.filter(id => id !== node.id) : [...state.expanded, node.id] }))
  }
  function finishEditing(id: string) {
    setEditing(null)
    requestAnimationFrame(() => document.getElementById(`node-${id}`)?.focus({ preventScroll: true }))
  }
  function keepFocusVisible(event: FocusEvent<HTMLElement>) {
    // Node focus may reveal an off-screen branch. Focusing an inner button must
    // not move the button between pointer-down and click.
    if (event.target !== event.currentTarget || !event.target.matches(':focus-visible')) return
    const rect = event.target.getBoundingClientRect()
    const x = rect.left < 16 ? 16 - rect.left : rect.right > size.width - 16 ? size.width - 16 - rect.right : 0
    const y = rect.top < 76 ? 76 - rect.top : rect.bottom > size.height - 76 ? size.height - 76 - rect.bottom : 0
    if (x || y) changeView(state => {
      const viewport = state.viewport ?? view
      return { ...state, viewport: { ...viewport, x: viewport.x + x, y: viewport.y + y } }
    })
  }
  function nodeKey(event: KeyboardEvent<HTMLElement>, node: RenderNode) {
    if ((event.target as HTMLElement).closest('input, textarea')) {
      if (event.key === 'Escape') { event.stopPropagation(); finishEditing(node.id) }
      return
    }
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') { event.preventDefault(); toggleExpanded(node) }
    if (event.key === 'F2') { event.preventDefault(); setEditing(node.id) }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); run({ type: 'delete', id: node.id }) }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (directions[event.key] && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); const [dx, dy] = directions[event.key]; const position = positionFor(node.id)
      const desired = { ...position, x: position.x + dx * (event.shiftKey ? 40 : 10), y: position.y + dy * (event.shiftKey ? 40 : 10), pinned: true }
      run({ type: 'move', id: node.id, position: vacantPosition(node.id, desired) })
    }
  }
  function action(node: RenderNode, action: NodeAction) {
    setMenu(null)
    if (action === 'edit') setEditing(node.id)
    if (action === 'note') setPanel({ type: 'note', parent: node.id })
    if (action === 'connect' || action === 'merge') setPanel({ type: 'target', operation: action, nodeId: node.id })
    if (action === 'relations') setPanel({ type: 'relations', nodeId: node.id })
    if (action === 'delete' && run({ type: 'delete', id: node.id })) setToast('节点已删除，可撤销。')
  }
  async function copy(node: RenderNode) {
    const reference = referenceFor(doc.id, node.id)
    try { await navigator.clipboard.writeText(reference); setToast('稳定引用已复制。可用“定位引用”在此画布中解析。') }
    catch { setPanel({ type: 'copy', reference }) }
  }
  function zoom(factor: number) {
    changeView(state => ({ ...state, viewport: zoomAt(state.viewport ?? view, factor, { x: size.width / 2, y: size.height / 2 }) }))
  }
  const themeLabel = { system: '跟随系统', light: '浅色', dark: '深色' }[doc.view.theme]
  const exportCanvas = () => download(JSON.stringify(live
    ? { schemaVersion: 1, document: doc, conversation: sourceData.conversation, sources: sourceData.sample.sources, connection: live.connection }
    : doc, null, 2), `${doc.id}.json`)

  const sceneBoxes: SceneBox[] = useMemo(() => Object.entries(displayPositions).map(([id, position]) => ({ id, position, height: heights[id] ?? DEFAULT_NODE_HEIGHT })), [displayPositions, heights])
  const sceneEdges: SceneEdge[] = useMemo(() => [
    // @ is outside the business-ID alphabet, so virtual and saved edges cannot collide.
    ...(canvasRoot ? forest.roots.map(id => ({ id: `@root-${id}`, visible: true,
      path: edgePath(canvasRoot, heights[CANVAS_ROOT_ID] ?? DEFAULT_NODE_HEIGHT, positionFor(id), heights[id] ?? DEFAULT_NODE_HEIGHT),
      suggested: graph.nodes.find(node => node.id === id)?.kind === 'suggestion', muted: Boolean(relatedIds) })) : []),
    ...graph.edges.map(edge => ({ id: edge.id,
      path: edgePath(positionFor(edge.from), heights[edge.from] ?? DEFAULT_NODE_HEIGHT, positionFor(edge.to), heights[edge.to] ?? DEFAULT_NODE_HEIGHT,
        graph.nodes.filter(node => node.id !== edge.from && node.id !== edge.to).map(node => ({ position: positionFor(node.id), height: heights[node.id] ?? DEFAULT_NODE_HEIGHT }))),
      visible: forest.edgeIds.has(edge.id) || edge.userCreated || showAllRelations || edge.from === doc.view.selected || edge.to === doc.view.selected,
      suggested: edge.suggested, secondary: !forest.edgeIds.has(edge.id),
      focused: edge.from === doc.view.selected || edge.to === doc.view.selected,
      muted: Boolean(relatedIds && edge.from !== doc.view.selected && edge.to !== doc.view.selected),
    })),
  ], [canvasRoot, forest, heights, graph, displayPositions, doc.view.selected, showAllRelations, relatedIds])
  const paths = useMemo(() => new Map(sceneEdges.map(edge => [edge.id, edge.path])), [sceneEdges])

  return <>
    {closed ? <div className="closed-preview"><span>Mindweave</span><button type="button" onClick={() => setClosed(false)}>打开画布</button></div> : <main ref={canvasRef} className="canvas" aria-label="会话画布" tabIndex={0}
      onPointerMove={movePointer} onPointerUp={event => endPointer(event)} onPointerCancel={event => endPointer(event, true)}
      onLostPointerCapture={event => endPointer(event, true)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        panKey(event)
      }}>
      <ExcalidrawSurface boxes={sceneBoxes}
        edges={sceneEdges} viewport={view} theme={editorTheme} paused={Boolean(panel) || !doc.view.viewport}
        onViewport={viewport => changeView(state => ({ ...state, viewport }))}
        onInteraction={active => { surfaceInteracting.current = active }}
        onCanvasKeyDown={event => { if (!panKey(event)) handleShortcut(event) }}
        onClearSelection={() => { changeView(state => ({ ...state, selected: null })); setMenu(null) }}>
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="edges" width="1" height="1" aria-label="节点关系">
          {canvasRoot && forest.roots.map(id => <g key={`root-${id}`} data-root-edge={id} aria-hidden="true"
            className={`${relatedIds ? 'muted-edge' : ''} ${graph.nodes.find(node => node.id === id)?.kind === 'suggestion' ? 'suggested-edge' : ''}`}>
            <path className="edge-line" d={edgePath(canvasRoot, heights[CANVAS_ROOT_ID] ?? DEFAULT_NODE_HEIGHT, positionFor(id), heights[id] ?? DEFAULT_NODE_HEIGHT)} />
          </g>)}
          {graph.edges.map(edge => {
            const path = paths.get(edge.id)!
            const fromTitle = graph.nodes.find(node => node.id === edge.from)?.title
            const toTitle = graph.nodes.find(node => node.id === edge.to)?.title
            const primary = forest.edgeIds.has(edge.id)
            const related = edge.from === doc.view.selected || edge.to === doc.view.selected
            const visible = primary || edge.userCreated || showAllRelations || related
            return <g key={edge.id} data-edge={edge.id} data-testid={`edge-${edge.id}`}
              className={`${edge.suggested ? 'suggested-edge' : ''} ${primary ? '' : 'secondary-edge'} ${related ? 'focused-edge' : relatedIds ? 'muted-edge' : ''} ${visible ? '' : 'hidden-edge'}`}>
              <title>{`${fromTitle} → ${toTitle}：${edge.label}`}</title>
              <path className="edge-line" d={path} />
              <path className="edge-hit" d={path} tabIndex={-1} role="button" aria-label={`关系：${fromTitle} → ${toTitle}`}
                onPointerDown={event => {
                  if (event.button !== 0) return
                  event.stopPropagation(); pannedEdge.current = false
                  gesture.current = { type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport: view, moved: false }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onClick={event => { event.stopPropagation(); if (pannedEdge.current) { pannedEdge.current = false; return }; setPanel({ type: 'edge', edgeId: edge.id }) }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPanel({ type: 'edge', edgeId: edge.id }) } }} />
            </g>
          })}
        </svg>
        {canvasRoot && <CanvasRoot title={canvasTitle} position={canvasRoot} onMeasure={measure} />}
        {graph.nodes.map(node => <NodeCard key={node.id} node={node} sample={sourceData.sample} conversation={sourceData.conversation} live={Boolean(live)} position={positionFor(node.id)} emphasized={!canvasRoot && node.id === emphasizedId}
          selected={doc.view.selected === node.id} unrelated={Boolean(relatedIds && !relatedIds.has(node.id))} expanded={doc.view.expanded.includes(node.id)} editing={editing === node.id} menuOpen={menu === node.id} showSources={sources.includes(node.id)}
          onSelect={() => changeView(state => ({ ...state, selected: node.id }))} onExpand={() => toggleExpanded(node)}
          onActivate={() => { if (draggedClick.current === node.id) { draggedClick.current = null; return }; toggleExpanded(node) }}
          onEdit={() => { changeView(state => ({ ...state, expanded: [...new Set([...state.expanded, node.id])] })); setEditing(node.id); setMenu(null) }} onSave={(title, summary) => { if (run({ type: 'edit', id: node.id, title, summary })) finishEditing(node.id) }} onCancel={() => finishEditing(node.id)}
          onMenu={() => { changeView(state => ({ ...state, selected: node.id })); setMenu(menu === node.id ? null : node.id) }} onAction={selectedAction => action(node, selectedAction)}
          onCopy={() => void copy(node)} onSources={() => setSources(old => old.includes(node.id) ? old.filter(id => id !== node.id) : [...old, node.id])}
          onDrag={event => startNodeDrag(event, node)} onKey={event => nodeKey(event, node)} onFocus={keepFocusVisible} onMeasure={measure} />)}
      </div>
      </ExcalidrawSurface>
      {!graph.nodes.length && <div className="empty-state"><p>画布为空</p><button onClick={() => setPanel({ type: 'note' })}>新增笔记</button><button onClick={() => setDoc(undo)}>撤销删除</button></div>}
      <div className="toolbar top-controls" aria-label="画布操作">
        <IconButton icon="note" label="新增笔记" onClick={() => setPanel({ type: 'note' })} />
        <IconButton icon="search" label="定位引用" title="查找节点或定位引用（Ctrl / ⌘ + K）" onClick={() => setPanel({ type: 'resolve' })} />
        <IconButton icon="arrange" label="整理布局" title="按分支整理布局（可撤销）" onClick={arrange} disabled={!graph.nodes.length || Boolean(editing)} />
        <IconButton icon="relations" label="显示全部关联" title={showAllRelations ? '收起补充关联' : '显示全部关联'} aria-pressed={showAllRelations}
          onClick={() => setShowAllRelations(value => !value)} disabled={!graph.edges.length} />
        <IconButton icon={doc.view.theme === 'system' ? 'system' : doc.view.theme === 'light' ? 'sun' : 'moon'} label={`主题：${themeLabel}`}
          onClick={() => changeView(state => ({ ...state, theme: state.theme === 'system' ? 'light' : state.theme === 'light' ? 'dark' : 'system' }))} />
        <IconButton icon="help" label="使用说明与保存" onClick={() => setPanel({ type: 'help' })} />
        <span className="control-divider" />
        <IconButton icon="close" label="关闭预览" onClick={() => { setClosed(true); setMenu(null); setEditing(null) }} />
      </div>
      <div className="toolbar zoom-controls" aria-label="视图控制">
        <IconButton icon="minus" label="缩小" onClick={() => zoom(1 / 1.2)} disabled={view.zoom <= 0.3} />
        <IconButton icon="fit" label="适应画布" onClick={fit} />
        <button className="zoom-value" aria-label="恢复 100% 缩放" title="恢复 100% 缩放" onClick={() => zoom(1 / view.zoom)}>{Math.round(view.zoom * 100)}%</button>
        <IconButton icon="plus" label="放大" onClick={() => zoom(1.2)} disabled={view.zoom >= 2} />
        <span className="control-divider" />
        <IconButton icon="undo" label={`撤销${doc.history.past.at(-1)?.label ?? ''}`} disabled={!doc.history.past.length} onClick={() => setDoc(undo)} />
        <IconButton icon="redo" label={`重做${doc.history.future.at(-1)?.label ?? ''}`} disabled={!doc.history.future.length} onClick={() => setDoc(redo)} />
      </div>
      {saveProblem && <div className="save-warning" role="alert"><span>{saveProblem}</span><button onClick={() => setPanel({ type: 'help' })}>查看保存选项</button></div>}
    </main>}
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    {panel && <Dialog key={panel.type} title={panel.type === 'help' ? '使用说明与保存' : panel.type === 'resolve' ? '查找节点与引用' : panel.type === 'copy' ? '复制稳定引用' : panel.type === 'note' ? '新增用户笔记' : panel.type === 'target' ? panel.operation === 'merge' ? '合并节点' : '建立关系' : '节点关系'} onClose={() => setPanel(null)}>
      {panel.type === 'help' && <div className="help-content">
        <p>在画布中回看和修正思路。选中节点不会发送消息；继续交流仍在原 agent 对话里。</p>
        <p>多个主题分支统一从会话主题根节点展开；已有单一根节点的画布直接沿用。整理布局后，根节点位于最左侧，一级分支对齐排列。</p>
        <p>默认沿分支显示连线。选中节点可查看它的全部直接关联，其余内容淡化；点击空白或按 Esc 返回总览。右上角“显示全部关联”可展开补充连线，“管理关系”始终列出完整关系。主干仅用于阅读，不改变已保存的关系。</p>
        <p>“整理布局”将当前节点按分支从左到右重新排列，并适应画布；包括手动移动过的节点，可一步撤销恢复原来的位置。</p>
        <dl className="shortcuts"><dt>阅读</dt><dd>点击标题、卡片空白或箭头展开，查看原文或复制引用。展开与折叠保持当前视角。连接较多的讨论节点略作强调，支线摘要展开后显示。</dd><dt>编辑</dt><dd>双击节点，或聚焦后按 F2。</dd><dt>移动</dt><dd>拖动节点；Ctrl / ⌘ + 方向键移动 10 像素，配合 Shift 移动 40 像素。重叠时就近避让；展开详情会临时推开相邻节点，折叠后回到保存的位置。</dd><dt>平移 / 缩放</dt><dd>拖动空白、滚动或方向键平移；长详情内滚动阅读。Ctrl / ⌘ + 滚轮缩放，也可用左下角按钮；点击百分比恢复 100%。</dd><dt>撤销 / 重做</dt><dd>Ctrl / ⌘ + Z；配合 Shift 重做。保留最近 40 步。</dd><dt>键盘</dt><dd>Tab 切换焦点，Enter 展开，Delete 删除；Esc 取消编辑或关闭菜单。</dd></dl>
        <h3>{live ? '已连接会话画布' : '保存在此浏览器'}</h3>
        {live ? <><p>{sourceData.conversation?.title ?? live.connection.title}</p><p>人工编辑、位置和主题保存在运行 Mindweave 的机器上，可通过稳定引用读取最新内容。浏览器同时保留未保存草稿。新的整理会保留人工修改，并在空闲时更新画布。</p></>
          : <p>画布、人工修改、位置、视口和主题自动保存在当前地址的 localStorage。关闭或刷新后仍可恢复；不同浏览器、设备、域名或端口之间不共享，清理站点数据会删除保存内容。</p>}
        <code className="storage-key">{live ? `.mindweave/canvases/${doc.id}.json` : storageKey(doc.id)}</code>
        {saveProblem && <p className="error-text">{saveProblem}</p>}
        <div className="form-actions wrap"><button onClick={exportCanvas}><Icon name="download" />导出当前画布</button>
          {blocked && initial.original && <button onClick={() => download(initial.original!, `${doc.id}.recovery.json`)}>下载原始数据</button>}
          {live && (blocked || saveProblem) ? <button onClick={() => {
            exportCanvas()
            void liveClient.current?.reload().then(() => { setBlocked(false); setPanel(null) }).catch(error => setSaveProblem(error instanceof Error ? error.message : '载入失败，草稿已保留。'))
          }}>备份并载入最新画布</button> : blocked && <button onClick={() => { setDoc(createDocument(sample)); setBlocked(false); setSaveProblem(null); setPanel(null) }}>用示例覆盖本地数据</button>}
          {!blocked && saveProblem && <button onClick={() => { if (live) { setPanel(null); liveClient.current?.retry() } else setDoc(current => ({ ...current })) }}>重试保存</button>}
        </div>
        <h3>三个内置样例</h3><div className="sample-links"><a href="?sample=branches">多次分叉</a><a href="?sample=learning">学习型</a><a href="?sample=planning">方案讨论型</a></div>
        <p className="muted">{live ? '当前画布来自导入的会话文本。整理由 Mindweave skill 手动触发；引用也由该 skill 读取。' : '当前展示内置样例。使用 Mindweave skill 整理当前会话后，可以打开对应画布。'}</p>
      </div>}
      {panel.type === 'resolve' && <ReferenceForm nodes={graph.nodes} onSelect={node => { focusNode(node); setPanel(null) }}
        onResolve={reference => { const error = resolve(reference); if (!error) setPanel(null); return error }} />}
      {panel.type === 'copy' && <><p>选中下面的引用，按 Ctrl / ⌘ + C 复制。</p><textarea className="reference-input" aria-label="稳定引用" readOnly value={panel.reference} autoFocus onFocus={event => event.target.select()} /></>}
      {panel.type === 'note' && <NoteForm onSave={(title, summary) => {
        const id = newId('note')
        const parentPosition = panel.parent && positionFor(panel.parent)
        const desired: Position = parentPosition ? { x: parentPosition.x + 370, y: parentPosition.y + 140, pinned: true } : { x: (size.width / 2 - view.x) / view.zoom - NODE_WIDTH / 2, y: (size.height / 2 - view.y) / view.zoom - 50, pinned: true }
        const position = vacantPosition(id, desired)
        if (run({ type: 'note', id, title, summary, position })) { setPanel(null); const node = materialize(docRef.current).nodes.find(node => node.id === id); if (node) focusNode(node) }
      }} />}
      {panel.type === 'target' && <TargetForm operation={panel.operation} nodes={graph.nodes.filter(node => node.id !== panel.nodeId)} onSave={target => {
        const ok = panel.operation === 'merge' ? run({ type: 'merge', from: panel.nodeId, into: target }) : run({ type: 'connect', id: newId('edge'), from: panel.nodeId, to: target })
        if (ok) { setPanel(null); setToast(panel.operation === 'merge' ? '已合并，旧引用和来源已保留。' : '关系已建立。'); if (panel.operation === 'merge') { const node = materialize(docRef.current).nodes.find(node => node.id === target); if (node) focusNode(node) } }
      }} />}
      {(panel.type === 'relations' || panel.type === 'edge') && <div className="relation-list">
        {graph.edges.filter(edge => panel.type === 'edge' ? edge.id === panel.edgeId : edge.from === panel.nodeId || edge.to === panel.nodeId).map(edge => <div className="relation-row" key={edge.id}>
          <span>{graph.nodes.find(node => node.id === edge.from)?.title}<small>{edge.label} →</small>{graph.nodes.find(node => node.id === edge.to)?.title}</span>
          <IconButton icon="trash" label={`移除关系 ${edge.id}`} onClick={() => { run({ type: 'remove-edge', id: edge.id }); if (panel.type === 'edge') setPanel(null) }} />
        </div>)}
        {panel.type === 'relations' && !graph.edges.some(edge => edge.from === panel.nodeId || edge.to === panel.nodeId) && <p>这个节点还没有关系。</p>}
      </div>}
    </Dialog>}
  </>
}

function ReferenceForm({ nodes, onSelect, onResolve }: { nodes: RenderNode[]; onSelect: (node: RenderNode) => void; onResolve: (reference: string) => string | null }) {
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const query = reference.trim().toLocaleLowerCase()
  const matches = query && !query.includes('://') ? nodes.filter(node => `${node.title}\n${node.summary}`.toLocaleLowerCase().includes(query)) : []
  return <form onSubmit={event => {
    event.preventDefault()
    if (matches.length === 1) onSelect(matches[0])
    else if (matches.length) setError('请选择要定位的节点。')
    else setError(onResolve(reference))
  }}>
    <p>搜索标题、摘要，或粘贴稳定引用。改标题或合并节点后，原引用仍能定位。</p>
    <label>标题、摘要或引用<textarea className="reference-input" aria-label="待定位引用" autoFocus value={reference} onChange={event => { setReference(event.target.value); setError(null) }} placeholder="搜索节点，或粘贴 mindweave://…" required /></label>
    {matches.length > 0 && <div className="node-search-results" aria-label="匹配节点">{matches.map(node => <button key={node.id} type="button" onClick={() => onSelect(node)}><strong>{node.title}</strong>{node.summary && <small>{node.summary}</small>}</button>)}</div>}
    {error && <p className="error-text" role="alert">{error}</p>}<div className="form-actions"><button className="primary" type="submit">定位节点</button></div>
  </form>
}
function NoteForm({ onSave }: { onSave: (title: string, summary: string) => void }) {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  return <form onSubmit={event => { event.preventDefault(); if (title.trim()) onSave(title, summary) }}>
    <p>笔记单独标为用户内容，保存只影响画布。</p>
    <label>标题<input aria-label="笔记标题" autoFocus value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} /></label>
    <label>摘要<textarea aria-label="笔记摘要" value={summary} onChange={event => setSummary(event.target.value)} rows={3} maxLength={500} /></label>
    <div className="form-actions"><button className="primary" type="submit" disabled={!title.trim()}>新增笔记</button></div>
  </form>
}
function TargetForm({ nodes, operation, onSave }: { nodes: RenderNode[]; operation: 'connect' | 'merge'; onSave: (id: string) => void }) {
  const [target, setTarget] = useState(nodes[0]?.id ?? '')
  return <form onSubmit={event => { event.preventDefault(); if (target) onSave(target) }}>
    <p>{operation === 'merge' ? '选择保留的节点。两个节点的内容与来源都会保留，旧引用将指向合并后的节点。' : '选择另一节点，建立一条由你添加的关系。'}</p>
    {nodes.length ? <label>目标节点<select aria-label="目标节点" autoFocus value={target} onChange={event => setTarget(event.target.value)}>{nodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label> : <p>先新增另一个节点。</p>}
    <div className="form-actions"><button className="primary" type="submit" disabled={!target}>{operation === 'merge' ? '合并并保留引用' : '建立关系'}</button></div>
  </form>
}
