import { useState, useEffect, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import type { LivingSkill, LivingSkillStage } from '@/agent/living-skills/types'
import type { LearnedRule } from '@/agent/evolution/SkillLearner'
import { SkeletonList } from '@/components/common/Skeleton'

const STAGE_ORDER: LivingSkillStage[] = [
  'OBSERVED', 'PATTERN', 'SOFT_SKILL', 'CONDITIONAL_RULE', 'HARD_CONSTRAINT', 'VERIFIED',
]

const STAGE_LABELS: Record<LivingSkillStage, { label: string; color: string }> = {
  OBSERVED: { label: '观察', color: '#9b8e84' },
  PATTERN: { label: '模式', color: '#2563eb' },
  SOFT_SKILL: { label: '软技能', color: '#16a34a' },
  CONDITIONAL_RULE: { label: '条件规则', color: '#e67e00' },
  HARD_CONSTRAINT: { label: '硬约束', color: '#dc2626' },
  VERIFIED: { label: '已验证', color: '#7c3aed' },
}

export function SkillsSection() {
  const [skills, setSkills] = useState<LivingSkill[]>([])
  const [rules, setRules] = useState<LearnedRule[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load living skills
      try {
        const raw = await fileService.read('.aiharness/living-skills/skills.json')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) setSkills(data)
      } catch { /* no skills yet */ }

      // Load learned rules
      try {
        const files = await fileService.listDir('.aiharness/learned')
        const loaded: LearnedRule[] = []
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              const raw = await fileService.read(`.aiharness/learned/${f}`)
              const pattern = JSON.parse(raw)
              // LearnedPattern → synthesize a rule-like display
              loaded.push({
                id: pattern.id,
                title: `${pattern.toolName} - ${pattern.errorCategory}`,
                when: pattern.errorSnippet,
                rule: pattern.solution,
                source: pattern,
                createdAt: pattern.lastSeen,
                isAutoDraft: true,
              })
            } catch { /* skip corrupt */ }
          }
        }
        setRules(loaded)
      } catch { /* no rules yet */ }
    } catch { /* best-effort */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Stage distribution
  const stageDistribution = STAGE_ORDER.map(stage => ({
    stage,
    ...STAGE_LABELS[stage],
    count: skills.filter(s => s.stage === stage).length,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stage distribution */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>技能阶段分布</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {stageDistribution.map(s => (
            <div key={s.stage} style={{
              flex: 1, minWidth: 80, padding: '8px 12px', borderRadius: 10,
              background: `${s.color}08`, border: `1px solid ${s.color}20`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Skills list */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
          Living Skills ({skills.length})
        </div>
        {skills.length > 0 ? (
          <div className="custom-scrollbar" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {skills
              .sort((a, b) => b.confidence - a.confidence)
              .map(s => {
                const stageInfo = STAGE_LABELS[s.stage] ?? STAGE_LABELS.OBSERVED
                return (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.03)',
                    fontSize: 12,
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', background: stageInfo.color, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 1 }}>
                        {s.trigger?.toolName} &middot; {stageInfo.label}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 600, color: stageInfo.color }}>
                        {(s.confidence * 100).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>
                        {s.occurrenceCount}次
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
            暂无 Living Skills。Agent 在执行任务过程中会自动积累经验，当同一类错误重复出现时会逐步形成技能。
          </p>
        )}
      </div>

      {/* Learned rules */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
          已学习规则 ({rules.length})
        </div>
        {rules.length > 0 ? (
          <div className="custom-scrollbar" style={{ maxHeight: 200, overflowY: 'auto' }}>
            {rules.map(r => (
              <div key={r.id} style={{
                padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.03)',
                fontSize: 12,
              }}>
                <div style={{ fontWeight: 600, color: '#2d2520' }}>{r.title}</div>
                <div style={{ fontSize: 11, color: '#6b5e54', marginTop: 2, lineHeight: 1.5 }}>
                  {r.rule}
                </div>
                <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
                  触发条件: {r.when}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
            暂无已学习规则。当工具连续失败 3 次以上，Agent 会自动生成修复规则。
          </p>
        )}
      </div>

      {loading && (
        <div style={{ padding: 8 }}><SkeletonList count={4} /></div>
      )}
    </div>
  )
}
