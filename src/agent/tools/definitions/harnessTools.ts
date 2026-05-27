// ── Harness Self-Management Tools ──
// Allows the Agent to modify its own configuration (.aiharness/)
// enabling self-repair: learn from errors → write rules → prevent recurrence

import type { ToolDefinition } from '../ToolRegistry'

function sanitizeHarnessPath(p: string): string {
  let clean = p.replace(/\\/g, '/')
  while (clean.includes('../')) clean = clean.replace(/\.\.\//g, '')
  if (!clean.startsWith('.aiharness/')) clean = '.aiharness/' + clean.replace(/^\/+/, '')
  return clean
}

export const harnessTools: ToolDefinition[] = [
  // ── list_rules — 列出已学习/已配置的规则 ──
  {
    schema: {
      name: 'list_rules',
      description: '列出 .aiharness/rules/ 中所有已学习的规则和经验教训。了解当前有哪些自动规则在生效。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async (_args, ctx) => {
      const { fileService } = await import('@/services/fileService')
      const rules: string[] = []
      try {
        // Try listing .aiharness/rules/
        const files = await fileService.listDir('.aiharness/rules')
        for (const f of files) {
          if (f.endsWith('.md')) {
            try { rules.push(f) } catch { /* */ }
          }
        }
      } catch { /* no rules dir */ }
      try {
        const autoFiles = await fileService.listDir('.aiharness/rules/auto-learned')
        for (const f of autoFiles) {
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

  // ── learn_rule — 从经验中学习并持久化规则 ──
  {
    schema: {
      name: 'learn_rule',
      description: '记录一条经验规则到 .aiharness/rules/auto-learned/，防止以后再次发生同样的错误。当你发现某个错误反复出现时，调用此工具将其记录为规则。下次会话自动生效。',
      parameters: {
        type: 'object',
        properties: {
          trigger: { type: 'string', description: '什么情况触发此规则，如"使用 create_file 创建角色 JSON 时"' },
          problem: { type: 'string', description: '之前发生了什么问题' },
          solution: { type: 'string', description: '正确的做法是什么' },
          category: { type: 'string', description: '分类: format|path|permission|tool_choice' },
        },
        required: ['trigger', 'problem', 'solution'],
      },
    },
    permission: 'READ_ASK',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { fileService } = await import('@/services/fileService')
        await fileService.ensureDir('.aiharness/rules/auto-learned')

        const rule = {
          title: `[自动学习] ${args.trigger}`,
          trigger: String(args.trigger || ''),
          problem: String(args.problem || ''),
          solution: String(args.solution || ''),
          category: String(args.category || 'general'),
          createdAt: new Date().toISOString(),
          status: 'auto-draft',
        }

        const id = `rule_${Date.now().toString(36)}`
        await fileService.write(`.aiharness/rules/auto-learned/${id}.json`, JSON.stringify(rule, null, 2), )
        return { status: 'success', summary: `已记录规则: ${id}`, detail: `下次会话此规则将自动生效。可在 .aiharness/rules/auto-learned/ 查看。` }
      } catch (e: any) {
        return { status: 'error', summary: `记录规则失败: ${e.message}` }
      }
    },
  },

  // ── update_config — 修改 Harness 配置 ──
  {
    schema: {
      name: 'update_config',
      description: '修改 .aiharness/aiharness.json 中的 Harness 配置项。可以调整权限策略、添加工具约束、修改预算设置。修改后下次会话生效。',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: '配置路径，如 permissions.policies、tools.constraints、budget、hooks' },
          changes: { type: 'string', description: 'JSON 格式的变更内容，会与现有配置合并' },
        },
        required: ['section', 'changes'],
      },
    },
    permission: 'DANGEROUS_ASK',
    category: 'prompt',
    availableInPlanMode: false,
    executor: async (args) => {
      try {
        const { fileService } = await import('@/services/fileService')
        let config: Record<string, unknown> = {}
        try {
          const raw = await fileService.read('.aiharness/aiharness.json')
          config = JSON.parse(raw)
        } catch { /* 新配置 */ }

        // Parse changes
        const changes = JSON.parse(String(args.changes || '{}'))
        const section = String(args.section || '')

        // Navigate to the section and merge
        const keys = section.split('.')
        let target: Record<string, unknown> = config
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
            target[keys[i]] = {}
          }
          target = target[keys[i]] as Record<string, unknown>
        }
        const lastKey = keys[keys.length - 1]
        target[lastKey] = changes

        await fileService.write('.aiharness/aiharness.json', JSON.stringify(config, null, 2))
        return { status: 'success', summary: `已更新配置: ${section}`, detail: '下次会话生效。可用 list_rules 查看当前规则。' }
      } catch (e: any) {
        return { status: 'error', summary: `更新配置失败: ${e.message}` }
      }
    },
  },
]
