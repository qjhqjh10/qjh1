import type { ToolDefinition } from '../ToolRegistry'

export const lspTools: ToolDefinition[] = [
  {
    schema: {
      name: 'lsp_diagnose',
      description: '对项目运行 TypeScript 类型检查，返回诊断错误。修改 .ts/.tsx 文件后可调用此工具自检。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '可选：仅检查指定文件的错误。不填则检查整个项目。' },
        },
        required: [],
      },
    },
    permission: 'AUTO',
    category: 'shell', // reuse shell category — it's a read-only check
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { bridge } = await import('@/services/electronBridge')
        const result = await bridge.lsp.diagnose(
          args.file_path ? String(args.file_path) : undefined,
        )
        return result || { status: 'error', summary: 'LSP 工具不可用' }
      } catch { return { status: 'error', summary: '诊断失败' } }
    },
  },
]
