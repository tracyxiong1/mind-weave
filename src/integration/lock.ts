import { mkdir, open, readFile, unlink, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CanvasError } from './types'

async function removeDeadLock(path: string) {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (value && typeof value === 'object' && 'pid' in value && typeof value.pid === 'number' && value.pid > 0) {
      try { process.kill(value.pid, 0) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(path) }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    const info = await stat(path).catch(() => null)
    if (info && Date.now() - info.mtimeMs > 30000) await unlink(path).catch(() => {})
  }
}
export async function withLock<T>(path: string, action: () => Promise<T>, timeoutMs = 3000): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + timeoutMs
  let handle
  while (!handle) {
    try {
      handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ pid: process.pid })) }
      catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await removeDeadLock(path)
      if (Date.now() >= deadline) throw new CanvasError('另一操作正在保存或启动，请稍后重试。', 409)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  try { return await action() }
  finally { await handle.close(); await unlink(path) }
}
