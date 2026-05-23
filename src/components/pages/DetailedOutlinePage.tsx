import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService, dialogService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import Modal from '@/components/common/Modal'
import {
  PlusIcon, TrashIcon, DocumentTextIcon, DocumentArrowDownIcon,
  PencilIcon, MapPinIcon, UserGroupIcon,
} from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { loadDetailedChapters, saveDetailedChapter } from '@/services/chapterService'
import { loadOutlineContent } from '@/services/outlineService'
import { logError } from '@/utils/logger'

export default function DetailedOutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const projects = useStore(s => s.projects)
  const detailedChapters = useStore(s => s.detailedChapters)
  const setDetailedChapters = useStore(s => s.setDetailedChapters)
  const addDetailedChapter = useStore(s => s.addDetailedChapter)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)
  const removeDetailedChapter = useStore(s => s.removeDetailedChapter)
  const outlineContent = useStore(s => s.outlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const characters = useStore(s => s.characters)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const os: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', marginBottom: 8 }
  const ost: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#2d2520', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(0,0,0,0.06)' }
  const osb: React.CSSProperties = { fontSize: 11, lineHeight: 1.6, color: '#4a3f38', whiteSpace: 'pre-wrap' }

  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingChapter, setEditingChapter] = useState<DetailedChapter | null>(null)
  const [editDraft, setEditDraft] = useState<DetailedChapter | null>(null)

  // Novel category from project metadata
  const project = projects.find(p => p.id === activeProjectId)
  const novelCategory = project?.novelCategory || 'general'
  const isErotic = novelCategory === 'erotic'

  useEffect(() => {
    setActivePage('detailed-outline')
    if (!activeProjectId) {
      navigate('/')
      return
    }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)

    const currentOutline = useStore.getState().outlineContent
    if (!currentOutline) {
      loadOutlineContent(pp).then(c => {
        if (c) useStore.getState().setOutlineContent(c)
      })
    }

    setLoading(true)
    loadDetailedChapters(pp).then(setDetailedChapters).finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath])

  // AI file edit → auto-refresh
  useEffect(() => {
    if (!fileEditNotify || !projectPath) return
    const normalized = fileEditNotify.filePath.replace(/\\/g, '/')
    const pp = projectPath.replace(/\\/g, '/')
    if (normalized.includes('/detailed_outline/') && normalized.startsWith(pp)) {
      loadDetailedChapters(projectPath).then(setDetailedChapters)
    }
    setFileEditNotify(null)
  }, [fileEditNotify])

  const saveDetailedChapterToFile = async (ch: DetailedChapter) => {
    await saveDetailedChapter(projectPath, ch)
  }

  const handleNewChapter = async () => {
    const newCh: DetailedChapter = {
      id: nanoid(8),
      title: `章节 ${detailedChapters.length + 1}`,
      description: '',
      summary: '',
      order: detailedChapters.length,
      status: 'incomplete',
      plotOverview: '',
      characters: '',
      location: '',
      keyEvents: '',
      eroticContent: '',
    }
    addDetailedChapter(newCh)
    await saveDetailedChapterToFile(newCh)
  }

  const handleSaveChapter = async (chId: string) => {
    const latest = useStore.getState().detailedChapters.find(c => c.id === chId)
    if (!latest) return
    await saveDetailedChapterToFile(latest)
  }

  const handleDeleteChapter = async (ch: DetailedChapter) => {
    await fileService.deleteFile(`${projectPath}/detailed_outline/${ch.id}.json`)
    removeDetailedChapter(ch.id)
    if (editingChapter?.id === ch.id) {
      setEditingChapter(null)
      setEditDraft(null)
    }
  }

  const handleWriteChapter = (ch: DetailedChapter) => {
    navigate(`/chapter/${ch.id}`)
  }

  const handleExportDetailedOutline = async () => {
    const outputPath = await dialogService.saveFile('小说细纲.txt')
    if (!outputPath) return
    try {
      let content = '小说细纲\n\n'
      for (let i = 0; i < detailedChapters.length; i++) {
        const ch = detailedChapters[i]
        content += `第${i + 1}章: ${ch.title}\n`
        if (ch.plotOverview) content += `剧情概述: ${ch.plotOverview}\n`
        if (ch.characters) content += `角色: ${ch.characters}\n`
        if (ch.location) content += `场景: ${ch.location}\n`
        if (ch.keyEvents) content += `关键事件:\n${ch.keyEvents.split('\n').map(l => `  · ${l}`).join('\n')}\n`
        if (ch.eroticContent) content += `情色剧情: ${ch.eroticContent}\n`
        content += '\n'
      }
      await fileService.write(outputPath, content)
    } catch (err) {
      logError('Failed to export detailed outline', err)
    }
  }

  // ── Modal handlers ──

  const openEditor = (ch: DetailedChapter) => {
    setEditingChapter(ch)
    setEditDraft({ ...ch })
  }

  const closeEditor = () => {
    if (editDraft && editingChapter) {
      updateDetailedChapter(editingChapter.id, editDraft)
      handleSaveChapter(editingChapter.id)
    }
    setEditingChapter(null)
    setEditDraft(null)
  }

  const updateDraft = (field: string, value: string) => {
    if (!editDraft) return
    setEditDraft({ ...editDraft, [field]: value })
  }

  // Auto-save draft on change (debounced 1.5s)
  useEffect(() => {
    if (!editDraft || !editingChapter) return
    const timer = setTimeout(() => {
      updateDetailedChapter(editingChapter.id, editDraft)
      handleSaveChapter(editingChapter.id)
    }, 1500)
    return () => clearTimeout(timer)
  }, [editDraft])

  const modalSave = async () => {
    if (!editDraft || !editingChapter) return
    updateDetailedChapter(editingChapter.id, editDraft)
    await handleSaveChapter(editingChapter.id)
  }

  const modalSaveAndClose = async () => {
    await modalSave()
    setEditingChapter(null)
    setEditDraft(null)
  }

  // ── Card preview helpers ──

  const previewText = (ch: DetailedChapter): string => {
    if (ch.plotOverview) return ch.plotOverview.slice(0, 120) + (ch.plotOverview.length > 120 ? '…' : '')
    if (ch.description) return ch.description.slice(0, 120).replace(/\n/g, ' ') + (ch.description.length > 120 ? '…' : '')
    return ''
  }

  const charPreview = (ch: DetailedChapter): string => {
    if (ch.characters) return ch.characters.slice(0, 60).replace(/\n/g, ' ') + (ch.characters.length > 60 ? '…' : '')
    return ''
  }

  if (!activeProjectId) return null

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: '#9b8e84' }}>加载中...</p>
      </div>
    )
  }

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* Left: Global outline reference */}
      <div style={{
        width: '30%',
        borderRight: '1px solid rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>全局大纲参考</h3>
        </div>
        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
          {(!outlineContent && !worldbuildingContent && characters.length === 0) ? (
            <div style={{ fontSize: 11, color: '#9b8e84', padding: 8 }}>暂无大纲数据，请先在大纲页填写</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {outlineContent && (
                <div style={os}>
                  <div style={ost}>故事剧情</div>
                  <div style={osb}>{outlineContent.slice(0, 500)}{outlineContent.length > 500 ? '...' : ''}</div>
                </div>
              )}
              {worldbuildingContent && (
                <div style={os}>
                  <div style={ost}>世界观</div>
                  <div style={osb}>{worldbuildingContent.slice(0, 500)}{worldbuildingContent.length > 500 ? '...' : ''}</div>
                </div>
              )}
              {characters.length > 0 && (
                <div style={os}>
                  <div style={ost}>角色 ({characters.length})</div>
                  <div style={osb}>
                    {characters.map((c, i) => (
                      <div key={i} style={{ marginBottom: 2, fontSize: 11 }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        {c.role && <span style={{ color: '#9b8e84' }}> — {c.role}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Chapter card grid + novel type selector */}
      <div style={{ flex: '70%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header with novel type selector */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 28px 16px',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>
            章节细纲（{detailedChapters.length}章）
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={handleExportDetailedOutline} icon={<DocumentArrowDownIcon style={{ width: 16, height: 16 }} />} disabled={detailedChapters.length === 0}>
              导出细纲
            </Button>
            <Button size="sm" onClick={handleNewChapter} icon={<PlusIcon style={{ width: 16, height: 16 }} />}>
              新建章节
            </Button>
          </div>
        </div>

        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 28px 24px' }}>
          {/* 2-column card grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
          }}>
            {detailedChapters.map((ch, idx) => {
              const preview = previewText(ch)
              const chars = charPreview(ch)

              return (
                <GlassCard key={ch.id} hover style={{ cursor: 'pointer', minHeight: 160 }}
                  onClick={() => openEditor(ch)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                    onDrop={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'))
                      if (fromIdx === idx || isNaN(fromIdx)) return
                      const updated = [...detailedChapters]
                      const [moved] = updated.splice(fromIdx, 1)
                      updated.splice(idx, 0, moved)
                      const reordered = updated.map((c, i) => ({ ...c, order: i }))
                      setDetailedChapters(reordered)
                      reordered.forEach(c => saveDetailedChapterToFile(c))
                    }}
                  >
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: '#d4ccc4', fontSize: 14, cursor: 'grab', flexShrink: 0 }} title="拖拽排序"
                        onClick={e => e.stopPropagation()}
                      >⠿</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', flexShrink: 0 }}>
                        章节{idx + 1}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 7px', borderRadius: 5,
                        fontSize: 9, fontWeight: 600,
                        background: ch.status === 'completed' ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.06)',
                        color: ch.status === 'completed' ? '#16a34a' : '#ef4444',
                        flexShrink: 0,
                      }}>
                        {ch.status === 'completed' ? '已完成' : '未完成'}
                      </span>
                      <span style={{
                        flex: 1, fontSize: 13, fontWeight: 600, color: '#2d2520',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ch.title || '(未命名)'}
                      </span>
                      {/* Action buttons */}
                      <button onClick={e => { e.stopPropagation(); navigate(`/chapter/${ch.id}`) }}
                        title="撰写本章" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)',
                          background: 'rgba(124,58,237,0.04)', cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: '#7c3aed',
                          flexShrink: 0, transition: 'all 0.1s',
                        }}>
                        <PencilIcon style={{ width: 11, height: 11 }} /> 撰写
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDeleteChapter(ch) }}
                        title="删除本章细纲" style={{
                          display: 'inline-flex', alignItems: 'center',
                          padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.15)',
                          background: 'transparent', cursor: 'pointer',
                          flexShrink: 0, transition: 'all 0.1s',
                        }}>
                        <TrashIcon style={{ width: 13, height: 13, color: '#ef4444' }} />
                      </button>
                    </div>

                    {/* Content preview */}
                    {preview ? (
                      <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.6, flex: 1, overflow: 'hidden' }}>
                        {preview}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: '#c4bdb6', flex: 1, fontStyle: 'italic' }}>
                        点击编辑细纲内容
                      </div>
                    )}

                    {/* Meta footer: characters + location */}
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                      {chars && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          <UserGroupIcon style={{ width: 11, height: 11, color: '#9b8e84', flexShrink: 0 }} /> {chars}
                        </span>
                      )}
                      {ch.location && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          <MapPinIcon style={{ width: 11, height: 11, color: '#9b8e84', flexShrink: 0 }} /> {ch.location.slice(0, 30)}{ch.location.length > 30 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
          {detailedChapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <DocumentTextIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>暂无章节，点击"新建章节"创建</p>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Edit Modal ── */}
      <Modal
        isOpen={!!editingChapter}
        onClose={closeEditor}
        title={editDraft ? `编辑细纲 — ${editDraft.title || '未命名'}` : ''}
        width={800}
      >
        {editDraft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Title + Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="text"
                value={editDraft.title}
                onChange={e => updateDraft('title', e.target.value)}
                style={{
                  flex: 1, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
                  outline: 'none', fontSize: 16, fontWeight: 600, color: '#2d2520',
                  background: '#faf9f8', padding: '8px 12px', fontFamily: 'inherit',
                }}
                placeholder="章节标题"
              />
              <select
                value={editDraft.status}
                onChange={e => updateDraft('status', e.target.value as ChapterStatus)}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
                  fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                  color: editDraft.status === 'completed' ? '#16a34a' : '#ef4444',
                  fontWeight: 600, background: '#faf9f8',
                }}
              >
                <option value="incomplete">未完成</option>
                <option value="completed">已完成</option>
              </select>
            </div>

            {/* 本章剧情概述 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                本章剧情概述
                <span style={{ fontWeight: 400, fontSize: 10, color: '#9b8e84' }}>
                  （建议 150—250 字，当前 {editDraft.plotOverview?.length || 0} 字）
                </span>
              </label>
              <textarea
                value={editDraft.plotOverview || ''}
                onChange={e => updateDraft('plotOverview', e.target.value)}
                className="custom-scrollbar"
                style={{
                  width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 10, outline: 'none', resize: 'vertical',
                  fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                  color: '#4a3f38', background: '#faf9f8', padding: 14,
                  minHeight: 120, maxHeight: 220,
                }}
                placeholder="简要概述本章的剧情走向，包括核心事件、冲突和转折点…"
              />
            </div>

            {/* 出现的角色 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserGroupIcon style={{ width: 14, height: 14, color: '#6b5e54' }} />
                出现的角色
              </label>
              <textarea
                value={editDraft.characters || ''}
                onChange={e => updateDraft('characters', e.target.value)}
                className="custom-scrollbar"
                style={{
                  width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 10, outline: 'none', resize: 'vertical',
                  fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                  color: '#4a3f38', background: '#faf9f8', padding: '10px 14px',
                  minHeight: 80, maxHeight: 160,
                }}
                placeholder={`每行一个角色，格式：角色名 — 性别/年龄/特征描述

示例：
林星辰 — 男，28岁，退役星际舰队指挥官，冷静果断
叶雪 — 女，25岁，星际医官，温柔坚韧`}
              />
            </div>

            {/* 场景地点 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPinIcon style={{ width: 14, height: 14, color: '#6b5e54' }} />
                场景地点
              </label>
              <input
                type="text"
                value={editDraft.location || ''}
                onChange={e => updateDraft('location', e.target.value)}
                style={{
                  width: '100%', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
                  outline: 'none', fontSize: 13, color: '#4a3f38',
                  background: '#faf9f8', padding: '8px 12px', fontFamily: 'inherit',
                }}
                placeholder="例如：星际港口 · 第7停泊区 · 黄昏"
              />
            </div>

            {/* 关键事件 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                关键事件
                <span style={{ fontWeight: 400, fontSize: 10, color: '#9b8e84' }}>
                  （每行一个事件，按发生顺序排列）
                </span>
              </label>
              <textarea
                value={editDraft.keyEvents || ''}
                onChange={e => updateDraft('keyEvents', e.target.value)}
                className="custom-scrollbar"
                style={{
                  width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 10, outline: 'none', resize: 'vertical',
                  fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                  color: '#4a3f38', background: '#faf9f8', padding: '10px 14px',
                  minHeight: 80, maxHeight: 180,
                }}
                placeholder={`每行一个关键事件，例如：
主角抵达星际港口，发现货物被调包
在酒吧与线人接头，获得走私路线图
遭遇星际巡警突击检查，被迫逃亡`}
              />
            </div>

            {/* 情色剧情 — only for erotic novels */}
            {isErotic && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 6, display: 'block' }}>
                  情色剧情
                </label>
                <textarea
                  value={editDraft.eroticContent || ''}
                  onChange={e => updateDraft('eroticContent', e.target.value)}
                  className="custom-scrollbar"
                  style={{
                    width: '100%', border: '1px solid rgba(220,38,38,0.15)',
                    borderRadius: 10, outline: 'none', resize: 'vertical',
                    fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                    color: '#4a3f38', background: '#fef2f2', padding: 14,
                    minHeight: 100, maxHeight: 220,
                  }}
                  placeholder="仅情色小说类型时填写，描述本章的情色剧情内容…"
                />
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <button
                onClick={() => handleDeleteChapter(editDraft)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.2)',
                  background: 'rgba(239,68,68,0.03)', color: '#dc2626',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <TrashIcon style={{ width: 14, height: 14 }} /> 删除本章
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeEditor} style={btnSecondary}>取消</button>
                <button onClick={modalSave} style={btnPrimary}>保存</button>
                <button
                  onClick={() => { modalSaveAndClose(); handleWriteChapter(editDraft) }}
                  style={{
                    padding: '8px 18px', borderRadius: 8, border: 'none',
                    background: '#16a34a', color: '#fff',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  保存并撰写
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
  color: '#6b5e54', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8,
  border: 'none', background: '#7c3aed', color: '#fff',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
