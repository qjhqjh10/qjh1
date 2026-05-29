/**
 * 统一 AI 能力接入层
 * 消除各模块独立调用 AI 的碎片化问题，统一参数构建、错误处理、结果标准化。
 */
import { aiService, kbService } from './fileService'
import { getTemplateInjection } from '@/utils/styleInjector'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { logError } from '@/utils/logger'

// ── Types ──

export interface AICallOptions {
  configId: string
  projectId?: string
  /** 风格模板ID，若提供则自动注入风格约束 */
  styleTemplateId?: string
  /** 场景模板prompt文本，若提供则追加为场景约束 */
  sceneInjection?: string
  /** KB文件ID集合，若提供则自动语义搜索并注入相关chunks */
  kbFileIds?: string[]
  /** KB搜索查询（默认使用userMessage） */
  kbSearchQuery?: string
  /** 最大注入KB chunks数 */
  kbMaxChunks?: number
  /** 温度参数 */
  temperature?: number
  /** 最大输出token */
  maxTokens?: number
}

export interface AICallResult {
  success: boolean
  content: string
  error?: string
  /** 是否降级处理（如generate_image不支持→search_images） */
  degraded?: boolean
  /** 消耗估算 */
  usage?: { promptTokens: number; outputTokens: number }
}

// ── Service ──

export const aiCapability = {
  /**
   * 通用 AI 文本生成 — 统一的入口
   * 自动处理: 风格注入 + KB检索注入 + 错误分类 + Token预算
   */
  async generate(userMessage: string, options: AICallOptions, systemPrompt?: string): Promise<AICallResult> {
    try {
      let prompt = userMessage
      const parts: string[] = []

      // 1. 风格模板注入
      if (options.styleTemplateId) {
        try {
          const stylePrompt = await getTemplateInjection(options.styleTemplateId)
          if (stylePrompt) parts.push(stylePrompt)
        } catch (e) { logError('风格模板注入失败', e) }
      }

      // 2. 场景模板注入
      if (options.sceneInjection) {
        parts.push(options.sceneInjection)
      }

      // 3. KB知识注入（语义搜索）
      if (options.kbFileIds && options.kbFileIds.length > 0 && options.projectId) {
        try {
          const query = options.kbSearchQuery || userMessage.slice(0, 500)
          const chunks = await kbService.search(query, options.projectId, options.configId, options.kbMaxChunks || 5, options.kbFileIds)
          if (Array.isArray(chunks) && chunks.length > 0) {
            const kbBlock = `【知识库参考】\n以下是与当前任务相关的参考资料：\n${chunks.map((c: any) => `【${c.fileName || 'KB'}】${c.content}`).join('\n---\n')}`
            parts.push(kbBlock)
          }
        } catch (e) { logError('KB检索注入失败', e) }
      }

      // 4. 组装完整prompt
      if (parts.length > 0) {
        prompt = parts.join('\n\n---\n\n') + '\n\n---\n\n' + userMessage
      }

      const messages: any[] = []
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: prompt })

      const reply = await aiService.chat(messages, options.configId, options.projectId)
      return { success: true, content: reply }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误'
      const userMsg = parseAiErrorMessage(err, 'AI 请求失败')
      if (msg.includes('[UNSUPPORTED_OPERATION]')) {
        return { success: false, content: '', error: userMsg, degraded: true }
      }
      return { success: false, content: '', error: userMsg }
    }
  },

  /** 改写文本 */
  async rewrite(text: string, configId: string, projectId?: string): Promise<AICallResult> {
    return aiCapability.generate(
      `请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。\n\n${text}`,
      { configId, projectId }
    )
  },

  /** 润色文本 */
  async polish(text: string, configId: string, projectId?: string): Promise<AICallResult> {
    return aiCapability.generate(
      `请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。\n\n${text}`,
      { configId, projectId }
    )
  },

  /** 续写文本 */
  async continueText(text: string, configId: string, projectId?: string): Promise<AICallResult> {
    return aiCapability.generate(
      `请根据以下内容自然续写，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性。\n\n${text}`,
      { configId, projectId }
    )
  },

  /** 提取章节信息 */
  async extractChapterInfo(
    chapterTitle: string, chapterContent: string, chapterNumber: number,
    configId: string, projectId?: string
  ): Promise<AICallResult> {
    const { buildRewriteAnalysisPrompt } = await import('./continuationService')
    const prompt = buildRewriteAnalysisPrompt(chapterTitle, chapterContent, chapterNumber)
    return aiCapability.generate(prompt, { configId, projectId })
  },

  /** 生成章节内容(完整上下文) */
  async generateChapter(
    context: { prompt: string; styleTemplateId?: string; scenePrompt?: string; kbFileIds?: string[] },
    configId: string, projectId?: string
  ): Promise<AICallResult> {
    return aiCapability.generate(
      context.prompt,
      {
        configId, projectId,
        styleTemplateId: context.styleTemplateId,
        sceneInjection: context.scenePrompt,
        kbFileIds: context.kbFileIds,
        kbMaxChunks: 5,
      }
    )
  },
}
