import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

let runtime
try { runtime = JSON.parse(await readFile(new URL('../runtime.json', import.meta.url), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (runtime) {
  if (runtime.schemaVersion !== 1 || typeof runtime.entry !== 'string') throw new Error('Mindweave skill 配置无效。请重新运行 mindweave setup。')
  await import(pathToFileURL(runtime.entry).href)
} else {
  // Source repo skill: the installed skill uses runtime.json and requires no tsx.
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const entry = fileURLToPath(new URL('../../../../src/integration/cli.ts', import.meta.url))
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
