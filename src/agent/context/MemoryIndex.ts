/**
 * Global Directory Index (V9.5.4 — recursive full scan)
 *
 * Recursively scans the entire software root directory, listing ALL files and folders.
 * No hardcoded directory names — any directory or file is discovered automatically.
 * Dynamically rebuilt on each message (with memory cache, invalidated on structural changes).
 */

import { estimateTokens } from '../utils/tokenEstimation'

let _globalIndexCache: { index: string; tokenCount: number } | null = null

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.ai_backups', 'out'])
const SKIP_PREFIXES = ['.']
const MAX_DEPTH = 5
const MAX_FILES_PER_DIR = 30

export async function buildGlobalIndex(projectId?: string | null): Promise<string> {
  if (_globalIndexCache) return _globalIndexCache.index

  try {
    const { fileService, styleTemplateService } = await import('@/services/fileService')
    const lines: string[] = []

    lines.push('## 📁 软件文件索引')
    lines.push('> 以下是软件内全部文件和目录。已知路径的文件直接 read_file 读取。')
    lines.push('> 路径: ../../ = 软件根目录。项目路径: 项目名/子路径（如 1/outline/plot.md）。')
    lines.push('')

    // ═══════════════════════════════════════════
    // Recursively scan the entire software root
    // ═══════════════════════════════════════════
    await walkDir(lines, '', 0, fileService, styleTemplateService)

    // ═══════════════════════════════════════════
    // Project details (if a project is selected)
    // ═══════════════════════════════════════════
    if (projectId) {
      lines.push('### 📌 当前项目')
      lines.push(`> 项目: ${projectId}/`)
      lines.push('')
      // Don't re-walk — the global walk already covered it under projects/
    }

    const result = lines.join('\n')
    _globalIndexCache = { index: result, tokenCount: estimateTokens(result) }
    return result
  } catch {
    return ''
  }
}

async function walkDir(
  lines: string[],
  relPath: string,
  depth: number,
  fileService: any,
  styleTemplateService?: any,
): Promise<void> {
  if (depth > MAX_DEPTH) return

  let entries: string[]
  try {
    const listPath = relPath || '.'
    entries = await fileService.listDir(listPath).catch(() => [] as string[])
  } catch { return }

  const dirs: string[] = []
  const files: string[] = []

  for (const e of entries) {
    const fullName = e as string
    // Skip hidden, system, and build artifacts
    if (SKIP_DIRS.has(fullName)) continue
    if (SKIP_PREFIXES.some(p => fullName.startsWith(p))) continue

    // Heuristic: files have extensions, directories don't
    if (fullName.includes('.')) {
      files.push(fullName)
    } else {
      dirs.push(fullName)
    }
  }

  // ── Output this directory ──
  if (depth === 0) {
    // Root level: just list top-level dirs, not individual root files
    lines.push('### 📁 软件根目录')
    lines.push('')
  } else {
    const indent = '  '.repeat(Math.min(depth, 3))
    const dirName = relPath.split('/').pop() || relPath
    const desc = getDirDescription(relPath)
    const prefix = relPath ? `${relPath}/` : ''

    // For global dirs, use ../../ prefix in paths
    const pathPrefix = relPath.startsWith('projects/') ? relPath.replace('projects/', '') + '/' : `../../${relPath}/`

    // List files in this directory
    if (files.length > 0) {
      const sortedFiles = files.sort()
      lines.push(`${indent}**${dirName}/** — ${files.length} 个文件${desc}`)
      for (const f of sortedFiles.slice(0, MAX_FILES_PER_DIR)) {
        lines.push(`${indent}  read_file("${pathPrefix}${f}") → ${f}`)
      }
      if (files.length > MAX_FILES_PER_DIR) {
        lines.push(`${indent}  ... 还有 ${files.length - MAX_FILES_PER_DIR} 个文件`)
      }
      lines.push('')
    } else if (dirs.length > 0) {
      // Directory with only subdirs, no files
      lines.push(`${indent}**${dirName}/**${desc}`)
      lines.push('')
    }
  }

  // ── Recurse into subdirectories ──
  for (const d of dirs.sort()) {
    const subPath = relPath ? `${relPath}/${d}` : d
    await walkDir(lines, subPath, depth + 1, fileService, styleTemplateService)
  }
}

function getDirDescription(relPath: string): string {
  const map: Record<string, string> = {
    'style_templates': ' — 写作风格模板 (JSON)',
    'scene_templates': ' — 场景模板 (JSON)',
    'knowledge_base/files': ' — 知识库参考资料',
    'knowledge_base': ' — 知识库',
    'uploads/files': ' — 上传的文本文件',
    'uploads/images': ' — 上传的图片',
    'uploads/clips': ' — 上传的剪藏',
    'uploads': ' — 用户上传文件',
    'notes': ' — 笔记草稿 (.md)',
    'projects': ' — 用户项目',
    'projects/*/characters': ' — 角色档案 (.json)',
    'projects/*/chapters': ' — 章节正文 (.txt)',
    'projects/*/outline': ' — 大纲',
    'projects/*/detailed_outline': ' — 细纲 (.json)',
    'projects/*/summaries': ' — 章节摘要 (.md)',
    'agent-sessions': ' — AI 对话会话记录',
    '.aiharness': ' — Agent 配置和规则',
    '.aiharness/rules': ' — 规则文件',
    'src': ' — 源代码',
    'electron': ' — Electron 主进程',
    'docs': ' — 技术文档',
    'tests': ' — 测试代码',
    'scripts': ' — 开发脚本',
    'projects/*/covers': ' — 封面图片',
    'projects/*/images': ' — 图片资源',
    'projects/*/notes': ' — 项目笔记',
    'projects/*/uploads': ' — 项目上传文件',
    'projects/*/characters_test': ' — 角色测试数据',
  }
  // Check exact match first, then wildcard patterns
  if (map[relPath]) return map[relPath]
  // Match projects/{name}/{subdir} patterns
  const parts = relPath.split('/')
  if (parts.length === 3 && parts[0] === 'projects') {
    const subdir = parts[2]
    const wildKey = `projects/*/${subdir}`
    if (map[wildKey]) return map[wildKey]
  }
  return ''
}

export function invalidateMemoryIndexCache(): void {
  _globalIndexCache = null
}

export function getMemoryIndexTokens(): number {
  return _globalIndexCache?.tokenCount ?? 0
}
