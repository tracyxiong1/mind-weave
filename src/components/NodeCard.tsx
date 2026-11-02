import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type FocusEvent } from 'react'
import { excerptFor } from '../data/samples'
import type { Conversation, Position, RenderNode, Sample } from '../core/types'
import { Icon } from './Icon'

export type NodeAction = 'edit' | 'note' | 'connect' | 'merge' | 'relations' | 'delete'
interface Props {
  node: RenderNode
  sample: Sample
  conversation?: Conversation
  live: boolean
  position: Position
  emphasized: boolean
  selected: boolean
  unrelated: boolean
  expanded: boolean
  editing: boolean
  menuOpen: boolean
  showSources: boolean
  onSelect: () => void
  onExpand: () => void
  onEdit: () => void
  onSave: (title: string, summary: string) => void
  onCancel: () => void
  onMenu: () => void
  onAction: (action: NodeAction) => void
  onCopy: () => void
  onSources: () => void
  onDrag: (event: PointerEvent<HTMLElement>) => void
  onKey: (event: KeyboardEvent<HTMLElement>) => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onMeasure: (id: string, height: number) => void
}
export function NodeCard(props: Props) {
  const { node, position, emphasized, expanded, selected, editing, menuOpen, showSources, sample } = props
  const showSummary = Boolean(node.summary && (expanded || emphasized))
  const ref = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(node.title)
  const [summary, setSummary] = useState(node.summary)
  useEffect(() => {
    if (editing) { setTitle(node.title); setSummary(node.summary); titleRef.current?.focus(); titleRef.current?.select() }
  }, [editing, node.title, node.summary])
  useEffect(() => {
    const element = ref.current!
    const observer = new ResizeObserver(() => props.onMeasure(node.id, element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [node.id, props.onMeasure])
  const menuItems: [NodeAction, string, 'edit' | 'note' | 'link' | 'merge' | 'trash'][] = [
    ['edit', '编辑标题和摘要', 'edit'], ['note', '补充笔记', 'note'], ['connect', '连接到…', 'link'],
    ['relations', '管理关系', 'link'], ['merge', '合并到…', 'merge'], ['delete', '删除节点', 'trash'],
  ]
  return <article ref={ref} id={`node-${node.id}`} data-node={node.id} data-testid={`node-${node.id}`} tabIndex={0}
    aria-label={node.title} aria-keyshortcuts="Enter F2 Delete" aria-describedby={showSummary && !editing ? `summary-${node.id}` : undefined}
    className={`node ${emphasized ? 'emphasized' : ''} ${selected ? 'selected' : ''} ${props.unrelated ? 'unrelated' : ''} ${node.kind === 'suggestion' ? 'suggested' : ''} ${editing ? 'editing' : ''}`}
    style={{ left: position.x, top: position.y }} onPointerDown={props.onDrag} onClick={props.onSelect}
    onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button, input, textarea, details, .context-menu')) { event.stopPropagation(); props.onEdit() } }}
    onKeyDown={props.onKey} onFocus={props.onFocus}>
    {editing ? <form className="node-editor" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); props.onSave(title, summary) }}>
      <label>标题<input ref={titleRef} aria-label="节点标题" value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} /></label>
      <label>摘要<textarea aria-label="节点摘要" value={summary} onChange={event => setSummary(event.target.value)} rows={3} maxLength={500} /></label>
      <div className="form-actions"><button type="button" onClick={props.onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
    </form> : <>
      <div className="node-heading">
        <h2>{node.title}</h2>
        <button type="button" className="expand-button" title={expanded ? '折叠详情' : '展开详情'} aria-label={`${expanded ? '折叠' : '展开'} ${node.title}`} aria-expanded={expanded}
          onClick={event => { event.stopPropagation(); props.onExpand() }}><span className={expanded ? 'rotated' : ''}><Icon name="chevron" /></span></button>
      </div>
      {showSummary && !expanded && <p id={`summary-${node.id}`} className="node-summary">{node.summary}</p>}
      {(node.kind !== 'discussion' || (expanded && node.modified)) && <div className="node-meta">
        {node.kind === 'suggestion' && <span>建议 · 尚未讨论</span>}
        {node.kind === 'note' && <span>用户笔记</span>}
        {node.modified && expanded && <span>已编辑</span>}
      </div>}
      {expanded && <div className="node-details">
        {showSummary && <p id={`summary-${node.id}`} className="node-summary full">{node.summary}</p>}
        {node.details && <Explanation id={`explanation-${node.id}`} text={node.details} />}
        {node.members.filter(member => member.id !== node.id).map(member => <section className="merged-part" key={member.id}>
          <h3>{member.title}<small>{member.kind === 'note' ? '用户笔记' : member.kind === 'suggestion' ? '未讨论的建议' : '合并的讨论'}</small></h3>
          {member.summary && <p className="merged-summary">{member.summary}</p>}{member.details && <Explanation id={`explanation-${member.id}`} text={member.details} />}
        </section>)}
        {node.kind === 'note' && !node.sourceIds.length && <p className="provenance">手动补充的内容，不属于{props.live ? '原对话' : '示例对话'}原文。</p>}
        <div className="node-reading-actions">
          {node.sourceIds.length > 0 && <button type="button" aria-expanded={showSources} onClick={event => { event.stopPropagation(); props.onSources() }}><Icon name="source" />{showSources ? '收起原文' : '查看原文'}</button>}
          <button type="button" onClick={event => { event.stopPropagation(); props.onCopy() }}><Icon name="copy" />复制引用</button>
        </div>
        {showSources && <section className="sources" aria-label={props.live ? '对话来源' : '示例对话来源'}>
          <h3 className="source-caption">{props.live ? '对话原文' : '示例原文'}</h3>
          {node.hasNotes && <p className="source-caption">合并的用户笔记另行标注。</p>}
          {node.sourceIds.map(id => {
            const source = sample.sources.find(source => source.id === id)
            const data = source && excerptFor(sample, source, props.conversation)
            if (!data || !source) return <p key={id}>此来源在当前对话中不可用。</p>
            return <div key={id} className="source-excerpt" data-source={id}>
              <span>{data.message.role === 'user' ? '用户' : 'Assistant'} · 消息 {data.conversation.messages.indexOf(data.message) + 1}</span>
              <blockquote>{data.excerpt}</blockquote>
              <details><summary>完整原始消息</summary><p>{data.message.text.slice(0, source.start)}<mark>{data.excerpt}</mark>{data.message.text.slice(source.end)}</p></details>
            </div>
          })}
        </section>}
      </div>}
    </>}
    {!editing && <button type="button" className="more-button" aria-label={`${node.title} 的操作`} aria-expanded={menuOpen}
      onClick={event => { event.stopPropagation(); props.onMenu() }}><Icon name="more" /></button>}
    {menuOpen && <div className="context-menu" role="group" aria-label="节点操作" onClick={event => event.stopPropagation()}>
      {menuItems.map(([action, label, icon]) => <button key={action} type="button" className={action === 'delete' ? 'danger' : ''}
        onClick={() => props.onAction(action)}><Icon name={icon} />{label}</button>)}
    </div>}
  </article>
}

function Explanation({ id, text }: { id: string; text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [full, setFull] = useState(false)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const paragraph = ref.current!
    const observer = new ResizeObserver(() => {
      if (!full) setOverflow(paragraph.scrollHeight > paragraph.clientHeight + 1)
    })
    observer.observe(paragraph)
    return () => observer.disconnect()
  }, [full, text])
  return <div className="node-explanation">
    <p ref={ref} id={id} className={full ? '' : 'clamped'}>{text}</p>
    {(overflow || full) && <button type="button" aria-expanded={full} aria-controls={id} onClick={() => setFull(!full)}>{full ? '收起说明' : '更多说明'}</button>}
  </div>
}
