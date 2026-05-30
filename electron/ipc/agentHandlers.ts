import { app, IpcMain, safeStorage } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises'
import { spawn } from 'child_process'

// ── Session storage path ──
function getSessionsPath(projectsPath?: string): string {
  if (projectsPath) return join(projectsPath, '..', 'agent-sessions')
  // Fallback: use Electron's standard userData path, not process.cwd()
  try {
    return join(app.getPath('userData'), 'agent-sessions')
  } catch {
    return join(process.cwd(), 'agent-sessions')
  }
}

// Validate session ID to prevent path traversal
function validateSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
}

export function registerAgentHandlers(ipcMain: IpcMain, projectsPath?: string) {
  const sessionsPath = getSessionsPath(projectsPath)

  // Ensure sessions directory exists — log failure instead of silently ignoring
  mkdir(sessionsPath, { recursive: true }).catch((err) => {
    console.error('[agentHandlers] Failed to create sessions directory:', sessionsPath, err)
  })

  // ── Session handlers ──

  ipcMain.handle('agent:session-save', async (_event, id: string, data: string) => {
    if (!validateSessionId(id)) throw new Error('Invalid session ID: ' + id)
    if (typeof data !== 'string' || data.length > 10_000_000) throw new Error('Session data too large or invalid')
    const filePath = join(sessionsPath, `${id}.json`)
    try {
      await writeFile(filePath, data, 'utf-8')
      return { success: true }
    } catch (err) {
      console.error('[agentHandlers] session-save failed:', filePath, err)
      throw new Error(`Failed to save session: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  })

  ipcMain.handle('agent:session-load', async (_event, id: string) => {
    if (!validateSessionId(id)) return null
    const filePath = join(sessionsPath, `${id}.json`)
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch (err: any) {
      // Distinguish file-not-found from other errors
      if (err?.code === 'ENOENT') return null
      console.error('[agentHandlers] session-load read failed:', filePath, err)
      return null
    }
    try {
      return JSON.parse(content)
    } catch (err) {
      console.error('[agentHandlers] session-load JSON parse failed:', filePath, err)
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
        } catch (err) { console.warn('[agentHandlers] skipping corrupt session file:', f, err) }
      }
      return sessions.sort((a: any, b: any) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      )
    } catch (err) {
      console.error('[agentHandlers] session-list failed:', err)
      return []
    }
  })

  ipcMain.handle('agent:session-delete', async (_event, id: string) => {
    if (!validateSessionId(id)) return { success: false }
    const filePath = join(sessionsPath, `${id}.json`)
    try { await unlink(filePath) } catch (err: any) {
      if (err?.code !== 'ENOENT') console.error('[agentHandlers] session-delete failed:', filePath, err)
    }
    return { success: true }
  })

  // ── Permission handlers ──

  ipcMain.handle('agent:permission-record', async (_event, toolName: string, approved: boolean) => {
    const patternFile = join(sessionsPath, '.permission-patterns.json')
    let patterns: Record<string, { approved: number; denied: number; lastApproved: number | null }> = {}
    try {
      const raw = await readFile(patternFile, 'utf-8')
      if (raw.trim()) {
        patterns = JSON.parse(raw)
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        // new file — start with empty patterns
      } else {
        // Corrupt file — backup and start fresh instead of silently overwriting
        console.error('[agentHandlers] Corrupt permission patterns file, backing up:', err)
        try {
          await writeFile(patternFile + '.bak', await readFile(patternFile, 'utf-8').catch(() => ''), 'utf-8')
        } catch { /* backup failed, proceed with fresh patterns */ }
      }
    }

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
      if (raw.trim()) return JSON.parse(raw)
      return {}
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error('[agentHandlers] Failed to load permission patterns:', err)
      }
      return {}
    }
  })

  // ── Budget / Stats handlers ──

  ipcMain.handle('agent:get-sessions-path', async () => {
    return sessionsPath
  })

  // ── Self-Optimize: spawn CLI agent ──
  ipcMain.handle('agent:optimize', async (_event, configId: string, command: string) => {
    // Validate inputs
    if (!configId || typeof configId !== 'string') throw new Error('Invalid configId')
    if (!command || typeof command !== 'string' || command.length > 2000) throw new Error('Invalid command')

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
      let settled = false
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      // Pass API key via environment variable (not CLI args — visible to all processes)
      const child = spawn('node', [scriptPath, '--self-optimize',
        `--api-url=${apiUrl}`, `--model=${model}`,
        `--command=${command}`, '--max-iters=12',
      ], {
        cwd: join(__dirname, '..', '..'),
        env: { ...process.env, AI_API_KEY: apiKey },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let output = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

      const cleanup = () => {
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
        try { child.kill() } catch { /* already dead */ }
      }

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle!)
        if (code === 0) resolve(output)
        else resolve(output + `\n[进程退出码: ${code}]`)
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`CLI agent 启动失败: ${err.message}`))
      })

      // Timeout after 5 minutes — clear timer on settle
      timeoutHandle = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve(output + '\n[超时: 5分钟]')
      }, 300000)
    })
  })
}
