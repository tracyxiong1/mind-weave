import { loadDocument, type StoragePort } from '../core/persistence'
import { validId } from '../core/identifiers'
import type { Conversation, Sample, Source } from '../core/types'
import { refreshSampleDetails } from './reading'

/** Preserve existing drafts; use the isolated prototype only if no formal draft
 * exists. Saving still writes the original production key and leaves its backup. */
export function loadSampleDraft(storage: StoragePort, sample: Sample, conversation?: Conversation) {
  const loaded = loadDocument({
    getItem: key => storage.getItem(key) ?? storage.getItem(`excalidraw-experiment:${key}`),
    setItem: (key, value) => storage.setItem(key, value),
  }, sample)
  const sources = new Map(sample.sources.map(source => [source.id, source]))
  try {
    const saved: unknown = JSON.parse(storage.getItem(`excalidraw-experiment:sources:${sample.canvasId}`) ?? 'null')
    const used = new Set(Object.values(loaded.document.generated.nodes).flatMap(node => node.sourceIds))
    if (Array.isArray(saved) && conversation) for (const source of saved as Source[]) {
      if (!source || !validId(source.id) || !used.has(source.id) || sources.has(source.id) || source.sessionId !== sample.sessionId) continue
      const message = conversation.messages.find(message => message.id === source.messageId)
      if (message && Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= 0 && source.end > source.start && source.end <= message.text.length) sources.set(source.id, source)
    }
  } catch { /* Original sample sources remain available if old metadata is bad. */ }
  return { ...loaded, document: refreshSampleDetails(loaded.document), sample: { ...sample, sources: [...sources.values()] } }
}
