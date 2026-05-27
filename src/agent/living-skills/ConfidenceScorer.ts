import type { LivingSkill } from './types'

// 6-factor weighted confidence algorithm
// confidence = w_f * f_freq + w_r * f_rec + w_e * f_eff + w_p * f_prev + w_u * f_user + w_proj * f_proj

export class ConfidenceScorer {
  compute(skill: LivingSkill): number {
    return (
      0.20 * this.frequencyScore(skill) +
      0.15 * this.recencyScore(skill) +
      0.30 * this.effectivenessScore(skill) +
      0.20 * this.preventionScore(skill) +
      0.10 * this.userTrustScore(skill) +
      0.05 * this.projectionScore(skill)
    )
  }

  private frequencyScore(s: LivingSkill): number {
    return Math.min(1.0, s.occurrenceCount / 5)
  }

  private recencyScore(s: LivingSkill): number {
    const daysSince = (Date.now() - s.lastSeenAt) / 86400000
    return Math.exp(-daysSince / 7)  // half-life ~5 days
  }

  private effectivenessScore(s: LivingSkill): number {
    return s.totalFixesAttempted > 0
      ? s.totalFixSuccesses / s.totalFixesAttempted
      : 0
  }

  private preventionScore(s: LivingSkill): number {
    return s.occurrenceCount > 0
      ? s.sessionsWhereEffective / s.occurrenceCount
      : 0
  }

  private userTrustScore(s: LivingSkill): number {
    return (s.userRating + 1) / 2  // -1→0, 0→0.5, 1→1.0
  }

  private projectionScore(s: LivingSkill): number {
    return Math.min(1.0, s.projects.length / 3)
  }
}
