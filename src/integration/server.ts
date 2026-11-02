import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Plugin } from 'vite'
import { CanvasStore, storeDirectory } from './store'
import { publicCanvas, saveBrowserDocument } from './update'
import { CanvasError } from './types'
import { validId } from '../core/identifiers'
import { isRecord } from '../core/live'

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(body))
}
const matches = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw new CanvasError('画布保存数据过大。', 413)
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new CanvasError('保存请求不是有效 JSON。') }
}

export function canvasMiddleware(store: CanvasStore) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    void handle(request, response, next).catch(error => {
      if (!response.writableEnded) send(response, error instanceof CanvasError ? error.status : 500,
        { message: error instanceof CanvasError ? error.message : '本地画布服务暂时不可用，当前编辑可导出备份。' })
    })
  }
  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let path: string
    try { path = decodeURIComponent(url.pathname).replaceAll('\\', '/') }
    catch { throw new CanvasError('请求路径无效。') }
    // Vite must not expose private transcripts through its static file handler.
    if (/(?:^|\/)\.mindweave(?:\/|$)/.test(path)) { send(response, 403, { message: '私人运行数据不能作为静态文件访问。' }); return }
    if (!path.startsWith('/api/canvases/')) { next(); return }
    const id = path.slice('/api/canvases/'.length)
    if (!validId(id)) throw new CanvasError('画布 ID 无效。')
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new CanvasError('只接受当前画布页面的请求。', 403)
    const record = await store.read(id)
    // Canvas contents require a per-canvas capability; there is no listing API.
    if (!record) throw new CanvasError('画布不可用，请由 Codex 重新生成预览链接。', 404)
    const cookieName = `mw_access_${id}`
    const cookies = new Map((request.headers.cookie ?? '').split(';').map(part => {
      const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1)]
    }))
    const access = url.searchParams.get('access') ?? cookies.get(cookieName) ?? ''
    if (access.length > 200 || !matches(access, record.accessToken)) throw new CanvasError('此浏览器尚未获得画布访问权限，请使用 Codex 给出的预览链接。', 401)
    if (url.searchParams.has('access')) response.setHeader('Set-Cookie', `${cookieName}=${record.accessToken}; HttpOnly; SameSite=Strict; Path=/api/canvases/${id}; Max-Age=2592000`)
    if (request.method === 'GET') {
      if (url.searchParams.get('version') === String(record.version)) { response.statusCode = 204; response.setHeader('Cache-Control', 'no-store'); response.end(); return }
      send(response, 200, publicCanvas(record)); return
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await readBody(request)
      if (!isRecord(body)) throw new CanvasError('保存请求格式无效。')
      const saved = await store.change(id, current => {
        if (!current) throw new CanvasError('画布已不可用。', 404)
        return saveBrowserDocument(current, body.version, body.document)
      })
      send(response, 200, publicCanvas(saved)); return
    }
    response.setHeader('Allow', 'GET, PUT, POST')
    throw new CanvasError('不支持此画布操作。', 405)
  }
}

export function mindweavePlugin(): Plugin {
  return {
    name: 'mindweave-local-canvas',
    configureServer(server) { server.middlewares.use(canvasMiddleware(new CanvasStore(storeDirectory(server.config.root)))) },
    configurePreviewServer(server) { server.middlewares.use(canvasMiddleware(new CanvasStore(storeDirectory(server.config.root)))) },
  }
}
