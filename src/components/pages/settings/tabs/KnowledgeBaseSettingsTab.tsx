import { useSettingsStore } from '@/store'
import type { KBSceneSettings } from '@/types/settings'
import { DEFAULT_KB_SCENE } from '@/types/settings'

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#2d2520',
}

const hintStyle: React.CSSProperties = {
  fontSize: 11, color: '#9b8e84', lineHeight: 1.5, marginTop: 3,
}

const numStyle: React.CSSProperties = {
  width: 80, padding: '6px 10px', borderRadius: 8,
  border: '1px solid #e5e0da', fontSize: 13, fontFamily: 'inherit',
  background: '#faf9f8', color: '#1a1512', textAlign: 'center',
  flexShrink: 0,
}

/** 数字输入（限制范围） */
function NumberField({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      min={min} max={max}
      value={value}
      onChange={e => {
        const n = parseInt(e.target.value, 10)
        if (isNaN(n)) return
        onChange(Math.min(max, Math.max(min, n)))
      }}
      style={numStyle}
    />
  )
}

/** 场景卡片：标题 + 说明 + 设置项（v14.8: 章节生成场景改为直接注入文件，不再显示语义检索条数） */
function SceneCard({ title, accent, description, value, onChange, mode }: {
  title: string
  accent: string
  description: string
  value: KBSceneSettings
  onChange: (patch: Partial<KBSceneSettings>) => void
  mode: 'agent' | 'generation'
}) {
  const rows: [keyof KBSceneSettings, string, string][] = mode === 'agent'
    ? [
        ['searchTopK', '语义检索片段数（topK）', '每次检索从知识库中取出的片段数量，越大参考越充分、消耗 token 越多'],
        ['fallbackPerFileMaxChars', '注入：每文件最多字符', '语义检索结果不可用时的兜底注入，单个文件最多注入的字符数'],
        ['fallbackTotalMaxChars', '注入：总字符上限', '兜底注入时所有文件合计注入的字符上限'],
      ]
    : [
        ['fallbackPerFileMaxChars', '每文件最多注入字符', '直接注入所选文件时，单个文件最多注入的字符数'],
        ['fallbackTotalMaxChars', '总注入字符上限', '所有勾选文件合计注入的字符上限（超出部分截断）'],
      ]
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '18px 20px',
      border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: accent }} />
        <span style={labelStyle}>{title}</span>
      </div>
      <div style={{ ...hintStyle, marginBottom: 12 }}>{description}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(([key, label, hint]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>{label}</div>
              <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.4, marginTop: 2 }}>{hint}</div>
            </div>
            <NumberField
              value={value[key]}
              min={key === 'searchTopK' ? 1 : 500}
              max={key === 'searchTopK' ? 20 : key === 'fallbackPerFileMaxChars' ? 50000 : 100000}
              onChange={v => onChange({ [key]: v })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function KnowledgeBaseSettingsTab() {
  const aiSettings = useSettingsStore(s => s.aiSettings)
  const setAISettings = useSettingsStore(s => s.setAISettings)
  const kb = {
    agent: { ...DEFAULT_KB_SCENE, ...aiSettings.kbSettings?.agent },
    generation: { ...DEFAULT_KB_SCENE, ...aiSettings.kbSettings?.generation },
  }

  const setScene = (scene: 'agent' | 'generation', patch: Partial<KBSceneSettings>) => {
    setAISettings({ kbSettings: { ...kb, [scene]: { ...kb[scene], ...patch } } })
  }

  return (
    <div className="page-enter custom-scrollbar" style={{ height: '100%', overflowY: 'auto', paddingRight: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>知识库设置</h3>
        <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6, margin: 0 }}>
          知识库注入按场景分开配置。当前支持知识库注入的位置：AI 写作助手（每轮语义检索）、章节生成 / 批量生成 / AI 生成角色（直接注入所选文件全文，按字符截断）。
        </p>
      </div>

      <SceneCard
        title="AI 写作助手"
        accent="#7c3aed"
        description="每次对话时按当前问题在你勾选的知识库文件中做语义检索，把相关片段注入提示词。"
        value={kb.agent}
        onChange={patch => setScene('agent', patch)}
        mode="agent"
      />

      <SceneCard
        title="章节生成 · 批量生成 · AI 生成角色"
        accent="#16a34a"
        description="章节创作弹窗、批量生成、AI 生成角色弹窗中勾选知识库文件后，直接注入所选文件全文（按字符截断），上限由以下两项控制。"
        value={kb.generation}
        onChange={patch => setScene('generation', patch)}
        mode="generation"
      />

      <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
        💡 网络搜索相关设置（搜索条数、安全模式）在「AI写作助手」标签页中配置。
      </div>
    </div>
  )
}
