import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Exercise the minified editor too; its initialization differs from dev. */
export default defineConfig({
  ...base,
  testMatch: ['**/canvas.spec.ts', '**/excalidraw.spec.ts'],
  outputDir: 'test-results/production',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
})
