// ── 内置技能: 多意图任务编排 ──
// 当用户消息同时触发多个 Skill 时，此技能负责：
// 1. 列出检测到的所有子任务
// 2. 确认执行顺序
// 3. 逐个执行（每完成一个汇报进度）
// 4. 全部完成后总结
//
// 此技能不直接操作文件 — 它协调其他 Skill 的执行。

import type { SkillDefinition } from '../types'

export const taskOrchestrationSkill: SkillDefinition = {
  id: 'task-orchestration',
  name: '多任务编排',
  description: '当用户消息包含多个独立任务（如"创建角色+写大纲+记笔记"）时，协调子任务的顺序执行。不操作文件，仅规划执行顺序和跟踪进度。',
  triggerPatterns: [
    // 编号列表
    '\\b[123]\\s*[.、）)]\\s*\\S',
    // 多任务关键词
    '(?:先|再|然后|最后|接着).*(?:再|然后|接着)',
    // 明确的"帮我做X件事"
    '帮我.*做.*[两三几].*件',
    // "还有""另外""同时"
    '还有.*[也还].*',
    '另外.*[也还].*',
  ],
  category: 'general',
  workflow: {
    description:
      '## 多任务编排流程\n' +
      '当用户消息包含多个独立操作时，按以下流程处理：\n\n' +
      '1. **分析子任务**: 拆解用户消息，列出所有独立的子任务（如"任务A: 创建角色 / 任务B: 写大纲 / 任务C: 记笔记"）\n' +
      '2. **确认顺序**: 如果用户指定了顺序，严格遵循。如果没指定，按用户提出的先后顺序。先向用户确认："我按以下顺序执行：①→②→③，可以吗？"\n' +
      '3. **逐个执行**: 完成一个子任务的所有步骤后，才开始下一个\n' +
      '   - 每完成一个子任务，汇报"✅ 任务X已完成（共N个，剩余M个）"\n' +
      '   - 如果某个子任务失败，报告原因后继续下一个\n' +
      '4. **全部完成后总结**: 列出所有完成的操作',
    steps: [
      { order: 1, tool: 'think', purpose: '拆解用户消息为子任务列表，列出每个子任务需要调用的工具', argsTemplate: { thought: '子任务1: [描述] → 工具: [...]; 子任务2: ...' }, optional: false },
      { order: 2, tool: 'list_directory', purpose: '了解项目已有文件结构', argsTemplate: { path: '${projectId}/' }, optional: true },
      // 步骤3-5由模型自主迭代 — 编排器提供 think 工具用于子任务间切换
      // 所有匹配的子 Skill 的工具已合并到可用工具集中（isMultiSkill 机制）
    ],
    maxIterations: 20,  // v9.5.3: 多任务需要更多轮次
  },
  qualityChecks: [
    { id: 'qc-all-tasks-listed', description: '所有子任务都已列出，无遗漏', severity: 'error', check: '子任务列表覆盖用户所有要求' },
    { id: 'qc-order-confirmed', description: '执行前已向用户确认顺序', severity: 'warn', check: '文本回复中包含顺序确认' },
    { id: 'qc-progress-reported', description: '每完成一个子任务都有进度汇报', severity: 'warn', check: '回复中含"X/Y 完成"或进度标记' },
    { id: 'qc-all-completed', description: '全部子任务完成后有总结', severity: 'error', check: '全部完成后有总结性回复' },
  ],
  inputSchema: {
    fields: [
      { name: 'taskCount', description: '子任务数量', type: 'number', required: false, extractFrom: '(\\d+)\\s*[个项条]' },
    ],
    extractionHint: '提取用户消息中的所有独立操作意图。',
  },
  examples: [
    {
      userInput: '帮我做三件事：创建角色林逸，给第1章写大纲，把灵感记到笔记里',
      skillOutput: '收到三个任务。按顺序执行：①创建角色 → ②写大纲 → ③记笔记。现在开始。',
      toolCallsExpected: ['think', 'think', 'list_directory', 'create_file', 'edit_file', 'write_note'],
    },
  ],
  metadata: {
    version: '1.0.0', author: '青剑内置', source: 'builtin',
    enabled: true, priority: 95,  // 高优先级 — 多意图应优先于单 Skill
    createdAt: '2026-06-05', updatedAt: '2026-06-05',
  },
}
