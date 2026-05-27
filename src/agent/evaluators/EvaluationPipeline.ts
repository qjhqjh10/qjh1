// ── Evaluation Pipeline ──
// Post-execution evaluation pipeline:
//   AuditTrail events → FailureTaxonomy → MetricsCollector → Layer 1 → Layer 2
//   → Feedback to SkillLearner + LivingSkillManager

import { FailureTaxonomy } from './FailureTaxonomy'
import { EvaluatorAgent } from './EvaluatorAgent'
import type { EvaluationReport } from './EvaluatorAgent'
import type { ToolResult, Message } from '../runtime/AgentRuntime'
import type { AuditTrail } from '../audit/AuditTrail'
import type { SkillLearner } from '../evolution/SkillLearner'
import type { LivingSkillManager } from '../living-skills/LivingSkillManager'
import type { ClassifiedFailure } from './FailureTaxonomy'

export interface PipelineInput {
  taskDescription: string
  toolResults: ToolResult[]
  messages: Message[]
  auditTrail: AuditTrail
  skillLearner: SkillLearner
  livingSkillManager: LivingSkillManager
}

export interface PipelineOutput {
  report: EvaluationReport
  failures: ClassifiedFailure[]
  dominantCategory: string | null
  autoSuggestions: string[]
}

export class EvaluationPipeline {
  private taxonomy = new FailureTaxonomy()
  private evaluator = new EvaluatorAgent()

  setEvaluatorAIService(svc: Parameters<EvaluatorAgent['setAIService']>[0]): void {
    this.evaluator.setAIService(svc)
  }

  async run(input: PipelineInput): Promise<PipelineOutput> {
    // Step 1: Classify failures
    const failures = this.taxonomy.classifyBatch(input.toolResults)
    const dominantCategory = this.taxonomy.getDominantCategory(failures)

    // Step 2: Record failures into SkillLearner
    for (const f of failures) {
      input.skillLearner.recordError(f.toolName || 'unknown', f.error, f.category)
    }

    // Step 3: Record success patterns into LivingSkill
    const successes = input.toolResults.filter(r => r.status === 'success')
    for (const r of successes) {
      // LivingSkill observes success for pattern learning
      input.livingSkillManager.onToolSuccess('', {}, r)
    }

    // Step 4: Run evaluation (Layer 1 always, Layer 2 if score low)
    const report = await this.evaluator.evaluate(
      input.toolResults,
      input.messages,
      input.taskDescription,
    )

    // Step 5: Generate auto-suggestions based on findings
    const autoSuggestions = this.generateSuggestions(report, failures, dominantCategory)

    return {
      report,
      failures,
      dominantCategory,
      autoSuggestions,
    }
  }

  private generateSuggestions(
    report: EvaluationReport,
    failures: ClassifiedFailure[],
    dominantCategory: string | null,
  ): string[] {
    const suggestions: string[] = []

    if (!report.overallPassed) {
      suggestions.push(`评估未通过（总分 ${report.overallScore}），请检查各维度详情`)
    }

    if (dominantCategory === 'tool_design' && failures.length >= 3) {
      suggestions.push('工具设计类失败频繁，建议检查工具描述和参数 schema 是否需要更新')
    }

    if (dominantCategory === 'data_gaps' && failures.length >= 3) {
      suggestions.push('数据缺口类失败频繁，建议增强 read_file/list_directory 的使用规范')
    }

    if (dominantCategory === 'prompt_design' && failures.length >= 2) {
      suggestions.push('提示词设计类失败出现，建议审查系统提示词中相关场景的覆盖')
    }

    // Check per-dimension issues
    for (const dim of report.dimensions) {
      if (!dim.passed && dim.issues.length > 0) {
        const criticalIssues = dim.issues.filter(i => i.severity === 'critical')
        if (criticalIssues.length > 0) {
          suggestions.push(`${dim.name} 维度有 ${criticalIssues.length} 个严重问题`)
        }
      }
    }

    return suggestions
  }

  getFailureTaxonomy(): FailureTaxonomy {
    return this.taxonomy
  }

  getEvaluator(): EvaluatorAgent {
    return this.evaluator
  }
}
