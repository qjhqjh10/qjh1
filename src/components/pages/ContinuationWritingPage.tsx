import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { continuationService } from '@/services/fileService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import type { ContinuationProject } from '@/types/continuation'

export default function ContinuationWritingPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const setActivePage = useStore(s => s.setActivePage)
  const [project, setProject] = useState<ContinuationProject | null>(null)

  useEffect(() => { setActivePage('continuation-writing') }, [])
  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId])

  const load = async () => {
    const list = await continuationService.list() as ContinuationProject[]
    const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
    if (found) setProject(found)
  }

  const written = project?.writtenChapters || []
  const planChapters = project?.continuationPlan?.chapterPlans || []

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/continuation-workspace')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>续写章节</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{written.length} 章已完成</span>
      </div>
      <ScrollArea style={{ flex: 1, padding: '20px 24px' }}>
        {written.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✍️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#4a3f38', marginBottom: 4 }}>暂未开始续写</div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>请在续写工作台中完成前面步骤后开始续写</div>
            <Button onClick={() => navigate('/continuation-workspace')}>前往工作台</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {written.map((ch, i) => (
              <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircleIcon style={{ width: 14, height: 14, color: '#16a34a' }} />
                  续第{ch.chapterNumber}章: {ch.title}
                  <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{new Date(ch.generatedAt).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#4a3f38' }}>{ch.content.slice(0, 500)}...</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
