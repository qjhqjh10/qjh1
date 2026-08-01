import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { aiService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { loadExtraction, saveDimResult, loadOutlineResults } from '@/services/imitationService'
import { buildGenerateCharactersPrompt, buildGenerateWorldbuildingPrompt } from '@/services/extractionService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { ArrowLeftIcon, SparklesIcon, UserGroupIcon, GlobeAltIcon, CubeIcon, ShieldCheckIcon, LightBulbIcon, FaceSmileIcon, ArrowTrendingUpIcon, HeartIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { normalizeRole } from '@/components/pages/ImitationPage/constants'
import type { NovelExtraction, AggregatedResult } from '@/types/story'

const cardStyle: React.CSSProperties = { padding: 20, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
const dividerStyle: React.CSSProperties = { height: 0, borderTop: '1px dashed rgba(0,0,0,0.06)', margin: '12px 0' }

type DimKey = 'characters' | 'worldbuilding' | 'items' | 'powerSystem' | 'foreshadowing' | 'emotionCurve'
const DIMS: { key: DimKey | 'erotic'; label: string; icon: any; color: string }[] = [
  { key: 'characters', label: '角色', icon: UserGroupIcon, color: '#7c3aed' },
  { key: 'worldbuilding', label: '世界观', icon: GlobeAltIcon, color: '#3b82f6' },
  { key: 'items', label: '道具', icon: CubeIcon, color: '#f59e0b' },
  { key: 'powerSystem', label: '等级', icon: ArrowTrendingUpIcon, color: '#16a34a' },
  { key: 'foreshadowing', label: '伏笔', icon: LightBulbIcon, color: '#ec4899' },
  { key: 'emotionCurve', label: '情绪', icon: FaceSmileIcon, color: '#8b5cf6' },
  { key: 'erotic', label: '涩涩', icon: HeartIcon, color: '#ef4444' },
]

export default function ImitationOutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileVersion = useStore(s => s.fileVersion)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [outlineResults, setOutlineResults] = useState<Record<string, string>>({})
  const [expandedDim, setExpandedDim] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState<string | null>(null)

  const pp = activeProjectId ? `${projectsBasePath}/${activeProjectId}` : ''

  useEffect(() => { if (!activeProjectId) { navigate('/'); return }; loadData() }, [activeProjectId, fileVersion])
  useEffect(() => {
    if (!fileEditNotify || !activeProjectId) return
    if (fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase().includes('/outline/')) { loadData(); setFileEditNotify(null) }
  }, [fileEditNotify, activeProjectId])

  const loadData = async () => {
    const ext = await loadExtraction(pp)
    setExtraction(ext)
    const or = await loadOutlineResults(pp)
    setOutlineResults(or || {})
  }

  const ag: AggregatedResult | null = extraction?.aggregated || null
  const novelType = extraction?.novelType || 'general'
  const isErotic = novelType === 'erotic'

  // ====================== AI Generate per dimension ======================

  const handleGenerate = async (dimKey: string) => {
    if (!extraction || !activeConfigId || !ag) return
    setGenLoading(dimKey)
    let result = ''
    try {
      let prompt = ''
      switch (dimKey) {
        case 'characters':
          prompt = buildGenerateCharactersPrompt(extraction)
          break
        case 'worldbuilding':
          prompt = buildGenerateWorldbuildingPrompt(extraction)
          break
        case 'items':
          prompt = `以下是原作的道具目录，请生成一套全新的道具目录:\n${ag.items.map((i: any) => `${i.name}(${i.type}${i.grade ? '/' + i.grade : ''}): ${i.ability}`).join('\n')}\n\n输出JSON数组: [{"name":"","type":"法宝|丹药|功法|武器|道具|其他","grade":"","ability":"详细能力描述","owner":"持有者"}]`
          break
        case 'powerSystem':
          prompt = `以下是原作的等级体系，请生成一套全新的等级体系:\n${(ag.powerSystem.levels as any[]).join(' → ')} (共${ag.powerSystem.levels.length}级)\n${ag.powerSystem.description}\n\n输出JSON: {"name":"","levels":[],"description":""}`
          break
        case 'foreshadowing':
          prompt = `以下是原作的伏笔清单，请生成全新的伏笔结构:\n${ag.foreshadowing.map((f: any) => `${f.description} [第${f.plantChapter}章]`).join('\n')}\n\n输出JSON数组: [{"description":"","plantChapter":1,"payoffChapter":0,"status":"planted"}]`
          break
        case 'emotionCurve':
          prompt = extraction.emotionCurve ? `以下是原作的情绪分布，请生成全新的情绪模板:\n${extraction.emotionCurve.segments.map((s: any) => `第${s.chapterStart}-${s.chapterEnd}章: ${s.dominantEmotion}`).join('\n')}\n\n输出JSON数组: [{"chapterStart":1,"chapterEnd":10,"dominantEmotion":""}]` : '生成全新的情绪分布模板'
          break
        case 'erotic': {
          const erChs = extraction.chapters.filter((c: any) => c.erotic)
          const erNames = [...new Set(erChs.flatMap((c: any) => c.erotic?.characterRoles?.map((cr: any) => cr.name) || []))]
          const allChars = ag.characters.map((c: any) => c.name).filter((n: any) => !erNames.includes(n)).slice(0, 2)
          const allRoles = [...erNames, ...allChars]
          prompt = `以下是原作角色列表，请生成全新的情色设定。每个角色都要有完整的情色属性。\n原作角色: ${allRoles.join('、')}\n原作情色章节数: ${erChs.length}章\n\n输出JSON: {"characterRoles":[...],"sceneFlow":[...],"techniques":{},"powerDynamics":"","degradationPatterns":[]}\ncharacterRoles必须包含${allRoles.length}个角色，属性全新`
          break
        }
      }
      const reply = await chatAI([{ role: 'user' as const, content: prompt }], activeConfigId)
      if (['characters', 'foreshadowing', 'emotionCurve'].includes(dimKey)) {
        try { const m = reply.match(/\[[\s\S]*\]/); result = m ? JSON.stringify(JSON.parse(m[0]), null, 2) : reply } catch { result = reply }
      } else {
        try { const m = reply.match(/\{[\s\S]*\}/); result = m ? JSON.stringify(JSON.parse(m[0]), null, 2) : reply } catch { result = reply }
      }
    } catch (err) { logError('生成失败', err) }
    setGenLoading(null)
    if (result) {
      setOutlineResults(prev => ({ ...prev, [dimKey]: result }))
      await saveDimResult(pp, dimKey, result)
    }
  }

  // ====================== Dimension preview ======================

  const getDimPreview = (key: string): { stats: string; preview: string } => {
    const data = outlineResults[key]
    if (!data) return { stats: '未生成', preview: '点击"AI 重新生成"来生成此维度' }
    try {
      const parsed = JSON.parse(data)
      if (Array.isArray(parsed)) return { stats: `共${parsed.length}项`, preview: parsed.slice(0, 3).map((d: any) => d.name || d.description || JSON.stringify(d).slice(0, 60)).join('、') }
      if (typeof parsed === 'object') return { stats: `${Object.keys(parsed).length}个字段`, preview: JSON.stringify(parsed).slice(0, 200) }
    } catch { return { stats: `${data.length}字`, preview: data.slice(0, 200) } }
    return { stats: `${data.length}字`, preview: data.slice(0, 200) }
  }

  const isGenerated = (key: string) => !!outlineResults[key]

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/imitation')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>(仿写)大纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{extraction?.novelName}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/imitation')} variant="secondary">返回仿写页</Button>
      </div>

      <ScrollArea style={{ flex: 1, padding: '24px 28px' }}>
        {!extraction ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84', fontSize: 13 }}>请先在仿写页导入小说并完成提取</div>
        ) : (
          DIMS.filter(d => d.key !== 'erotic' || isErotic).map((dim, i) => {
            const { stats, preview } = getDimPreview(dim.key)
            const generated = isGenerated(dim.key)
            return (
              <div key={dim.key}>
                {i > 0 && <div style={dividerStyle} />}
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <dim.icon style={{ width: 16, height: 16, color: dim.color }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{dim.label}</span>
                      <span style={{ fontSize: 11, color: generated ? '#16a34a' : '#9b8e84' }}>
                        {generated ? `已生成 (${stats})` : '未生成'}
                      </span>
                    </div>
                    <Button size="sm" onClick={() => handleGenerate(dim.key)} disabled={genLoading === dim.key || !activeConfigId} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>
                      {genLoading === dim.key ? '生成中...' : 'AI 重新生成'}
                    </Button>
                  </div>
                  <div onClick={() => setExpandedDim(expandedDim === dim.key ? null : dim.key)} style={{ cursor: 'pointer' }}>
                    <div style={{ fontSize: 12, color: generated ? '#4a3f38' : '#9b8e84', lineHeight: 1.7, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {preview}
                    </div>
                  </div>
                  {expandedDim === dim.key && generated && (
                    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#faf9f8', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }} className="custom-scrollbar">
                      {(() => {
                        try {
                          const d = JSON.parse(outlineResults[dim.key])
                          if (Array.isArray(d)) return d.map((item: any, j: number) => (
                            <div key={j} style={{ marginBottom: 4, padding: '4px 8px', borderRadius: 6, background: '#fff' }}>
                              {dim.key === 'characters' ? `${item.name} [${normalizeRole(item.role)}]` : item.name || item.description || JSON.stringify(item)}
                            </div>
                          ))
                          return JSON.stringify(d, null, 2)
                        } catch { return outlineResults[dim.key] }
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
