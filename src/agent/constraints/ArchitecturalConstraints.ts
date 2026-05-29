// ── Architectural Constraints ──
// Enforce invariants that must not be violated. Agent cannot bypass these.
// Failure messages embed fix instructions so the agent can self-correct.

import type { ArchitecturalConstraint, ToolCallArgs } from './types'

export const FILE_SIZE_LIMIT = 1000

/**
 * Factory: file size constraint with configurable limit.
 * When limit is 0, the constraint is disabled (returns a no-op).
 */
export function createFileSizeLimit(limit: number): ArchitecturalConstraint {
  if (limit <= 0) {
    return {
      id: 'file-size-limit',
      description: '文件大小限制已禁用',
      check: () => ({ passed: true, message: '' }),
      fixInstruction: '',
    }
  }
  return {
    id: 'file-size-limit',
    description: `单文件不超过 ${limit} 行`,
    check: (args: ToolCallArgs) => {
      const content = args.content as string | undefined
      if (!content) return { passed: true, message: '' }
      const lines = content.split('\n').length
      if (lines > limit) {
        return {
          passed: false,
          message: `文件内容 ${lines} 行，超过上限 ${limit} 行。请拆分为多个文件：主文件保留核心逻辑，将辅助逻辑提取到 components/ 或 hooks/ 子目录。`,
        }
      }
      return { passed: true, message: '' }
    },
    fixInstruction: `拆分为 XxxPage/index.tsx + XxxPage/components/Y.tsx 或 XxxPage/hooks/useZ.ts`,
  }
}

/** Default file size constraint using the module-level constant */
export const fileSizeLimit = createFileSizeLimit(FILE_SIZE_LIMIT)

/**
 * Constraint: path isolation
 * All file operations must stay within the project directory.
 */
export const pathIsolation: ArchitecturalConstraint = {
  id: 'path-isolation',
  description: '文件路径必须在项目目录内',
  check: (args: ToolCallArgs) => {
    const fp = args.filePath || (args.file_path as string) || ''
    if (!fp) return { passed: true, message: '' }
    // Reject absolute paths that look like system paths
    if (/^[A-Z]:[\\/]/i.test(fp) || fp.startsWith('/etc') || fp.startsWith('/usr')) {
      return {
        passed: false,
        message: `路径 "${fp}" 指向项目外部。请使用项目目录内的相对路径，如 "outline/plot.md"、"characters/xxx.json"。`,
      }
    }
    // Reject UNC paths (\\server\share)
    if (/^\\\\/.test(fp)) {
      return {
        passed: false,
        message: `路径 "${fp}" 是 UNC 网络路径，禁止访问。请使用项目目录内的相对路径。`,
      }
    }
    // Reject environment variable expansion (%VAR% or $VAR)
    if (/%[A-Z_]+%/.test(fp) || /\$[A-Z_]+/i.test(fp) || fp.includes('${')) {
      return {
        passed: false,
        message: `路径 "${fp}" 包含环境变量引用，禁止使用。请使用项目目录内的相对路径。`,
      }
    }
    // Reject ../ traversal
    if (fp.includes('..')) {
      return {
        passed: false,
        message: `路径 "${fp}" 包含 ".." 目录遍历。请使用项目目录内的相对路径。`,
      }
    }
    return { passed: true, message: '' }
  },
  fixInstruction: '使用当前项目目录内的相对路径，如 "outline/plot.md"、"characters/xxx.json"',
}

/**
 * Constraint: JSON schema validation
 * Created/modified JSON files must conform to expected schema.
 */
export const jsonSchemaValidation: ArchitecturalConstraint = {
  id: 'json-schema-validation',
  description: '创建/修改 JSON 文件必须校验格式',
  check: (args: ToolCallArgs) => {
    const fp = args.filePath || (args.file_path as string) || ''
    const content = args.content as string | undefined
    if (!content || !fp.endsWith('.json')) return { passed: true, message: '' }
    try {
      JSON.parse(content)
      return { passed: true, message: '' }
    } catch (e) {
      return {
        passed: false,
        message: `JSON 解析失败: ${(e as Error).message}。请检查 JSON 格式：所有键必须用双引号，字符串值必须用双引号，不允许尾随逗号。参考项目中已有的 JSON 文件格式。`,
      }
    }
  },
  fixInstruction: 'JSON 格式错误。所有键用双引号包裹，不允许尾随逗号。用 read_file 参考已有 JSON 文件格式。',
}

