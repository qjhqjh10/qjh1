// Wrapper: clear ELECTRON_RUN_AS_NODE then run electron-vite
// Because Electron reads this env var at C++ init time,
// we must clear it in the PARENT process before Electron spawns.
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.log('[dev-runner] Clearing ELECTRON_RUN_AS_NODE=' + process.env.ELECTRON_RUN_AS_NODE)
  delete process.env.ELECTRON_RUN_AS_NODE
}

const path = require('path')
const { spawn } = require('child_process')
const pkgDir = path.dirname(require.resolve('electron-vite/package.json'))
const electronViteBin = path.join(pkgDir, 'bin', 'electron-vite.js')
const args = [electronViteBin, ...process.argv.slice(2)]

const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code))
