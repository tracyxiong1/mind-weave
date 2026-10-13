import { defineConfig } from 'vitest/config'
import { mindweavePlugin } from './src/integration/server'

export default defineConfig({
  plugins: [mindweavePlugin()],
  server: {
    open: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.mindweave/**'] },
    watch: { ignored: ['**/.mindweave/**'] },
  },
  preview: { open: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
