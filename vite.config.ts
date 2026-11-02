import { defineConfig } from 'vitest/config'
import { mindweavePlugin } from './src/integration/server'
import { excalidrawAssets } from './build/excalidraw-assets'

export default defineConfig({
  plugins: [mindweavePlugin(), excalidrawAssets()],
  server: {
    open: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.mindweave/**'] },
    watch: { ignored: ['**/.mindweave/**'] },
  },
  preview: { open: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
