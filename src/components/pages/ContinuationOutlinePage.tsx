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

  const outline = project?.continuationOutline || (project as any)?.inferredOutline
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
        {/* Original understanding summary */}
        <div style={{ marginBottom: 20 }}>
          <div onClick={() => setShowOriginal(!showOriginal)} style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            {showOriginal ? <ChevronDownIcon style={{ width: 12 }} /> : <ChevronRightIcon style={{ width: 12 }} />}
            原作理解摘要 ({analyzed.length}章已分析)
          </div>
          {showOriginal && story && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#faf9f8', fontSize: 11, marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}><strong>主线:</strong> {story.mainPlot}</div>
              <div style={{ marginBottom: 4 }}><strong>未完问题:</strong> {story.unresolvedQuestions?.join('; ') || '无'}</div>
              <div><strong>角色:</strong> {story.characterArcs?.map(c => `${c.name}(${c.currentState},${c.unresolved ? '未完成' : '完成'})`).join('、')}</div>
            </div>
          )}
        </div>

        {/* Continuation outline */}
        {outline ? (
          <div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 12, color: '#6b5e54', flexWrap: 'wrap' }}>
              <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', fontWeight: 600 }}>
                {outline.structure}
              </span>
              <span>续写 {outline.estimatedChapters || '?'} 章</span>
              {outline.ending && (
                <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(236,72,153,0.06)', color: '#ec4899', fontWeight: 600 }}>
                  结局: {outline.ending.type || '?'}
                </span>
              )}
            </div>

            {/* Acts */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>幕/卷结构</div>
              {outline.acts?.map((act: any, i: number) => (
                <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(124,58,237,0.1)', marginBottom: 8, borderLeft: '3px solid #7c3aed' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{act.name}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 6 }}>{act.chapterRange}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.7, color: '#4a3f38' }}>{act.summary}</div>
                  {act.keyEvents?.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {act.keyEvents.map((ev: string, j: number) => (
                        <span key={j} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>{ev}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Turning points */}
            {outline.majorTurningPoints?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 10 }}>关键转折</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {outline.majorTurningPoints.map((tp: any, i: number) => (
                    <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: '#faf9f8', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 700, color: '#f59e0b', flexShrink: 0 }}>第{tp.chapter}章</span>
                      <div><strong>{tp.name}</strong> — {tp.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ending */}
            {outline.ending && (
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(236,72,153,0.04)', border: '1px solid rgba(236,72,153,0.1)', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', marginBottom: 4 }}>结局方向</div>
                <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.7 }}>{outline.ending.description}</div>
              </div>
            )}

            <Button onClick={() => navigate('/continuation-detailed')}>查看续写细纲 →</Button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#4a3f38', marginBottom: 4 }}>暂未生成续写大纲</div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>请在续写工作台中完成前面的步骤后，在步骤4生成</div>
            <Button onClick={() => navigate('/continuation-workspace')}>前往工作台</Button>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
