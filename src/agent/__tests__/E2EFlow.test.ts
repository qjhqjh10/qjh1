/**
 * End-to-end flow test: Simulates "小明" using the AI writing assistant.
 * Tests the complete chain: user message → context assembly → tool execution → response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentStateMachine } from '../state/AgentStateMachine'
import { ToolRegistry } from '../tools/ToolRegistry'
import { PolicyEngine } from '../permissions/PolicyEngine'
import { HallucinationDetector } from '../runtime/HallucinationDetector'
import { CircuitBreaker } from '../circuit/CircuitBreaker'
import { BudgetManager } from '../budget/BudgetManager'
import type { ToolResult, ToolExecutionContext, Message } from '../runtime/AgentRuntime'

// ── Mock fileService ──
const mockFileStore = new Map<string, string>()

vi.mock('@/services/fileService', () => ({
  fileService: {
    read: vi.fn(async (path: string) => mockFileStore.get(path) || ''),
    write: vi.fn(async (path: string, content: string) => { mockFileStore.set(path, content) }),
    listDir: vi.fn(async (dir: string) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      return [...mockFileStore.keys()]
        .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(k => k.slice(prefix.length))
    }),
    ensureDir: vi.fn(async () => {}),
    deleteFile: vi.fn(async (path: string) => { mockFileStore.delete(path) }),
  },
  aiService: {
    chatWithTools: vi.fn(),
    abortStream: vi.fn(),
    executeFileTools: vi.fn(),
    chat: vi.fn(),
    chatStream: vi.fn(),
    listModels: vi.fn(),
    generateImage: vi.fn(),
  },
  kbService: { list: vi.fn(), search: vi.fn(), webSearch: vi.fn() },
  httpService: { get: vi.fn(), fetch: vi.fn() },
}))

// ── Mock AI Service ──
function createMockAIService(responses: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }>; finishReason?: string }>) {
  let callIndex = 0
  return {
    chatWithTools: vi.fn(async (..._args: any[]) => {
      const resp = responses[Math.min(callIndex++, responses.length - 1)]
      return {
        text: resp.text || '',
        toolCalls: resp.toolCalls || null,
        finishReason: resp.finishReason || 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }
    }),
    abortStream: vi.fn(),
  }
}

// ── Mock Tool Executor ──
function createMockToolExecutor() {
  return vi.fn(async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const toolName = ctx.toolName

    if (toolName === 'read_file') {
      const path = String(args.file_path || '')
      const content = mockFileStore.get(path)
      if (content !== undefined) return { status: 'success', summary: `已读取: ${path}`, detail: content }
      return { status: 'error', summary: `文件不存在: ${path}` }
    }

    if (toolName === 'create_file') {
      const path = String(args.file_path || '')
      const content = String(args.content || '')
      mockFileStore.set(path, content)
      return { status: 'success', summary: `已创建: ${path}`, detail: `${content.length} 字符` }
    }

    if (toolName === 'edit_file') {
      const path = String(args.file_path || '')
      const existing = mockFileStore.get(path) || ''
      const oldStr = String(args.old_string || '')
      const newStr = String(args.new_string || '')
      if (existing.includes(oldStr)) {
        mockFileStore.set(path, existing.replace(oldStr, newStr))
        return { status: 'success', summary: `已编辑: ${path}` }
      }
      return { status: 'error', summary: `old_string 未匹配: ${path}` }
    }

    if (toolName === 'list_directory') {
      const dir = String(args.dir_path || '')
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const files = [...mockFileStore.keys()]
        .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(k => k.slice(prefix.length))
      return { status: 'success', summary: `${files.length} 个文件`, detail: files.join('\n') }
    }

    return { status: 'success', summary: `${toolName} 执行成功` }
  })
}

// ── Tests ──

describe('E2E Flow: 小明的写作之旅', () => {
  beforeEach(() => {
    mockFileStore.clear()
    vi.clearAllMocks()
  })

  describe('Step 1: 创建项目', () => {
    it('should create project directory structure', async () => {
      const toolExecutor = createMockToolExecutor()
      const result = await toolExecutor(
        { project_name: '天道无极' },
        { projectId: null, configId: 'test', callId: 'call_001', toolName: 'create_project', signal: new AbortController().signal },
      )
      expect(result.status).toBe('success')
    })
  })

  describe('Step 2: 写大纲', () => {
    it('should create outline/plot.md via tool execution', async () => {
      const toolExecutor = createMockToolExecutor()
      const result = await toolExecutor(
        { file_path: 'outline/plot.md', content: '# 天道无极\n## 故事主线\n废柴少年林天偶得天道传承...' },
        { projectId: '天道无极', configId: 'test', callId: 'call_002', toolName: 'create_file', signal: new AbortController().signal },
      )
      expect(result.status).toBe('success')
      expect(mockFileStore.get('outline/plot.md')).toContain('天道无极')
    })

    it('outlineProvider should inject outline content when project exists', async () => {
      mockFileStore.set('天道无极/outline/plot.md', '# 天道无极\n## 故事主线\n废柴少年林天偶得天道传承，踏上逆天之路。')

      const { outlineProvider } = await import('../context/providers/outlineProvider')
      const block = await outlineProvider.buildContext('天道无极', '帮我修改大纲')

      expect(block.domain).toBe('outline')
      expect(block.content).toContain('天道无极')
      expect(block.content).toContain('废柴少年')
    })
  })

  describe('Step 3: 创建角色', () => {
    it('should create and read character JSON', async () => {
      const toolExecutor = createMockToolExecutor()
      const character = {
        id: 'lintian', name: '林天', role: '男主', gender: '男', age: '16',
        personality: '坚韧不屈', relationships: '师父:玄天道人', relationshipTags: ['师徒'],
      }

      await toolExecutor(
        { file_path: 'characters/lintian.json', content: JSON.stringify(character, null, 2) },
        { projectId: '天道无极', configId: 'test', callId: 'call_003', toolName: 'create_file', signal: new AbortController().signal },
      )

      const readResult = await toolExecutor(
        { file_path: 'characters/lintian.json' },
        { projectId: '天道无极', configId: 'test', callId: 'call_004', toolName: 'read_file', signal: new AbortController().signal },
      )
      expect(readResult.status).toBe('success')
      const parsed = JSON.parse(readResult.detail!)
      expect(parsed.name).toBe('林天')
      expect(parsed.relationshipTags).toEqual(['师徒'])
    })

    it('characterProvider should inject character data when creating', async () => {
      mockFileStore.set('天道无极/characters/lintian.json', JSON.stringify({
        id: 'lintian', name: '林天', role: '男主', personality: '坚韧不屈', relationships: '师父:玄天道人',
      }))

      const { characterProvider } = await import('../context/providers/characterProvider')
      const block = await characterProvider.buildContext('天道无极', '创建一个新角色叫李四')

      expect(block.domain).toBe('characters')
      expect(block.content).toContain('林天')
      expect(block.content).toContain('男主')
    })

    it('characterProvider should inject full matrix for consistency check', async () => {
      mockFileStore.set('天道无极/characters/lintian.json', JSON.stringify({
        id: 'lintian', name: '林天', role: '男主', gender: '男', age: '16',
        personality: '坚韧不屈', relationships: '师父:玄天道人', arc: '废柴逆袭',
      }))
      mockFileStore.set('天道无极/characters/xuantian.json', JSON.stringify({
        id: 'xuantian', name: '玄天道人', role: '其他', gender: '男', age: '200',
        personality: '慈祥', relationships: '弟子:林天', arc: '引导者',
      }))

      const { characterProvider } = await import('../context/providers/characterProvider')
      const block = await characterProvider.buildContext('天道无极', '检查角色有没有矛盾')

      expect(block.content).toContain('角色一致性检查')
      expect(block.content).toContain('林天')
      expect(block.content).toContain('玄天道人')
    })
  })

  describe('Step 4: 写细纲', () => {
    it('should create detailed outline JSON', async () => {
      const toolExecutor = createMockToolExecutor()
      const outline = {
        id: 'ch001', title: '废柴少年', order: 1, status: 'complete',
        plotOverview: '林天在宗门受辱，偶得天道传承',
        characters: '林天', location: '青云宗', keyEvents: '偶得天道传承',
      }
      const result = await toolExecutor(
        { file_path: 'detailed_outline/ch001.json', content: JSON.stringify(outline, null, 2) },
        { projectId: '天道无极', configId: 'test', callId: 'call_005', toolName: 'create_file', signal: new AbortController().signal },
      )
      expect(result.status).toBe('success')
    })

    it('detailedOutlineProvider should extract chapter number and inject outline', async () => {
      mockFileStore.set('天道无极/detailed_outline/ch001.json', JSON.stringify({
        id: 'ch001', title: '废柴少年', status: 'complete',
        plotOverview: '林天在宗门受辱', characters: '林天', location: '青云宗',
        keyEvents: '偶得天道传承',
      }))

      const { detailedOutlineProvider } = await import('../context/providers/detailedOutlineProvider')
      const block = await detailedOutlineProvider.buildContext('天道无极', '帮我写第一章')

      expect(block.content).toContain('第1章细纲')
      expect(block.content).toContain('废柴少年')
      expect(block.content).toContain('林天在宗门受辱')
    })
  })

  describe('Step 5: 写章节 — 多轮工具调用', () => {
    it('should simulate multi-turn tool calling flow', async () => {
      mockFileStore.set('detailed_outline/ch001.json', JSON.stringify({
        id: 'ch001', title: '废柴少年', plotOverview: '林天在宗门受辱', characters: '林天',
      }))
      mockFileStore.set('characters/lintian.json', JSON.stringify({
        id: 'lintian', name: '林天', role: '男主', personality: '坚韧不屈',
      }))

      const responses = [
        { toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"file_path":"detailed_outline/ch001.json"}' }] },
        { toolCalls: [{ id: 'c2', name: 'read_file', arguments: '{"file_path":"characters/lintian.json"}' }] },
        { toolCalls: [{ id: 'c3', name: 'create_file', arguments: '{"file_path":"chapters/ch001.txt","content":"第一章 废柴少年\\n\\n青云山上，晨雾缭绕。\\n\\n林天跪在演武场中央..."}' }] },
        { text: '已完成第一章，共 3000 字。' },
      ]

      const aiService = createMockAIService(responses)
      const toolExecutor = createMockToolExecutor()
      const messagesForApi: Message[] = [{ role: 'user', content: '帮我写第一章' }]
      let iteration = 0
      let collectedText = ''

      while (iteration < 15) {
        iteration++
        const response = await aiService.chatWithTools(messagesForApi, 'test', '天道无极')

        if (!response.toolCalls || response.toolCalls.length === 0) {
          collectedText = response.text
          break
        }

        messagesForApi.push({
          role: 'assistant', content: response.text,
          tool_calls: response.toolCalls.map(tc => ({
            type: 'function', id: tc.id,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        } as Message)

        for (const tc of response.toolCalls) {
          const args = JSON.parse(tc.arguments)
          const result = await toolExecutor(args, {
            projectId: '天道无极', configId: 'test',
            callId: tc.id, toolName: tc.name, signal: new AbortController().signal,
          })
          messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
        }
      }

      expect(iteration).toBe(4)
      expect(collectedText).toContain('已完成第一章')
      expect(mockFileStore.has('chapters/ch001.txt')).toBe(true)
      expect(mockFileStore.get('chapters/ch001.txt')).toContain('废柴少年')

      // Verify OpenAI format
      const assistantMsgs = messagesForApi.filter(m => m.role === 'assistant')
      for (const msg of assistantMsgs) {
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls as any[]) {
            expect(tc.type).toBe('function')
            expect(tc.function).toBeDefined()
            expect(tc.function.name).toBeDefined()
          }
        }
      }
    })
  })

  describe('Step 6: 续写 — chapterWritingProvider 注入', () => {
    it('should inject last chapter tail for continuation', async () => {
      const longContent = '第一章 废柴少年\n\n' + '这是正文内容。'.repeat(200) + '\n\n林天握紧拳头，眼中闪过一丝坚定。'
      mockFileStore.set('天道无极/chapters/ch001.txt', longContent)
      mockFileStore.set('天道无极/summaries/ch001.md', '# 第一章摘要\n林天在宗门受辱，偶得天道传承。')

      const { chapterWritingProvider } = await import('../context/providers/chapterWritingProvider')
      const block = await chapterWritingProvider.buildContext('天道无极', '续写下一章')

      expect(block.content).toContain('续写上下文')
      expect(block.content).toContain('ch001')
      expect(block.content).toContain('林天握紧拳头')
      expect(block.content).toContain('摘要')
    })
  })

  describe('Step 7: 一致性检查', () => {
    it('should detect character name mention for targeted reading', async () => {
      mockFileStore.set('天道无极/characters/lintian.json', JSON.stringify({ name: '林天', role: '男主' }))

      const { characterProvider } = await import('../context/providers/characterProvider')
      const block = await characterProvider.buildContext('天道无极', '检查林天的设定有没有矛盾')

      expect(block.content).toContain('林天')
    })
  })

  describe('PolicyEngine: 权限控制', () => {
    it('should allow read tools without approval', () => {
      const policy = new PolicyEngine()
      policy.setDefaultEffect('allow')
      const result = policy.evaluate('read_file', { file_path: 'outline/plot.md' })
      expect(result.effect).toBe('allow')
      expect(result.requiresUserApproval).toBe(false)
    })

    it('should ask for approval on dangerous tools', () => {
      const policy = new PolicyEngine()
      policy.setDefaultEffect('allow')
      policy.load([{ id: 'ask-delete', effect: 'ask', toolName: 'delete_file', pathPattern: 'chapters/**' }])
      const result = policy.evaluate('delete_file', { file_path: 'chapters/ch001.txt' })
      expect(result.effect).toBe('ask')
      expect(result.requiresUserApproval).toBe(true)
    })
  })

  describe('HallucinationDetector: 幻觉检测', () => {
    it('should detect hallucination when AI claims action without calling tools', () => {
      const detector = new HallucinationDetector()
      const warning = detector.detect('我已经帮你创建了角色文件。', new Set())
      expect(warning).not.toBeNull()
      expect(warning).toContain('创建')
    })

    it('should NOT trigger when AI actually called tools', () => {
      const detector = new HallucinationDetector()
      const warning = detector.detect('我已经帮你创建了角色文件。', new Set(['create_file']))
      expect(warning).toBeNull()
    })
  })

  describe('CircuitBreaker: 断路保护', () => {
    it('should open after consecutive failures', () => {
      const cb = new CircuitBreaker(3, 100)
      cb.recordFailure()
      cb.recordFailure()
      expect(cb.currentState).toBe('CLOSED')
      cb.recordFailure()
      expect(cb.currentState).toBe('OPEN')
    })

    it('should recover after cooldown', async () => {
      const cb = new CircuitBreaker(3, 100)
      for (let i = 0; i < 3; i++) cb.recordFailure()
      await new Promise(r => setTimeout(r, 150))
      cb.beforeCall()
      expect(cb.currentState).toBe('HALF_OPEN')
    })
  })

  describe('BudgetManager: 渐进压缩', () => {
    it('microcompact should not mutate original array', () => {
      const bm = new BudgetManager(100000)
      bm.addUsage(75000)
      const messages = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！' },
      ]
      const originalLength = messages.length
      bm.compressMessages(messages)
      expect(messages.length).toBe(originalLength)
    })
  })

  describe('AgentStateMachine: 状态转换', () => {
    it('should follow the complete lifecycle', async () => {
      const fsm = new AgentStateMachine(8)
      expect(fsm.currentPhase).toBe('IDLE')

      await fsm.transition('THINKING')
      await fsm.transition('ASSEMBLING_CONTEXT')
      await fsm.transition('CALLING_API')
      await fsm.transition('AWAITING_TOOLS')
      await fsm.transition('EXECUTING')
      await fsm.transition('REFLECTING')

      // REFLECTING → RESPONDING requires shouldContinue = false
      fsm.setShouldContinue(false)
      await fsm.transition('RESPONDING')
      await fsm.transition('IDLE')

      expect(fsm.currentPhase).toBe('IDLE')
    })

    it('should reject invalid transitions', async () => {
      const fsm = new AgentStateMachine(8)
      expect(fsm.canTransition('EXECUTING')).toBe(false)
      await expect(fsm.transition('EXECUTING')).rejects.toThrow()
    })
  })
})
