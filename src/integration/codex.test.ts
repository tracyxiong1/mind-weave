import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeThread, readCodexThread } from './codex'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const user = { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '当前请求🧵' }, { type: 'image', url: 'hidden-image' }] }
const final = { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: '已完成的回复' }

describe('Codex read-only adapter', () => {
  it('keeps exact text and stable IDs while excluding reasoning, tools, commentary and unfinished replies', () => {
    const thread = { id: 'thread-id', name: '测试会话', cwd: '/project', turns: [
      { id: 't1', status: 'completed', items: [user, final,
        { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '处理中' },
        { id: 'reasoning', type: 'reasoning', text: 'private-reasoning' },
        { id: 'tool', type: 'commandExecution', output: 'private-output' },
      ] },
      { id: 't2', status: 'inProgress', items: [{ ...user, id: 'u2' }, { ...final, id: 'a2', text: '未完成的回复' }] },
    ] }
    const captured = normalizeThread(thread)
    expect(captured.conversation.messages.map(m => [m.role, m.text])).toEqual([
      ['user', '当前请求🧵'], ['assistant', '已完成的回复'], ['user', '当前请求🧵'],
    ])
    const again = normalizeThread({ ...thread, name: '改过标题', turns: [...thread.turns, { id: 't3', status: 'completed', items: [{ ...user, id: 'u3' }] }] })
    expect(again.conversation.messages.slice(0, 3).map(m => m.id)).toEqual(captured.conversation.messages.map(m => m.id))
    expect(new Set(captured.conversation.messages.map(m => m.id)).size).toBe(3)
    expect(() => normalizeThread({ ...thread, turns: [{ id: 't1', status: 'completed' }] })).toThrow('未完整加载')
  })

  async function fakeServer(mode: 'paginated' | 'legacy' | 'broken' | 'timeout') {
    const directory = await mkdtemp(join(tmpdir(), 'mindweave-codex-')); directories.push(directory)
    const binary = join(directory, 'codex'), log = join(directory, 'requests.jsonl')
    await writeFile(binary, `#!/usr/bin/env node
const { createInterface } = require('node:readline');
const { appendFileSync } = require('node:fs');
const mode = ${JSON.stringify(mode)}, log = ${JSON.stringify(log)};
const user = ${JSON.stringify(user)}, final = ${JSON.stringify(final)};
const turn = { id: 't1', status: 'completed', itemsView: 'full', items: [user, final] };
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); appendFileSync(log, line + '\\n');
  if (request.id === undefined || mode === 'timeout') return;
  let result;
  if (request.method === 'initialize') result = {};
  else if (request.method === 'thread/read') result = { thread: { id: 'thread-id', name: '测试', cwd: '/test', historyMode: mode === 'legacy' ? 'legacy' : 'paginated', turns: request.params.includeTurns ? [turn] : [] } };
  else if (request.method === 'thread/turns/list') result = { data: [{ ...turn, id: request.params.cursor ? 't2' : 't1', itemsView: mode === 'broken' ? 'summary' : 'full' }], nextCursor: request.params.cursor ? null : 'page-2' };
  else { process.stdout.write(JSON.stringify({ id: request.id, error: { message: 'mutation is forbidden' } }) + '\\n'); return; }
  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n');
});
`, { mode: 0o700 })
    return { binary, log }
  }
  it('reads full paginated history with initialize and read calls, never starts/resumes a turn', async () => {
    const { binary, log } = await fakeServer('paginated')
    const result = await readCodexThread('thread-id', { binary })
    expect(result.conversation.messages).toHaveLength(4)
    const requests = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(r => r.method)).toEqual(['initialize', 'initialized', 'thread/read', 'thread/turns/list', 'thread/turns/list'])
    expect(requests[3].params).toMatchObject({ threadId: 'thread-id', itemsView: 'full', sortDirection: 'asc', cursor: null })
    expect(requests[4].params.cursor).toBe('page-2')
  })
  it('supports legacy thread/read and rejects truncated history, missing binary and timeout', async () => {
    const legacy = await fakeServer('legacy')
    expect((await readCodexThread('thread-id', { binary: legacy.binary })).conversation.messages).toHaveLength(2)
    const broken = await fakeServer('broken')
    await expect(readCodexThread('thread-id', { binary: broken.binary })).rejects.toThrow('只有摘要')
    await expect(readCodexThread('thread-id', { binary: join(tmpdir(), 'nonexistent-mindweave-codex') })).rejects.toThrow('无法启动')
    const timeout = await fakeServer('timeout')
    await expect(readCodexThread('thread-id', { binary: timeout.binary, timeoutMs: 100 })).rejects.toThrow('超时')
  })
})
