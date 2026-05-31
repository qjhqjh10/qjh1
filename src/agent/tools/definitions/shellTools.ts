import type { ToolDefinition } from '../ToolRegistry'
import { err } from '../resultHelpers'
import { checkCommand, sanitizeFileName } from '@/utils/security'

const ALLOWED_COMMANDS = new Set(['node', 'python', 'python3', 'git', 'npm', 'npx'])

export const shellTools: ToolDefinition[] = [
  {
    schema: {
      name: 'shell_exec',
      description: '执行系统命令（仅允许 node/python/git/npm/npx）。需要用户双确认。输出限制 50KB，超时 30 秒。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令，如 "npx tsc --noEmit" 或 "git status"' },
          cwd: { type: 'string', description: '工作目录，默认项目根目录' },
        },
        required: ['command'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'shell',
    availableInPlanMode: false,
    executor: async (args) => {
      const check = checkCommand(args.command, ALLOWED_COMMANDS)
      if (!check.valid) return { status: 'error', summary: check.error! }
      const cmd = check.value
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.shell.exec(cmd, args.cwd ? String(args.cwd) : undefined)
        return result || { status: 'error', summary: 'Shell 工具不可用' }
      } catch (e) { return err('shell_exec', e) }
    },
  },
  {
    schema: {
      name: 'shell_run_script',
      description: '执行 .aiharness/scripts/ 目录下的预置脚本（node 运行）。需要用户确认后执行。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '脚本文件名，如 "validate-json.mjs"' },
        },
        required: ['name'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'shell',
    availableInPlanMode: false,
    executor: async (args) => {
      const check = sanitizeFileName(args.name)
      if (!check.valid) return { status: 'error', summary: check.error! }
      const name = check.value
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.shell.runScript(name)
        return result || { status: 'error', summary: '脚本工具不可用' }
      } catch (e) { return err('shell_run_script', e) }
    },
  },
]
