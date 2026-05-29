// ── Progressive Compression Engine ──
// 5-stage pipeline replacing the single 70% threshold in BudgetManager.
// Stage 1: Budget Reduction → 2: Snip → 3: Microcompact → 4: Context Collapse → 5: Auto-Compact

export type CompressionStage = 'none' | 'budget_reduction' | 'snip' | 'microcompact' | 'context_collapse' | 'auto_compact'

export class ProgressiveCompressor {
  private thresholds: number[]  // [50, 60, 70, 85, 95] percent
  private contextWindow: number

  constructor(contextWindow: number, thresholds?: number[]) {
    this.contextWindow = contextWindow
    this.thresholds = thresholds || [30, 45, 60, 78, 92]
  }

  getStage(usedTokens: number): CompressionStage {
    const pct = (usedTokens / this.contextWindow) * 100
    if (pct >= this.thresholds[4]) return 'auto_compact'
    if (pct >= this.thresholds[3]) return 'context_collapse'
    if (pct >= this.thresholds[2]) return 'microcompact'
    if (pct >= this.thresholds[1]) return 'snip'
    if (pct >= this.thresholds[0]) return 'budget_reduction'
    return 'none'
  }

  needsCompression(usedTokens: number): boolean {
    return this.getStage(usedTokens) !== 'none'
  }

  shouldTriggerHook(usedTokens: number): boolean {
    return this.getStage(usedTokens) === 'auto_compact'
  }

  getThresholds(): number[] {
    return [...this.thresholds]
  }

  getStageDescription(stage: CompressionStage): string {
    const map: Record<CompressionStage, string> = {
      none: '无需压缩',
      budget_reduction: '阶段1: 移除过期/低优先级上下文',
      snip: '阶段2: 裁剪冗余工具结果（保留status+summary，丢弃detail）',
      microcompact: '阶段3: 压缩历史消息为摘要',
      context_collapse: '阶段4: 合并多轮对话为单条system消息',
      auto_compact: '阶段5: 触发PreCompact hook → 模型压缩 → 重建上下文',
    }
    return map[stage]
  }
}
