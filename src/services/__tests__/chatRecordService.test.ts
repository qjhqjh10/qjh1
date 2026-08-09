// ── ChatRecordService 会话记录导出测试 ──
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fileService 层（chatRecordService 通过动态 import 使用 fileService）
const writes: Record<string, string> = {}
const ensuredDirs: string[] = []

vi.mock('@/services/fileService', () => ({
  fileService: {
    ensureDir: async (d: string) => { ensuredDirs.push(d); return true },
    write: async (p: string, content: string) => { writes[p] = content; return true },
  },
  appService: { getProjectsBasePath: async () => 'D:/x/projects' },
}))

// Mock store（getRecordsDir 用 projectsBasePath）
vi.mock('@/store', () => ({
  useStore: { getState: () => ({ projectsBasePath: 'D:/x/projects' }) },
}))

import { exportConversationRecord } from '../chatRecordService'
import type { Conversation } from '@/components/ai/chat/types'

function makeConv(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv_1',
    title: '角色扮演测试',
    createdAt: 1786200000000,
    messages: [
      { id: 'u1', role: 'user', content: '师姐帮我改标题', timestamp: 1786200001000 },
      {
        id: 'a1', role: 'assistant', content: '改好了', timestamp: 1786200005000,
        toolsUsed: ['search_content', 'edit_file'],
        toolCallSteps: [
          { tool: 'search_content', status: 'success', summary: '找到 3 个匹配' },
          { tool: 'edit_file', status: 'success', summary: '已替换 1 处' },
        ],
        usage: {
          prompt_tokens: 8000, completion_tokens: 300, total_tokens: 8300,
          cost: 0.01, cacheHitTokens: 7000, cacheCreationTokens: 0,
        },
        apiCallDetails: [
          { iteration: 1, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 2500, toolCall: true, model: 'deepseek-v4-flash', finishReason: 'tool_use' },
          { iteration: 2, inputTokens: 500, outputTokens: 100, cacheReadTokens: 7000, cacheCreationTokens: 0, durationMs: 1200, toolCall: true, model: 'deepseek-v4-flash', finishReason: 'tool_use' },
        ],
      },
    ],
    totalTokens: 8300,
    lastPromptTokens: 0,
    peakPromptTokens: 0,
    ...overrides,
  }
}

describe('chatRecordService — 会话记录导出', () => {
  beforeEach(() => {
    Object.keys(writes).forEach(k => delete writes[k])
    ensuredDirs.length = 0
  })

  it('导出到 chat-records/<会话名>/ 目录并生成 4 个文件', async () => {
    const dir = await exportConversationRecord(makeConv())
    expect(dir).toContain('chat-records')
    expect(dir).toContain('角色扮演测试')
    expect(Object.keys(writes).length).toBe(4)
    expect(writes[`${dir}/conversation.json`]).toBeDefined()
    expect(writes[`${dir}/api-calls.jsonl`]).toBeDefined()
    expect(writes[`${dir}/tools.jsonl`]).toBeDefined()
    expect(writes[`${dir}/summary.json`]).toBeDefined()
  })

  it('conversation.json 含完整对话流（消息/工具/usage/apiCallDetails）', async () => {
    const dir = await exportConversationRecord(makeConv())
    const conv = JSON.parse(writes[`${dir}/conversation.json`])
    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[1].toolsUsed).toEqual(['search_content', 'edit_file'])
    expect(conv.messages[1].apiCallDetails).toHaveLength(2)
    expect(conv.messages[1].apiCallDetails[1].cacheReadTokens).toBe(7000)
  })

  it('api-calls.jsonl 每行一条调用，含缓存命中率', async () => {
    const dir = await exportConversationRecord(makeConv())
    const lines = writes[`${dir}/api-calls.jsonl`].trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.toolCall).toBe(true)
    expect(first.model).toBe('deepseek-v4-flash')
    expect(first.hitRate).toBe(0)  // 首轮无缓存
    const second = JSON.parse(lines[1])
    expect(second.hitRate).toBe(93.3)  // 7000/(500+7000) = 93.3%
  })

  it('tools.jsonl 含工具明细（名称/状态/摘要）', async () => {
    const dir = await exportConversationRecord(makeConv())
    const lines = writes[`${dir}/tools.jsonl`].trim().split('\n')
    // toolCallSteps 2 条 + toolsUsed 2 条 = 4 行
    expect(lines).toHaveLength(4)
    expect(JSON.parse(lines[0]).tool).toBe('search_content')
    expect(JSON.parse(lines[0]).status).toBe('success')
  })

  it('summary.json 含会话摘要（API 统计/缓存命中率/工具分布）', async () => {
    const dir = await exportConversationRecord(makeConv())
    const summary = JSON.parse(writes[`${dir}/summary.json`])
    expect(summary.messageCount).toBe(2)
    expect(summary.userMessageCount).toBe(1)
    expect(summary.api.callCount).toBe(2)
    expect(summary.api.totalCacheReadTokens).toBe(7000)
    // 总命中率 = 7000 / (8000 + 7000) = 46.7%
    expect(summary.api.cacheHitRate).toBe(46.7)
    expect(summary.api.avgDurationMs).toBe(1850)
    expect(summary.tools.byName.search_content).toBeGreaterThan(0)
    expect(summary.tools.byName.edit_file).toBeGreaterThan(0)
  })

  it('会话名清洗（非法字符 → 下划线，截断 40 字）', async () => {
    const dir = await exportConversationRecord(makeConv({ title: '测试:会话/特殊*字符?名称太长了超过四十个字应该被截断掉只保留前面部分' }))
    expect(dir).toContain('chat-records')
    // 只检查目录名部分（路径最后一段）不含非法字符
    const dirName = dir!.split('/').pop()!
    expect(dirName).not.toMatch(/[<>:"|?*]/)
    expect(dirName).not.toContain('/')
    expect(dirName.length).toBeLessThanOrEqual(60)  // 时间戳前缀(19) + _ + 40 字上限
  })
})
