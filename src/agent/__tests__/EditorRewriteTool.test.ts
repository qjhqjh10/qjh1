import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { editorRewriteTools } from '@/agent/skills/tools/editorRewriteTool'
import { useChapterCollabStore } from '@/store/chapterCollabStore'
import type { ToolExecutionContext } from '@/agent/skills/types'

describe('editor_rewrite 工具', () => {
  const tool = editorRewriteTools[0]
  const mkCtx = (): ToolExecutionContext => ({
    projectId: 'proj1', configId: 'test', callId: 'c1', toolName: 'editor_rewrite', signal: new AbortController().signal,
  })

  beforeEach(() => useChapterCollabStore.getState().detach())
  afterEach(() => useChapterCollabStore.getState().detach())

  it('schema: 名称/参数/必填', () => {
    expect(tool.schema.name).toBe('editor_rewrite')
    expect(tool.schema.parameters.required).toEqual(['anchor', 'newText'])
    expect(tool.permission).toBe('AUTO')
    expect(tool.category).toBe('file')
  })

  it('未关联 → error 引导建立关联', async () => {
    const r = await tool.executor({ anchor: '锚', newText: '新' }, mkCtx())
    expect(r.status).toBe('error')
    expect(r.summary).toContain('未启用章节协作改写')
  })

  it('关联 + 有效锚 → dispatchRewrite 写入 pendingAction + success', async () => {
    // 锚必须真实存在于权威源文本中（真实流程中锚来自用户选中，必然在文本内）
    useChapterCollabStore.getState().attach('chapter3', '段落开头内容段落结尾', '第一段\n\n段落开头内容段落结尾\n\n第三段')
    const r = await tool.executor({ anchor: '段落开头内容段落结尾', newText: '全新的段落内容' }, mkCtx())
    expect(r.status).toBe('success')
    const st = useChapterCollabStore.getState()
    expect(st.pendingAction).toEqual({ chapterId: 'chapter3', anchor: '段落开头内容段落结尾', newText: '全新的段落内容' })
  })

  it('锚点失效 → error 引导 search_content', async () => {
    useChapterCollabStore.getState().attach('chapter3', '旧锚', '完全不同的内容')
    const r = await tool.executor({ anchor: '旧锚', newText: '新内容' }, mkCtx())
    expect(r.status).toBe('error')
    expect(r.summary).toContain('search_content')
  })

  it('参数缺失 → error', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '文')
    const r1 = await tool.executor({ anchor: '', newText: 'x' }, mkCtx())
    expect(r1.status).toBe('error')
    const r2 = await tool.executor({ anchor: 'a', newText: '' }, mkCtx())
    expect(r2.status).toBe('error')
  })

  it('newText 与 anchor 相同 → error(未发生改写)', async () => {
    useChapterCollabStore.getState().attach('chapter3', '同样内容', '同样内容')
    const r = await tool.executor({ anchor: '同样内容', newText: '同样内容' }, mkCtx())
    expect(r.status).toBe('error')
    expect(r.summary).toContain('未发生改写')
  })

  it('newText 超 5000 → error', async () => {
    useChapterCollabStore.getState().attach('chapter3', '锚', '锚')
    const r = await tool.executor({ anchor: '锚', newText: '长'.repeat(5001) }, mkCtx())
    expect(r.status).toBe('error')
    expect(r.summary).toContain('过长')
  })
})
