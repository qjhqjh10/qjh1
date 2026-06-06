// ── Phase Manager (v10.0.0) ──
// Enforces the ANALYZE→EXECUTE→VERIFY phase transitions.
// Not just prompt guidance — phase violations are intercepted by the Runtime loop.

import type { AgentPhase } from '../state/types'
import type { ActiveSkillContext } from '../skills/types'
import type { NormalizedModelResponse } from './adapters/ProtocolAdapter'
import { scoreTaskComplexity } from '../utils/taskDetection'

/** Tools that require format knowledge → should be gated behind a Skill */
const COMPLEX_CREATE_PATHS = /^(?:characters\/|chapters\/|detailed_outline\/|outline\/)/
const COMPLEX_EDIT_PATHS = /^(?:outline\/|characters\/)/
const COMPLEX_TOOLS = new Set(['create_style_template', 'create_scene_template', 'kb_create_file'])

export class PhaseManager {
  private phase: AgentPhase = 'IDLE'
  private taskComplexity: 'simple' | 'complex' = 'simple'
  private analysisAttempts = 0
  private skillGateSuggestionCount = 0  // v10.0.4: 限制 Skill Gate 建议次数
  private readonly MAX_ANALYSIS_ATTEMPTS = 3

  // ── Phase control ──

  transition(to: AgentPhase): void { this.phase = to }

  getPhase(): AgentPhase { return this.phase }

  isInPhase(p: AgentPhase): boolean { return this.phase === p }

  /** Called at start of each run(). Resets to ANALYZE (or skips for pure chat). */
  startRun(userMessage: string): void {
    this.analysisAttempts = 0
    this.skillGateSuggestionCount = 0  // v10.0.4: 重置计数
    this.taskComplexity = scoreTaskComplexity(userMessage) >= 2 ? 'complex' : 'simple'
    this.phase = 'ANALYZE'
  }

  getTaskComplexity(): 'simple' | 'complex' { return this.taskComplexity }

  // ── ANALYZE phase gate ──

  /**
   * In ANALYZE phase, the model must output analysis TEXT before calling any tools.
   * Returns { canProceed, injection } — if !canProceed, the Runtime must inject
   * `injection` as a user message to nudge the model.
   */
  checkAnalyzePhase(response: NormalizedModelResponse): { canProceed: boolean; injection?: string } {
    this.analysisAttempts++

    // Model output text + tools in same response → text IS the analysis, allow
    const hasText = response.text && response.text.trim().length > 10
    const hasTools = response.toolCalls.length > 0

    if (hasText && hasTools) {
      return { canProceed: true }  // 文本+工具同轮 → 分析在文本中
    }

    if (hasTools && !hasText) {
      if (this.analysisAttempts >= this.MAX_ANALYSIS_ATTEMPTS) {
        return { canProceed: true }  // 放弃拦截
      }
      return {
        canProceed: false,
        injection: `[阶段约束] 当前处于意图分析阶段（第${this.analysisAttempts}次），请先输出分析文本再调用工具。`,
      }
    }

    // Pure text — analysis complete
    if (hasText) {
      return { canProceed: true }
    }

    // No text, no tools — edge case, allow
    return { canProceed: true }
  }

  // ── Skill Gate (EXECUTE phase) ──

  /**
   * In EXECUTE phase, certain COMPLEX tool calls benefit from an active Skill.
   * Returns { allowed, suggestion } — complex tools without activeSkill are
   * allowed through (v10.0.1: permissive mode — warn but don't block),
   * while injecting a suggestion to invoke_skill.
   */
  checkSkillGate(
    toolName: string,
    args: Record<string, unknown>,
    activeSkill: ActiveSkillContext | null,
  ): { allowed: boolean; suggestion?: string } {
    // Always allow SIMPLE tools
    if (!this.isComplexToolCall(toolName, args)) {
      return { allowed: true }
    }

    // COMPLEX tool with active Skill → allowed, no suggestion needed
    if (activeSkill) {
      return { allowed: true }
    }

    // COMPLEX tool without Skill → allow but suggest invoke_skill (only first 2 times)
    this.skillGateSuggestionCount++
    if (this.skillGateSuggestionCount > 2) {
      return { allowed: true }  // v10.0.4: 不再重复建议，避免spam
    }
    const skillHint = this.suggestSkill(toolName, args)
    return {
      allowed: true,
      suggestion: `[Skill建议] 检测到 ${this.describeComplexity(toolName, args)} 操作。建议先调用 \`invoke_skill\` 获取完整工作流和格式规范，以确保操作正确。${skillHint}`,
    }
  }

  /** Check if a tool call is "complex" — needs format knowledge from a Skill */
  private isComplexToolCall(toolName: string, args: Record<string, unknown>): boolean {
    // Always-gated tools regardless of path
    if (COMPLEX_TOOLS.has(toolName)) return true

    // Path-sensitive gating
    const fp = String(args.file_path || '')
    if (toolName === 'create_file' && COMPLEX_CREATE_PATHS.test(fp)) return true
    if (toolName === 'edit_file' && COMPLEX_EDIT_PATHS.test(fp)) return true

    return false
  }

  /** Suggest which skill to invoke based on the tool and path */
  private suggestSkill(toolName: string, args: Record<string, unknown>): string {
    const fp = String(args.file_path || '')

    if (toolName === 'create_style_template') return '建议调用: invoke_skill name="style-template"'
    if (toolName === 'create_scene_template') return '建议调用: invoke_skill name="scene-template"'
    if (toolName === 'kb_create_file') return '建议调用: invoke_skill name="knowledge-base"'

    if (fp.startsWith('characters/')) return '建议调用: invoke_skill name="character-management"'
    if (fp.startsWith('chapters/') || fp.startsWith('summaries/')) return '建议调用: invoke_skill name="chapter-writing"'
    if (fp.startsWith('detailed_outline/')) return '建议调用: invoke_skill name="detailed-outline"'
    if (fp.startsWith('outline/')) return '建议调用: invoke_skill name="outline-creation"'

    return '请在 Skill 目录中查找匹配的技能。'
  }

  private describeComplexity(toolName: string, args: Record<string, unknown>): string {
    const fp = String(args.file_path || '')
    if (toolName === 'create_style_template') return '11必填维度+26维完整分析'
    if (toolName === 'create_scene_template') return '20+字段场景配置'
    if (fp.startsWith('characters/')) return '16字段YAML角色卡'
    if (fp.startsWith('chapters/')) return '章节正文格式+阅读顺序'
    if (fp.startsWith('detailed_outline/')) return '细纲YAML关键字段'
    if (fp.startsWith('outline/')) return '大纲Markdown+Tab JSON格式'
    return '结构化内容创建'
  }
}
