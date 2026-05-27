// ── MCP Handlers ──
// Model Context Protocol (Anthropic) client for Electron main process.
// Manages MCP server subprocesses via stdio JSON-RPC.

import { IpcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { createInterface } from 'readline'

interface MCPServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled?: boolean
}

interface MCPServerState {
  config: MCPServerConfig
  process: ChildProcess | null
  tools: MCPToolSchema[]
  connected: boolean
}

interface MCPToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const servers = new Map<string, MCPServerState>()
let requestId = 0

function nextId(): number { return ++requestId }

async function sendJsonRpc(proc: ChildProcess, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    const timeout = setTimeout(() => {
      reject(new Error(`MCP 请求超时: ${method}`))
    }, 10_000)

    const onData = (data: Buffer) => {
      try {
        const lines = data.toString().split('\n').filter(l => l.trim())
        for (const line of lines) {
          const msg = JSON.parse(line)
          if (msg.id === id) {
            clearTimeout(timeout)
            proc.stdout?.removeListener('data', onData)
            if (msg.error) reject(new Error(msg.error.message || 'MCP error'))
            else resolve(msg.result)
            return
          }
        }
      } catch { /* partial line, wait for more */ }
    }

    proc.stdout?.on('data', onData)
    proc.stdin?.write(request + '\n')
  })
}

const MCP_ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3']
const MCP_BLOCKED_ARG_PATTERNS = [/;/, /\|/, /&&/, /\$\(/, /`/, /\\|/, /sudo/, /rm\s+-rf/]

function validateMCPCommand(command: string, args: string[]): { valid: boolean; reason?: string } {
  if (!MCP_ALLOWED_COMMANDS.includes(command)) {
    return { valid: false, reason: `MCP 不允许的命令: ${command}。允许: ${MCP_ALLOWED_COMMANDS.join(', ')}` }
  }
  for (const arg of args) {
    for (const p of MCP_BLOCKED_ARG_PATTERNS) {
      if (p.test(arg)) {
        return { valid: false, reason: `MCP 参数包含禁止模式: ${p}` }
      }
    }
  }
  return { valid: true }
}

function inferPermission(schema: MCPToolSchema): string {
  const name = (schema.name || '').toLowerCase()
  const desc = (schema.description || '').toLowerCase()
  if (/delete|remove|drop|destroy|erase/.test(name + desc)) return 'DANGEROUS_ASK'
  if (/write|create|update|edit|modify|save|set|put|post|patch/.test(name + desc)) return 'PROJECT_ASK'
  if (/read|get|list|search|find|query|fetch|view|show/.test(name + desc)) return 'READ_ASK'
  return 'PROJECT_ASK' // Conservative default for unknown MCP tools
}

async function connectServer(config: MCPServerConfig): Promise<MCPToolSchema[]> {
  // Validate command before spawning
  const validation = validateMCPCommand(config.command, config.args)
  if (!validation.valid) {
    throw new Error(validation.reason)
  }

  const existing = servers.get(config.name)
  if (existing?.connected) return existing.tools

  const proc = spawn(config.command, config.args, {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      USER: process.env.USER || process.env.USERNAME || '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const state: MCPServerState = { config, process: proc, tools: [], connected: false }
  servers.set(config.name, state)

  // Log stderr for debugging
  proc.stderr?.on('data', (d: Buffer) => {
    console.error(`[MCP:${config.name}] ${d.toString().slice(0, 200)}`)
  })

  proc.on('exit', (code) => {
    state.connected = false
    if (code !== 0) console.error(`[MCP:${config.name}] 进程退出, code=${code}`)
  })

  try {
    // Initialize
    await sendJsonRpc(proc, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'AIWritingAssistant', version: '1.0' },
    })

    // Get tools
    const result = await sendJsonRpc(proc, 'tools/list')
    state.tools = result?.tools || []
    state.connected = true

    console.log(`[MCP:${config.name}] 已连接, ${state.tools.length} 个工具`)
    return state.tools
  } catch (err) {
    console.error(`[MCP:${config.name}] 连接失败:`, err)
    state.connected = false
    return []
  }
}

export function registerMCPHandlers(ipcMain: IpcMain) {
  ipcMain.handle('mcp:list-servers', async () => {
    const list: Array<{ name: string; connected: boolean; tools: number }> = []
    for (const [name, state] of servers) {
      list.push({ name, connected: state.connected, tools: state.tools.length })
    }
    return { status: 'success', servers: list }
  })

  ipcMain.handle('mcp:connect', async (_event, name: string, config: MCPServerConfig) => {
    try {
      const tools = await connectServer(config || { name, command: 'npx', args: [] })
      return { status: 'success', summary: `已连接 MCP: ${name}`, detail: JSON.stringify(tools) }
    } catch (err) {
      return { status: 'error', summary: `MCP 连接失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })

  ipcMain.handle('mcp:call-tool', async (_event, serverName: string, toolName: string, args: Record<string, unknown>) => {
    const state = servers.get(serverName)
    if (!state?.connected || !state.process) {
      return { status: 'error', summary: `MCP server 未连接: ${serverName}` }
    }
    try {
      const result = await sendJsonRpc(state.process, 'tools/call', {
        name: toolName, arguments: args,
      })
      return { status: 'success', summary: `${toolName} 执行完成`, detail: JSON.stringify(result) }
    } catch (err) {
      return { status: 'error', summary: `MCP 工具调用失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })

  ipcMain.handle('mcp:list-tools', async (_event, serverName: string) => {
    const state = servers.get(serverName)
    return {
      status: 'success',
      summary: `${state?.tools.length || 0} 个工具`,
      detail: JSON.stringify(state?.tools || []),
    }
  })
}
