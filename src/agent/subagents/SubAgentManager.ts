import { AgentRuntime } from '../runtime/AgentRuntime'
import { ContextAssembler } from '../context/ContextAssembler'
import { ToolRegistry } from '../tools/ToolRegistry'
import { TEAM_ROLES } from '../teams/AgentTeam'
import { coreRulesProvider } from '../context/providers/coreRulesProvider'
import { characterProvider } from '../context/providers/characterProvider'
import { outlineProvider } from '../context/providers/outlineProvider'
import { detailedOutlineProvider } from '../context/providers/detailedOutlineProvider'
import { styleProvider } from '../context/providers/styleProvider'
import { sceneProvider } from '../context/providers/sceneProvider'
import type { Message, ToolResult } from '../runtime/AgentRuntime'

// ── Types ──

export type ModelTier = 'cheap' | 'main' | 'eval'

export interface SubAgentConfig {
  name: string
  purpose: string
  toolNames: string[]
  contextProviderDomains: string[]
  maxIterations: number
  systemPrompt: string
  modelTier?: ModelTier  // 'cheap'=haiku/small, 'main'=opus/sonnet, 'eval'=evaluation model
}

export interface SubAgentResult {
  agentName: string
  status: 'success' | 'error'
  summary: string
  output: string
  tokenCost: number
  toolCalls: number
  duration: number
  modelTier: ModelTier
}

// ── Pre-built Sub-Agent Configurations ──

export const SUB_AGENTS: SubAgentConfig[] = [
  {
    name: 'chapter-planner',
    purpose: '分析大纲和细纲，规划章节结构和内容要点',
    toolNames: ['read_file', 'list_directory', 'search_content', 'search_files', 'write_note'],
    contextProviderDomains: ['core-rules', 'outline', 'detailed-outline', 'characters'],
    maxIterations: 4,
    modelTier: 'main',
    systemPrompt: [
      '你是章节规划专家。你的任务是分析大纲和细纲数据，为章节写作做准备。',
      '操作步骤:',
      '1. 读取大纲文件 (outline/plot.md) 了解故事整体走向',
      '2. 读取指定章节的细纲 (detailed_outline/{id}.json)',
      '3. 分析角色关系、冲突设置、情感曲线',
      '4. 将分析结果写入草稿笔记 (write_note)',
      '完成后简要汇报: 章节结构、关键冲突、出场角色、情感变化。',
    ].join('\n'),
  },
  {
    name: 'style-analyzer',
    purpose: '分析文本风格特征，创建风格模板',
    toolNames: ['read_file', 'search_content', 'create_style_template', 'write_note'],
    contextProviderDomains: ['core-rules', 'style'],
    maxIterations: 5,
    modelTier: 'main',
    systemPrompt: [
      '你是风格分析专家。分析原文的 26 个文风维度，创建风格模板。',
      '操作步骤:',
      '1. read_file 阅读原文样本',
      '2. 逐维度分析: 有信号则详填(description+examples+writingRules), 无信号跳过',
      '3. 调用 create_style_template 保存结果',
      '4. 将分析过程写入草稿笔记',
      '完成后简要汇报: 发现的显著风格特征、已填写维度数、模板名称。',
    ].join('\n'),
  },
  {
    name: 'consistency-checker',
    purpose: '检查角色设定、剧情逻辑、时间线的一致性',
    toolNames: ['read_file', 'search_content', 'search_files', 'list_directory', 'write_note'],
    contextProviderDomains: ['core-rules', 'characters', 'outline'],
    maxIterations: 6,
    modelTier: 'cheap',
    systemPrompt: [
      '你是一致性检查专家。检查项目中的设定冲突和逻辑矛盾。',
      '操作步骤:',
      '1. 读取所有角色文件，检查角色属性是否有冲突',
      '2. search_content 搜索角色出场记录，验证时间线一致性',
      '3. 对比大纲中的设定与实际章节内容',
      '4. 将发现的问题写入草稿笔记，标注严重程度',
      '完成后汇报: 发现的问题列表、严重程度、建议修复方案。',
    ].join('\n'),
  },
  {
    name: 'scene-builder',
    purpose: '根据细纲分析结果，创建详细的场景模板',
    toolNames: ['read_file', 'create_scene_template', 'write_note'],
    contextProviderDomains: ['core-rules', 'scene', 'detailed-outline'],
    maxIterations: 3,
    modelTier: 'main',
    systemPrompt: [
      '你是场景构建专家。根据细纲内容创建详细的场景配置模板。',
      '操作步骤:',
      '1. read_file 读取指定章节的细纲',
      '2. 分析场景类型、冲突、角色情绪、氛围',
      '3. 调用 create_scene_template 填写详细配置',
      '4. 不确定的字段放入 autoFields 数组',
      '完成后汇报: 创建的模板名称、场景类型、已配置和自动的字段数。',
    ].join('\n'),
  },
  {
    name: 'knowledge-curator',
    purpose: '整理和索引知识库内容，优化知识管理',
    toolNames: ['kb_list', 'kb_create_file', 'kb_append_file', 'kb_index_file', 'read_file'],
    contextProviderDomains: ['core-rules', 'kb'],
    maxIterations: 4,
    modelTier: 'cheap',
    systemPrompt: [
      '你是知识管理专家。整理和维护知识库的素材和参考资料。',
      '操作步骤:',
      '1. kb_list 查看当前知识库文件列表',
      '2. 分析内容，决定是创建新文件还是追加到已有文件',
      '3. 整理完成后用 kb_index_file 建立语义搜索索引',
      '完成后汇报: 创建/追加的文件、索引状态、知识库总体情况。',
    ].join('\n'),
  },
  {
    name: 'gc-scanner',
    purpose: '扫描代码健康度：超大文件、过期引用、孤儿文件、文档漂移',
    toolNames: ['read_file', 'list_directory', 'search_files', 'search_content', 'write_note', 'list_rules'],
    contextProviderDomains: ['core-rules'],
    maxIterations: 10,
    modelTier: 'cheap',
    systemPrompt: [
      '你是代码健康检查 Agent（GC Scanner）。扫描项目，发现并报告问题。',
      '你只能读取文件，不能修改任何内容。',
      '',
      '检查项目:',
      '1. 超大文件: 检查每个 .ts/.tsx 文件是否超过 500 行',
      '2. 过期引用: 验证 CLAUDE.md 和 golden-rules.md 中的文件引用',
      '3. 孤儿文件: 检查是否有文件没有被其他文件 import 或引用',
      '4. 文档漂移: 对比文档声明与实际结构',
      '',
      '操作步骤:',
      '1. list_directory 顶级目录，list_directory src/agent/ 子目录',
      '2. read_file CLAUDE.md + .aiharness/rules/golden-rules.md',
      '3. read_file 各子目录的 index.ts 确认导出覆盖',
      '4. 将问题写入 write_note，标题 "gc-report"',
      '完成后输出问题列表和修复建议。',
    ].join('\n'),
  },
]

