import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { continuationService, aiService } from '@/services/fileService'
import * as cs from '@/services/continuationService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { ArrowLeftIcon, SparklesIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, CheckCircleIcon, BookOpenIcon, LightBulbIcon, DocumentTextIcon, CubeIcon, MapPinIcon, ShieldCheckIcon, ArrowTrendingUpIcon, FlagIcon, GlobeAltIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { safeJsonParse, safeJsonParseAs } from '@/utils/safeJsonParse'
import type { ContinuationProject, StoryUnderstanding, OutlineMergeData, PlotDirectionSegment, CharacterRole } from '@/types/continuation'

const cardStyle: React.CSSProperties = { padding: 20, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
const dividerStyle: React.CSSProperties = { height: 0, borderTop: '1px dashed rgba(0,0,0,0.06)', margin: '12px 0' }
const previewText: React.CSSProperties = { fontSize: 12, color: '#4a3f38', lineHeight: 1.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const statBadge: React.CSSProperties = { fontSize: 11, color: '#9b8e84', marginRight: 16 }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }

type EditTarget = { type: 'story'; data: StoryUnderstanding } | { type: 'segment'; data: PlotDirectionSegment } | { type: 'merge'; data: OutlineMergeData } | null

export default function ContinuationOutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showPlotCards, setShowPlotCards] = useState(false)
  const [showMergeCards, setShowMergeCards] = useState(false)
  const [loading, setLoading] = useState('')
  const [editTarget, setEditTarget] = useState<EditTarget>(null)

  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId])

  const load = async () => {
    const list = await continuationService.list() as ContinuationProject[]
    const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
    if (found) setProject(found)
  }

  const save = async (updates: Partial<ContinuationProject>) => {
    if (!project) return
    const updated = { ...project, ...updates, updatedAt: new Date().toISOString() }
    const saved = await continuationService.save(updated)
    setProject(saved)
    return saved
  }

  const parseReply = (reply: string) => {
    return safeJsonParse(reply)
  }

  // ====================== Card 1: 原作理解 ======================

  const handleAggregateOriginal = async () => {
    if (!activeConfigId || !project) return
    setLoading('aggregate')
    try {
      const analyzed = project.sourceChapters.filter(c => c.analysis)
      const BATCH_SIZE = 50
      let su: StoryUnderstanding | null = null

      if (analyzed.length <= BATCH_SIZE) {
        const summaries = analyzed.map(c => `第${c.chapterNumber}章: ${c.analysis!.plotEvents.join('; ')}`)
        const prompt = cs.buildAggregationPrompt(summaries, project.sourceChapters.length)
        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
        su = parseReply(reply) as StoryUnderstanding | null
      } else {
        const totalBatches = Math.ceil(analyzed.length / BATCH_SIZE)
        const batchResults: string[] = []
        let prevEndingState = ''
        for (let b = 0; b < totalBatches; b++) {
          const start = b * BATCH_SIZE; const end = Math.min(start + BATCH_SIZE, analyzed.length)
          const batch = analyzed.slice(start, end)
          const summaries = batch.map(c => `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('; ')}`)
          const prompt = cs.buildBatchSummaryPrompt(summaries, b + 1, totalBatches, batch[0].chapterNumber, batch[batch.length - 1].chapterNumber, prevEndingState)
          const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
          const parsed = parseReply(reply) as Record<string, any> | null
          if (parsed) { batchResults.push(JSON.stringify(parsed)); if (parsed.endingCharacterStates) prevEndingState = JSON.stringify(parsed.endingCharacterStates) }
        }
        const lastStart = Math.max(0, analyzed.length - 20)
        const lastDetail = analyzed.slice(lastStart).map(c => `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('；')}`).join('\n\n')
        const prompt = cs.buildGlobalAggregationPrompt(batchResults, lastDetail, project.sourceChapters.length)
        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
        su = parseReply(reply) as StoryUnderstanding | null
      }
      if (su) {
        su.powerSystemFinal = su.powerSystemFinal || { name: '', levels: '', description: '' }
        su.keyItemsFinal = su.keyItemsFinal || []; su.factionsFinal = su.factionsFinal || []
        su.locationsFinal = su.locationsFinal || []; su.foreshadowingUnresolved = su.foreshadowingUnresolved || []
        await save({ storyUnderstanding: su })
      }
    } catch (err) { logError('聚合失败', err) }
    setLoading('')
  }

  // ====================== Card 2: 剧情走向 ======================

  const handleGeneratePlot = async () => {
    if (!activeConfigId || !project?.storyUnderstanding) return
    setLoading('plot')
    try {
      const analyzed = project.sourceChapters.filter(c => c.analysis)
      const lastStart = Math.max(0, analyzed.length - 20)
      const lastDetail = analyzed.slice(lastStart).map(c => `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('；')} | 角色:${c.analysis!.charactersAppeared.map(a => `${a.name}(${a.role})`).join('、')}`).join('\n\n')
      const prompt = cs.buildPlotDirectionPrompt(JSON.stringify(project.storyUnderstanding), lastDetail)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const seg: PlotDirectionSegment = { id: 'pd_' + Date.now(), content: reply, label: '首次生成', generatedAt: new Date().toISOString() }
      const segments = [...(project.plotDirection || []), seg]
      await save({ plotDirection: segments, status: 'outlining' })
    } catch (err) { logError('剧情走向生成失败', err) }
    setLoading('')
  }

  const handleContinuePlot = async () => {
    if (!activeConfigId || !project?.storyUnderstanding || !project?.plotDirection?.length) return
    setLoading('plotContinue')
    try {
      const analyzed = project.sourceChapters.filter(c => c.analysis)
      const lastStart = Math.max(0, analyzed.length - 20)
      const lastDetail = analyzed.slice(lastStart).map(c => `第${c.chapterNumber}章 ${c.title}: ${c.analysis!.plotEvents.join('；')}`).join('\n\n')
      const existingPlot = project.plotDirection.map(s => s.content).join('\n\n')
      const label = `后续剧情${project.plotDirection.length}`
      const prompt = cs.buildContinuationPlotPrompt(JSON.stringify(project.storyUnderstanding), existingPlot, lastDetail)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const seg: PlotDirectionSegment = { id: 'pd_' + Date.now(), content: reply, label, generatedAt: new Date().toISOString() }
      await save({ plotDirection: [...project.plotDirection, seg] })
    } catch (err) { logError('后续剧情生成失败', err) }
    setLoading('')
  }

  // ====================== Card 3: 大纲融合 ======================

  const handleGenerateMerge = async () => {
    if (!activeConfigId || !project?.storyUnderstanding || !project?.plotDirection?.length) return
    setLoading('merge')
    try {
      const fullPlot = project.plotDirection.map(s => s.content).join('\n\n')
      const prompt = cs.buildOutlineMergePrompt(fullPlot, JSON.stringify(project.storyUnderstanding))
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const om = safeJsonParseAs<OutlineMergeData>(reply)
      if (om) {
        await save({ outlineMerge: om, status: 'merged' })
      }
    } catch (err) { logError('大纲融合失败', err) }
    setLoading('')
  }

  // ====================== Edit handlers ======================

  const handleEditStory = () => { if (project?.storyUnderstanding) setEditTarget({ type: 'story', data: JSON.parse(JSON.stringify(project.storyUnderstanding)) }) }
  const handleEditSegment = (seg: PlotDirectionSegment) => { setEditTarget({ type: 'segment', data: { ...seg } }) }
  const handleEditMerge = () => { if (project?.outlineMerge) setEditTarget({ type: 'merge', data: JSON.parse(JSON.stringify(project.outlineMerge)) }) }

  const handleSaveEdit = async () => {
    if (!editTarget) return
    if (editTarget.type === 'story') { await save({ storyUnderstanding: editTarget.data }) }
    else if (editTarget.type === 'segment') {
      const segments = (project?.plotDirection || []).map(s => s.id === editTarget.data.id ? editTarget.data : s)
      await save({ plotDirection: segments })
    }
    else if (editTarget.type === 'merge') { await save({ outlineMerge: editTarget.data }) }
    setEditTarget(null)
  }

  const story = project?.storyUnderstanding
  const plotSegments = project?.plotDirection || []
  const outlineMerge = project?.outlineMerge
  const analyzedCount = project?.sourceChapters?.filter(c => c.analysis).length || 0

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/continuation-workspace')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>续写大纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{project?.name}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/continuation-workspace')} variant="secondary">返回工作台</Button>
      </div>

      <ScrollArea style={{ flex: 1, padding: '24px 28px' }}>
        {/* Card 1: 原作理解 */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={sectionTitle}><BookOpenIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />原作理解 ({analyzedCount}章已分析)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {story && <Button size="sm" variant="secondary" onClick={handleEditStory} icon={<PencilIcon style={{ width: 11, height: 11 }} />}>编辑</Button>}
              <Button size="sm" onClick={handleAggregateOriginal} disabled={loading === 'aggregate' || !activeConfigId || analyzedCount === 0} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>{loading === 'aggregate' ? '聚合中...' : 'AI 重新聚合'}</Button>
            </div>
          </div>
          {story ? (
            <div onClick={() => setShowOriginal(!showOriginal)} style={{ cursor: 'pointer' }}>
              <div style={{ ...previewText, whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}><strong>主线:</strong> {story.mainPlot}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: '#9b8e84' }}>
                <span>角色: {story.characterArcs?.length || 0}</span>
                <span>未完问题: {story.unresolvedQuestions?.length || 0}</span>
                <span>伏笔: {story.foreshadowingChain?.length || 0}</span>
                <span>世界规则: {story.worldRules?.length || 0}</span>
              </div>
              {showOriginal && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#faf9f8', fontSize: 11 }}>
                  <div style={{ marginBottom: 4 }}><strong>角色:</strong> {story.characterArcs?.map(c => `${c.name}(${c.role},${c.arcType})`).join('；')}</div>
                  <div style={{ marginBottom: 4 }}><strong>未完问题:</strong> {story.unresolvedQuestions?.join('；') || '无'}</div>
                  <div><strong>续写建议:</strong> {story.continuationSuggestions?.join('；')}</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#9b8e84', textAlign: 'center', padding: 20 }}>暂未生成原作理解，请先分析章节后点击"AI 重新聚合"</div>
          )}
        </div>

        <div style={dividerStyle} />

        {/* Card 2: 剧情走向 */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={sectionTitle}><LightBulbIcon style={{ width: 16, height: 16, color: '#f59e0b' }} />剧情走向 ({plotSegments.length}段，{plotSegments.reduce((s, seg) => s + seg.content.length, 0)}字)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {plotSegments.length === 0 ? (
                <Button size="sm" onClick={handleGeneratePlot} disabled={loading === 'plot' || !activeConfigId || !story} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>{loading === 'plot' ? '生成中...' : 'AI 生成剧情走向'}</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={handleContinuePlot} disabled={loading === 'plotContinue' || !activeConfigId} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>{loading === 'plotContinue' ? '生成中...' : '生成后续剧情'}</Button>
              )}
            </div>
          </div>
          {plotSegments.length > 0 ? (
            <div>
              <div onClick={() => setShowPlotCards(!showPlotCards)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, fontSize: 11, color: '#6b5e54' }}>
                {showPlotCards ? <ChevronDownIcon style={{ width: 10 }} /> : <ChevronRightIcon style={{ width: 10 }} />}
                {showPlotCards ? '收起' : '展开'}剧情段
              </div>
              {showPlotCards && plotSegments.map((seg, i) => (
                <div key={seg.id} style={{ padding: '12px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>{seg.label} ({seg.content.length}字)</span>
                    <Button size="sm" variant="secondary" onClick={() => handleEditSegment(seg)} icon={<PencilIcon style={{ width: 10, height: 10 }} />}>编辑</Button>
                  </div>
                  <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden' }}>{seg.content.slice(0, 200)}{seg.content.length > 200 ? '...' : ''}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#9b8e84', textAlign: 'center', padding: 20 }}>暂未生成剧情走向，点击按钮生成 ~10000 字的续写剧情走向</div>
          )}
        </div>

        <div style={dividerStyle} />

        {/* Card 3: 大纲融合 */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={sectionTitle}><DocumentTextIcon style={{ width: 16, height: 16, color: '#16a34a' }} />大纲融合</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {outlineMerge && <Button size="sm" variant="secondary" onClick={handleEditMerge} icon={<PencilIcon style={{ width: 11, height: 11 }} />}>编辑</Button>}
              <Button size="sm" onClick={handleGenerateMerge} disabled={loading === 'merge' || !activeConfigId || !story || plotSegments.length === 0} icon={<SparklesIcon style={{ width: 11, height: 11 }} />}>{loading === 'merge' ? '生成中...' : 'AI 重新生成'}</Button>
            </div>
          </div>
          {outlineMerge ? (
            <div onClick={() => setShowMergeCards(!showMergeCards)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: '#9b8e84' }}>
                <span><UserGroupIcon style={{ width: 10, height: 10, display: 'inline' }} /> 角色变化: {outlineMerge.characters?.length || 0}</span>
                <span><CubeIcon style={{ width: 10, height: 10, display: 'inline' }} /> 道具流转: {outlineMerge.items?.length || 0}</span>
                <span><ShieldCheckIcon style={{ width: 10, height: 10, display: 'inline' }} /> 势力变化: {outlineMerge.factions?.length || 0}</span>
                <span><MapPinIcon style={{ width: 10, height: 10, display: 'inline' }} /> 新地点: {outlineMerge.newLocations?.length || 0}</span>
                <span><ArrowTrendingUpIcon style={{ width: 10, height: 10, display: 'inline' }} /> 等级: {outlineMerge.powerSystem?.length || 0}</span>
                <span><FlagIcon style={{ width: 10, height: 10, display: 'inline' }} /> 伏笔: {outlineMerge.newForeshadowing?.length || 0}</span>
              </div>
              {showMergeCards && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: '#faf9f8' }}><strong>基础设定:</strong> {outlineMerge.basicSettingUpdate}</div>
                  {outlineMerge.characters?.length > 0 && <div><strong>角色:</strong> {outlineMerge.characters.map(c => `${c.name}[${c.role}] ${c.originalStatus}→${c.newStatus}`).join('；')}</div>}
                  {outlineMerge.items?.length > 0 && <div><strong>道具:</strong> {outlineMerge.items.map(i => `${i.name} ${i.previousStatus}→${i.newStatus}`).join('；')}</div>}
                  {outlineMerge.factions?.length > 0 && <div><strong>势力:</strong> {outlineMerge.factions.map(f => `${f.name} ${f.previousStatus}→${f.newStatus}`).join('；')}</div>}
                  {outlineMerge.newLocations?.length > 0 && <div><strong>新地点:</strong> {outlineMerge.newLocations.map(l => `${l.name}[${l.type}]`).join('、')}</div>}
                  {outlineMerge.powerSystem?.length > 0 && <div><strong>等级:</strong> {outlineMerge.powerSystem.map(p => `${p.name} ${p.originalLevels}→${p.newLevels}`).join('；')}</div>}
                  {outlineMerge.newForeshadowing?.length > 0 && <div><strong>新伏笔:</strong> {outlineMerge.newForeshadowing.map(f => f.description).join('；')}</div>}
                  {outlineMerge.newPlotThreads?.length > 0 && <div><strong>新故事线:</strong> {outlineMerge.newPlotThreads.map(t => `${t.name}[${t.type}]`).join('、')}</div>}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#9b8e84', textAlign: 'center', padding: 20 }}>暂未生成大纲融合，请先生成剧情走向后点击"AI 重新生成"</div>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <Button onClick={() => navigate('/continuation-detailed')}>查看续写细纲 →</Button>
        </div>
      </ScrollArea>

      {/* Edit Modal */}
      <Modal isOpen={editTarget !== null} onClose={() => setEditTarget(null)} title={editTarget?.type === 'story' ? '编辑原作理解' : editTarget?.type === 'segment' ? `编辑 ${(editTarget.data as PlotDirectionSegment)?.label}` : '编辑大纲融合'} width={700} draggable>
        {editTarget?.type === 'story' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflow: 'auto' }} className="custom-scrollbar">
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>主线</div><textarea value={editTarget.data.mainPlot} onChange={e => setEditTarget({ type: 'story', data: { ...editTarget.data, mainPlot: e.target.value } })} rows={2} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>世界规则（一行一条）</div><textarea value={editTarget.data.worldRules.join('\n')} onChange={e => setEditTarget({ type: 'story', data: { ...editTarget.data, worldRules: e.target.value.split('\n').filter(Boolean) } })} rows={4} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>未完问题（一行一条）</div><textarea value={editTarget.data.unresolvedQuestions.join('\n')} onChange={e => setEditTarget({ type: 'story', data: { ...editTarget.data, unresolvedQuestions: e.target.value.split('\n').filter(Boolean) } })} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>续写建议（一行一条）</div><textarea value={editTarget.data.continuationSuggestions.join('\n')} onChange={e => setEditTarget({ type: 'story', data: { ...editTarget.data, continuationSuggestions: e.target.value.split('\n').filter(Boolean) } })} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
          </div>
        )}
        {editTarget?.type === 'segment' && (
          <textarea value={editTarget.data.content} onChange={e => setEditTarget({ type: 'segment', data: { ...editTarget.data, content: e.target.value } })} rows={24} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, lineHeight: 1.8, fontFamily: 'inherit', resize: 'vertical' }} />
        )}
        {editTarget?.type === 'merge' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflow: 'auto' }} className="custom-scrollbar">
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>基础设定</div><textarea value={editTarget.data.basicSettingUpdate} onChange={e => setEditTarget({ type: 'merge', data: { ...editTarget.data, basicSettingUpdate: e.target.value } })} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>世界观新规则（一行一条）</div><textarea value={(editTarget.data.newWorldRules || []).join('\n')} onChange={e => setEditTarget({ type: 'merge', data: { ...editTarget.data, newWorldRules: e.target.value.split('\n').filter(Boolean) } })} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>角色变化 JSON</div><textarea value={JSON.stringify(editTarget.data.characters || [], null, 2)} onChange={e => { try { const v = JSON.parse(e.target.value); setEditTarget({ type: 'merge', data: { ...editTarget.data, characters: v } }) } catch {} }} rows={8} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>道具流转 JSON</div><textarea value={JSON.stringify(editTarget.data.items || [], null, 2)} onChange={e => { try { const v = JSON.parse(e.target.value); setEditTarget({ type: 'merge', data: { ...editTarget.data, items: v } }) } catch {} }} rows={6} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>势力变化 JSON</div><textarea value={JSON.stringify(editTarget.data.factions || [], null, 2)} onChange={e => { try { const v = JSON.parse(e.target.value); setEditTarget({ type: 'merge', data: { ...editTarget.data, factions: v } }) } catch {} }} rows={6} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} /></div>
            <div><div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>新伏笔（一行一条）</div><textarea value={(editTarget.data.newForeshadowing || []).map(f => f.description).join('\n')} onChange={e => setEditTarget({ type: 'merge', data: { ...editTarget.data, newForeshadowing: e.target.value.split('\n').filter(Boolean).map(d => ({ description: d, plantChapter: '', predictedResolution: '' })) } })} rows={3} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, fontFamily: 'inherit' }} /></div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Button variant="secondary" onClick={() => setEditTarget(null)}>取消</Button>
          <Button onClick={handleSaveEdit}>保存</Button>
        </div>
      </Modal>
    </div>
  )
}
