import type { ContextProvider } from '../ContextAssembler'
import { isTaskMessage } from '../../utils/taskDetection'

export const planWorkflowProvider: ContextProvider = {
  domain: 'plan-workflow',
  relevance: (userMessage) => {
    if (isTaskMessage(userMessage)) return 1.0
    return 0
  },

  buildContext: async () => {
    return {
      domain: 'plan-workflow',
      priority: 95,
      estimatedTokens: 600,
      content: [
        '## 执行计划工作流程',
        '',
        '当用户提出需要工具操作的请求时，遵循以下流程:',
        '',
        '### 第一步：输出结构化计划',
        '使用 ```thinking JSON 代码块输出执行计划（不要同时调用工具）。格式:',
        '```thinking',
        '{',
        '  "intent": "一句话描述用户意图",',
        '  "steps": [',
        '    { "id": "step_1", "tool": "read_file", "action": "描述操作", "args": {"file_path": "相对路径"}, "expectedOutcome": "预期结果" },',
        '    { "id": "step_2", "tool": "create_file", "action": "描述操作", "args": {"file_path": "相对路径"}, "expectedOutcome": "预期结果" }',
        '  ],',
        '  "dependencies": [],',
        '  "estimatedTokens": 500',
        '}',
        '```',
        '',
        '### 第二步：等待用户批准',
        '输出计划后等待。用户会看到你的计划并可批准/拒绝各步骤。不要自行开始执行。',
        '如果是问候、闲聊等不需要工具的消息，直接回复即可，跳过此流程。',
      ].join('\n'),
    }
  },
}