// ── Manager ──

export class SubAgentManager {
  private agents: SubAgentConfig[] = []
  private registry: ToolRegistry
  private parentRuntime: AgentRuntime | null = null

  constructor(registry: ToolRegistry) {
    this.registry = registry
    this.agents = [...SUB_AGENTS]
  }

  setParentRuntime(runtime: AgentRuntime): void {
    this.parentRuntime = runtime
  }

  defineAgent(config: SubAgentConfig): void {
    const existing = this.agents.findIndex(a => a.name === config.name)
    if (existing !== -1) this.agents[existing] = config
    else this.agents.push(config)
  }

  getAgent(name: string): SubAgentConfig | undefined {
    return this.agents.find(a => a.name === name)
  }

  listAgents(): SubAgentConfig[] {
    return [...this.agents]
  }

  /**
   * Delegate a task to a sub-agent. The sub-agent runs in an isolated context
   * with limited tools and focused system prompt, then returns a structured result.
   * Uses the sub-agent's modelTier if configured, otherwise falls back to main.
   */
  async delegate(
    agentName: string,
    input: string,
    configId: string,
    projectId: string | null,
    modelTierOverride?: 'cheap' | 'main' | 'eval',
  ): Promise<SubAgentResult> {
    const config = this.getAgent(agentName)
    if (!config) {
      return {
        agentName, status: 'error',
        summary: `未找到子 Agent: ${agentName}`,
        output: '', tokenCost: 0, toolCalls: 0, duration: 0, modelTier: 'main',
      }
    }

    const effectiveTier = modelTierOverride || config.modelTier || 'main'
    const effectiveConfigId = configId // Model routing via different configIds when available

    const startTime = Date.now()
    let totalTokens = 0
    let toolCalls = 0

    try {
      // Build isolated context assembler for this sub-agent
      const assembler = new ContextAssembler()
      const allProviders = [
        coreRulesProvider, characterProvider, outlineProvider,
        detailedOutlineProvider, styleProvider, sceneProvider,
      ]
      for (const p of allProviders) {
        if (config.contextProviderDomains.includes(p.domain)) {
          assembler.register(p)
        }
      }

      // Assemble context
      const ctx = await assembler.assemble(input, [], projectId)

      // Build messages
      const messages: Message[] = [
        { role: 'system', content: config.systemPrompt },
        ...ctx.systemMessages,
        { role: 'user', content: input },
      ]

      // Filter tools to only what this agent needs
      const allowedTools = this.registry.getAllSchemas().filter(
        t => config.toolNames.includes(t.function.name)
      )

      // Dynamic import AI service
      const { aiService } = await import('@/services/fileService')

      // Run sub-agent loop
      let iteration = 0
      let done = false

      while (iteration < config.maxIterations && !done) {
        iteration++

        const response = await aiService.chatWithTools(
          messages, configId, projectId || undefined, allowedTools,
        )

        totalTokens += response.usage?.total_tokens || 0
        toolCalls += response.toolCalls?.length || 0

        if (!response.toolCalls || response.toolCalls.length === 0) {
          // No more tool calls — sub-agent is done
          done = true
          continue
        }

        // Execute tool calls
        for (const tc of response.toolCalls) {
          const args = JSON.parse(tc.function.arguments)
          const result = await this.registry.execute(tc.function.name, args, {
            projectId, configId,
            callId: `${agentName}_${tc.id}`,
            toolName: tc.function.name,
            signal: new AbortController().signal,
          })

          messages.push({
            role: 'assistant',
            content: response.text,
            tool_calls: [tc],
          } as Message)
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          })
        }
      }

