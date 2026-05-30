import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Plugin: strip ELECTRON_RUN_AS_NODE from env before any module loads
function fixElectronEnvPlugin() {
  return {
    name: 'fix-electron-env',
    buildStart() {
      if (process.env.ELECTRON_RUN_AS_NODE) {
        delete process.env.ELECTRON_RUN_AS_NODE
      }
    },
    // Also fix in the generated output via transformIndexHtml equivalent for main
    generateBundle(_opts: any, bundle: any) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName === 'main.js' && bundle[fileName].type === 'chunk') {
          // Insert after "use strict" to avoid disabling strict mode
          const code = bundle[fileName].code
          const strictIdx = code.indexOf('"use strict"')
          if (strictIdx >= 0) {
            const afterStrict = strictIdx + '"use strict";\n'.length
            bundle[fileName].code = code.slice(0, afterStrict) + 'if(typeof process!=="undefined"&&process.env.ELECTRON_RUN_AS_NODE){delete process.env.ELECTRON_RUN_AS_NODE}\n' + code.slice(afterStrict)
          } else {
            bundle[fileName].code = 'if(typeof process!=="undefined"&&process.env.ELECTRON_RUN_AS_NODE){delete process.env.ELECTRON_RUN_AS_NODE}\n' + code
          }
        }
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), fixElectronEnvPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'electron/main.ts'),
        output: {
          entryFileNames: 'main.js',
          format: 'cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload.ts'),
        output: {
          entryFileNames: 'preload.js',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    root: 'src/renderer',
  },
})
