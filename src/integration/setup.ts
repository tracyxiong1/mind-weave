import { mkdir, readFile, writeFile, cp, readdir, lstat, rename, rm } from 'node:fs/promises'
import { join, dirname, relative, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { isRecord } from '../core/live'
import { CanvasError } from './types'
import { runtimePaths, skillDirectory } from './runtime'
import { withLock } from './lock'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function files(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(path: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const full = join(path, item.name)
      if (item.isSymbolicLink()) throw new CanvasError('skill 内有符号链接，保留现有安装。')
      if (item.isDirectory()) await walk(full)
      else if (item.name !== '.mindweave-install.json') result[relative(directory, full)] = hash(await readFile(full, 'utf8'))
    }
  }
  await walk(directory); return result
}

export async function setupSkill(force = false, paths = runtimePaths(), destination = skillDirectory()) {
  return withLock(join(paths.home, 'skill-setup.lock'), async () => {
    const previous = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (previous?.isSymbolicLink() || (previous && !previous.isDirectory())) throw new CanvasError('已有 skill 是链接或文件，已保留。请先选择安装目录。')
    if (previous && !force) {
      let marker: unknown = null
      try { marker = JSON.parse(await readFile(join(destination, '.mindweave-install.json'), 'utf8')) } catch { /* Existing custom skill. */ }
      const actual = await files(destination)
      const recorded = isRecord(marker) && marker.schemaVersion === 1 && isRecord(marker.files) ? marker.files : null
      if (!recorded || Object.keys(actual).length !== Object.keys(recorded).length || Object.entries(actual).some(([path, digest]) => recorded[path] !== digest)) {
        throw new CanvasError('已有自定义或改过的 mindweave skill，已保留。需要替换时运行 mindweave setup --force，原内容会先备份。')
      }
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const temporary = join(dirname(destination), `.mindweave-new-${randomUUID()}`)
    const old = join(dirname(destination), `.mindweave-old-${randomUUID()}`)
    let backup: string | null = null, moved = false
    try {
      await cp(paths.skillSource, temporary, { recursive: true })
      await writeFile(join(temporary, 'runtime.json'), JSON.stringify({ schemaVersion: 1, entry: resolve(paths.entry) }), { mode: 0o600 })
      const manifest = await files(temporary)
      await writeFile(join(temporary, '.mindweave-install.json'), JSON.stringify({ schemaVersion: 1, files: manifest }), { mode: 0o600 })
      if (previous) {
        backup = join(paths.home, 'backups', `skill-${Date.now()}-${randomUUID()}`)
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
        await cp(destination, backup, { recursive: true })
        await rename(destination, old); moved = true
      }
      try { await rename(temporary, destination) }
      catch (error) { if (moved) await rename(old, destination); throw error }
      if (moved) await rm(old, { recursive: true })
      return { installed: true, skillPath: join(destination, 'SKILL.md'), ...(backup ? { backupPath: backup } : {}) }
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
}
