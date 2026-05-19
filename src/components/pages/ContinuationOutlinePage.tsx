import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { continuationService } from '@/services/fileService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { ArrowLeftIcon, SparklesIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import type { ContinuationProject, StoryUnderstanding } from '@/types/continuation'

export default function ContinuationOutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId])

  const load = async () => {
    const list = await continuationService.list() as ContinuationProject[]
    const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
    if (found) setProject(found)
  }

  const plotDirection = project?.plotDirection
  const outlineMerge = project?.outlineMerge
  const story = project?.storyUnderstanding
  const analyzed = project?.sourceChapters?.filter(c => c.analysis) || []

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/continuation-workspace')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>续写大纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{project?.name}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/continuation-workspace')} variant="secondary">返回工作台</Button>
      </div>

      <ScrollArea style={{ flex: 1, padding: '20px 24px' }}>
        <div style={{ marginBottom: 20 }}>
          <div onClick={() => setShowOriginal(!showOriginal)} style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            {showOriginal ? <ChevronDownIcon style={{ width: 12 }} /> : <ChevronRightIcon style={{ width: 12 }} />}
            原作理解摘要 ({analyzed.length}章已分析)
          </div>
          {showOriginal && story && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#faf9f8', fontSize: 11, marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}><strong>主线:</strong> {story.mainPlot}</div>
              <div style={{ marginBottom: 4 }}><strong>未完问题:</strong> {story.unresolvedQuestions?.join('; ') || '无'}</div>
              <div><strong>角色:</strong> {story.characterArcs?.map(c => `${c.name}(${c.role},${c.currentState})`).join('、')}</div>
            </div>
          )}
        </div>

        {/* Plot direction */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 12 }}>剧情走向</h3>
          {plotDirection ? (
            <div style={{ padding: '20px 24px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', fontSize: 14, lineHeight: 2, whiteSpace: 'pre-wrap' }}>{plotDirection}</div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂未生成剧情走向，请在续写工作台中完成步骤4</div>
          )}
        </div>

        {/* Outline merge */}
        {outlineMerge && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 12 }}>大纲融合</h3>
            <div style={{ fontSize: 13, color: '#4a3f38', lineHeight: 1.8, marginBottom: 12, padding: '12px 16px', borderRadius: 10, background: '#faf9f8' }}><strong>基础设定:</strong> {outlineMerge.basicSettingUpdate}</div>
            {outlineMerge.characters?.length > 0 && <div style={{ marginBottom: 8 }}><strong>角色变化:</strong> {outlineMerge.characters.map(c => `${c.name}[${c.role}] ${c.originalStatus}→${c.newStatus}`).join('；')}</div>}
            {outlineMerge.items?.length > 0 && <div style={{ marginBottom: 8 }}><strong>道具流转:</strong> {outlineMerge.items.map(i => `${i.name} ${i.previousStatus}→${i.newStatus}`).join('；')}</div>}
            {outlineMerge.factions?.length > 0 && <div style={{ marginBottom: 8 }}><strong>势力变化:</strong> {outlineMerge.factions.map(f => `${f.name} ${f.previousStatus}→${f.newStatus}`).join('；')}</div>}
            {outlineMerge.newLocations?.length > 0 && <div style={{ marginBottom: 8 }}><strong>新地点:</strong> {outlineMerge.newLocations.map(l => l.name).join('、')}</div>}
            {outlineMerge.newForeshadowing?.length > 0 && <div style={{ marginBottom: 8 }}><strong>新增伏笔:</strong> {outlineMerge.newForeshadowing.map(f => f.description).join('；')}</div>}
          </div>
        )}

        <Button onClick={() => navigate('/continuation-detailed')}>查看续写细纲 →</Button>
      </ScrollArea>
    </div>
  )
}
