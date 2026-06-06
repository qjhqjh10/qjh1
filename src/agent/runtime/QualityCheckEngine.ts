// ── Quality Check Engine ──
// Extracted from V4AgentRuntime.ts / V4AnthropicRuntime.ts (100% identical).
// Pure functions — no instance state needed. Called by ToolActionPrompter.
//
// 质量检查分两类：
//   A. 代码可自动检测 — 正则/结构校验（如字段完整性、格式合法性）
//   B. 行为约束 — 依赖提示词约束（如"必须先 read_file"、"等待用户确认"）
//     此类在 evaluateQualityCheck 中 default → true，不会误报

import type { ToolResult } from '../state/types'

/**
 * Run all quality checks for a skill against a tool execution result.
 * Returns the list of failed checks.
 */
export function runQualityChecks(
  skill: { qualityChecks: Array<{ id: string; description: string; severity: string; check: string }> },
  toolName: string,
  result: ToolResult,
  args: Record<string, unknown>,
): Array<{ id: string; description: string }> {
  const failed: Array<{ id: string; description: string }> = []
  const content = String(args.content || result.detail || '')

  for (const qc of skill.qualityChecks) {
    if (!isQualityCheckApplicable(qc.id, toolName)) continue

    const passed = evaluateQualityCheck(qc.id, content, args)
    if (!passed) {
      failed.push({ id: qc.id, description: qc.description })
    }
  }
  return failed
}

/** Determine whether a quality check ID is relevant for the given tool. */
export function isQualityCheckApplicable(checkId: string, toolName: string): boolean {
  // 角色相关检查（qc- 前缀）→ 仅 create_file 创建角色文件时
  if (/^qc-/.test(checkId) && toolName === 'create_file') return true
  // 章节内容检查 → create_file（章节正文 .txt）
  if (/^(word-count|paragraph-spacing|not-one-block|chapter-format|read-summary-not-chapter)$/.test(checkId)) return toolName === 'create_file'
  // 风格模板检查 → create_style_template
  if (/^(no-empty-dims|11-required-dims|vocabulary-limit|english-keys)$/.test(checkId)) return toolName === 'create_style_template'
  // 场景模板检查
  if (/^(required-fields|auto-fields-limit|no-empty-config)$/.test(checkId)) return toolName === 'create_scene_template'
  // 大纲/追加内容检查 → edit_file 或 create_file
  if (/^(content-length|old-string-exact|append-not-overwrite)$/.test(checkId)) return toolName === 'edit_file' || toolName === 'create_file'
  // KB/其他检查
  if (/^(list-before-create|remind-index|chinese-name)$/.test(checkId)) return toolName === 'kb_create_file'
  // 通用格式检查 — 行为约束类 → 代码无法检测，不在此处拦截
  if (/^(yaml-format|plot-length|analyze-first|wait-confirm|offer-options|confirm-type|read-before-edit)$/.test(checkId)) {
    return false
  }
  return false
}

/** Evaluate a single quality check against tool arguments and result content. */
export function evaluateQualityCheck(checkId: string, content: string, args: Record<string, unknown>): boolean {
  const filePath = String(args.file_path || '')
  const fileName = filePath.replace(/^.*[/\\]/, '').replace(/\.(yaml|yml|json)$/, '')

  switch (checkId) {
    // ═══ 角色卡检查 ═══
    case 'qc-all-fields': {
      const requiredFields = ['id','name','role','gender','age','occupation',
        'background','appearance','personality','abilities','weaknesses',
        'relationships','relationshipTags','arc','importance']
      return requiredFields.every(f => content.includes(f + ':'))
    }
    case 'qc-abilities-string':
      return !/\babilities\b.*:\s*[\{\[]/.test(content)
    case 'qc-role-enum':
      return /\brole\b.*:\s*(男主|女主|男配|女配|反派|其他)/.test(content)
    case 'qc-relationship-tags':
      return /relationshipTags\b.*:\s*\[/.test(content)
    case 'qc-importance-number':
      return /\bimportance\b.*:\s*\d+/.test(content)
    case 'qc-no-nesting':
      return !/^(id|name|role|gender|age|occupation|background|appearance|personality|abilities|weaknesses|relationships|relationshipTags|arc|importance):\s*\n\s+\w+:/m.test(content)
    case 'qc-name-match': {
      if (!fileName || !content) return true
      const nameField = content.match(/^name:\s*(.+)$/m)
      return nameField ? nameField[1].trim() === fileName : true
    }
    case 'qc-file-extension':
      return filePath.endsWith('.yaml') || filePath.endsWith('.yml')

    // ═══ 风格模板检查 ═══
    case 'no-empty-dims':
      return !/\bdimensions\b.*:\s*\{\s*\}/.test(content) && !/\bdimensions\b.*:\s*""/.test(content)
    case '11-required-dims': {
      const requiredDims = ['narrativeTone','sentenceStyle','vocabularyStyle','rhetoricStyle',
        'rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle',
        'sensoryStyle','descriptionPattern']
      let dims: Record<string, unknown> | null = null
      const rawDims = args.dimensions
      if (typeof rawDims === 'string') {
        try { dims = JSON.parse(rawDims) } catch { /* not JSON */ }
      } else if (rawDims && typeof rawDims === 'object') {
        dims = rawDims as Record<string, unknown>
      }
      if (dims) {
        return requiredDims.every(d => dims![d] && typeof dims![d] === 'object')
      }
      return requiredDims.every(d => content.includes(`"${d}"`) || content.includes(d + ':'))
    }
    case 'vocabulary-limit':
      return true // warn 级别，不做硬拦截
    case 'english-keys': {
      let dimsStr = ''
      const rawDims = args.dimensions
      if (typeof rawDims === 'string') dimsStr = rawDims
      else if (rawDims && typeof rawDims === 'object') dimsStr = JSON.stringify(rawDims)
      else dimsStr = content
      const keyMatch = dimsStr.match(/"dimensions"\s*:\s*\{([^}]+)\}/)
      if (keyMatch) return !/[一-鿿]/.test(keyMatch[1])
      return true
    }

    // ═══ 章节正文检查 ═══
    case 'word-count':
      return content.length >= 500
    case 'paragraph-spacing':
      return /\n\n/.test(content)
    case 'not-one-block':
      return content.split('\n').filter(l => l.trim()).length >= 3
    case 'chapter-format':
      return /^#\s+.+/m.test(content) && content.split('\n').filter(l => l.trim()).length >= 3

    // ═══ 场景模板检查 ═══
    case 'required-fields': {
      const hasName = typeof args.name === 'string' && args.name.trim().length > 0
      const hasType = typeof args.type === 'string' && args.type.trim().length > 0
      return hasName && hasType
    }
    case 'auto-fields-limit': {
      const af = args.autoFields
      return !Array.isArray(af) || af.length <= 10
    }
    case 'no-empty-config': {
      const plotOk = typeof args.plotOverview === 'string' && args.plotOverview.trim().length > 0
      const sceneOk = typeof args.sceneType === 'string' && args.sceneType.trim().length > 0
      return plotOk || sceneOk
    }

    // ═══ 大纲/KB 检查 ═══
    case 'content-length':
      return content.length >= 50
    case 'chinese-name':
      return /[一-鿿]/.test(fileName)

    default:
      return true
  }
}
