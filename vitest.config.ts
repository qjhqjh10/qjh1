import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
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
        'src/agent/store/**',       // Zustand store, tested via integration
        'src/agent/diagnostics/**',  // Logging module, tested via integration
      ],
      // Baselines set at current coverage + small buffer.
      // Increase after each phase of test additions.
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
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
