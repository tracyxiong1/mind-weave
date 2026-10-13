import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { open: false },
  preview: { open: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
