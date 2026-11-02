import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runtimePaths } from './runtime'
import { setupSkill } from './setup'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mindweave-setup-')); directories.push(root)
  const source = join(root, 'bundle/skill'), destination = join(root, 'user/skills/mindweave')
  await mkdir(join(source, 'scripts/runtime'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: mindweave\ndescription: Synthetic test skill\n---\n')
  await writeFile(join(source, 'scripts/mindweave.mjs'), '// launcher')
  await writeFile(join(source, 'scripts/runtime/cli.mjs'), '// self-contained runtime')
  const paths = { ...runtimePaths(), home: join(root, 'data'), entry: join(root, 'bundle/cli.mjs'), skillSource: source }
  return { root, source, destination, paths }
}
describe('user skill installation', () => {
  it('copies the complete skill without machine-specific paths and survives an npm update', async () => {
    const h = await setup()
    await setupSkill(false, h.paths, h.destination)
    expect(await readFile(join(h.destination, 'scripts/runtime/cli.mjs'), 'utf8')).toContain('self-contained runtime')
    expect(await readdir(h.destination)).not.toContain('runtime.json')
    await writeFile(join(h.source, 'SKILL.md'), 'updated skill')
    const updated = await setupSkill(false, h.paths, h.destination)
    expect(await readFile(join(h.destination, 'SKILL.md'), 'utf8')).toBe('updated skill')
    expect(await readFile(join(updated.backupPath!, 'SKILL.md'), 'utf8')).toContain('Synthetic test skill')
    expect(await readdir(join(h.root, 'user/skills'))).toEqual(['mindweave'])
  })
  it('keeps an existing custom skill, and an explicit force install backs it up', async () => {
    const h = await setup(); await mkdir(h.destination, { recursive: true }); await writeFile(join(h.destination, 'SKILL.md'), 'my custom skill')
    await expect(setupSkill(false, h.paths, h.destination)).rejects.toThrow('已有自定义')
    expect(await readFile(join(h.destination, 'SKILL.md'), 'utf8')).toBe('my custom skill')
    const installed = await setupSkill(true, h.paths, h.destination)
    expect(await readFile(join(installed.backupPath!, 'SKILL.md'), 'utf8')).toBe('my custom skill')
    expect(await readFile(join(h.destination, 'SKILL.md'), 'utf8')).toContain('Synthetic test skill')
  })
  it('protects changes to managed files and extra custom references, and refuses a symlink target', async () => {
    const h = await setup(); await setupSkill(false, h.paths, h.destination)
    await writeFile(join(h.destination, 'SKILL.md'), 'my edit')
    await expect(setupSkill(false, h.paths, h.destination)).rejects.toThrow('已保留')
    await setupSkill(true, h.paths, h.destination)
    await writeFile(join(h.destination, 'my-reference.md'), 'custom notes')
    await expect(setupSkill(false, h.paths, h.destination)).rejects.toThrow('已保留')
    await rm(h.destination, { recursive: true }); await symlink(h.source, h.destination)
    await expect(setupSkill(true, h.paths, h.destination)).rejects.toThrow('链接或文件')
    expect(await readFile(join(h.source, 'SKILL.md'), 'utf8')).toContain('Synthetic test skill')
  })
  it('serializes two installers and preserves the old skill if the bundle cannot be copied', async () => {
    const h = await setup()
    await Promise.all([setupSkill(false, h.paths, h.destination), setupSkill(false, h.paths, h.destination)])
    const before = await readFile(join(h.destination, 'SKILL.md'), 'utf8')
    await rm(h.source, { recursive: true })
    await expect(setupSkill(false, h.paths, h.destination)).rejects.toThrow()
    expect(await readFile(join(h.destination, 'SKILL.md'), 'utf8')).toBe(before)
    expect(await readdir(join(h.root, 'user/skills'))).toEqual(['mindweave'])
  })
})
