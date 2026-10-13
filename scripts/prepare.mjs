import { existsSync } from 'node:fs'
import { mkdir, cp, rm, chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (existsSync(resolve(root, 'src/integration/cli.ts'))) {
  const { build: webBuild } = await import('vite')
  const { build } = await import('esbuild')
  // Keep npm pack --json machine-readable; build diagnostics use stderr.
  await webBuild({ root, logLevel: 'silent' })
  await mkdir(resolve(root, 'lib'), { recursive: true })
  await build({ entryPoints: [resolve(root, 'src/integration/cli.ts')], outfile: resolve(root, 'lib/cli.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    define: { __MINDWEAVE_PACKAGE__: 'true' }, logLevel: 'warning' })
  await rm(resolve(root, 'skills'), { recursive: true, force: true })
  await cp(resolve(root, '.agents/skills/mindweave'), resolve(root, 'skills/mindweave'), { recursive: true })
  await mkdir(resolve(root, 'licenses'), { recursive: true })
  for (const name of ['react', 'react-dom', 'scheduler', 'esbuild']) {
    await cp(resolve(root, 'node_modules', name, name === 'esbuild' ? 'LICENSE.md' : 'LICENSE'), resolve(root, 'licenses', `${name}.txt`))
  }
  await chmod(resolve(root, 'bin/mindweave.mjs'), 0o755)
} else if (!existsSync(resolve(root, 'lib/cli.mjs')) || !existsSync(resolve(root, 'dist/index.html'))) {
  throw new Error('安装包缺少运行产物。请使用完整的 Mindweave 安装包或 Git 安装入口。')
}
