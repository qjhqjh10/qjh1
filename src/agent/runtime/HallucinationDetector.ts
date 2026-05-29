// ── Hallucination Detector ──
// Detects when AI claims to have performed an action but did not actually call a tool.
// Also detects permission hallucinations, future-tense deception, and over-generalization.

interface ActionCheck {
  pattern: RegExp
  tools: string[]
  label: string
}

export class HallucinationDetector {
  private checks: ActionCheck[] = [
    // #1-8: Past-tense action claims without tool calls
    { pattern: /(?:已经|已).{0,10}(创建|新建|生成|写入|写好|做好|添加了)/, tools: ['create_file', 'create_project', 'create_style_template', 'create_scene_template', 'generate_image', 'kb_create_file'], label: '创建/生成' },
    { pattern: /(?:已经|已).{0,10}(修改|编辑|更新|替换|改写|改成|调整了|调整好)/, tools: ['edit_file', 'rename_file', 'create_file'], label: '修改/编辑' },
    { pattern: /(?:已经|已).{0,10}(读取|查看|读过|看过|查阅)/, tools: ['read_file', 'list_directory'], label: '读取/查看' },
    { pattern: /(?:已经|已).{0,10}(删除|移除|去掉)/, tools: ['delete_file'], label: '删除' },
    { pattern: /(?:已经|已).{0,10}(保存|存储)/, tools: ['create_file', 'edit_file', 'kb_create_file', 'kb_append_file'], label: '保存/写入' },
    { pattern: /(?:已经|已).{0,10}(搜索|检索|查找|找到)/, tools: ['search_files', 'search_content'], label: '搜索' },
    { pattern: /(?:已经|已).{0,10}(追加|写入)/, tools: ['edit_file', 'create_file', 'kb_append_file'], label: '追加/写入' },
    { pattern: /\b(?:has been|have been|already)\s+(created|modified|edited|deleted|generated|written|saved|added)/i, tools: ['create_file', 'edit_file', 'delete_file'], label: 'action claimed' },

    // #9: Permission hallucination — AI invents restrictions that don't exist
    { pattern: /(?:没有|无)权限|路径.*受限|不允许.*访问|无权|无法.*访问|protected|permission|access\s+denied/i, tools: [], label: '权限幻觉' },

    // #10: Future-tense deception — AI says "I will..." but then doesn't
    { pattern: /(?:我会帮你|我将要帮你|让我来帮你|现在帮你|马上帮你|这就帮你)做/i, tools: [], label: '未来时态声称' },

    // #11: Over-generalization — AI claims "all/everything" but only did a portion
    { pattern: /(?:所有|全部|每一个|整个|完整)地?(?:检查|修复|更新|创建|修改|生成|读取|搜索)/i, tools: [], label: '过度泛化' },
  ]

  detect(text: string, knownTools: Set<string>): string | null {
    if (!text || typeof text !== 'string') return null

    for (const check of this.checks) {
      if (check.pattern.test(text)) {
        // For permission hallucination/future-tense/over-generalization (tools list empty),
        // we always flag regardless of knownTools
        if (check.tools.length === 0) {
          if (check.label === '权限幻觉') {
            return `检测到你在回复中声称"没有权限/无法访问"，但你实际拥有所有工具的使用权。这是幻觉——请直接调用工具尝试操作。`
          }
          if (check.label === '未来时态声称') {
            return `检测到你说"${check.label}"但没有实际调用工具。请不要只是承诺——立即调用对应工具完成操作。`
          }
          if (check.label === '过度泛化') {
            return `检测到你声称完成了"所有/全部"操作，但你可能只完成了部分。请明确说明你实际做了哪些操作。`
          }
        }

        // For action checks, verify the corresponding tool was called
        const hasTool = check.tools.some(t => knownTools.has(t))
        if (!hasTool) {
          return `检测到你在回复中声称"${check.label}"操作，但未实际调用对应工具。请立即调用对应工具完成操作。`
        }
      }
    }

    return null
  }
}
