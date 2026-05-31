/**
 * Learning Engine Types (V2-1)
 *
 * Unified type definitions for the LearningEngine that replaces
 * SkillLearner + LivingSkillManager with a single 6-stage lifecycle.
 */

export type LearningStage =
  | 'OBSERVED'        // Single observation, low confidence
  | 'PATTERN'         // 2-3 observations form a pattern
  | 'SOFT_SKILL'      // Pattern confirmed, injected as suggestion
  | 'CONDITIONAL_RULE' // High confidence, auto-injected on relevant tasks
  | 'HARD_CONSTRAINT'  // Always enforced
  | 'VERIFIED'         // Manually confirmed by user

export interface LearnedPattern {
  id: string
  toolName: string
  /** Summary of the observed behavior (error or success pattern) */
  summary: string
  /** Full detail of the pattern */
  detail: string
  /** How many times observed */
  occurrenceCount: number
  /** How many times the pattern was seen to hold */
  confirmationCount: number
  currentStage: LearningStage
  createdAt: number
  updatedAt: number
  /** Last project this pattern was observed in */
  projectId: string | null
}

export interface LearningConfig {
  /** Maximum patterns to store */
  maxPatterns: number
  /** Patterns persist across sessions */
  persistPath: string
  /** Auto-promotion thresholds */
  promotionThresholds: {
    /** Occurrences needed to reach PATTERN stage */
    pattern: number  // default 2
    /** Occurrences needed to reach SOFT_SKILL */
    softSkill: number  // default 5
    /** Occurrences needed to reach CONDITIONAL_RULE */
    conditionalRule: number  // default 10
    /** Occurrences needed to reach HARD_CONSTRAINT */
    hardConstraint: number  // default 20
  }
  /** Maximum tokens for context injection */
  maxContextTokens: number
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  maxPatterns: 100,
  persistPath: '.aiharness/learned-patterns.json',
  promotionThresholds: {
    pattern: 2,
    softSkill: 5,
    conditionalRule: 10,
    hardConstraint: 20,
  },
  maxContextTokens: 2000,
}
