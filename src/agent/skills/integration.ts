// ── 技能系统集成层 ──
// 将技能系统接入 V4 Agent 主流程。
// 在上下文组装前进行技能匹配，匹配到的技能指引注入系统提示词。
//
// 集成点:
//   1. buildSkillInjection() — V4SystemPrompt 调用，生成技能提示词片段
//   2. enhanceDomainModules() — V4AgentChatBridge 调用，增强领域模块
//   3. isSkillMatch() — 快速判断用户消息是否匹配任何技能

import { skillRegistry } from './SkillRegistry'
import { initSkills } from './index'
import type { SkillPromptFragment } from './types'

let initialized = false

/** 确保技能系统已初始化 */
function ensureInit(): void {
  if (!initialized) {
    try {
      initSkills()
      initialized = true
    } catch {
      // 技能系统初始化失败不应阻止 Agent 正常运行
      console.warn('[Skills] 初始化失败，技能指引将不可用')
    }
  }
}

/**
 * 构建技能注入文本。
 * 在 V4SystemPrompt 的 buildSystemPrompt() 之后调用，
 * 将匹配到的技能指引追加到系统提示词末尾。
 *
 * @returns 技能提示词文本，无匹配时返回空字符串
 */
export function buildSkillInjection(userMessage: string): string {
  ensureInit()

  const fragments = skillRegistry.buildPromptFragments({
    userMessage,
    projectId: null,
    activePage: '',
  })

  const matched = fragments.filter(f => f.matched)
  if (matched.length === 0) return ''

  // 按优先级排序
  matched.sort((a, b) => b.priority - a.priority)

  const lines: string[] = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '## 🔧 技能匹配指引（以下技能已匹配到用户意图，优先参考）',
    '',
  ]

  for (const f of matched.slice(0, 2)) { // 最多注入 2 个匹配技能
    lines.push(f.promptText)
  }

  // 高置信度技能：强调必须遵守
  const highConf = matched.filter(f => f.confidence >= 0.7)
  if (highConf.length > 0) {
    lines.push('⚠️ 以上技能指引具有高置信度匹配，请严格遵循推荐的步骤和质量检查规则。')
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

/**
 * 获取当前匹配到的技能元信息（用于 UI 展示）。
 */
export function getMatchedSkillMeta(userMessage: string): Array<{
  id: string
  name: string
  confidence: number
  category: string
}> {
  ensureInit()
  const matches = skillRegistry.match(userMessage)
  return matches.slice(0, 3).map(m => ({
    id: m.skill.id,
    name: m.skill.name,
    confidence: Math.round(m.confidence * 100) / 100,
    category: m.skill.category,
  }))
}

/**
 * 获取所有可用技能的简要列表（用于"你能做什么"类查询）。
 */
export function getAvailableSkillsSummary(): string {
  ensureInit()
  const skills = skillRegistry.getEnabled()
  if (skills.length === 0) return ''

  const byCategory = new Map<string, string[]>()
  for (const s of skills) {
    const cat = s.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(s.name)
  }

  const lines: string[] = ['## 🔧 可用技能', '']
  for (const [cat, names] of byCategory) {
    const catLabel: Record<string, string> = {
      character: '角色', outline: '大纲', chapter: '章节',
      style: '风格', scene: '场景', knowledge: '知识库',
      note: '笔记', project: '项目', review: '审稿',
      continuation: '续写', imitation: '仿写', general: '通用',
    }
    lines.push(`- ${catLabel[cat] || cat}: ${names.join('、')}`)
  }

  return lines.join('\n')
}

/**
 * 为 V4AgentChatBridge 增强领域模块。
 * 在原有的 selectDomainModules() 基础上叠加技能指引。
 */
export function enhanceDomainModules(
  userMessage: string,
  existingModules: string[],
): string[] {
  ensureInit()

  const matches = skillRegistry.match(userMessage)
  if (matches.length === 0) return existingModules

  const result = [...existingModules]

  for (const match of matches.slice(0, 2)) {
    const { skill } = match

    // 构建技能模块
    const lines = [
      `\n## 🔧 匹配技能: ${skill.name} (置信度: ${Math.round(match.confidence * 100)}%)`,
      skill.description,
      '',
      skill.workflow.description,
    ]

    if (skill.workflow.steps.length > 0) {
      lines.push('推荐步骤:')
      for (const step of skill.workflow.steps) {
        lines.push(`  ${step.order}. ${step.purpose} → ${step.tool}`)
      }
    }

    if (skill.qualityChecks.length > 0) {
      lines.push('\n质量检查:')
      for (const qc of skill.qualityChecks) {
        lines.push(`  ${qc.severity === 'error' ? '❌' : '⚠️'} ${qc.description}`)
      }
    }

    result.push(lines.join('\n'))
  }

  return result
}

// ── 便捷导出 ──
export { skillRegistry, initSkills }
