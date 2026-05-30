// ── Intent Analyzer ──
// Extracted from AgentRuntime.analyzeIntent().
// Simple keyword-based intent detection — pure function, no dependencies.

import type { ThinkingContext } from './AgentEventEmitter'

export function analyzeIntent(userMessage: string): ThinkingContext {
  const steps: { tool: string; action: string }[] = []

  if (/创建|新建/.test(userMessage)) steps.push({ tool: 'create_file', action: '创建文件' })
  if (/编辑|修改(?!善)|改动/.test(userMessage)) steps.push({ tool: 'edit_file', action: '编辑文件' })
  if (/查看|读取/.test(userMessage)) steps.push({ tool: 'read_file', action: '读取文件' })
  if (/删除|移除/.test(userMessage)) steps.push({ tool: 'delete_file', action: '删除文件' })

  return {
    intent: userMessage.slice(0, 100),
    steps: steps.length > 0 ? steps : [{ tool: 'read_file', action: '分析需求' }],
    filesNeeded: [],
    estimatedTokens: 500,
    timestamp: Date.now(),
  }
}
