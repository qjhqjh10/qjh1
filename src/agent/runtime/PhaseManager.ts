// ── Phase Manager (v11.0: simplified stub) ──
// v11.0: Phase machine removed. All execution goes directly.
// @deprecated v11.5.1: Zero references in src/ — kept for potential electron/script consumers.
// Kept as stub for backward compatibility.

import type { AgentPhase } from '../state/types'
import type { NormalizedModelResponse } from './adapters/ProtocolAdapter'
import { scoreTaskComplexity } from '../utils/taskDetection'

/** Tools allowed during discovery — read-only exploration */
export const DISCOVER_ALLOWED_TOOLS = new Set([
  'read_file', 'list_directory', 'search_content', 'find_files',
  'search_notes',
  'list_rules', 'list_audit', 'list_prompts',
  'think',
])

export type AnalyzeCheckResult =
  | { status: 'exploring' }
  | { status: 'blocked'; injection: string }
  | { status: 'analysis_complete' }

export class PhaseManager {
  private phase: AgentPhase = 'IDLE'
  private taskComplexity: 'simple' | 'complex' = 'simple'

  transition(to: AgentPhase): void { this.phase = to }
  getPhase(): AgentPhase { return this.phase }
  isInPhase(p: AgentPhase): boolean { return this.phase === p }

  startRun(userMessage: string): void {
    this.taskComplexity = scoreTaskComplexity(userMessage) >= 2 ? 'complex' : 'simple'
    this.phase = 'EXECUTE'  // v11.0: start in EXECUTE directly
  }

  getTaskComplexity(): 'simple' | 'complex' { return this.taskComplexity }

  // v11.0: Always returns analysis_complete — no phase gating
  checkAnalyzePhase(_response: NormalizedModelResponse): AnalyzeCheckResult {
    return { status: 'analysis_complete' }
  }

  checkSkillGate(
    _toolName: string, _args: Record<string, unknown>, _activeSkill: unknown,
  ): { allowed: boolean; suggestion?: string } {
    return { allowed: true }
  }
}
