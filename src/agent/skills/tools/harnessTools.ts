// ── Harness Self-Management Tools (3 tools) ──
// list_rules, update_config, list_audit.
// (learn_rule + write_learning removed in v11.7.2 — learning system retired)

import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types'

export const harnessTools: ToolDefinition[] = [
  // ── list_rules ──
  {
    schema: {
      name: 'list_rules',
      description:
        '列出 .aiharness/rules/ 中所有已学习的规则和经验教训。了解当前有哪些自动规则在生效。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'harness',
    executor: async (_args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { fileService } = await import('@/services/fileService')
      const rules: string[] = []
      try {
        const files = await fileService.listDir('.aiharness/rules')
        for (const f of files as string[]) {
          if (f.endsWith('.md')) rules.push(`[规则] ${f}`)
        }
      } catch { /* no rules dir */ }
      try {
        const autoFiles = await fileService.listDir('.aiharness/rules/auto-learned')
        for (const f of autoFiles as string[]) {
          if (f.endsWith('.json')) {
            try {
              const content = await fileService.read(`.aiharness/rules/auto-learned/${f}`)
              const rule = JSON.parse(content)
              rules.push(`[自动学习] ${rule.title || f}`)
            } catch { rules.push(f) }
          }
        }
      } catch { /* no auto-learned dir */ }
      return {
        status: 'success',
        summary: `${rules.length} 条规则`,
        detail: rules.join('\n') || '(暂无已学习规则)',
      }
    },
  },

  // ── update_config ──
  {
    schema: {
      name: 'update_config',
      description:
        '修改 .aiharness/aiharness.json 中的 Harness 配置项。可以调整权限策略、添加工具约束、修改预算设置。修改后下次会话生效。',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: '配置路径，如 permissions.policies、tools.constraints、budget、hooks',
          },
          changes: {
            type: 'string',
            description: 'JSON 格式的变更内容，会与现有配置合并',
          },
        },
        required: ['section', 'changes'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'harness',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { fileService } = await import('@/services/fileService')
        let config: Record<string, unknown> = {}
        try {
          const raw = await fileService.read('.aiharness/aiharness.json')
          config = JSON.parse(raw)
        } catch { /* new config */ }

        const changes = JSON.parse(String(args.changes || '{}'))
        const section = String(args.section || '')
        const keys = section.split('.')
        let target: Record<string, unknown> = config
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
            target[keys[i]] = {}
          }
          target = target[keys[i]] as Record<string, unknown>
        }
        target[keys[keys.length - 1]] = changes

        await fileService.write('.aiharness/aiharness.json', JSON.stringify(config, null, 2))
        return {
          status: 'success',
          summary: `已更新配置: ${section}`,
          detail: '下次会话生效。可用 list_rules 查看当前规则。',
        }
      } catch (e: any) {
        return { status: 'error', summary: `更新配置失败: ${e.message}` }
      }
    },
  },

  // ── list_audit ──
  {
    schema: {
      name: 'list_audit',
      description:
        '查询 Agent 的反馈记录和会话分析报告（存储在 .aiharness/feedback/）。用于自观测和调试。可查看最近的操作反馈、PostSession 分析和改进建议。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回最近 N 条事件，默认 20，最大 100' },
        },
        required: [],
      },
    },
    permission: 'AUTO',
    category: 'harness',
    executor: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const limit = Math.min(Number(args.limit) || 20, 100)
      try {
        const { fileService } = await import('@/services/fileService')
        const logs: string[] = []
        try {
          const files = await fileService.listDir('.aiharness/feedback')
          for (const f of (files as string[]).slice(-limit)) {
            try {
              const content = await fileService.read(`.aiharness/feedback/${f}`)
              logs.push(`[feedback/${f}] ${content.slice(0, 200)}`)
            } catch { /* skip */ }
          }
        } catch { /* no feedback dir */ }
        return {
          status: 'success',
          summary: `${logs.length} 条记录`,
          detail: logs.length > 0
            ? logs.join('\n---\n')
            : '暂无审计或反馈记录。',
        }
      } catch {
        return { status: 'error', summary: '审计日志查询暂不可用' }
      }
    },
  },
]
