// ── Task Pipeline ──
// Orchestrates the Classifier → Intent+Plan → Approval → Execute pipeline.
// Injects the pre-designed plan into AgentRuntime for execution.

import { prefilterClient, parseClassification, CLASSIFIER_PROMPT } from './TaskClassifier'
import { parseIntent, parsePlan as parseMergedPlan, INTENT_PLAN_PROMPT } from './IntentAnalyzer'
import { parsePlan as parseSimplePlan, PLAN_ONLY_PROMPT } from './PlanDesigner'
import { ContextCache } from './ContextCache'
import type {
  ClassificationResult, IntentResult,
  PipelineResult, PipelineConfig,
} from './types'
import type { ThinkingPlan } from '../state/types'

export class TaskPipeline {
  private configId: string       // Main execution model (fallback)
  private projectId: string | null
  private cache = new ContextCache()
  private pipelineConfig: PipelineConfig

  constructor(
    configId: string,
    projectId: string | null,
    pipelineConfig?: Partial<PipelineConfig>,
  ) {
    this.configId = configId
    this.projectId = projectId
    this.pipelineConfig = {
      enabled: true,
      autoApproveBelow: 'low',
      ...pipelineConfig,
    }
  }

  /** Use classifier model if configured, otherwise fall back to main */
  private get classifierModelId(): string {
    return this.pipelineConfig.classifierModelId || this.configId
  }
  /** Use intent+plan model if configured, otherwise fall back to main */
  private get intentPlannerModelId(): string {
    return this.pipelineConfig.intentPlannerModelId || this.configId
  }

  // ── Public API ──

  async run(userMessage: string): Promise<PipelineResult> {
    if (!this.pipelineConfig.enabled) {
      return { phase: 'done', pipelineTokens: 0 }
    }

    let totalTokens = 0

    // ── Stage 0: Client-side pre-filter ──
    const preFilter = prefilterClient(userMessage)
    if (preFilter && preFilter.suggestedRoute === 'direct') {
      return this.directClientResponse(preFilter)
    }

    // ── Stage 1: Classifier (API #1, cheap model) ──
    let classification: ClassificationResult
    try {
      const result = await this.callAI(CLASSIFIER_PROMPT, userMessage, this.classifierModelId)
      totalTokens += result.tokens
      classification = preFilter || parseClassification(result.text)
    } catch {
      // Fallback: classifier failed → route to full pipeline
      classification = {
        isComplexTask: true, taskType: 'simple_query',
        reasoning: '分类器异常，默认完整流水线', estimatedComplexity: 'medium',
        suggestedRoute: 'full',
      }
    }

    // ── Direct route: simple reply ──
    if (classification.suggestedRoute === 'direct') {
      const directText = await this.directAIResponse(userMessage, this.classifierModelId)
      return { phase: 'done', classification, directText, pipelineTokens: totalTokens }
    }

    // ── Stage 2: Intent+Plan (API #2, cheap model) ──
    let intent: IntentResult | null = null
    let plan: ThinkingPlan | null = null

    try {
      const projectSummary = await this.cache.getProjectSummary(this.projectId)
      const contextPrompt = projectSummary
        ? `\n当前项目摘要: ${projectSummary.slice(0, 500)}\n用户消息: ${userMessage}`
        : `用户消息: ${userMessage}`

      if (classification.suggestedRoute === 'full') {
        // Merged Intent+Plan prompt
        const result = await this.callAI(INTENT_PLAN_PROMPT, contextPrompt, this.intentPlannerModelId)
        totalTokens += result.tokens
        intent = parseIntent(result.text)
        plan = parseMergedPlan(result.text)
      } else {
        // Simplified route: Plan only
        const result = await this.callAI(PLAN_ONLY_PROMPT, contextPrompt, this.intentPlannerModelId)
        totalTokens += result.tokens
        plan = parseSimplePlan(result.text)
      }

      // Handle ambiguous intent
      if (intent?.isAmbiguous && intent.clarificationQuestions.length > 0) {
        return {
          phase: 'awaiting_approval',
          classification, intent,
          clarificationQuestions: intent.clarificationQuestions,
          pipelineTokens: totalTokens,
        }
      }
    } catch {
      // Fallback: Intent+Plan failed → degrade to inline planning by main LLM
    }

    // Plan design failed → degrade to existing flow
    if (!plan || plan.steps.length === 0) {
      return { phase: 'done', classification, intent, pipelineTokens: totalTokens }
    }

    // ── Auto-approve for low complexity ──
    const complexity = classification.estimatedComplexity
    const threshold = this.pipelineConfig.autoApproveBelow || 'none'
    const autoApprove = threshold !== 'none' && (
      (threshold === 'low' && complexity === 'low') ||
      (threshold === 'medium' && (complexity === 'low' || complexity === 'medium')) ||
      (threshold === 'high')
    )

    if (autoApprove) {
      plan.steps.forEach(s => { s.approvalStatus = 'approved' })
    }

    return {
      phase: autoApprove ? 'executing' : 'awaiting_approval',
      classification, intent, plan,
      pipelineTokens: totalTokens,
    }
  }

  // ── Helpers ──

  private async callAI(systemPrompt: string, userMessage: string, modelId: string):
    Promise<{ text: string; tokens: number }> {
    const { aiService } = await import('@/services/fileService')
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage },
    ]
    const result = await aiService.chatWithUsage(messages, modelId)
    return {
      text: result.text,
      tokens: result.usage?.total_tokens || Math.ceil((systemPrompt.length + userMessage.length) / 2),
    }
  }

  private async directAIResponse(userMessage: string, modelId: string): Promise<string> {
    try {
      const { aiService } = await import('@/services/fileService')
      const result = await aiService.chat(
        [{ role: 'user', content: userMessage }],
        modelId,
      )
      return result
    } catch {
      return '好的，收到你的消息。'
    }
  }

  private directClientResponse(c: ClassificationResult): PipelineResult {
    return {
      phase: 'done',
      classification: c,
      directText: '你好！有什么我可以帮你的吗？',
      pipelineTokens: 0,
    }
  }
}
