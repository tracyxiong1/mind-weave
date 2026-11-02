import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { emptyRecord, recordWithGraph } from '../../tests/fixtures/codex'
import { execute } from '../core/model'
import { CanvasStore } from './store'
import { canvasMiddleware } from './server'
import { saveBrowserDocument } from './update'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'mindweave-store-')); directories.push(directory)
  const store = new CanvasStore(directory), record = recordWithGraph()
  await store.change(record.document.id, () => record)
  return { store, record, directory }
}

describe('private canvas storage and API', () => {
  it('atomically serializes concurrent writers, reclaims dead locks, and leaves invalid input unchanged', async () => {
    const { store, record, directory } = await setup(), id = record.document.id
    await Promise.all(Array.from({ length: 8 }, () => store.change(id, current => ({ ...current!, version: current!.version + 1 }))))
    expect((await store.read(id))!.version).toBe(record.version + 8)
    expect((await readdir(directory))).toEqual([`${id}.json`])
    expect((await stat(join(directory, `${id}.json`))).mode & 0o777).toBe(0o600)
    await writeFile(join(directory, `${id}.json.lock`), JSON.stringify({ pid: 2147483647 }))
    await store.change(id, current => current!)
    expect((await readdir(directory))).toEqual([`${id}.json`])
    const before = await readFile(join(directory, `${id}.json`), 'utf8')
    await expect(store.change(id, () => emptyRecord('another-thread'))).rejects.toThrow('无效画布')
    expect(await readFile(join(directory, `${id}.json`), 'utf8')).toBe(before)
    await writeFile(join(directory, `${id}.json`), '{corrupt')
    await expect(store.change(id, current => current!)).rejects.toThrow('原数据已保留')
    expect(await readFile(join(directory, `${id}.json`), 'utf8')).toBe('{corrupt')
    await expect(store.read('../escape')).rejects.toThrow('ID 无效')
  })
  it('authenticates bootstrap links, removes secrets from payloads, blocks private static paths and checks browser origins', async () => {
    const { store, record } = await setup(), id = record.document.id
    const middleware = canvasMiddleware(store)
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end() }))
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`, api = `${base}/api/canvases/${id}`
    expect((await fetch(api)).status).toBe(401)
    expect((await fetch(`${api}?access=wrong`)).status).toBe(401)
    expect((await fetch(`${base}/.mindweave/canvases/${id}.json`)).status).toBe(403)
    expect((await fetch(`${base}/@fs/private/%2Emindweave/canvases/${id}.json`)).status).toBe(403)
    const response = await fetch(`${api}?access=${record.accessToken}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json()
    expect(payload).not.toHaveProperty('accessToken'); expect(payload).not.toHaveProperty('updates')
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict')
    const headers = { cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }
    expect((await fetch(`${api}?version=${record.version}`, { headers })).status).toBe(204)
    const document = execute(record.document, { type: 'edit', id: 'main', title: '从浏览器修改', summary: '保留真实来源' })
    const body = JSON.stringify({ version: record.version, document })
    expect((await fetch(api, { method: 'PUT', headers: { ...headers, origin: 'https://external.example' }, body })).status).toBe(403)
    const saved = await fetch(api, { method: 'PUT', headers: { ...headers, origin: base }, body })
    expect(saved.status).toBe(200)
    expect((await store.read(id))!.document.user.fields.main.title).toBe('从浏览器修改')
    expect((await fetch(api, { method: 'PUT', headers, body })).status).toBe(409)
    const latest = (await store.read(id))!
    expect((await fetch(api, { method: 'POST', headers, body: JSON.stringify({ version: latest.version, document: latest.document }) })).status).toBe(200)
    const fake = structuredClone(latest.document); fake.generated.nodes.main.title = '伪造'
    expect(() => saveBrowserDocument(latest, latest.version, fake)).toThrow('不能改写生成内容')
  })
})
