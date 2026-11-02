import { CanvasApp } from './App'
import { CanvasLoader } from './components/CanvasLoader'
import { conversations, sampleFromUrl } from './data/samples'
import { readingSample } from './data/reading'

export function App() {
  const query = new URLSearchParams(window.location.search)
  const id = query.get('canvas')
  if (id) return <CanvasLoader id={id} access={query.get('access') ?? undefined} />
  const selected = sampleFromUrl(window.location.search)
  const sample = selected.id === 'branches' ? readingSample : selected
  return <CanvasApp sample={sample} conversation={conversations[sample.id]} />
}
