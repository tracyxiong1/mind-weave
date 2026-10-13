import { CanvasApp } from './App'
import { CanvasLoader } from './components/CanvasLoader'
import { conversations, sampleFromUrl } from './data/samples'

export function App() {
  const query = new URLSearchParams(window.location.search)
  const id = query.get('canvas')
  if (id) return <CanvasLoader id={id} access={query.get('access') ?? undefined} />
  const sample = sampleFromUrl(window.location.search)
  return <CanvasApp sample={sample} conversation={conversations[sample.id]} />
}
