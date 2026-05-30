// ── Pipeline Types ──
// Shared type definitions for the TaskPipeline system.

import type { ThinkingPlan } from '../state/types'

// ── Classifier ──

export interface ClassificationResult {
  isComplexTask: boolean
  taskType: 'simple_chat' | 'simple_query' | 'file_single' |
    'chapter_writing' | 'chapter_edit' | 'project_analysis' | 'ambiguous'
  reasoning: string
  estimatedComplexity: 'low' | 'medium' | 'high'
  suggestedRoute: 'direct' | 'simplified' | 'full'
}

// ── Intent Analyzer ──

export interface IntentResult {
  intent: string
  goal: { primary: string; secondary: string[] }
  constraints: {
    wordCount?: string; styleRef?: string; characterFocus?: string
    plotRequirements: string[]; avoidance: string[]
  }
  contextNeeded: { currentPlot: string; characterState: string; foreshadowing: string }
  isAmbiguous: boolean
  clarificationQuestions: string[]
  suggestedApproach: string
}

// ── Pipeline ──

export type PipelinePhase =
  | 'prefilter' | 'classifying' | 'analyzing' | 'designing'
  | 'awaiting_approval' | 'executing' | 'comparing' | 'done'

export interface PipelineResult {
  phase: PipelinePhase
  classification?: ClassificationResult
  intent?: IntentResult | null
  plan?: ThinkingPlan
  /** Direct simple reply (route=direct) */
  directText?: string
  /** Clarification questions (intent was ambiguous) */
  clarificationQuestions?: string[]
  /** Total tokens consumed by pipeline stages (not including execution) */
  pipelineTokens: number
}

// ── Result Comparator ──

export interface ComparisonResult {
  intentMatch: number       // 0-1
  constraintsMet: string[]
  constraintsMissed: string[]
  qualityAssessment: string
  suggestedNextSteps: string[]
}

// ── Pipeline Config ──

export interface PipelineConfig {
  enabled: boolean
  /** Override model configId for pipeline stages (default: same as main) */
  classifierModelId?: string
  intentPlannerModelId?: string
  /** Auto-approve plans below this complexity */
  autoApproveBelow?: 'low' | 'medium' | 'high' | 'none'
}
