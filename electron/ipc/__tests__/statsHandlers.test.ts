// ── Stats Handlers 纯函数测试（v14 批处理）──
// 覆盖 parseAuditJsonl：会话统计聚合（cost/toolErrors/permissionDenied/lastUsed）与兼容性

import { describe, it, expect } from 'vitest'
import { parseAuditJsonl } from '../statsHandlers'

const T0 = 1750000000000
const T1 = 1750000006000

describe('parseAuditJsonl', () => {
  it('聚合 api:call 的 tokens/cost/model，且不截断 sessionId', () => {
    const lines = [
      JSON.stringify({ timestamp: T0, sessionId: 'ant_abcdefghijklmnopqrstuvwxyz', event: 'session:start', data: {} }),
      JSON.stringify({ timestamp: T1, sessionId: 's1', event: 'api:call', data: { promptTokens: 100, completionTokens: 50, cost: 0.0012, model: 'deepseek-v4-flash' } }),
      JSON.stringify({ timestamp: T1 + 1, sessionId: 's1', event: 'api:call', data: { promptTokens: 200, completionTokens: 80, cost: 0.0024 } }),
    ]
    const s = parseAuditJsonl(lines, 'ant_abcdefghijklmnopqrstuvwxyz')!
    expect(s).not.toBeNull()
    expect(s.sessionId).toBe('ant_abcdefghijklmnopqrstuvwxyz') // 完整 id（deleteSession 依赖）
    expect(s.apiCallCount).toBe(2)
    expect(s.promptTokens).toBe(300)
    expect(s.completionTokens).toBe(130)
    expect(s.totalTokens).toBe(430)
    expect(s.cost).toBeCloseTo(0.0036)
    expect(s.lastUsed).toBe(new Date(T1 + 1).toISOString())
  })

  it('toolErrors: tool:result 非 success 计数（error/blocked），success 不计', () => {
    const lines = [
      JSON.stringify({ timestamp: T0, sessionId: 's1', event: 'session:start', data: {} }),
      JSON.stringify({ timestamp: T1, sessionId: 's1', event: 'tool:result', data: { toolName: 'read_file', status: 'success' } }),
      JSON.stringify({ timestamp: T1 + 1, sessionId: 's1', event: 'tool:result', data: { toolName: 'edit_file', status: 'error' } }),
      JSON.stringify({ timestamp: T1 + 2, sessionId: 's1', event: 'tool:result', data: { toolName: 'delete_file', status: 'blocked' } }),
    ]
    const s = parseAuditJsonl(lines, 's1')!
    expect(s.toolErrors).toBe(2)
  })

  it('permissionDenied: permission:decision effect=deny 计数，allow 不计', () => {
    const lines = [
      JSON.stringify({ timestamp: T0, sessionId: 's1', event: 'session:start', data: {} }),
      JSON.stringify({ timestamp: T1, sessionId: 's1', event: 'permission:decision', data: { toolName: 'delete_file', effect: 'allow' } }),
      JSON.stringify({ timestamp: T1 + 1, sessionId: 's1', event: 'permission:decision', data: { toolName: 'rename_file', effect: 'deny', reason: '用户拒绝' } }),
    ]
    const s = parseAuditJsonl(lines, 's1')!
    expect(s.permissionDenied).toBe(1)
  })

  it('无 session:start 标记 → 返回 null（跳过）；坏行跳过不中断', () => {
    const lines = [
      '{bad json',
      JSON.stringify({ timestamp: T0, sessionId: 's1', event: 'api:call', data: { promptTokens: 10 } }),
    ]
    expect(parseAuditJsonl(lines, 's1')).toBeNull()
  })

  it('operations 来自 tool:call 描述，去重且上限 10 条', () => {
    const lines = [
      JSON.stringify({ timestamp: T0, sessionId: 's1', event: 'session:start', data: {} }),
      JSON.stringify({ timestamp: T1, sessionId: 's1', event: 'tool:call', data: { toolName: 'read_file', args: { file_path: 'chapters/c1.txt' } } }),
      JSON.stringify({ timestamp: T1 + 1, sessionId: 's1', event: 'tool:call', data: { toolName: 'read_file', args: { file_path: 'chapters/c1.txt' } } }),
    ]
    const s = parseAuditJsonl(lines, 's1')!
    expect(s.operations).toEqual(['读取 chapters/c1.txt'])
    expect(s.toolCalls[0].count).toBe(2)
    expect(s.toolCalls[0].toolName).toBe('read_file')
  })
})
