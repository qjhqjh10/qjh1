// ── Skill 调用工具 ──
// v9.6.1: invoke_skill — 模型主动调用以获取 Skill 的完整工作流。
// 遵循 Claude Code 的 Agent/Skill/Tool 三层架构：
//   Agent 决策 → Skill 提供工作流指引 → Tool 执行原子操作

import type { ToolDefinition } from '../types'
import { skillRegistry } from '../SkillRegistry'

export const invokeSkillTool: ToolDefinition = {
  schema: {
    name: 'invoke_skill',
    description:
      '调用指定的技能来获取完整的工作流指引。\n' +
      '当你认为当前任务需要某个技能的详细步骤指导时，应该先调用此工具。\n' +
      '调用后你会收到该技能的完整操作流程、必须执行的步骤、质量检查规则。\n' +
      '注意：调用 invoke_skill 后，你必须严格按照返回的工作流步骤执行。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            '技能ID。可用技能列表见系统提示词中的"技能目录"。\n' +
            '可选值: outline-creation | character-management | chapter-writing | detailed-outline | ' +
            'style-template | scene-template | knowledge-base | text-import | text-analysis | ' +
            'text-processor | chapter-polish | task-orchestration',
        },
      },
      required: ['name'],
    },
  },
  permission: 'AUTO',
  category: 'prompt',
  availableInPlanMode: false,
  executor: async (args: Record<string, unknown>) => {
    const skillName = String(args.name || '')
    const skill = skillRegistry.get(skillName)

    if (!skill) {
      return {
        status: 'error',
        summary: `未找到技能: ${skillName}。可用技能: ${skillRegistry.getEnabled().map(s => s.id).join(', ')}`,
      }
    }

    // 构建完整工作流文本
    const lines: string[] = [
      `## 🔧 技能: ${skill.name}`,
      `> ${skill.description}`,
      '',
      skill.workflow.description,
      '',
    ]

    if (skill.workflow.steps.length > 0) {
      lines.push('### 必须执行的步骤（按顺序，不允许跳过或调换）：')
      for (const step of skill.workflow.steps) {
        const prefix = step.optional ? '[可选]' : '[必做]'
        lines.push(`${prefix} 步骤${step.order}. ${step.purpose}`)
        lines.push(`   工具: \`${step.tool}\``)
        if (step.argsTemplate && Object.keys(step.argsTemplate).length > 0) {
          lines.push(`   参数模板: ${JSON.stringify(step.argsTemplate)}`)
        }
      }
      lines.push('')
    }

    if (skill.qualityChecks.length > 0) {
      lines.push('### 质量检查（以下检查会被代码自动验证，不通过会被退回重做）：')
      for (const qc of skill.qualityChecks) {
        const icon = qc.severity === 'error' ? '❌' : '⚠️'
        lines.push(`  ${icon} ${qc.description}`)
      }
      lines.push('')
    }

    // v9.7.0: 验证脚本引用
    if (skill.workflow.verification?.script) {
      lines.push('### 最终验证脚本')
      lines.push(`所有步骤完成后，必须调用 \`shell_run_script\` 运行验证脚本：`)
      lines.push(`  name: "${skill.workflow.verification.script}"`)
      lines.push(`  ${skill.workflow.verification.description}`)
      lines.push('如果脚本返回 status: "fail"，请根据 checks 中的错误详情修正后重新验证。')
      lines.push('')
    }

    // v9.7.0: 计划清单 + 执行前承诺
    lines.push('### 📋 执行计划（执行前必须输出承诺）')
    lines.push('在调用任何工具之前，你必须先输出一行承诺，格式如下：')
    const stepLabels = skill.workflow.steps
      .filter(s => !s.optional)
      .map(s => `${s.order}. ${s.purpose}`)
    lines.push(`"我将执行: ${stepLabels.join(' | ')}"`)
    if (skill.workflow.verification?.script) {
      lines.push(`"完成后运行: shell_run_script name="${skill.workflow.verification.script}""`)
    }
    lines.push('然后再开始调用工具。不要跳过任何步骤。')

    return {
      status: 'success',
      summary: `已激活技能: ${skill.name}`,
      detail: lines.join('\n'),
    }
  },
}
