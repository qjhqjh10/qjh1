// ── Harness Self-Management Tools (1 tool) ──
// list_rules — 列出已学习规则。update_config/list_audit 已移除（用户可手动操作）。
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

  // update_config, list_audit removed in v13.2.0 — 用户可手动编辑 .aiharness/aiharness.json 和查看 .aiharness/feedback/
]
