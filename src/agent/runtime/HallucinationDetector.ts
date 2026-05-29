// ── Hallucination Detector ──
// Detects when AI claims to have performed an action but did not actually call a tool.

interface ActionCheck {
  pattern: RegExp
  tools: string[]
  label: string
}

export class HallucinationDetector {
  private checks: ActionCheck[] = [
    { pattern: /(?:已经|已).{0,10}(创建|新建|生成|写入|写好|做好|添加了)/, tools: ['create_file', 'create_project', 'create_style_template', 'create_scene_template', 'generate_image', 'kb_create_file'], label: '创建/生成' },
    { pattern: /(?:已经|已).{0,10}(修改|编辑|更新|替换|改写|改成|调整了|调整好)/, tools: ['edit_file', 'rename_file', 'create_file'], label: '修改/编辑' },
    { pattern: /(?:已经|已).{0,10}(读取|查看|读过|看过|查阅)/, tools: ['read_file', 'list_directory'], label: '读取/查看' },
    { pattern: /(?:已经|已).{0,10}(删除|移除|去掉)/, tools: ['delete_file'], label: '删除' },
    { pattern: /(?:已经|已).{0,10}(保存|存储)/, tools: ['create_file', 'edit_file', 'kb_create_file', 'kb_append_file'], label: '保存/写入' },
    { pattern: /(?:已经|已).{0,10}(搜索|检索|查找|找到)/, tools: ['search_files', 'search_content'], label: '搜索' },
    { pattern: /(?:已经|已).{0,10}(追加|写入)/, tools: ['edit_file', 'create_file', 'kb_append_file'], label: '追加/写入' },
    // English patterns
    { pattern: /\b(?:has been|have been|already)\s+(created|modified|edited|deleted|generated|written|saved|added)/i, tools: ['create_file', 'edit_file', 'delete_file'], label: 'action claimed' },
  ]

  detect(text: string, knownTools: Set<string>): string | null {
    if (!text || typeof text !== 'string') return null

    for (const check of this.checks) {
      if (check.pattern.test(text)) {
        const hasTool = check.tools.some(t => knownTools.has(t))
        if (!hasTool) {
          return `检测到你在回复中声称"${check.label}"操作，但未实际调用对应工具。请立即调用对应工具完成操作。`
        }
      }
    }

    return null
  }
}
