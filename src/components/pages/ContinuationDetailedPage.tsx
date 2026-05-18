import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { continuationService } from '@/services/fileService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { ArrowLeftIcon, SparklesIcon, CheckCircleIcon, PencilIcon, TrashIcon, PlusIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import type { ContinuationProject, ContinuationChapterPlan } from '@/types/continuation'
import { logError } from '@/utils/logger'
import { inputStyle } from '@/components/common/styles'

export default function ContinuationDetailedPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editPlan, setEditPlan] = useState<ContinuationChapterPlan | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newPoints, setNewPoints] = useState('')
  const [newChars, setNewChars] = useState('')
  const [newTarget, setNewTarget] = useState('3000')

  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId])

  const load = async () => {
    const list = await continuationService.list() as ContinuationProject[]
    const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
    if (found) setProject(found)
  }

  const save = async (plan: ContinuationChapterPlan[]) => {
    if (!project) return
    const updated = { ...project, continuationPlan: { ...project.continuationPlan, chapterPlans: plan, estimatedRemainingChapters: plan.length, overallDirection: project.continuationPlan?.overallDirection || '', majorTwists: project.continuationPlan?.majorTwists || [], endingType: project.continuationPlan?.endingType || 'undetermined' }, updatedAt: new Date().toISOString() }
    const saved = await continuationService.save(updated)
    setProject(saved)
  }

  const plans = project?.continuationPlan?.chapterPlans || []
  const written = project?.writtenChapters || []

  const handleAdd = () => {
    const np: ContinuationChapterPlan = {
      relativeChapterNumber: plans.length + 1, order: plans.length,
      tentativeTitle: newTitle || `续第${plans.length + 1}章`,
      plotPoints: newPoints ? newPoints.split('\n').filter(Boolean) : ['待填充'],
      characterFocus: newChars ? newChars.split(',').map(s => s.trim()) : [],
      foreshadowToResolve: [], foreshadowToPlant: [],
      wordTarget: parseInt(newTarget) || 3000,
    }
    save([...plans, np])
    setNewTitle(''); setNewPoints(''); setNewChars(''); setNewTarget('3000')
  }

  const handleEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditPlan({ ...plans[idx] })
  }

  const handleSaveEdit = async () => {
    if (editingIdx === null || !editPlan) return
    const updated = [...plans]
    updated[editingIdx] = editPlan
    await save(updated)
    setEditingIdx(null); setEditPlan(null)
  }

  const handleDelete = async (idx: number) => {
    const updated = plans.filter((_, i) => i !== idx).map((p, i) => ({ ...p, relativeChapterNumber: i + 1 }))
    await save(updated)
  }

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= plans.length) return
    const updated = [...plans]
    ;[updated[idx], updated[target]] = [updated[target], updated[idx]]
    updated.forEach((p, i) => { p.relativeChapterNumber = i + 1; p.order = i })
    await save(updated)
  }

  const handleEnterWriting = (plan: ContinuationChapterPlan) => {
    navigate('/continuation-workspace')
  }

  const isWritten = (chNum: number) => written.some(w => w.chapterNumber === chNum)
  const outline = project?.continuationOutline || (project as any)?.inferredOutline
  const story = project?.storyUnderstanding

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/continuation-workspace')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>续写细纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{plans.length}章</span>
        <span style={{ fontSize: 11, color: '#16a34a' }}>{written.length}已完成</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/continuation-workspace')} variant="secondary">返回工作台</Button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: outline reference */}
        <div style={{ width: 240, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <ScrollArea style={{ flex: 1, padding: '12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 10 }}>大纲参考</div>
            {story && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>原作理解</div>
                <div style={{ fontSize: 10, color: '#6b5e54', lineHeight: 1.6 }}>{story.mainPlot?.slice(0, 120)}</div>
                <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 4 }}>
                  角色: {story.characterArcs?.slice(0, 5).map(c => c.name).join('、')}
                </div>
              </div>
            )}
            {outline ? (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>续写大纲</div>
                {outline.acts?.map((act: any, i: number) => (
                  <div key={i} style={{ fontSize: 10, padding: '4px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.03)', marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, color: '#7c3aed' }}>{act.name}</div>
                    <div style={{ color: '#9b8e84' }}>{act.chapterRange}</div>
                  </div>
                ))}
                {outline.ending && (
                  <div style={{ fontSize: 9, color: '#ec4899', marginTop: 4, padding: '4px 6px', borderRadius: 4, background: 'rgba(236,72,153,0.04)' }}>
                    结局: {outline.ending.type}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#9b8e84' }}>暂未生成续写大纲</div>
            )}
          </ScrollArea>
        </div>

        {/* Right: chapter plans */}
        <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
        {/* Add new */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px dashed rgba(124,58,237,0.2)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#7c3aed' }}>+ 添加章节</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="标题" style={{ ...inputStyle as any, flex: 1, fontSize: 11 }} />
            <input value={newTarget} onChange={e => setNewTarget(e.target.value)} placeholder="字数" style={{ ...inputStyle as any, width: 70, fontSize: 11 }} />
          </div>
          <textarea value={newPoints} onChange={e => setNewPoints(e.target.value)} placeholder="剧情点（每行一个）" rows={2} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', marginBottom: 6 }} />
          <input value={newChars} onChange={e => setNewChars(e.target.value)} placeholder="角色（逗号分隔）" style={{ ...inputStyle as any, width: '100%', fontSize: 11, marginBottom: 8 }} />
          <Button size="sm" onClick={handleAdd} icon={<PlusIcon style={{ width: 11, height: 11 }} />}>添加</Button>
        </div>

        {/* Chapter plans */}
        {plans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>
            暂无续写细纲。手动添加或前往工作台生成。
          </div>
        ) : (
          plans.map((plan, i) => (
            <div key={i} style={{
              padding: '14px 16px', borderRadius: 12, background: isWritten(plan.relativeChapterNumber) ? 'rgba(22,163,74,0.03)' : '#fff',
              border: editingIdx === i ? '2px solid #7c3aed' : isWritten(plan.relativeChapterNumber) ? '1px solid rgba(22,163,74,0.15)' : '1px solid rgba(0,0,0,0.06)',
              marginBottom: 8,
            }}>
              {editingIdx === i && editPlan ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={editPlan.tentativeTitle} onChange={e => setEditPlan({ ...editPlan, tentativeTitle: e.target.value })} style={{ ...inputStyle as any, flex: 1, fontSize: 12, fontWeight: 600 }} />
                    <input type="number" value={editPlan.wordTarget} onChange={e => setEditPlan({ ...editPlan, wordTarget: parseInt(e.target.value) || 3000 })} style={{ ...inputStyle as any, width: 80, fontSize: 11 }} placeholder="字数" />
                  </div>
                  <textarea value={editPlan.plotPoints.join('\n')} onChange={e => setEditPlan({ ...editPlan, plotPoints: e.target.value.split('\n').filter(Boolean) })} rows={3} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} placeholder="剧情点（每行一个）" />
                  <input value={editPlan.characterFocus.join('、')} onChange={e => setEditPlan({ ...editPlan, characterFocus: e.target.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean) })} style={{ ...inputStyle as any, fontSize: 11 }} placeholder="角色（逗号分隔）" />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditingIdx(null); setEditPlan(null) }}>取消</Button>
                    <Button size="sm" onClick={handleSaveEdit}>保存</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isWritten(plan.relativeChapterNumber)
                        ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>✓ 已完成</span>
                        : <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 12 }}>○ 待续写</span>
                      }
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>
                        续第{plan.relativeChapterNumber}章: {plan.tentativeTitle}
                      </span>
                      <span style={{ fontSize: 10, color: '#9b8e84' }}>~{plan.wordTarget}字</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleMove(i, -1)} disabled={i === 0} style={iconBtn} title="上移"><ArrowUpIcon style={iconS} /></button>
                      <button onClick={() => handleMove(i, 1)} disabled={i === plans.length - 1} style={iconBtn} title="下移"><ArrowDownIcon style={iconS} /></button>
                      <button onClick={() => handleEdit(i)} style={iconBtn} title="编辑"><PencilIcon style={iconS} /></button>
                      <button onClick={() => handleDelete(i)} style={{ ...iconBtn, color: '#ef4444' }} title="删除"><TrashIcon style={iconS} /></button>
                      <Button size="sm" onClick={() => handleEnterWriting(plan)}>续写本章</Button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    <div style={{ color: '#6b5e54', marginBottom: 2 }}>剧情: {plan.plotPoints.join(' → ')}</div>
                    {plan.characterFocus.length > 0 && <div style={{ color: '#9b8e84' }}>角色: {plan.characterFocus.join('、')}</div>}
                  </div>
                  {(plan.foreshadowToResolve.length > 0 || plan.foreshadowToPlant.length > 0) && (
                    <div style={{ fontSize: 10, marginTop: 4 }}>
                      {plan.foreshadowToResolve.length > 0 && <span style={{ color: '#16a34a' }}>回收: {plan.foreshadowToResolve.join('、')} </span>}
                      {plan.foreshadowToPlant.length > 0 && <span style={{ color: '#f59e0b' }}>新埋: {plan.foreshadowToPlant.join('、')}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </ScrollArea>
      </div>{/* end flex container */}
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }
const iconS = { width: 14, height: 14 }
