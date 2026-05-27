import type { ToolDefinition } from '../ToolRegistry'

export const promptTools: ToolDefinition[] = [
  {
    schema: {
      name: 'list_prompts',
      description: '列出提示词库中所有提示词模板。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permission: 'AUTO',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async () => {
      const { useSettingsStore } = await import('@/store')
      const prompts = useSettingsStore.getState().prompts
      const lines = prompts.map(p => `[${p.enabled ? '✓启用' : '  关闭'}] ${p.id} | ${p.title} | 类型:${p.type}`)
      return { status: 'success', summary: `${prompts.length} 个提示词模板`, detail: lines.join('\n') }
    },
  },
  {
    schema: {
      name: 'toggle_prompt',
      description: '启用或关闭某个提示词模板。同类型只能启用一个。',
      parameters: {
        type: 'object',
        properties: {
          prompt_id: { type: 'string', description: '提示词模板 ID' },
          enabled: { type: 'boolean', description: 'true=启用, false=关闭' },
        },
        required: ['prompt_id', 'enabled'],
      },
    },
    permission: 'READ_ASK',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async (args) => {
      const { useSettingsStore } = await import('@/store')
      const store = useSettingsStore.getState()
      const prompts = store.prompts
      const pid = String(args.prompt_id || '')
      const enable = args.enabled !== false
      const target = prompts.find(p => p.id === pid)

      if (!target) return { status: 'error', summary: `未找到提示词: ${pid}` }
      if (enable) {
        const sameType = prompts.filter(p => p.type === target.type && p.id !== pid && p.enabled)
        for (const p of sameType) store.updatePrompt(p.id, { enabled: false })
        store.updatePrompt(pid, { enabled: true })
        const disabled = sameType.map(p => p.title).join('、')
        return { status: 'success', summary: `已启用「${target.title}」${disabled ? `（自动关闭: ${disabled}）` : ''}` }
      }
      store.updatePrompt(pid, { enabled: false })
      return { status: 'success', summary: `已关闭「${target.title}」` }
    },
  },
  {
    schema: {
      name: 'update_prompt',
      description: '修改提示词模板的标题或内容。',
      parameters: {
        type: 'object',
        properties: {
          prompt_id: { type: 'string', description: '提示词模板 ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容（可选）' },
          type: { type: 'string', description: '新类型（可选）' },
        },
        required: ['prompt_id'],
      },
    },
    permission: 'READ_ASK',
    category: 'prompt',
    availableInPlanMode: true,
    executor: async (args) => {
      const { useSettingsStore } = await import('@/store')
      const store = useSettingsStore.getState()
      const pid = String(args.prompt_id || '')
      const updates: Record<string, unknown> = {}
      if (args.title) updates.title = String(args.title)
      if (args.content) updates.content = String(args.content)
      if (args.type) updates.type = String(args.type)
      if (Object.keys(updates).length === 0) return { status: 'error', summary: '没有提供要修改的字段' }
      store.updatePrompt(pid, updates)
      const fields = Object.keys(updates).join('、')
      return { status: 'success', summary: `已更新提示词 ${fields}` }
    },
  },
]
