// ── Shell Handlers ──
// Execute shell commands on behalf of the Agent.
// Highest risk tools — strict command whitelisting.

import { IpcMain } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const MAX_OUTPUT = 50_000
const CMD_TIMEOUT = 30_000

const ALLOWED_COMMANDS = ['node', 'python', 'python3', 'git', 'npm', 'npx']
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\b/, /\bcurl\b/, /\bwget\b/,
  /\|/, /;/, /&&/, /\$\(/, /`/, /\t/,
  /\/etc\//, /\/proc\//, /\/sys\//,
  /sudo\b/, /\bsu\b/, /%[A-Z]+%/, /\^/,
]

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  // Check base command
  const base = command.trim().split(/\s+/)[0]
  if (!ALLOWED_COMMANDS.includes(base)) {
    return { safe: false, reason: `不允许的命令: ${base}。允许: ${ALLOWED_COMMANDS.join(', ')}` }
  }
  // Check dangerous patterns
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(command)) {
      return { safe: false, reason: `命令包含禁止模式: ${p}` }
    }
  }
  return { safe: true }
}

function resolveScriptPath(scriptName: string, projectRoot: string): string {
  const clean = scriptName.replace(/\.\./g, '').replace(/[\\/]/g, '')
  return join(projectRoot || '.', '.aiharness', 'scripts', clean)
}

export function registerShellHandlers(ipcMain: IpcMain, projectRoot?: string, appRoot?: string) {
  const scriptsBase = appRoot || projectRoot  // scripts at root, CWD at projects
  ipcMain.handle('shell:exec', async (_event, command: string, cwd?: string) => {
    const check = isCommandSafe(String(command || ''))
    if (!check.safe) {
      return { status: 'error', summary: check.reason }
    }

    try {
      const parts = String(command).trim().split(/\s+/)
      const cmd = parts[0]
      const args = parts.slice(1)
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: cwd || projectRoot || '.',
        timeout: CMD_TIMEOUT,
        maxBuffer: MAX_OUTPUT,
        shell: false, // Never use shell — prevents cmd.exe metacharacter injection
      })
      const output = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '')
      return {
        status: 'success',
        summary: `命令执行完成 (${output.length} 字符)`,
        detail: output.slice(0, MAX_OUTPUT),
      }
    } catch (err: any) {
      return {
        status: 'error',
        summary: `命令执行失败: ${err.message || err}`,
        detail: err.stderr || err.stdout || '',
      }
    }
  })

  ipcMain.handle('shell:run-script', async (_event, scriptName: string) => {
    const scriptPath = resolveScriptPath(String(scriptName || ''), scriptsBase || '.')
    try {
      const { stdout, stderr } = await execFileAsync('node', [scriptPath], {
        cwd: projectRoot || '.',
        timeout: CMD_TIMEOUT,
        maxBuffer: MAX_OUTPUT,
      })
      return {
        status: 'success',
        summary: `脚本执行完成: ${scriptName}`,
        detail: stdout || stderr || '',
      }
    } catch (err: any) {
      return {
        status: 'error',
        summary: `脚本执行失败: ${err.message}`,
        detail: err.stderr || '',
      }
    }
  })
}
