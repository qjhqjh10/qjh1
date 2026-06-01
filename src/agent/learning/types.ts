/**
 * Learning Engine Types (V5)
 *
 * Simple entry format: AI writes a human-readable problem+solution pair.
 * No automatic pattern tracking, no 6-stage lifecycle.
 */

export interface LearningEntry {
  id: string
  problem: string       // 出错原因
  solution: string      // 解决方法
  category: string      // file | character | outline | chapter | style | kb | general
  createdAt: string
  enabled: boolean
}

// Legacy types kept for minimal backward compat
export type LearningStage = string
export interface LearnedPattern { [key: string]: any }
export interface LearningConfig {
  maxPatterns: number
  persistPath: string
  promotionThresholds: Record<string, number>
  maxContextTokens: number
}
export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  maxPatterns: 100,
  persistPath: '.aiharness/learnings.json',
  promotionThresholds: {},
  maxContextTokens: 2000,
}
