export interface PermissionRequest {
  toolName: string
  filePath?: string
  action: string
  risk: 'low' | 'medium' | 'high'
  suggestedAutoApprove: boolean
}

export interface PermissionPattern {
  toolName: string
  approvedCount: number
  deniedCount: number
  lastApproved: number | null
}

export interface PermissionPolicy {
  toolName: string
  autoApprove: boolean
  reason: string
}

export class PermissionManager {
  private patterns: PermissionPattern[] = []

  recordDecision(toolName: string, approved: boolean): void {
    const p = this.patterns.find(x => x.toolName === toolName)
    if (p) {
      if (approved) p.approvedCount++
      else p.deniedCount++
      p.lastApproved = approved ? Date.now() : p.lastApproved
    } else {
      this.patterns.push({
        toolName,
        approvedCount: approved ? 1 : 0,
        deniedCount: approved ? 0 : 1,
        lastApproved: approved ? Date.now() : null,
      })
    }
  }

  evaluate(toolName: string, filePath?: string): PermissionRequest {
    const risk = this.assessRisk(toolName, filePath)
    const pattern = this.patterns.find(p => p.toolName === toolName)

    // Auto-approve if user has approved > 5 times with no denials AND within 7 days
    const SEVEN_DAYS = 7 * 86400000
    const suggestedAutoApprove = pattern
      ? pattern.approvedCount > 5 && pattern.deniedCount === 0 && pattern.lastApproved !== null && (Date.now() - pattern.lastApproved) < SEVEN_DAYS
      : false

    return {
      toolName,
      filePath,
      action: this.describeAction(toolName),
      risk,
      suggestedAutoApprove,
    }
  }

  getLearnedPolicies(): PermissionPolicy[] {
    return this.patterns
      .filter(p => p.approvedCount > 5 && p.deniedCount === 0)
      .map(p => ({
        toolName: p.toolName,
        autoApprove: true,
        reason: `已批准 ${p.approvedCount} 次，未拒绝过`,
      }))
  }

  private assessRisk(toolName: string, filePath?: string): 'low' | 'medium' | 'high' {
    const lowRisk = ['list_directory', 'read_file', 'search_files', 'search_content',
      'kb_list', 'list_notes', 'read_note', 'list_prompts']
    const mediumRisk = ['edit_file', 'write_note', 'append_note',
      'kb_create_file', 'kb_append_file', 'kb_index_file',
      'create_style_template', 'create_scene_template',
      'generate_image', 'search_images', 'toggle_prompt', 'update_prompt']
    const highRisk = ['create_file', 'delete_file', 'rename_file',
      'create_project', 'delete_project', 'delete_note']

    if (lowRisk.includes(toolName)) return 'low'
    if (highRisk.includes(toolName)) return 'high'
    if (mediumRisk.includes(toolName)) return 'medium'

    // Default: higher risk for unknown tools
    return 'high'
  }

  private describeAction(toolName: string): string {
    const map: Record<string, string> = {
      read_file: '读取文件', list_directory: '列出目录',
      search_files: '搜索文件', search_content: '搜索内容',
      edit_file: '编辑文件', create_file: '创建文件',
      delete_file: '删除文件', rename_file: '重命名文件',
      kb_list: '列出知识库', kb_create_file: '创建KB文件',
      kb_append_file: '追加KB文件', kb_index_file: '索引KB文件',
      list_notes: '列出草稿', read_note: '读取草稿',
      write_note: '写入草稿', append_note: '追加草稿',
      delete_note: '删除草稿', search_images: '搜索图片',
      generate_image: '生成图片', list_prompts: '列出提示词',
      toggle_prompt: '切换提示词', update_prompt: '修改提示词',
      create_style_template: '创建风格模板', create_scene_template: '创建场景模板',
      create_project: '创建项目', delete_project: '删除项目',
    }
    return map[toolName] || toolName
  }
}
