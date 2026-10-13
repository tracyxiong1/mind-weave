import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validId } from '../core/identifiers'
import { validateRecord } from './update'
import { CanvasError, type CanvasRecord } from './types'

export function storeDirectory(root = process.cwd()) { return resolve(root, '.mindweave', 'canvases') }
export class CanvasStore {
  constructor(readonly directory = storeDirectory()) {}
  private file(id: string) {
    if (!validId(id)) throw new CanvasError('画布 ID 无效。')
    return join(this.directory, `${id}.json`)
  }
  async read(id: string): Promise<CanvasRecord | null> {
    let raw: string
    try { raw = await readFile(this.file(id), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new CanvasError('本地画布文件损坏，原数据已保留。', 500) }
    if (!validateRecord(value) || value.document.id !== id) throw new CanvasError('本地画布结构无效，原数据已保留。', 500)
    return value
  }
  async change(id: string, update: (record: CanvasRecord | null) => CanvasRecord): Promise<CanvasRecord> {
    const file = this.file(id)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const lock = `${file}.lock`
    const deadline = Date.now() + 3000
    let handle
    while (!handle) {
      try {
        handle = await open(lock, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ pid: process.pid })) }
        catch (error) { await handle.close(); await unlink(lock).catch(() => {}); throw error }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await this.removeDeadLock(lock)
        if (Date.now() >= deadline) throw new CanvasError('另一操作正在保存画布，请稍后重试。', 409)
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    }
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const previous = await this.read(id)
      const next = update(previous)
      if (!validateRecord(next) || next.document.id !== id) throw new CanvasError('拒绝保存无效画布。')
      if (next === previous) return next
      const output = await open(temporary, 'wx', 0o600)
      try { await output.writeFile(JSON.stringify(next)); await output.sync() } finally { await output.close() }
      await rename(temporary, file)
      return next
    } finally {
      await unlink(temporary).catch(() => {})
      await handle.close(); await unlink(lock)
    }
  }
  private async removeDeadLock(lock: string) {
    try {
      const value: unknown = JSON.parse(await readFile(lock, 'utf8'))
      if (value && typeof value === 'object' && 'pid' in value && typeof value.pid === 'number' && value.pid > 0) {
        try { process.kill(value.pid, 0) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lock) }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      // A process can die between creating a lock and writing its owner.
      const info = await stat(lock).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 30000) await unlink(lock).catch(() => {})
    }
  }
}
