/**
 * 功能冒烟测试 — 用项目"1"的数据追踪全链路
 * 不调真实 API，验证代码路径和数据结构
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { V4SecurityFence } from '../V4SecurityFence'
import { buildSystemPrompt, CORE_SYSTEM_PROMPT } from '../V4SystemPrompt'
import { isPureGreeting, hasTaskKeywords, isKnowledgeOnly } from '../utils/taskDetection'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import { ContextAssembler } from '../context/ContextAssembler'

beforeAll(() => {
  toolRegistry.registerAll(ALL_TOOLS)
})

describe('功能冒烟测试 (项目"1")', () => {
  // ── 1. 意图分类（真实 taskDetection 函数——M4: 原内联 classify 是已删除逻辑的重写残留） ──
  it('意图分类: isPureGreeting/hasTaskKeywords/isKnowledgeOnly 边界正确', () => {
    expect(isPureGreeting('你好')).toBe(true)
    expect(isPureGreeting('谢谢')).toBe(true)
    expect(isPureGreeting('帮我创建5个角色')).toBe(false)
    expect(hasTaskKeywords('帮我完善世界观，创建5个角色，写前3章细纲')).toBe(true)
    expect(hasTaskKeywords('你好')).toBe(false)
    expect(isKnowledgeOnly('什么是修仙境界？')).toBe(true)
    expect(isKnowledgeOnly('帮我写大纲')).toBe(false)
  })

  // ── 2. 任务画像匹配 ──
  it('任务画像: 风格/场景/章节/角色/图片 匹配正确', () => {
    const profiles: Record<string, RegExp> = {
      style: /风格|文风|仿写|分析.*文/,
      scene: /场景.*(?:模板|创建|生成)|创建.*场景/,
      character: /创建.*角色|添加.*角色|角色.*创建/,
      chapter: /写.{0,5}章|创作|生成.{0,5}章|续写/,
      kb: /知识库|kb|素材.*保存/,
      image: /图片|插图|配图|生成.*图/,
      read: /查看|检查|列出|读取|看看|搜索/,
    }
    const match = (msg: string) => Object.keys(profiles).find(k => profiles[k].test(msg)) || 'default'
    expect(match('上传文件分析风格生成模板')).toBe('style')
    expect(match('创建场景模板')).toBe('scene')
    expect(match('写第3章')).toBe('chapter')
    expect(match('创建一个反派角色')).toBe('character')
    expect(match('看看大纲')).toBe('read')
    expect(match('生成一张古风图')).toBe('image')
  })

  // ── 3. 工具裁剪 ──
  it('工具裁剪: 风格→3核心, 章节→5核心, 图片→2核心', () => {
    const allTools = toolRegistry.getAllSchemas()
    const READ = new Set(['read_file','list_directory','search_content'])
    const TMPL = new Set(['analyze_text_style'])
    const WRITE = new Set(['create_file','edit_file'])
    const IMG = new Set(['search_images','generate_image'])

    const styleCore = allTools.filter((t: any) =>
      new Set(['read_file', ...TMPL]).has(t.function.name))
    const chapterCore = allTools.filter((t: any) =>
      new Set([...READ, ...WRITE]).has(t.function.name))
    const imageCore = allTools.filter((t: any) =>
      IMG.has(t.function.name))

    expect(styleCore.length).toBe(2)
    expect(chapterCore.length).toBe(5)
    expect(imageCore.length).toBe(2)
    expect(styleCore.map((t: any) => t.function.name).sort())
      .toEqual(['analyze_text_style','read_file'])
  })

  // ── 4. 安全围栏 ──
  it('安全围栏: 正常✅ 系统❌ 外部🔔 JSON✅', () => {
    const fence = new V4SecurityFence('1')
    expect(fence.check('read_file', { file_path: 'outline/plot.md' }).allowed).toBe(true)
    expect(fence.check('read_file', { file_path: 'C:/Windows/test.txt' }).allowed).toBe(false)
    const ext = fence.check('read_file', { file_path: 'C:/Users/file.txt' })
    expect(ext.allowed).toBe(true)
    expect(ext.needsApproval).toBe(true)
    expect(fence.check('delete_file', { file_path: 'chapters/ch3.txt' }).needsApproval).toBe(true)
    expect(fence.check('create_file', { file_path: 'characters/test.json', content: '{invalid}' }).allowed).toBe(false)
    expect(fence.check('create_file', { file_path: 'characters/test.json', content: '{"name":"test"}' }).allowed).toBe(true)
  })

  // ── 5. 工具注册 ──
  it('工具注册: 29个工具 (v15: +analyze_file/+edit_file_task 子 agent 委托)', () => {
    const names = toolRegistry.getNames()
    expect(names.length).toBe(29)
    expect(names).toContain('analyze_text_style')
    expect(names).toContain('generate_image')
    expect(names).toContain('read_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('create_file')
    expect(names).toContain('analyze_file')
    expect(names).toContain('edit_file_task')
  })

  // ── 6. 系统提示词 (v10.2.0: Skill-First) ──
  it('系统提示词 v13.2.0: 核心+写作规范手册引用', async () => {
    const prompt = await buildSystemPrompt()
    expect(prompt).toContain('青剑')
    expect(prompt).toContain('写作规范手册')
    expect(prompt).toContain('list_directory')
    // v13.2.0: 手册内容已移到外部文件，此处仅剩索引
    expect(prompt).toContain('writing-handbook')
  })

  // ── 8. Context Assembler ──
  it('ContextAssembler: Provider系统已退役(v11.7.1)，仅保留 domainsForPath', () => {
    expect(typeof ContextAssembler.domainsForPath).toBe('function')
  })

  // ── 9. 缓存域映射 ──
  it('缓存域映射: 角色/细纲/章节/大纲路径→正确域', () => {
    expect(ContextAssembler.domainsForPath('characters/zhangming.json')).toContain('characters')
    expect(ContextAssembler.domainsForPath('detailed_outline/chapter1.json')).toContain('detailed-outline')
    expect(ContextAssembler.domainsForPath('chapters/chapter3.txt')).toContain('chapter-writing')
    expect(ContextAssembler.domainsForPath('outline/plot.md')).toContain('outline')
    expect(ContextAssembler.domainsForPath('summaries/chapter1.md')).toContain('chapter-writing')
  })

  // ── 11. ContextCompressor ──
  it('ContextCompressor: 128K窗口下70%阈值=89600', async () => {
    const { ContextCompressor } = await import('../context/ContextCompressor')
    const c = new ContextCompressor(128_000)
    expect(c.getStage(50_000)).toBe('none')
    expect(c.getStage(90_000)).toBe('strip_detail')
    expect(c.getStage(110_000)).toBe('summarize_pairs')
    expect(c.getStage(120_000)).toBe('collapse_early')
    expect(c.needsCompression(50_000)).toBe(false)
    expect(c.needsCompression(90_000)).toBe(true)
  })

  // M4: IntentClassifier 类已从 src 删除（v13.x），原测试 12 测的是内联重写残留——已移除
})
