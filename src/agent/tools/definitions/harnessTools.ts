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
            rules.push(`[规则] ${f}`)  // L2: consistent format with auto-learned rules
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

        // Write in LearnedRule format (matching SkillLearner.loadLearned() expectation)
        const now = Date.now()
        const ruleId = `rule_${now.toString(36)}`
        const rule = {
          id: ruleId,
          title: `[手动学习] ${args.trigger}`,
          when: `当调用相关工具遇到 ${args.category || '错误'} 类型的问题时`,
          rule: `## 经验教训\n**问题**: ${args.problem}\n\n**解决方案**: ${args.solution}`,
          source: {
            id: `pat_${now.toString(36)}`,
            toolName: '',
            errorCategory: String(args.category || 'manual'),
            errorSnippet: String(args.problem || '').slice(0, 100),
            solution: String(args.solution || ''),
            occurrenceCount: 1,
            lastSeen: now,
            sessions: [],
            projects: [],
          },
          createdAt: now,
          isAutoDraft: true,
        }

        await fileService.write(`.aiharness/rules/auto-learned/${ruleId}.json`, JSON.stringify(rule, null, 2))
        return { status: 'success', summary: `已记录规则: ${ruleId}`, detail: `下次会话此规则将自动生效。可在 .aiharness/rules/auto-learned/ 查看。` }
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

  // ── list_audit — 查询 Agent 自身的操作审计日志 ──
  {
    schema: {
      name: 'list_audit',
      description: '查询 Agent 自身的操作审计日志，用于自观测和调试。可查看最近的工具调用、状态变更和错误记录。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回最近 N 条事件，默认 20，最大 100' },
        },
        required: [],
      },
    },
    permission: 'AUTO',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async (args) => {
      const limit = Math.min(Number(args.limit) || 20, 100)
      try {
        const { fileService } = await import('@/services/fileService')
        const logs: string[] = []
        try {
          const files = await fileService.listDir('.aiharness/feedback')
          for (const f of files.slice(-limit)) {
            try {
              const content = await fileService.read(`.aiharness/feedback/${f}`)
              logs.push(`[feedback/${f}] ${content.slice(0, 200)}`)
            } catch { /* */ }
          }
        } catch { /* */ }
        return {
          status: 'success',
          summary: `${logs.length} 条记录`,
          detail: logs.length > 0
            ? logs.join('\n---\n')
            : '暂无审计或反馈记录。Agent 每次会话结束时会自动生成 PostSession 分析和反馈建议到 .aiharness/feedback/。',
        }
      } catch {
        return { status: 'error', summary: '审计日志查询暂不可用' }
      }
    },
  },
]
