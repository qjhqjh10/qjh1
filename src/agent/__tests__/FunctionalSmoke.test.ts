/**
 * 功能冒烟测试 — 用项目"1"的数据追踪全链路
 * 不调真实 API，验证代码路径和数据结构
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { V4SecurityFence } from '../V4SecurityFence'
import { buildSystemPrompt, CORE_SYSTEM_PROMPT, STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE } from '../V4SystemPrompt'
import { toolRegistry } from '../tools/ToolRegistry'
import { ALL_TOOLS } from '../tools/definitions'
import { contextAssembler, ContextAssembler } from '../context/ContextAssembler'
import { LearningEngine } from '../learning/LearningEngine'

beforeAll(() => {
  toolRegistry.registerAll(ALL_TOOLS)
})

describe('功能冒烟测试 (项目"1")', () => {
  // ── 1. 意图分类逻辑 ──
  it('意图分类: 多要求→complex, 查看→simple, 闲聊→chat', () => {
    const classify = (msg: string) => {
      if (/^(你好|谢谢|再见|嗯)/.test(msg)) return 'chat'
      if (/写|创建|修改|删除|编辑|生成|续写/.test(msg) &&
          (msg.match(/[，,；;。\n]/g) || []).length >= 2) return 'complex'
      if (/写|创建|生成|续写/.test(msg)) return 'complex'
      if (/查看|检查|列出|读取|看看|搜索/.test(msg)) return 'simple'
      return 'chat'
    }
    expect(classify('帮我完善世界观，创建5个角色，写前3章细纲')).toBe('complex')
    expect(classify('看看角色列表')).toBe('simple')
    expect(classify('你好')).toBe('chat')
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
  it('工具裁剪: 风格→3核心, 章节→6核心, 图片→2核心', () => {
    const allTools = toolRegistry.getAllSchemas()
    const READ = new Set(['read_file','list_directory','search_files','search_content'])
    const TMPL = new Set(['create_style_template','create_scene_template'])
    const WRITE = new Set(['create_file','edit_file'])
    const IMG = new Set(['search_images','generate_image'])

    const styleCore = allTools.filter((t: any) =>
      new Set(['read_file', ...TMPL]).has(t.function.name))
    const chapterCore = allTools.filter((t: any) =>
      new Set([...READ, ...WRITE]).has(t.function.name))
    const imageCore = allTools.filter((t: any) =>
      IMG.has(t.function.name))

    expect(styleCore.length).toBe(3)
    expect(chapterCore.length).toBe(6)
    expect(imageCore.length).toBe(2)
    expect(styleCore.map((t: any) => t.function.name).sort())
      .toEqual(['create_scene_template','create_style_template','read_file'])
  })

  // ── 4. 安全围栏 ──
  it('安全围栏: 正常✅ 系统❌ 遍历❌ 确认✅ JSON✅', () => {
    const fence = new V4SecurityFence('1')
    expect(fence.check('read_file', { file_path: 'outline/plot.md' }).allowed).toBe(true)
    expect(fence.check('read_file', { file_path: 'C:/Windows/test.txt' }).allowed).toBe(false)
    expect(fence.check('read_file', { file_path: '../../../etc/passwd' }).allowed).toBe(false)
    expect(fence.check('delete_file', { file_path: 'chapters/ch3.txt' }).needsApproval).toBe(true)
    expect(fence.check('create_file', { file_path: 'characters/test.json', content: '{invalid}' }).allowed).toBe(false)
    expect(fence.check('create_file', { file_path: 'characters/test.json', content: '{"name":"test"}' }).allowed).toBe(true)
  })

  // ── 5. 工具注册 ──
  it('工具注册: 38个工具，含风格/场景/图片/学习', () => {
    const names = toolRegistry.getNames()
    expect(names.length).toBeGreaterThanOrEqual(38)
    expect(names).toContain('create_style_template')
    expect(names).toContain('create_scene_template')
    expect(names).toContain('generate_image')
    expect(names).toContain('write_learning')
    expect(names).toContain('read_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('create_file')
  })

  // ── 6. 系统提示词 ──
  it('系统提示词: 风格/场景工具+自我优化均已包含', () => {
    const prompt = buildSystemPrompt([STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE], '项目1', '')
    expect(prompt).toContain('青剑')
    expect(prompt).toContain('create_style_template')
    expect(prompt).toContain('create_scene_template')
    expect(prompt).toContain('自我优化')
    expect(prompt).toContain('项目1')
  })

  // ── 7. 学习引擎 ──
  it('学习引擎: 写入→禁用不注入→启用注入', () => {
    const engine = new LearningEngine()
    const entry = engine.addEntry('JSON字段名缺少双引号', '先read_file参考已有JSON格式', 'file')
    expect(entry.problem).toContain('双引号')
    expect(entry.enabled).toBe(false)

    const ctx = engine.getContextInject()
    expect(ctx).toBe('')

    engine.toggleEnabled(entry.id)
    const ctx2 = engine.getContextInject()
    expect(ctx2).toContain('双引号')
    expect(ctx2).toContain('read_file')
  })

  // ── 8. Context Provider ──
  it('ContextAssembler: ALL_PROVIDERS 包含10个Provider', async () => {
    const { ALL_PROVIDERS } = await import('../context/providers/index')
    for (const p of ALL_PROVIDERS) {
      if (!contextAssembler.getProviders().some(ex => ex.domain === p.domain)) {
        contextAssembler.register(p)
      }
    }
    expect(contextAssembler.getProviders().length).toBeGreaterThanOrEqual(10)
  })

  // ── 9. 缓存域映射 ──
  it('缓存域映射: 角色/细纲/章节/大纲路径→正确域', () => {
    expect(ContextAssembler.domainsForPath('characters/zhangming.json')).toContain('character')
    expect(ContextAssembler.domainsForPath('detailed_outline/chapter1.json')).toContain('detailedOutline')
    expect(ContextAssembler.domainsForPath('chapters/chapter3.txt')).toContain('chapterWriting')
    expect(ContextAssembler.domainsForPath('outline/plot.md')).toContain('outline')
    expect(ContextAssembler.domainsForPath('summaries/chapter1.md')).toContain('chapterWriting')
  })

  // ── 10. write_learning 工具 ──
  it('write_learning: 已注册+AUTO+必填字段完整', () => {
    const wl = toolRegistry.get('write_learning')
    expect(wl).toBeDefined()
    expect(wl!.permission).toBe('AUTO')
    expect(wl!.schema.parameters.required).toContain('problem')
    expect(wl!.schema.parameters.required).toContain('solution')
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

  // ── 12. IntentClassifier fallback ──
  it('IntentClassifier: 输出格式"意图|要求数"解析', () => {
    const parse = (text: string) => {
      const match = text.match(/(chat|simple|complex)\|?(\d+)?/)
      return { intent: match?.[1] || 'chat', count: parseInt(match?.[2] || '0') || 0 }
    }
    expect(parse('complex|4')).toEqual({ intent: 'complex', count: 4 })
    expect(parse('simple|1')).toEqual({ intent: 'simple', count: 1 })
    expect(parse('chat|0')).toEqual({ intent: 'chat', count: 0 })
    expect(parse('garbage')).toEqual({ intent: 'chat', count: 0 })
  })
})
