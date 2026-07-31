import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dir = path.dirname(__filename)

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['node_modules/**', 'dist/**', '.aiharness/backups/**', '.claude-backup-*/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/agent/**/*.ts',
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
        'src/store/**/*.ts',
        'electron/ipc/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        'node_modules',
        'src/test-setup.ts',
        'src/agent/store/**',
        'src/agent/diagnostics/**',
        'tests/integration/**',     // Node.js E2E scripts, not vitest tests
      ],
      thresholds: {
        statements: 10,
        branches: 8,
        functions: 10,
        lines: 10,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dir, 'src'),
    },
  },
})
