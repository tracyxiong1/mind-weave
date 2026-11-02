import { useCallback, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { MAX_ZOOM, MIN_ZOOM, zoomAt } from '../core/geometry'
import type { Viewport } from '../core/types'
import { projectScene, type SceneBox, type SceneEdge } from './scene'
import '@excalidraw/excalidraw/index.css'
import './style.css'

Object.assign(window, { EXCALIDRAW_ASSET_PATH: import.meta.env.BASE_URL })
const sameView = (a: Viewport, b: Viewport) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.zoom - b.zoom) < 0.00001
const uiOptions = { canvasActions: { loadScene: false, saveToActiveFile: false, clearCanvas: false, export: false, toggleTheme: false }, tools: { image: false } } as const

export function ExcalidrawSurface({ boxes, edges, viewport, theme, paused, onViewport, onInteraction, onClearSelection, onCanvasKeyDown, children }: {
  boxes: SceneBox[]; edges: SceneEdge[]; viewport: Viewport; theme: 'light' | 'dark'; paused: boolean
  onViewport: (viewport: Viewport) => void; onInteraction: (active: boolean) => void; onClearSelection: () => void; children: ReactNode
  onCanvasKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const [api, setAPI] = useState<ExcalidrawImperativeAPI | null>(null)
  const [ready, setReady] = useState(false)
  const initialized = useRef(false), synced = useRef(false)
  const awaiting = useRef<Viewport | null>(null)
  const viewportRef = useRef(viewport); viewportRef.current = viewport
  const callbacks = useRef({ onViewport, onInteraction, onClearSelection, paused })
  callbacks.current = { onViewport, onInteraction, onClearSelection, paused }
  const surfaceRef = useRef<HTMLDivElement>(null)
  const background = theme === 'dark' ? '#191919' : '#f8f8f7'
  const [initial] = useState(() => ({ elements: projectScene(boxes, edges, [], theme), appState: {
    scrollX: viewport.x / viewport.zoom, scrollY: viewport.y / viewport.zoom,
    zoom: { value: viewport.zoom as AppState['zoom']['value'] }, viewBackgroundColor: background,
  } }))
  const onChange = useCallback((_elements: readonly ExcalidrawElement[], state: AppState) => {
    if (state.isLoading) return
    if (!initialized.current) { initialized.current = true; setReady(true); return }
    if (!synced.current || callbacks.current.paused) return
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom.value))
    const next = { x: state.scrollX * zoom, y: state.scrollY * zoom, zoom }
    if (awaiting.current) {
      if (!sameView(next, awaiting.current)) return
      awaiting.current = null
    }
    if (!sameView(next, viewportRef.current)) callbacks.current.onViewport(next)
  }, [])

  useEffect(() => {
    if (!api || !ready) return
    const current = api.getSceneElements()
    const next = projectScene(boxes, edges, current, theme)
    if (next.length !== current.length || next.some((element, index) => element !== current[index])) {
      api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER })
      api.history.clear()
    }
  }, [api, ready, boxes, edges, theme])
  useEffect(() => {
    if (!api || !ready) return
    synced.current = true
    const state = api.getAppState()
    const current = { x: state.scrollX * state.zoom.value, y: state.scrollY * state.zoom.value, zoom: state.zoom.value }
    if (sameView(current, viewport) && state.viewBackgroundColor === background) { awaiting.current = null; return }
    awaiting.current = viewport
    api.updateScene({ appState: { scrollX: viewport.x / viewport.zoom, scrollY: viewport.y / viewport.zoom,
      zoom: { value: viewport.zoom as AppState['zoom']['value'] }, viewBackgroundColor: background }, captureUpdate: CaptureUpdateAction.NEVER })
  }, [api, ready, viewport, background])
  useEffect(() => {
    const element = surfaceRef.current!
    const wheel = (event: WheelEvent) => {
      if (callbacks.current.paused) return
      if ((event.target as HTMLElement).closest('.node-details, textarea') && !event.ctrlKey && !event.metaKey) return
      event.preventDefault(); event.stopPropagation()
      const current = viewportRef.current, rect = element.getBoundingClientRect()
      const delta = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      callbacks.current.onViewport(event.ctrlKey || event.metaKey
        ? zoomAt(current, Math.exp(-event.deltaY * delta * 0.005), { x: event.clientX - rect.left, y: event.clientY - rect.top })
        : { ...current, x: current.x - event.deltaX * delta, y: current.y - event.deltaY * delta })
    }
    const finish = () => callbacks.current.onInteraction(false)
    element.addEventListener('wheel', wheel, { passive: false, capture: true })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    return () => {
      element.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      finish()
    }
  }, [])

  return <div ref={surfaceRef} className="canvas-editor" data-engine="excalidraw" data-ready={ready}
    onContextMenuCapture={event => {
      if (!(event.target as HTMLElement).closest('.excalidraw')) return
      event.preventDefault(); event.stopPropagation()
    }}
    onKeyDownCapture={event => {
      if (!(event.target as HTMLElement).closest('.excalidraw')) return
      // Keep reader shortcuts in the business controller; native shape actions
      // and image export are not part of the persisted document yet.
      event.stopPropagation(); onCanvasKeyDown(event)
    }}
    onKeyUpCapture={event => { if ((event.target as HTMLElement).closest('.excalidraw')) event.stopPropagation() }}
    onPointerDownCapture={event => {
      callbacks.current.onInteraction(true)
      if (event.target instanceof HTMLCanvasElement) callbacks.current.onClearSelection()
    }}>
    {/* Reader colors are projected explicitly. Keep the hidden editor UI theme
        stable while its asynchronous initialization or a document reset runs. */}
    <Excalidraw excalidrawAPI={setAPI} initialData={initial} theme="light" viewModeEnabled zenModeEnabled
      langCode="zh-CN" autoFocus={false} handleKeyboardGlobally={false} aiEnabled={false}
      UIOptions={uiOptions} onChange={onChange} />
    {children}
  </div>
}
