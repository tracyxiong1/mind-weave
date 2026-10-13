import { homedir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

declare const __MINDWEAVE_PACKAGE__: boolean
export const packaged = typeof __MINDWEAVE_PACKAGE__ !== 'undefined' && __MINDWEAVE_PACKAGE__
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), packaged ? '..' : '../..')
export function runtimePaths() {
  const home = resolve(process.env.MINDWEAVE_HOME ?? (packaged ? join(homedir(), '.mindweave') : join(packageRoot, '.mindweave')))
  return { home, canvases: join(home, 'canvases'), captures: join(home, 'captures'), updates: join(home, 'updates'),
    serverFile: join(home, 'server.json'), serverLock: join(home, 'server-start.lock'), log: join(home, 'server.log'),
    assets: join(packageRoot, 'dist'), entry: join(packageRoot, 'lib/cli.mjs'),
    skillSource: join(packageRoot, packaged ? 'skills' : '.agents/skills', 'mindweave') }
}
export function skillDirectory() {
  const root = process.env.MINDWEAVE_SKILLS_DIR ?? (process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'skills') : join(homedir(), '.agents', 'skills'))
  return resolve(root, 'mindweave')
}
