import type { StoryEvent, StoryLink, ChapterEmotion, ChapterRhythm, ChapterPOV, Plotline, ChapterPlotline, GrowthTrack, GrowthEntry } from '@/types/story';
import type { DetailedChapter } from '@/types/chapter';
import type { Character } from '@/types/character';

export function CoOccurrenceTab({ chapters }: { chapters: DetailedChapter[] }) {
  const coMap = new Map<string, number>()
  chapters.forEach(ch => {
    const names = (ch.description || '').match(/[：:]\s*(.+)/)?.[1]?.split(/[,，、]/)?.map((s: string) => s.trim()).filter(Boolean) || []
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const key = [names[i], names[j]].sort().join('|||')
      coMap.set(key, (coMap.get(key) || 0) + 1)
    }
  })
  const pairs = [...coMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => { const [a, b] = k.split('|||'); return { charA: a, charB: b, coCount: v } })
  if (pairs.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无角色共现数据。请在细纲描述中为各章添加角色信息。</div>
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>角色共现网络</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {pairs.map((p, i) => (
          <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: `rgba(124,58,237,${0.04 + p.coCount * 0.03})`, border: '1px solid rgba(124,58,237,0.1)', fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charA}</span><span style={{ color: '#9b8e84', margin: '0 4px' }}>+</span><span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charB}</span><span style={{ marginLeft: 8, color: '#6b5e54' }}>共现 {p.coCount} 章</span>
          </div>
        ))}
      </div>
    </div>
  )
}
