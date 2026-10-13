import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { canvasMiddleware } from './server'
import { CanvasStore } from './store'

export function createCanvasServer(options: { assets: string; store: CanvasStore; secret: string; onStop?: () => void }): Server {
  const middleware = canvasMiddleware(options.store)
  const server = createServer((request, response) => {
    void handle().catch(() => { if (!response.writableEnded) { response.statusCode = 500; response.end('本地服务暂时不可用。') } })
    async function handle() {
      const hostname = new URL(`http://${request.headers.host ?? ''}`).hostname
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) { response.statusCode = 403; response.end(); return }
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname === '/api/mindweave/health' || url.pathname === '/api/mindweave/stop') {
        const token = (request.headers.authorization ?? '').replace(/^Bearer /, '')
        const authenticated = /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(options.secret))
        if (!authenticated || (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host)) {
          response.statusCode = 403; response.end(); return
        }
        response.setHeader('Cache-Control', 'no-store')
        if (url.pathname.endsWith('/stop')) {
          if (request.method !== 'POST') { response.statusCode = 405; response.end(); return }
          response.end('stopping'); setImmediate(() => {
            options.onStop?.(); server.close(); server.closeIdleConnections()
            const forceClose = setTimeout(() => server.closeAllConnections(), 1000); forceClose.unref()
          }); return
        }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ service: 'mindweave', protocol: 1 })); return
      }
      middleware(request, response, () => { void serveStatic() })
      async function serveStatic() {
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end(); return }
        let path: string
        try { path = decodeURIComponent(url.pathname) } catch { response.statusCode = 400; response.end(); return }
        // Only built UI files are public. Package code, skill files and user data
        // never pass through the static handler, including encoded traversal.
        if (path === '/' || path === '/index.html') path = '/index.html'
        else if (path !== '/favicon.svg' && !/^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(path)) { response.statusCode = 404; response.end(); return }
        try {
          const body = await readFile(join(options.assets, path.slice(1)))
          const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
          response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.setHeader('Referrer-Policy', 'no-referrer')
          response.setHeader('Cache-Control', path === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable')
          response.end(request.method === 'HEAD' ? undefined : body)
        } catch { response.statusCode = 404; response.end() }
      }
    }
  })
  return server
}
