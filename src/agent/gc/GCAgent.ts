// ── GC Agent (Garbage Collection Agent) ──
// Periodic scanner that detects codebase drift and auto-files fix suggestions.
// Inspired by: Harness Engineering concept 03 — "Entropy and Garbage Collection"
//
// Scans for:
//   1. Oversized files (> FILE_SIZE_LIMIT lines)
//   2. Stale CLAUDE.md references (paths that don't resolve)
//   3. Orphan files (no references from any other file)
//   4. Documentation drift (CLAUDE.md claims vs reality)

import { FILE_SIZE_LIMIT } from '../constraints/ArchitecturalConstraints'

export interface GCIssue {
  type: 'oversized_file' | 'stale_reference' | 'orphan_file' | 'doc_drift'
  severity: 'info' | 'warn' | 'critical'
  location: string
  description: string
  fixInstruction: string
}

export interface GCReport {
  timestamp: number
  totalIssues: number
  issues: GCIssue[]
  summary: string
}

/**
 * Scan filesystem for issues. Designed to be called by agent via list_directory + read_file.
 * In CLI mode, can directly use fs. In GUI mode, uses tool results.
 */
export class GCAgent {
  private issues: GCIssue[] = []

  /** Scan file content for oversized files */
  scanOversized(filePath: string, content: string): void {
    const lines = content.split('\n').length
    if (lines > FILE_SIZE_LIMIT) {
      this.issues.push({
        type: 'oversized_file',
        severity: lines > FILE_SIZE_LIMIT * 1.5 ? 'critical' : 'warn',
        location: filePath,
        description: `${filePath}: ${lines} 行（上限 ${FILE_SIZE_LIMIT}）`,
        fixInstruction: `拆分为 index.tsx + components/ 子组件 或 hooks/ 自定义 hook`,
      })
    }
  }

  /** Check if CLAUDE.md references resolve */
  scanStaleReference(claudeRef: string, exists: boolean): void {
    if (!exists) {
      this.issues.push({
        type: 'stale_reference',
        severity: 'warn',
        location: 'CLAUDE.md',
        description: `CLAUDE.md 引用 "${claudeRef}" 不存在`,
        fixInstruction: `更新 CLAUDE.md 中的路径引用，或创建缺失的文件`,
      })
    }
  }

  /** Scan for orphan files (files with no incoming references) */
  scanOrphan(filePath: string, referencedBy: string[]): void {
    if (referencedBy.length === 0) {
      // Skip well-known entry points
      const entryPoints = ['main.ts', 'index.ts', 'CLAUDE.md', 'AGENTS.md',
        'package.json', 'tsconfig.json']
      const fileName = filePath.split('/').pop() || ''
      if (entryPoints.includes(fileName)) return

      this.issues.push({
        type: 'orphan_file',
        severity: 'info',
        location: filePath,
        description: `${filePath} 没有被任何其他文件引用`,
        fixInstruction: `检查是否为死代码。如果是，用 delete_file 删除；如果是有用文件，添加到对应的 index 或文档中`,
      })
    }
  }

  /** Check documentation drift */
  scanDocDrift(claim: string, actual: string, location: string): void {
    if (claim !== actual) {
      this.issues.push({
        type: 'doc_drift',
        severity: 'warn',
        location,
        description: `文档声称: "${claim}"，实际: "${actual}"`,
        fixInstruction: `更新文档以匹配实际状态`,
      })
    }
  }

  /** Get all found issues */
  getIssues(): GCIssue[] {
    return [...this.issues]
  }

  /** Generate a GC report */
  generateReport(): GCReport {
    const critical = this.issues.filter(i => i.severity === 'critical').length
    const warns = this.issues.filter(i => i.severity === 'warn').length
    const infos = this.issues.filter(i => i.severity === 'info').length

    return {
      timestamp: Date.now(),
      totalIssues: this.issues.length,
      issues: this.getIssues(),
      summary: [
        this.issues.length === 0 ? '✅ 未发现问题' : `发现 ${this.issues.length} 个问题`,
        critical > 0 ? `${critical} 严重` : '',
        warns > 0 ? `${warns} 警告` : '',
        infos > 0 ? `${infos} 提示` : '',
      ].filter(Boolean).join('，'),
    }
  }

  /** Generate fix instructions as a Markdown report */
  toMarkdown(): string {
    if (this.issues.length === 0) {
      return '## GC Report\n\n✅ 未发现问题。'
    }

    const lines = [
      `## GC Report — ${new Date().toISOString()}`,
      '',
      `发现 ${this.issues.length} 个问题:`,
      '',
    ]

    for (const issue of this.issues) {
      lines.push(
        `### [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.location}`,
        '',
        `- **描述**: ${issue.description}`,
        `- **修复**: ${issue.fixInstruction}`,
        '',
      )
    }

    return lines.join('\n')
  }

  /** Reset scanner for a new run */
  reset(): void {
    this.issues = []
  }
}

/** GC system prompt for the sub-agent */
export const GC_AGENT_PROMPT = [
  '你是代码健康检查 Agent（GC Agent）。你的任务是扫描项目，发现并报告问题。',
  '你只能读取文件（read_file, list_directory, search_files, search_content），不能修改任何内容。',
  '',
  '检查项目:',
  '1. **超大文件**: read_file 每个源文件，检查行数是否超过 500 行',
  '2. **过期引用**: 验证 CLAUDE.md 中引用的文件路径是否真实存在',
  '3. **孤儿文件**: search_content 搜索每个源文件名，确认有至少一个其他文件引用它',
  '4. **文档漂移**: 对比文档中的声明与实际文件结构',
  '',
  '操作步骤:',
  '1. list_directory 了解项目顶级结构',
  '2. read_file CLAUDE.md 提取所有文件引用',
  '3. 逐项 read_file 验证引用存在性',
  '4. 对每个源文件运行 search_files 检查是否被引用',
  '5. 将发现的问题写入草稿笔记 (write_note)，标题格式 "gc-report-{date}"',
  '',
  '完成后输出 GCReport JSON。',
].join('\n')
