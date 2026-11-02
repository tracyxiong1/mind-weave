import { useEffect, useState } from 'react'
import { fetchLiveCanvas } from '../core/live-client'
import type { LiveCanvas } from '../core/live'
import { validId } from '../core/identifiers'
import { CanvasApp } from '../App'

export function CanvasLoader({ id, access }: { id: string; access?: string }) {
  const [record, setRecord] = useState<LiveCanvas | null>(null)
  const [problem, setProblem] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    setProblem('')
    if (!validId(id)) { setProblem('画布 ID 无效。'); return }
    void fetchLiveCanvas(id, access).then(record => {
      if (disposed || !record) return
      const url = new URL(window.location.href)
      url.searchParams.delete('access')
      window.history.replaceState(null, '', url)
      setRecord(record)
    }).catch(error => { if (!disposed) setProblem(error instanceof Error ? error.message : '无法打开画布。') })
    return () => { disposed = true }
  }, [id, access, retry])
  if (record) return <CanvasApp sample={record.sample} conversation={record.conversation} live={record} />
  return <main className="closed-preview" aria-label="加载会话画布"><div className="load-message">
    <p role={problem ? 'alert' : 'status'}>{problem || '正在载入会话画布…'}</p>
    {problem && <button type="button" onClick={() => setRetry(value => value + 1)}>重试载入</button>}
  </div></main>
}
