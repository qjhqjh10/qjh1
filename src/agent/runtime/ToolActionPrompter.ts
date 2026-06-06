// ── Tool Action Prompter ──
// Extracted from executeSingleTool in both runtimes (~95% identical).
// Handles: missing file tracking, consecutive-reads action prompts,
// precondition skipping, skill step completion, quality check invocation.
//
// Accepts mutable state via a context object — caller owns messagesForApi,
// activeSkill, and _consecutiveReads.

import type { Message, ToolCallRequest, ToolResult } from '../state/types'
import type { ActiveSkillContext } from '../skills/types'
import { skillRegistry } from '../skills/SkillRegistry'
import { runQualityChecks } from './QualityCheckEngine'

export interface ActionPromptContext {
  messagesForApi: Message[]
  activeSkill: ActiveSkillContext | null
  _consecutiveReads: number
  tc: ToolCallRequest
  result: ToolResult
  args: Record<string, unknown>
}

const READ_TOOLS_ACTION = new Set(['read_file','list_directory','search_content','find_files'])
const WRITE_TOOLS_ACTION = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file',
  'kb_create_file','kb_append_file','write_note','append_note'])

/**
 * Apply all post-execution skill orchestration to the agent state.
 * Called by ToolExecutor after each tool execution.
 * Returns the (possibly updated) _consecutiveReads counter.
 */
export function applyActionPrompts(ctx: ActionPromptContext): number {
  let reads = ctx._consecutiveReads

  // ── v9.6.1: invoke_skill — 模型主动调用 Skill，设置活跃 Skill 上下文 ──
  if (ctx.tc.name === 'invoke_skill' && ctx.result.status === 'success') {
    const skillName = String(ctx.args.name || '')
    const skill = skillRegistry.get(skillName)
    if (skill) {
      ctx.activeSkill = {
        skillId: skill.id,
        currentStep: 1,
        completedSteps: new Set(),
        extractedFields: {},
        retryCount: 0,
        missingFiles: new Set(),
      }
      // v9.7.0: 确认消息提示模型查看紧随其后的 tool_result 中的工作流
      ctx.messagesForApi.push({
        role: 'user',
        content: `[Skill已激活] ${skill.name}。请严格按照下方工具返回结果中的工作流步骤执行，从步骤1开始。先输出执行承诺，再调用工具。`,
      })
    }
  }

  // ── v9.5.3: 前置条件 — 跟踪缺失文件 ──
  if (ctx.activeSkill && ctx.tc.name === 'read_file' && ctx.result.status === 'error') {
    const fp = String(ctx.args.file_path || '')
    if (fp) ctx.activeSkill.missingFiles.add(fp)
  }

  // ── v9.5.3: 行动提示 — 连续读取后无写入则注入提醒 ──
  if (READ_TOOLS_ACTION.has(ctx.tc.name)) {
    reads = (reads || 0) + 1
  } else if (WRITE_TOOLS_ACTION.has(ctx.tc.name)) {
    reads = 0
  }
  if ((reads || 0) >= 3 && ctx.result.status === 'success') {
    ctx.messagesForApi.push({
      role: 'user',
      content: '[行动提示] 已连续读取多个文件，请立即对需要修改的文件调用 edit_file 或 create_file 写入。',
    })
    reads = 0
  }

  // ── v5: Skill 质量检查 ──
  if (ctx.activeSkill && ctx.result.status === 'success') {
    const skill = skillRegistry.get(ctx.activeSkill.skillId)
    if (skill) {
      // v9.5.3: 前置条件 — 下一步文件已知缺失则自动跳过
      const nextStep = skill.workflow.steps.find(s => s.order === ctx.activeSkill!.currentStep + 1)
      if (nextStep?.precondition && ctx.activeSkill!.missingFiles.has(nextStep.precondition.path)) {
        ctx.activeSkill!.completedSteps.add(nextStep.order)
        ctx.activeSkill!.currentStep = Math.min(nextStep.order + 1, skill.workflow.steps.length + 1)
        ctx.messagesForApi.push({
          role: 'user',
          content: `[前置条件] 步骤 ${nextStep.order}（${nextStep.purpose}）所需文件已知不存在，已自动跳过。`,
        })
      }

      // 标记步骤完成
      const matchedStep = skill.workflow.steps.find(
        s => s.tool === ctx.tc.name && s.order === ctx.activeSkill!.currentStep
      )
      if (matchedStep) {
        ctx.activeSkill.completedSteps.add(matchedStep.order)
        ctx.activeSkill.currentStep = Math.min(
          matchedStep.order + 1,
          skill.workflow.steps.length + 1
        )
      }

      // 运行质量检查（write/create 类工具 + 验证脚本）
      if (/^(create_file|edit_file|create_style_template|create_scene_template|shell_run_script)$/.test(ctx.tc.name)) {
        const failed = runQualityChecks(skill, ctx.tc.name, ctx.result, ctx.args)
        if (failed.length > 0 && ctx.activeSkill.retryCount < 3) {
          ctx.activeSkill.retryCount++
          const correctionMsg = `[自动纠错] 以下质量检查未通过，请修正后重试：\n` +
            failed.map(f => `- ${f.description}`).join('\n') +
            `\n请基于以上反馈修正后重新调用 ${ctx.tc.name}。`
          ctx.messagesForApi.push({ role: 'user', content: correctionMsg })
        } else if (failed.length > 0 && ctx.activeSkill.retryCount >= 3) {
          // v9.5.3: 熔断反馈 — retryCount 耗尽时告知模型，避免静默放弃
          ctx.messagesForApi.push({
            role: 'user',
            content: `[质量检查] 已重试 ${ctx.activeSkill.retryCount} 次仍未通过以下检查，当前结果已接受，请继续后续步骤：\n` +
              failed.map(f => `- ${f.description}`).join('\n'),
          })
        }
      }
    }
  }

  return reads
}
