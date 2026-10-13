import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { isRecord } from '../core/live'
import { CanvasError } from './types'
import { CanvasStore } from './store'
import { createCanvasServer } from './http'
import { runtimePaths } from './runtime'
import { withLock } from './lock'

export interface ServerState { schemaVersion: 1; pid: number; port: number; secret: string }
type Paths = ReturnType<typeof runtimePaths>
async function readState(paths: Paths): Promise<ServerState | null> {
  try {
    const value: unknown = JSON.parse(await readFile(paths.serverFile, 'utf8'))
    if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.pid) || Number(value.pid) < 1
      || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535
      || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)) return null
    return value as unknown as ServerState
  } catch { return null }
}
export const serverUrl = (state: ServerState) => `http://127.0.0.1:${state.port}`
async function control(state: ServerState, stop = false) {
  try {
    const response = await fetch(`${serverUrl(state)}/api/mindweave/${stop ? 'stop' : 'health'}`, {
      method: stop ? 'POST' : 'GET', headers: { Authorization: `Bearer ${state.secret}` }, signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return false
    if (stop) return true
    const body: unknown = await response.json()
    return isRecord(body) && body.service === 'mindweave' && body.protocol === 1
  } catch { return false }
}
async function clearOwnedState(paths: Paths, secret: string) {
  if ((await readState(paths))?.secret === secret) await unlink(paths.serverFile).catch(() => {})
}

export async function serve(paths = runtimePaths()) {
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  const secret = process.env.MINDWEAVE_DAEMON_SECRET ?? randomBytes(32).toString('hex')
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new CanvasError('服务启动凭据无效。')
  const port = Number(process.env.MINDWEAVE_PORT ?? 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CanvasError('MINDWEAVE_PORT 必须是 0 到 65535 的端口。')
  const server = createCanvasServer({ assets: paths.assets, store: new CanvasStore(paths.canvases), secret })
  server.listen(port, '127.0.0.1'); await once(server, 'listening')
  const state: ServerState = { schemaVersion: 1, pid: process.pid, port: (server.address() as AddressInfo).port, secret }
  const temporary = `${paths.serverFile}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(state)); await file.sync() } finally { await file.close() }
  await rename(temporary, paths.serverFile)
  console.log(JSON.stringify({ service: 'mindweave', url: serverUrl(state) }))
  const stop = () => { server.close(); server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), 1000).unref() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  await once(server, 'close')
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  await withLock(paths.serverLock, () => clearOwnedState(paths, secret), 12000)
}

export async function ensureServer(paths = runtimePaths()): Promise<ServerState> {
  return withLock(paths.serverLock, async () => {
    const current = await readState(paths)
    if (current && await control(current)) return current
    await readFile(`${paths.assets}/index.html`).catch(() => { throw new CanvasError('安装包缺少画布页面。源码开发请运行 npm run prepare。') })
    const secret = randomBytes(32).toString('hex')
    const log = await open(paths.log, 'a', 0o600)
    const child = spawn(process.execPath, [paths.entry, 'serve'], {
      detached: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, MINDWEAVE_HOME: paths.home, MINDWEAVE_DAEMON_SECRET: secret },
    })
    let error: Error | null = null
    child.on('error', value => { error = value }); child.unref(); await log.close()
    for (let attempt = 0; attempt < 80; attempt++) {
      if (error || child.exitCode !== null) break
      const state = await readState(paths)
      if (state?.secret === secret && await control(state)) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    child.kill()
    throw new CanvasError(`本地画布服务未能启动，请查看 ${paths.log}。`)
  }, 12000)
}
export async function stopServer(paths = runtimePaths()) {
  return withLock(paths.serverLock, async () => {
    const state = await readState(paths)
    if (!state) return { stopped: false }
    if (await control(state)) {
      if (!await control(state, true)) throw new CanvasError('服务暂时无法停止，请稍后重试。')
      for (let i = 0; i < 30 && await control(state); i++) await new Promise(resolve => setTimeout(resolve, 100))
      if (await control(state)) throw new CanvasError('服务尚未停止，请稍后重试。')
    }
    await clearOwnedState(paths, state.secret)
    return { stopped: true }
  }, 12000)
}
