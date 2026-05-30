import { IpcMain, safeStorage } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises'
import { spawn } from 'child_process'

// ── Session storage path ──
function getSessionsPath(projectsPath?: string): string {
  if (!projectsPath) return join(process.cwd(), 'agent-sessions')
  // Use parent of projects dir for agent sessions
  return join(projectsPath, '..', 'agent-sessions')
}

export function registerAgentHandlers(ipcMain: IpcMain, projectsPath?: string) {
  const sessionsPath = getSessionsPath(projectsPath)

  // Ensure sessions directory exists
  mkdir(sessionsPath, { recursive: true }).catch(() => {})

  // ── Session handlers ──

  ipcMain.handle('agent:session-save', async (_event, id: string, data: string) => {
    const filePath = join(sessionsPath, `${id}.json`)
    await writeFile(filePath, data, 'utf-8')
    return { success: true }
  })

  ipcMain.handle('agent:session-load', async (_event, id: string) => {
    const filePath = join(sessionsPath, `${id}.json`)
    try {
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  })

  ipcMain.handle('agent:session-list', async () => {
    try {
      const files = await readdir(sessionsPath)
      const sessions = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const content = await readFile(join(sessionsPath, f), 'utf-8')
          const data = JSON.parse(content)
          if (data.meta) sessions.push(data.meta)
        } catch { /* skip corrupt files */ }
      }
      return sessions.sort((a: any, b: any) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      )
    } catch {
      return []
    }
  })

  ipcMain.handle('agent:session-delete', async (_event, id: string) => {
    const filePath = join(sessionsPath, `${id}.json`)
    try { await unlink(filePath) } catch { /* already gone */ }
    return { success: true }
  })

  // ── Permission handlers ──

  ipcMain.handle('agent:permission-record', async (_event, toolName: string, approved: boolean) => {
    const patternFile = join(sessionsPath, '.permission-patterns.json')
    let patterns: Record<string, { approved: number; denied: number; lastApproved: number | null }> = {}
    try {
      const raw = await readFile(patternFile, 'utf-8')
      patterns = JSON.parse(raw)
    } catch { /* new file */ }

    if (!patterns[toolName]) {
      patterns[toolName] = { approved: 0, denied: 0, lastApproved: null }
    }
    if (approved) {
      patterns[toolName].approved++
      patterns[toolName].lastApproved = Date.now()
    } else {
      patterns[toolName].denied++
    }

    await writeFile(patternFile, JSON.stringify(patterns, null, 2), 'utf-8')
    return { success: true }
  })

  ipcMain.handle('agent:permission-patterns', async () => {
    const patternFile = join(sessionsPath, '.permission-patterns.json')
    try {
      const raw = await readFile(patternFile, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  })

  // ── Budget / Stats handlers ──

  ipcMain.handle('agent:get-sessions-path', async () => {
    return sessionsPath
  })

  // ── Self-Optimize: spawn CLI agent ──
  ipcMain.handle('agent:optimize', async (_event, configId: string, command: string) => {
    // Load config from store and decrypt key
    const { default: Store } = await import('electron-store')
    const store = new Store()
    const configs = store.get('configs', []) as any[]
    const config = configs.find((c: any) => c.id === configId)
    if (!config) throw new Error('Config not found: ' + configId)
    const { decryptKey } = await import('./utils')
    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const apiUrl = config.apiUrl || 'https://api.deepseek.com'
    const model = config.model || 'deepseek-chat'

    return new Promise<string>((resolve, reject) => {
      const scriptPath = join(__dirname, '..', '..', 'scripts', 'agent-cli.mjs')
      const child = spawn('node', [scriptPath, '--self-optimize',
        `--key=${apiKey}`, `--api-url=${apiUrl}`, `--model=${model}`,
        `--command=${command}`, '--max-iters=12',
      ], {
        cwd: join(__dirname, '..', '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let output = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

      child.on('close', (code) => {
        if (code === 0) resolve(output)
        else resolve(output + `\n[进程退出码: ${code}]`)
      })
      child.on('error', (err) => { reject(err.message) })

      // Timeout after 5 minutes
      setTimeout(() => { child.kill(); resolve(output + '\n[超时: 5分钟]') }, 300000)
    })
  })
}
