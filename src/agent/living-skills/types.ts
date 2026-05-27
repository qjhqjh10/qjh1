// ── Living Skill: 6-stage lifecycle unified skill entity ──

export type LivingSkillStage =
  | 'OBSERVED'          // Stage 1: single observation, confidence 0.0-0.2
  | 'PATTERN'           // Stage 2: N occurrences detected, confidence 0.2-0.4
  | 'SOFT_SKILL'        // Stage 3: text rule injected as system prompt, confidence 0.4-0.6
  | 'CONDITIONAL_RULE'  // Stage 4: rule with conditions + hook, confidence 0.6-0.8
  | 'HARD_CONSTRAINT'   // Stage 5: policy that blocks, confidence 0.8-0.95
  | 'VERIFIED'          // Stage 6: proven across sessions/projects, confidence >0.95

export type SkillCategory =
  | 'format_error' | 'path_error' | 'permission_error' | 'conflict_error'
  | 'timeout_error' | 'hallucination'
  | 'efficient_workflow' | 'user_preference' | 'best_practice' | 'project_convention'

export type SkillSource = 'error' | 'success' | 'user_preference' | 'pattern_noticed'

export interface LivingSkill {
  id: string
  title: string
  trigger: { toolName: string; category: SkillCategory; source: SkillSource }
  problem: string
  solution: string
  stage: LivingSkillStage
  confidence: number
  occurrenceCount: number
  totalFixesAttempted: number
  totalFixSuccesses: number
  sessionsWhereEffective: number
  firstSeenAt: number; lastSeenAt: number; promotedAt: number | null
  originProjectId: string | null; projects: string[]
  userRating: 0 | 1 | -1
  isUserApproved: boolean
  softRuleText: string
  policyConfig: { effect: 'deny' | 'ask'; toolName: string; pathPattern?: string } | null
  hookConfig: { event: 'PreToolUse' | 'PostToolUse'; kind: 'shell'; command?: string } | null
  createdAt: number; updatedAt: number
  tags: string[]
}

export interface RawObservation {
  type: 'error' | 'success' | 'user_feedback' | 'user_preference'
  toolName: string; summary: string; detail?: string
  sessionId: string; projectId: string | null; timestamp: number
  errorCategory?: string; rating?: 1 | -1; feedbackTarget?: string
}

export const STAGE_BOUNDS: Record<LivingSkillStage, { min: number; max: number }> = {
  OBSERVED:          { min: 0.0, max: 0.20 },
  PATTERN:           { min: 0.20, max: 0.40 },
  SOFT_SKILL:        { min: 0.40, max: 0.60 },
  CONDITIONAL_RULE:  { min: 0.60, max: 0.80 },
  HARD_CONSTRAINT:   { min: 0.80, max: 0.95 },
  VERIFIED:          { min: 0.95, max: 1.00 },
}
