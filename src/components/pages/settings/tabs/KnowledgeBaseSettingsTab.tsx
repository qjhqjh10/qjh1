import { useSettingsStore } from '@/store'
import type { KBSceneSettings, KBInjectMode } from '@/types/settings'
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

/** v15.4.0: 注入方式单选（全量注入 / 片段注入）——按钮组，选中态高亮 */
function InjectModeToggle({ value, onChange }: {
  value: KBInjectMode
  onChange: (v: KBInjectMode) => void
}) {
  const optStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', borderRadius: 8, border: '1px solid',
    borderColor: active ? 'rgba(124,58,237,0.35)' : 'rgba(0,0,0,0.1)',
    background: active ? 'rgba(124,58,237,0.08)' : '#fff',
    color: active ? '#7c3aed' : '#6b5e54',
    fontSize: 11, fontWeight: active ? 600 : 500, cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
  })
  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      <button style={optStyle(value === 'full')} onClick={() => onChange('full')} title="勾选文件全文截断注入（上限受下方两项控制）">全量注入</button>
      <button style={optStyle(value === 'chunk')} onClick={() => onChange('chunk')} title="按关键词做向量化语义检索，注入 topK 个相关片段——更省 token 且聚焦相关设定">片段注入</button>
    </div>
  )
}

/**
 * 场景卡片：标题 + 说明 + 设置项。
 * v15.4.0: agent 恒为语义检索（不渲染注入方式）；chapterGen/characterGen 渲染注入方式 + searchTopK + 两个上限。
 */
function SceneCard({ title, accent, description, value, onChange, showInjectMode }: {
  title: string
  accent: string
  description: string
  value: KBSceneSettings
  onChange: (patch: Partial<KBSceneSettings>) => void
  showInjectMode: boolean
}) {
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
        {showInjectMode && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>注入方式</div>
              <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.4, marginTop: 2 }}>
                全量：勾选文件全文截断注入（上限受下方两项控制）；片段：按关键词语义检索 topK 个相关片段注入，更省 token 且聚焦相关设定
              </div>
            </div>
            <InjectModeToggle value={value.injectMode} onChange={v => onChange({ injectMode: v })} />
          </div>
        )}
        {showInjectMode && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>语义检索片段数（topK）</div>
              <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.4, marginTop: 2 }}>
                片段注入模式每次检索注入的片段数（1-20），越大参考越充分、消耗 token 越多
              </div>
            </div>
            <NumberField value={value.searchTopK} min={1} max={20} onChange={v => onChange({ searchTopK: v })} />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>
              {showInjectMode ? '全量注入：每文件最多字符' : '注入：每文件最多字符'}
            </div>
            <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.4, marginTop: 2 }}>
              全量注入时单个文件最多注入的字符数
            </div>
          </div>
          <NumberField value={value.fallbackPerFileMaxChars} min={500} max={50000} onChange={v => onChange({ fallbackPerFileMaxChars: v })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>
              {showInjectMode ? '全量注入：总字符上限' : '注入：总字符上限'}
            </div>
            <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.4, marginTop: 2 }}>
              全量注入时所有勾选文件合计注入的字符上限（超出部分截断）
            </div>
          </div>
          <NumberField value={value.fallbackTotalMaxChars} min={500} max={100000} onChange={v => onChange({ fallbackTotalMaxChars: v })} />
        </div>
      </div>
    </div>
  )
}

export function KnowledgeBaseSettingsTab() {
  const aiSettings = useSettingsStore(s => s.aiSettings)
  const setAISettings = useSettingsStore(s => s.setAISettings)
  // v15.4.0: 三场景独立配置（generation 旧键仅兜底读取，不参与 UI）
  const kb = {
    agent: { ...DEFAULT_KB_SCENE, ...aiSettings.kbSettings?.agent },
    chapterGen: { ...DEFAULT_KB_SCENE, ...(aiSettings.kbSettings?.chapterGen ?? aiSettings.kbSettings?.generation) },
    characterGen: { ...DEFAULT_KB_SCENE, ...(aiSettings.kbSettings?.characterGen ?? aiSettings.kbSettings?.generation) },
  }

  const setScene = (scene: 'agent' | 'chapterGen' | 'characterGen', patch: Partial<KBSceneSettings>) => {
    setAISettings({ kbSettings: { ...aiSettings.kbSettings, ...kb, [scene]: { ...kb[scene], ...patch } } })
  }

  return (
    <div className="page-enter custom-scrollbar" style={{ height: '100%', overflowY: 'auto', paddingRight: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>知识库设置</h3>
        <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6, margin: 0 }}>
          知识库注入按场景分开配置：AI 写作助手（每轮语义检索）、章节生成与批量生成、AI 生成角色（每个场景可选全量注入或关键词片段检索注入）。
        </p>
      </div>

      <SceneCard
        title="AI 写作助手"
        accent="#7c3aed"
        description="每次对话时按当前问题在你勾选的知识库文件中做语义检索，把相关片段注入提示词。"
        value={kb.agent}
        onChange={patch => setScene('agent', patch)}
        showInjectMode={false}
      />

      <SceneCard
        title="章节生成 · 批量生成"
        accent="#16a34a"
        description="章节创作弹窗与批量生成弹窗勾选知识库文件后的注入方式：全量（文件全文截断注入）或片段（输入关键词，向量化检索相关片段注入）。"
        value={kb.chapterGen}
        onChange={patch => setScene('chapterGen', patch)}
        showInjectMode
      />

      <SceneCard
        title="AI 生成角色"
        accent="#f59e0b"
        description="AI 生成角色弹窗勾选知识库文件后的注入方式（同章节生成：全量或关键词语义片段）。"
        value={kb.characterGen}
        onChange={patch => setScene('characterGen', patch)}
        showInjectMode
      />

      <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
        💡 片段注入的关键词在生成弹窗中填写（如「剑术, 宗门」）；检索不到相关片段时不注入任何内容。网络搜索相关设置（搜索条数、安全模式）在「AI写作助手」标签页中配置。
      </div>
    </div>
  )
}
