import { open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validId } from '../core/identifiers'
import { validateRecord } from './update'
import { CanvasError, type CanvasRecord } from './types'
import { withLock } from './lock'

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
    return withLock(`${file}.lock`, async () => {
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
      }
    })
  }
}
