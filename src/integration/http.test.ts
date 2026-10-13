import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { recordWithGraph } from '../../tests/fixtures/codex'
import { createCanvasServer } from './http'
import { CanvasStore } from './store'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mindweave-http-')); directories.push(root)
  const assets = join(root, 'dist'), store = new CanvasStore(join(root, 'private/canvases'))
  await mkdir(join(assets, 'assets'), { recursive: true })
  await writeFile(join(assets, 'index.html'), '<!doctype html><title>Mindweave</title>')
  await writeFile(join(assets, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(assets, 'assets/index-test.js'), 'console.log("bundle")')
  await writeFile(join(root, 'private.txt'), 'private content')
  const record = recordWithGraph(); await store.change(record.document.id, () => record)
  const secret = 'a'.repeat(64), server = createCanvasServer({ assets, store, secret })
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, record, secret }
}
describe('installed package server', () => {
  it('serves only packaged UI assets and authenticates private canvas data', async () => {
    const h = await setup()
    expect((await fetch(`${h.base}/`)).status).toBe(200)
    expect((await fetch(`${h.base}/favicon.svg`)).status).toBe(200)
    const asset = await fetch(`${h.base}/assets/index-test.js`)
    expect(asset.status).toBe(200); expect(asset.headers.get('content-type')).toContain('javascript')
    for (const path of ['/private.txt', '/lib/cli.mjs', '/package.json', '/assets/%2e%2e%2fprivate.txt']) expect((await fetch(`${h.base}${path}`)).status).toBe(404)
    expect((await fetch(`${h.base}/.mindweave/canvases/x.json`)).status).toBe(403)
    const url = `${h.base}/api/canvases/${h.record.document.id}`
    expect((await fetch(url)).status).toBe(401)
    const payload = await (await fetch(`${url}?access=${h.record.accessToken}`)).json()
    expect(payload.document.id).toBe(h.record.document.id); expect(payload).not.toHaveProperty('accessToken')
  })
  it('protects service control with a distinct token, rejects rebinding hosts and stops gracefully', async () => {
    const h = await setup()
    expect((await fetch(`${h.base}/api/mindweave/health`)).status).toBe(403)
    expect((await fetch(`${h.base}/api/mindweave/health`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(403)
    const control = { Authorization: `Bearer ${h.secret}` }
    expect((await (await fetch(`${h.base}/api/mindweave/health`, { headers: control })).json()).service).toBe('mindweave')
    const rebinding = await new Promise<number>(resolve => {
      request(h.base, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!) }).end()
    })
    expect(rebinding).toBe(403)
    expect((await fetch(`${h.base}/api/mindweave/stop`, { headers: control })).status).toBe(405)
    expect((await fetch(`${h.base}/api/mindweave/stop`, { method: 'POST', headers: control })).status).toBe(200)
  })
})
