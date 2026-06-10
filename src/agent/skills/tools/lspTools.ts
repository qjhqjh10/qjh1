// ── LSP Tool (1 tool) ──
// Self-contained for skill system. Uses electronBridge.lsp for TypeScript
// type checking / diagnostics.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const lspTools: ToolDefinition[] = [
  {
    schema: {
      name: 'lsp_diagnose',
      description:
        '对项目运行 TypeScript 类型检查，返回诊断错误。修改 .ts/.tsx 文件后可调用此工具自检。',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '可选：仅检查指定文件的错误。不填则检查整个项目。',
          },
        },
        required: [],
      },
    },
    permission: 'AUTO',
    category: 'lsp',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        let filePath: string | undefined
        if (args.file_path) {
          const { sanitizePath } = await import('@/utils/security')
          const check = sanitizePath(args.file_path)
          if (!check.valid) return { status: 'error', summary: check.error! }
          filePath = check.value
        }
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.lsp.diagnose(filePath)
        return result || { status: 'error', summary: 'LSP 工具不可用' }
      } catch (e) {
        return {
          status: 'error',
          summary: `lsp_diagnose 失败: ${e instanceof Error ? e.message : '未知错误'}`,
        }
      }
    },
  },
]