      const output = messages.filter(m => m.role === 'assistant').pop()?.content || ''

      return {
        agentName,
        status: 'success',
        summary: `${config.purpose} — 完成`,
        output,
        tokenCost: totalTokens,
        toolCalls,
        duration: Date.now() - startTime,
        modelTier: effectiveTier,
      }
    } catch (err) {
      return {
        agentName,
        status: 'error',
        summary: `执行失败: ${err instanceof Error ? err.message : 'Unknown'}`,
        output: '',
        tokenCost: totalTokens,
        toolCalls,
        duration: Date.now() - startTime,
        modelTier: effectiveTier,
      }
    }
  }

  /**
   * Run multiple sub-agents in parallel for independent tasks.
   */
  async runParallel(
    tasks: Array<{ agentName: string; input: string }>,
    configId: string,
    projectId: string | null,
  ): Promise<SubAgentResult[]> {
    return Promise.all(
      tasks.map(t => this.delegate(t.agentName, t.input, configId, projectId))
    )
  }

  /**
   * Run a relay team: Planner → Coder → Reviewer → Fixer.
   * Each role reads the previous role's output from a shared note.
   * Teams provide multi-perspective verification (Claude Code pattern).
   */
  async runRelay(
    input: string,
    configId: string,
    projectId: string | null,
    relayNote = 'relay-plan',
  ): Promise<{ results: SubAgentResult[]; passed: boolean }> {
    const results: SubAgentResult[] = []
    let plan = input

    // 1. Planner: analyze and create plan
    const plannerResult = await this.delegateWithRole(
      'planner', `分析需求并制定执行计划:\n${plan}`, configId, projectId, relayNote,
    )
    results.push(plannerResult)
    if (plannerResult.status === 'error') return { results, passed: false }
    plan = plannerResult.output

    // 2. Coder: execute the plan
    const coderResult = await this.delegateWithRole(
      'coder', `根据以下计划执行任务:\n${plan}`, configId, projectId, relayNote,
    )
    results.push(coderResult)
    if (coderResult.status === 'error') return { results, passed: false }

    // 3. Reviewer: check the output
    const reviewerResult = await this.delegateWithRole(
      'reviewer', `审查以下执行结果，只读验证:\n${coderResult.output}`, configId, projectId, relayNote,
    )
    results.push(reviewerResult)

    // 4. Fixer: fix issues if reviewer found problems (exclude negation patterns like "没有问题")
    const reviewText = reviewerResult.output
    const hasNegation = /没有[问错]|无[问错]|不存在[问错]|no\s+(?:issues?|problems?|errors?)/i.test(reviewText)
    const hasProblem = /[问错]题|issues?|problems?|errors?|缺陷|漏洞|异常|失败/i.test(reviewText)
    if (hasProblem && !hasNegation) {
      const fixerResult = await this.delegateWithRole(
        'fixer', `根据审查意见修复问题:\n审查意见: ${reviewerResult.output}\n原始输出: ${coderResult.output}`, configId, projectId, relayNote,
      )
      results.push(fixerResult)
    }

    return { results, passed: true }
  }

  private async delegateWithRole(
    roleName: string,
    input: string,
    configId: string,
    projectId: string | null,
    relayNote: string,
  ): Promise<SubAgentResult> {
    const role = TEAM_ROLES[roleName]
    if (!role) {
      return { agentName: roleName, status: 'error', summary: `未找到角色: ${roleName}`, output: '', tokenCost: 0, toolCalls: 0, duration: 0, modelTier: 'main' }
    }

    // Build temporary agent config from the team role
    const tempConfig = {
      name: roleName,
      purpose: role.name,
      toolNames: role.toolNames,
      contextProviderDomains: ['core-rules'],
      maxIterations: role.maxIterations,
      systemPrompt: role.systemPrompt,
      modelTier: 'main' as const,
    }

    // Temporarily register this role as a sub-agent
    const prevAgent = this.getAgent(roleName)
    this.defineAgent(tempConfig)

    const result = await this.delegate(roleName, input, configId, projectId, role.name === 'Planner' ? 'cheap' : 'main')

    // Restore original agent if it existed
    if (prevAgent) this.defineAgent(prevAgent)
    else {
      // Remove the temporary agent
      const idx = (this as any).agents?.findIndex?.((a: any) => a.name === roleName)
      if (idx >= 0) (this as any).agents?.splice?.(idx, 1)
    }

    return result
  }
}
