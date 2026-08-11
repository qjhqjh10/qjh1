/**
 * 统一 AI 能力接入层
 * 消除各模块独立调用 AI 的碎片化问题，统一参数构建、错误处理、结果标准化。
 */
import { aiService } from './fileService'
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
  /** 温度参数 */
  temperature?: number
  /** 最大输出token */
  maxTokens?: number
}

export interface AICallResult {
  success: boolean
  content: string
  error?: string
  /** 是否降级处理（如不支持的操作 → 回退路径） */
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

      // 3. KB 注入：已移除（v13.x 死代码——kbFileIds 全仓无调用方传参；真实管道是 knowledgePipeline）

      // 4. 组装完整prompt
      if (parts.length > 0) {
        prompt = parts.join('\n\n---\n\n') + '\n\n---\n\n' + userMessage
      }

      const messages: any[] = []
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: prompt })

      const { chatAI } = await import('@/utils/chatAI')
      const reply = await chatAI(messages, options.configId)
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
}
