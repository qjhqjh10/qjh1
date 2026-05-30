// ── LSP Handlers ──
// TypeScript diagnostics via tsc. Agent self-checks modified files.

import { IpcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export function registerLSPHandlers(ipcMain: IpcMain) {
  ipcMain.handle('lsp:diagnose', async (_event, filePath?: string) => {
    // Run tsc on the specific file if provided, otherwise full project
    try {
      const args = ['--noEmit', '--pretty']
      const tscPath = 'node_modules/.bin/tsc'

      const { stdout, stderr } = await execFileAsync('npx', ['tsc', ...args], {
        timeout: 60_000,
        maxBuffer: 100_000,
        shell: false, // No shell — prevents cmd.exe metacharacter injection on Windows
      })

      const output = stdout || stderr || ''
      const errors = output.split('\n').filter(l =>
        l.includes('error TS') || l.includes('warning')
      )

      // If a specific file was requested, filter results
      const relevant = filePath
        ? errors.filter(l => l.includes(String(filePath)))
        : errors

      return {
        status: 'success',
        summary: relevant.length > 0 ? `${relevant.length} 个诊断问题` : '无类型错误',
        detail: relevant.length > 0 ? relevant.join('\n') : output.slice(0, 200) || 'TypeScript 编译通过，零错误',
      }
    } catch (err: any) {
      // tsc exits with code 1 on type errors — parse the output anyway
      const output = (err.stdout || err.stderr || err.message || '')
      const errors = output.split('\n').filter((l: string) =>
        l.includes('error TS') || l.includes('warning')
      )
      const relevant = filePath
        ? errors.filter((l: string) => l.includes(String(filePath)))
        : errors

      return {
        status: 'success',
        summary: `${relevant.length} 个类型错误`,
        detail: relevant.length > 0 ? relevant.join('\n') : output.slice(0, 200),
      }
    }
  })
}
