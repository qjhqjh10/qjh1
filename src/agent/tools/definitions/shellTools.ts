import type { ToolDefinition } from '../ToolRegistry'

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
      try {
        const { fileService } = await import('@/services/fileService')
        const result = await (fileService as any).shellExec?.(
          String(args.command),
          args.cwd ? String(args.cwd) : undefined,
        )
        return result || { status: 'error', summary: 'Shell 工具不可用' }
      } catch { return { status: 'error', summary: '命令执行失败' } }
    },
  },
  {
    schema: {
      name: 'shell_run_script',
      description: '执行 .aiharness/scripts/ 目录下的预置脚本（node 运行）。脚本已经过人工审计，无需额外确认。',
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
      try {
        const { fileService } = await import('@/services/fileService')
        const result = await (fileService as any).shellRunScript?.(String(args.name))
        return result || { status: 'error', summary: '脚本工具不可用' }
      } catch { return { status: 'error', summary: '脚本执行失败' } }
    },
  },
]
