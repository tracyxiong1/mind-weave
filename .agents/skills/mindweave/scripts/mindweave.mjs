import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12)) throw new Error('Mindweave 需要 Node.js 22.12 或更新版本。')

// The complete runtime travels with the skill, independent of its installation path.
const bundled = new URL('./runtime/cli.mjs', import.meta.url)
let available = true
try { await access(bundled) } catch (error) { if (error.code !== 'ENOENT') throw error; available = false }
if (available) {
  await import(bundled.href)
} else {
  // Compatibility for a managed 0.2 installation with an external compiled entry.
  let runtime
  try { runtime = JSON.parse(await readFile(new URL('../runtime.json', import.meta.url), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (runtime?.schemaVersion !== 1 || typeof runtime.entry !== 'string') {
    throw new Error('skill 缺少运行文件。请重新安装完整的 mindweave skill；源码开发使用 npm run mindweave。')
  }
  await import(pathToFileURL(runtime.entry).href)
}
