// ── Taste Invariants ──
// Style-level rules that keep agent output consistent.
// Less severe than architectural constraints — warn but don't block.

import type { TasteInvariant, ToolCallArgs } from './types'

/**
 * Invariant: naming convention
 * Component files PascalCase, utility files camelCase, pages XxxPage.tsx
 */
export const namingConvention: TasteInvariant = {
  id: 'naming-convention',
  description: '文件命名规范',
  check: (args: ToolCallArgs) => {
    const fp = args.filePath || (args.file_path as string) || ''
    if (!fp || !args.toolName || !['create_file', 'edit_file'].includes(args.toolName)) {
      return { passed: true, message: '' }
    }
    const fileName = fp.split('/').pop() || ''

    // Pages should be XxxPage.tsx
    if (fp.includes('pages/') && !/\w+Page\.(tsx|ts)$/.test(fileName)) {
      return {
        passed: false,
        message: `页面文件名应为 XxxPage.tsx 格式，当前: ${fileName}`,
      }
    }
    return { passed: true, message: '' }
  },
}

/**
 * Invariant: no empty files
 */
export const noEmptyFiles: TasteInvariant = {
  id: 'no-empty-files',
  description: '禁止创建空文件',
  check: (args: ToolCallArgs) => {
    if (args.toolName !== 'create_file') return { passed: true, message: '' }
    const content = args.content as string | undefined
    if (!content || content.trim().length === 0) {
      return {
        passed: false,
        message: '不能创建空文件。请提供有意义的文件内容。',
      }
    }
    return { passed: true, message: '' }
  },
}

/**
 * Invariant: Markdown heading levels
 * Start from ## (h2), never # (h1) or jump levels (## → ####)
 */
export const markdownHeadings: TasteInvariant = {
  id: 'markdown-headings',
  description: 'Markdown 标题规范',
  check: (args: ToolCallArgs) => {
    const content = args.content as string | undefined
    if (!content || !(args.filePath || (args.file_path as string) || '').endsWith('.md')) {
      return { passed: true, message: '' }
    }
    // Check for h1 usage
    if (/^# [^#]/m.test(content)) {
      return {
        passed: false,
        message: 'Markdown 文件不要使用 # （一级标题），从 ## 开始。一级标题由系统自动生成。',
      }
    }
    return { passed: true, message: '' }
  },
}

export const ALL_TASTE_INVARIANTS: TasteInvariant[] = [
  namingConvention,
  noEmptyFiles,
  markdownHeadings,
]
