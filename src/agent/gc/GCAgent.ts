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
    | 'orphan_character' | 'plot_continuity' | 'chapter_coverage' | 'style_consistency'
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

  // ── Novel-specific scans ──

  /** Check if character JSON files are referenced in chapters or outlines */
  scanOrphanCharacters(characterFiles: string[], chapterContents: string[], outlineContents: string[]): void {
    const allContent = [...chapterContents, ...outlineContents].join('\n')
    for (const charFile of characterFiles) {
      const charName = charFile.replace('.json', '').replace('characters/', '')
      // Check if character name appears in any chapter or outline
      if (!allContent.includes(charName)) {
        this.issues.push({
          type: 'orphan_character',
          severity: 'warn',
          location: charFile,
          description: `角色文件 ${charFile} 未在任何章节或大纲中被引用`,
          fixInstruction: `在相关章节或大纲中引用此角色，或用 delete_file 删除孤儿角色文件`,
        })
      }
    }
  }

  /** Check plot continuity — detailed_outline statuses should be contiguous */
  scanPlotContinuity(outlineStatuses: Array<{ id: string; title: string; status: string; order: number }>): void {
    const sorted = [...outlineStatuses].sort((a, b) => a.order - b.order)
    let foundIncomplete = false
    for (const item of sorted) {
      if (item.status !== 'completed') {
        foundIncomplete = true
      } else if (foundIncomplete) {
        // Found a completed outline after an incomplete one — gap
        this.issues.push({
          type: 'plot_continuity',
          severity: 'warn',
          location: `detailed_outline/${item.id}.json`,
          description: `细纲「${item.title}」状态为已完成，但前面有未完成的细纲`,
          fixInstruction: `按顺序完成细纲，确保没有跳跃。先完成前面未完成的细纲。`,
        })
      }
    }
  }

  /** Compare outline chapter count vs actual chapter files */
  scanChapterCoverage(outlineCount: number, chapterCount: number, chapterFiles: string[]): void {
    if (outlineCount > 0 && chapterCount > 0 && outlineCount !== chapterCount) {
      this.issues.push({
        type: 'chapter_coverage',
        severity: outlineCount > chapterCount ? 'info' : 'warn',
        location: 'chapters/',
        description: `细纲提到 ${outlineCount} 章，但只有 ${chapterCount} 个章节文件`,
        fixInstruction: outlineCount > chapterCount
          ? `继续创作剩余 ${outlineCount - chapterCount} 个章节`
          : `检查是否有多余的章节文件，或更新细纲数量`,
      })
    }
  }

  /** Flag chapters with word counts far from project average */
  scanStyleConsistency(chapterWordCounts: Array<{ file: string; words: number }>): void {
    if (chapterWordCounts.length < 2) return
    const avg = chapterWordCounts.reduce((s, c) => s + c.words, 0) / chapterWordCounts.length
    for (const ch of chapterWordCounts) {
      const deviation = Math.abs(ch.words - avg) / avg
      if (deviation > 0.5 && ch.words > 100) {
        this.issues.push({
          type: 'style_consistency',
          severity: 'info',
          location: ch.file,
          description: `${ch.file} 字数 ${ch.words}，偏离平均值 ${Math.round(avg)} 的 ${Math.round(deviation * 100)}%`,
          fixInstruction: `检查此章节是否需要扩充或精简，以保持全书节奏一致`,
        })
      }
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

  /** Run all novel-specific scans using fileService */
  async runNovelScans(projectId: string): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')

      // 1. Read character files
      let characterFiles: string[] = []
      try {
        const charsDir = await fileService.listDir('characters')
        characterFiles = charsDir.filter(f => f.endsWith('.json')).map(f => `characters/${f}`)
      } catch { /* no characters dir */ }

      // 2. Read chapter files and count words
      let chapterFiles: string[] = []
      let chapterContents: string[] = []
      let chapterWordCounts: Array<{ file: string; words: number }> = []
      try {
        const chDir = await fileService.listDir('chapters')
        chapterFiles = chDir.filter(f => f.endsWith('.txt'))
        for (const f of chapterFiles) {
          try {
            const content = await fileService.read(`chapters/${f}`)
            chapterContents.push(content)
            chapterWordCounts.push({ file: `chapters/${f}`, words: content.replace(/\s/g, '').length })
          } catch { /* skip unreadable */ }
        }
      } catch { /* no chapters dir */ }

      // 3. Read outline contents
      let outlineContents: string[] = []
      try {
        const outlineDir = await fileService.listDir('outline')
        for (const f of outlineDir.filter(f => f.endsWith('.md'))) {
          try {
            outlineContents.push(await fileService.read(`outline/${f}`))
          } catch { /* skip */ }
        }
      } catch { /* no outline dir */ }

      // 4. Read detailed outline statuses
      let outlineStatuses: Array<{ id: string; title: string; status: string; order: number }> = []
      try {
        const doDir = await fileService.listDir('detailed_outline')
        const jsonFiles = doDir.filter(f => f.endsWith('.json'))
        for (const f of jsonFiles) {
          try {
            const content = await fileService.read(`detailed_outline/${f}`)
            const obj = JSON.parse(content)
            outlineStatuses.push({
              id: obj.id || f.replace('.json', ''),
              title: obj.title || f.replace('.json', ''),
              status: obj.status || 'incomplete',
              order: typeof obj.order === 'number' ? obj.order : 0,
            })
          } catch { /* skip */ }
        }
      } catch { /* no detailed_outline dir */ }

      // Run scans
      this.scanOrphanCharacters(characterFiles, chapterContents, outlineContents)
      this.scanPlotContinuity(outlineStatuses)
      this.scanChapterCoverage(outlineStatuses.length, chapterFiles.length, chapterFiles)
      this.scanStyleConsistency(chapterWordCounts)

    } catch { /* best effort */ }
  }
}

/** GC system prompt for the sub-agent */
export const GC_AGENT_PROMPT = [
  '你是小说项目健康检查 Agent（GC Agent）。你的任务是扫描项目，发现并报告问题。',
  '你只能读取文件（read_file, list_directory, search_files, search_content），不能修改任何内容。',
  '',
  '## 代码健康检查',
  '1. **超大文件**: 检查文件行数是否超过 1000 行',
  '2. **孤儿文件**: 检查源文件是否被其他文件引用',
  '',
  '## 小说完整性检查',
  '3. **孤儿角色**: 读取 characters/*.json，用 search_content 搜索每个角色名，检查是否在章节或大纲中被引用',
  '4. **情节连续性**: 读取 detailed_outline/*.json，检查已完成/未完成状态是否连续（不能有已完成的第5章但未完成的第3章）',
  '5. **章节覆盖**: 对比细纲章节数与实际 chapters/*.txt 文件数',
  '6. **风格一致性**: 统计每章字数，标记偏离平均值超过 50% 的章节',
  '',
  '## 操作步骤',
  '1. list_directory 了解项目结构',
  '2. list_directory characters/ 获取角色文件列表',
  '3. 逐个 read_file 角色 JSON，search_content 搜索角色名',
  '4. list_directory detailed_outline/ 获取细纲列表',
  '5. 读取细纲 JSON，检查 status 字段连续性',
  '6. list_directory chapters/ 获取章节列表',
  '7. 逐个 read_file 章节，统计字数',
  '8. 对比细纲数与章节数',
  '9. 将发现的问题写入草稿笔记 (write_note)，标题格式 "gc-report-{date}"',
  '',
  '完成后输出 GCReport JSON。',
].join('\n')