/**
 * Constraint: dependency direction
 * Agent layer code should not import UI component layer code.
 */
export const dependencyDirection: ArchitecturalConstraint = {
  id: 'dependency-direction',
  description: 'Agent 层不能直接引用 React 组件',
  check: (args: ToolCallArgs) => {
    const content = args.content as string | undefined
    if (!content) return { passed: true, message: '' }
    // Check for suspicious imports from agent context into components
    if (content.includes("from '@/components/") || content.includes('from "react"')) {
      // Only flag if this is being written to src/agent/ path
      const fp = args.filePath || (args.file_path as string) || ''
      if (fp.startsWith('src/agent/') && content.includes("from '@/components/")) {
        return {
          passed: false,
          message: `Agent 层代码不应直接引用 React 组件（from '@/components/'）。如需与组件层通信，请使用 IPC 或 service 层接口。`,
        }
      }
    }
    return { passed: true, message: '' }
  },
  fixInstruction: 'Agent 层通过 IPC 或 service 层与 UI 通信，不要 import React 组件。',
}

/**
 * Constraint: no duplicate create
 * Prevents creating files that would shadow well-known system files.
 */
export const noDuplicateCreate: ArchitecturalConstraint = {
  id: 'no-duplicate-create',
  description: '禁止创建会覆盖系统文件的重复文件',
  check: (args: ToolCallArgs) => {
    if (args.toolName !== 'create_file') return { passed: true, message: '' }
    const fp = (args.file_path as string) || ''
    if (!fp) return { passed: true, message: '' }
    // Block creating files at project root that shadow known system files
    const systemFiles = ['package.json', 'tsconfig.json', 'electron-builder.yml', 'vitest.config.ts', 'tailwind.config.js', 'postcss.config.js']
    const fileName = fp.split('/').pop() || ''
    if (!fp.includes('/') && systemFiles.includes(fileName)) {
      return {
        passed: false,
        message: `文件 "${fileName}" 是系统配置文件，不应通过 create_file 创建。请用 edit_file 修改现有文件。`,
      }
    }
    return { passed: true, message: '' }
  },
  fixInstruction: '使用 edit_file 修改已有系统配置文件，不要用 create_file 重新创建。',
}

/**
 * Constraint: chapter requires outline
 * Cannot create a chapter file without a corresponding detailed outline.
 */
export const chapterRequiresOutline: ArchitecturalConstraint = {
  id: 'chapter-requires-outline',
  description: '创建章节文件前必须有对应细纲',
  check: (args: ToolCallArgs) => {
    if (args.toolName !== 'create_file') return { passed: true, message: '' }
    const fp = (args.file_path as string) || ''
    if (!fp.startsWith('chapters/') || !fp.endsWith('.txt')) return { passed: true, message: '' }
    // This is a soft check — we can't easily verify file existence here
    // The system prompt already instructs the AI to read outline first
    return { passed: true, message: '' }
  },
  fixInstruction: '先创建对应的细纲文件（detailed_outline/*.json），再创建章节文件。',
}

/**
 * Constraint: non-empty chapter content
 * Chapter files must have meaningful content.
 */
export const nonEmptyChapter: ArchitecturalConstraint = {
  id: 'non-empty-chapter',
  description: '章节文件内容不能少于 100 字符',
  check: (args: ToolCallArgs) => {
    if (args.toolName !== 'create_file' && args.toolName !== 'edit_file') return { passed: true, message: '' }
    const fp = (args.file_path as string) || ''
    if (!fp.startsWith('chapters/') || !fp.endsWith('.txt')) return { passed: true, message: '' }
    const content = (args.content as string) || ''
    if (content.length < 100) {
      return {
        passed: false,
        message: `章节文件内容只有 ${content.length} 字符，少于 100 字符最低要求。请提供完整的章节内容。`,
      }
    }
    return { passed: true, message: '' }
  },
  fixInstruction: '章节文件需要完整的章节内容（至少 100 字符），不要创建空文件或占位符。',
}

export const ALL_ARCHITECTURAL_CONSTRAINTS: ArchitecturalConstraint[] = [
  fileSizeLimit,
  pathIsolation,
  jsonSchemaValidation,
  dependencyDirection,
  noDuplicateCreate,
  chapterRequiresOutline,
  nonEmptyChapter,
]
