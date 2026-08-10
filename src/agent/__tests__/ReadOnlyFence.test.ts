import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolExecutor } from '@/agent/bridge/toolExecutorFactory'
import { V4SecurityFence } from '@/agent/V4SecurityFence'
import { AuditTrail } from '@/agent/audit/AuditTrail'
import { toolRegistry } from '@/agent/skills/ToolRegistry'
import { ALL_TOOLS } from '@/agent/skills/tools'
import { useChapterCollabStore } from '@/store/chapterCollabStore'
import type { ToolExecutionContext } from '@/agent/skills/types'

describe('协作只读围栏', () => {
  let registry: typeof toolRegistry
  beforeEach(() => {
    toolRegistry.registerAll(ALL_TOOLS as any)
    registry = toolRegistry
    useChapterCollabStore.getState().detach()
  })
  afterEach(() => {
    useChapterCollabStore.getState().detach()
  })

  const mkExecutor = () => createToolExecutor({
    securityFence: new V4SecurityFence('proj1'),
    auditTrail: new AuditTrail(),
    projectId: 'proj1',
  })
  const mkCtx = (toolName: string): ToolExecutionContext => ({
    projectId: 'proj1', configId: 'test', callId: 'c1', toolName, signal: new AbortController().signal,
  })

  it('关联模式 + 写当前章文件 → 拦截(含协作只读文案)', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    const r = await ex({ file_path: 'proj1/chapters/chapter3.txt', content: 'x' }, mkCtx('edit_file'))
    expect(r.status).toBe('error')
    expect(r.summary).toContain('协作只读')
    expect(r.summary).toContain('editor_rewrite')
  })

  it('路径归一化: 反斜杠/裸文件名均拦截', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    const r1 = await ex({ file_path: 'proj1\\chapters\\chapter3.txt', content: 'x' }, mkCtx('create_file'))
    expect(r1.status).toBe('error')
    expect(r1.summary).toContain('协作只读')
    const r2 = await ex({ file_path: 'chapter3.txt', content: 'x' }, mkCtx('batch_replace'))
    expect(r2.status).toBe('error')
  })

  it('关联模式 + 其他文件/其他章节 → 放行(不报协作只读)', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    // 真实文件工具对不存在文件会报文件级错误——关键断言是"错误文案不含协作只读"
    const r1 = await ex({ file_path: 'proj1/outline/plot.md', content: 'x' }, mkCtx('edit_file'))
    expect(r1.summary).not.toContain('协作只读')
    const r2 = await ex({ file_path: 'proj1/chapters/chapter5.txt', content: 'x' }, mkCtx('edit_file'))
    expect(r2.summary).not.toContain('协作只读')
  })

  it('未关联 → 一律放行(不报协作只读)', async () => {
    const ex = mkExecutor()
    const r = await ex({ file_path: 'proj1/chapters/chapter3.txt', content: 'x' }, mkCtx('edit_file'))
    expect(r.summary).not.toContain('协作只读')
  })

  it('非写工具(读工具)不受围栏限制', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    const r = await ex({ file_path: 'proj1/chapters/chapter3.txt' }, mkCtx('read_file'))
    expect(r.summary).not.toContain('协作只读')
  })

  it('写工具清单外(如 http_get)不受围栏限制', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    const r = await ex({ url: 'https://example.com' }, mkCtx('http_get'))
    expect(r.summary).not.toContain('协作只读')
  })

  it('v16.1.0审查修复: 备份目录的同名文件同样受保护(同一章节内容)', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    // .ai_backups/chapters/chapter3.txt——备份的是当前章内容，同样拦截（防改写绕过落盘）
    const r1 = await ex({ file_path: 'proj1/.ai_backups/chapters/chapter3.txt', content: 'x' }, mkCtx('edit_file'))
    expect(r1.status).toBe('error')
    expect(r1.summary).toContain('协作只读')
  })

  it('v16.1.0审查修复: 绝对路径的当前章文件仍拦截', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '全文')
    const ex = mkExecutor()
    const r = await ex({ file_path: 'D:/novel-writer/projects/proj1/chapters/chapter3.txt', content: 'x' }, mkCtx('edit_file'))
    expect(r.status).toBe('error')
    expect(r.summary).toContain('协作只读')
  })
})
