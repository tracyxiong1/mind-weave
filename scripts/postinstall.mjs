import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Source checkouts retain their repo skill; installed packages configure a user skill.
if (!existsSync(resolve(root, 'src/integration/cli.ts'))) {
  const result = spawnSync(process.execPath, [resolve(root, 'lib/cli.mjs'), 'setup'], { stdio: 'inherit' })
  if (result.status !== 0) console.error('Mindweave 命令已安装，skill 配置未完成。运行 mindweave setup 查看恢复说明。')
}
