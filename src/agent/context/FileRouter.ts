// ── File Path Router ──
// Maps user intent keywords to exact project file paths.
// Used by buildAdvisoryInject() to give the AI direct instructions
// instead of letting it explore blindly.

interface RouteEntry {
  pattern: RegExp
  instructions: Array<{ tool: string; path: string; desc: string }>
}

const ROUTES: RouteEntry[] = [
  {
    pattern: /故事剧情|剧情|情节|故事线|plot|story/i,
    instructions: [{ tool: 'read_file', path: 'outline/plot.md', desc: '故事剧情文件' }],
  },
  {
    pattern: /世界观|世界设定|worldbuilding|world/i,
    instructions: [{ tool: 'read_file', path: 'outline/worldbuilding.md', desc: '世界观设定文件' }],
  },
  {
    pattern: /大纲|outline/i,
    instructions: [{ tool: 'read_file', path: 'outline/plot.md', desc: '大纲剧情' }],
  },
  {
    pattern: /角色|人物|character/i,
    instructions: [
      { tool: 'list_directory', path: 'characters', desc: '查看角色目录' },
      { tool: 'read_file', path: 'characters/', desc: '读取指定角色' },
    ],
  },
  {
    pattern: /细纲|detailed.?outline/i,
    instructions: [{ tool: 'list_directory', path: 'detailed_outline', desc: '查看细纲列表' }],
  },
  {
    pattern: /章节|chapter|第.*章/i,
    instructions: [{ tool: 'list_directory', path: 'chapters', desc: '查看章节列表' }],
  },
  {
    pattern: /笔记|草稿|note|draft/i,
    instructions: [{ tool: 'list_notes', path: '', desc: '列出所有笔记' }],
  },
  {
    pattern: /知识库|kb/i,
    instructions: [{ tool: 'kb_list', path: '', desc: '列出知识库文件' }],
  },
]

/**
 * Route user intent to specific file operations.
 * Returns a direct instruction string, or null if no route matches.
 */
export function routeIntent(userMessage: string, projectId: string | null): string | null {
  if (!projectId || !userMessage) return null

  for (const route of ROUTES) {
    if (route.pattern.test(userMessage)) {
      const lines = route.instructions.map(i => {
        const fullPath = i.path ? `${projectId}/${i.path}`.replace(/\/$/, '') : ''
        return `→ ${i.tool}("${fullPath}") — ${i.desc}`
      })
      lines.push('不要先 list_directory 探索项目结构。直接执行以上操作。')
      return lines.join('\n')
    }
  }

  return null
}
