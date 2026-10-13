import branchesGraph from './branches.graph.json' with { type: 'json' }
import branchesConversation from './branches.conversation.json' with { type: 'json' }
import learningGraph from './learning.graph.json' with { type: 'json' }
import learningConversation from './learning.conversation.json' with { type: 'json' }
import planningGraph from './planning.graph.json' with { type: 'json' }
import planningConversation from './planning.conversation.json' with { type: 'json' }
import type { Conversation, Sample, Source } from '../core/types'

export const samples: Record<string, Sample> = {
  branches: branchesGraph as Sample,
  learning: learningGraph as Sample,
  planning: planningGraph as Sample,
}
export const conversations: Record<string, Conversation> = {
  branches: branchesConversation as Conversation,
  learning: learningConversation as Conversation,
  planning: planningConversation as Conversation,
}
export function sampleFromUrl(search: string): Sample {
  const id = new URLSearchParams(search).get('sample') ?? 'branches'
  return samples[id] ?? samples.branches
}
export function excerptFor(sample: Sample, source: Source, conversation = conversations[sample.id]) {
  if (!conversation) return null
  if (source.sessionId !== conversation.sessionId) return null
  const message = conversation.messages.find(message => message.id === source.messageId)
  if (!message || source.start < 0 || source.end > message.text.length || source.start >= source.end) return null
  return { message, excerpt: message.text.slice(source.start, source.end), conversation }
}
