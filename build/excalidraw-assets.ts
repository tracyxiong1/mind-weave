import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { Connect, Plugin } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(root, 'node_modules/@excalidraw/excalidraw')
const fontRoot = resolve(packageRoot, 'dist/prod/fonts')

/** Only the reader's UI font is needed; drawing/text tools remain disabled. */
export function excalidrawAssets(): Plugin {
  const fonts = new Map(readdirSync(resolve(fontRoot, 'Assistant')).filter(name => name.endsWith('.woff2'))
    .map(name => [`/fonts/Assistant/${name}`, resolve(fontRoot, 'Assistant', name)]))
  const serve: Connect.NextHandleFunction = (request, response, next) => {
    const file = fonts.get((request.url ?? '').split('?')[0])
    if (!file) { next(); return }
    response.setHeader('Content-Type', 'font/woff2')
    createReadStream(file).pipe(response)
  }
  return {
    name: 'mindweave-excalidraw-assets',
    configureServer(server) { server.middlewares.use(serve) },
    generateBundle(_options, bundle) {
      for (const [name, file] of fonts) this.emitFile({ type: 'asset', fileName: name.slice(1), source: readFileSync(file) })
      const packages = new Map<string, string>()
      // Excalidraw also prebundles dependencies, so Rollup's module list alone
      // misses their notices. Walk its installed dependency graph as well.
      const collectPackage = (directory: string) => {
        if (packages.has(directory)) return
        const info = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
        const names = readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:$|[.\-])/i.test(name))
        const license = names.map(name => { try { return readFileSync(resolve(directory, name), 'utf8') } catch { return '' } }).filter(Boolean).join('\n\n')
        packages.set(directory, `${info.name}@${info.version}\nLicense: ${typeof info.license === 'string' ? info.license : JSON.stringify(info.license ?? 'See package source')}\n${license}`)
        const require = createRequire(resolve(directory, 'package.json'))
        for (const name of Object.keys(info.dependencies ?? {})) {
          // Find metadata directly (some packages do not export package.json).
          const metadata = require.resolve.paths(name)?.map(path => resolve(path, name, 'package.json')).find(existsSync)
          if (metadata) collectPackage(dirname(metadata))
        }
      }
      collectPackage(packageRoot)
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          if (!id.includes('/node_modules/')) continue
          let directory = dirname(id.split('?')[0])
          while (directory.startsWith(root) && directory !== root) {
            const metadata = resolve(directory, 'package.json')
            if (existsSync(metadata)) {
              try {
                const info = JSON.parse(readFileSync(metadata, 'utf8'))
                if (info.name && info.version) {
                  collectPackage(directory)
                  break
                }
              } catch { /* A bundled virtual module may have no package metadata. */ }
            }
            directory = dirname(directory)
          }
        }
      }
      const fallback = readFileSync(resolve(root, 'build/excalidraw-license.txt'), 'utf8')
      const assistant = readFileSync(resolve(root, 'build/assistant-license.txt'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: `Excalidraw core\nSource: https://github.com/excalidraw/excalidraw/tree/v0.18.1\n${fallback}\n\nAssistant UI font\nSource: https://github.com/google/fonts/tree/main/ofl/assistant\n${assistant}\n\n${[...packages.values()].sort().join('\n\n--------------------\n\n')}\n` })
    },
  }
}
