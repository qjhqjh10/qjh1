import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService, dialogService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import {
  PlusIcon, TrashIcon, DocumentTextIcon, DocumentArrowDownIcon,
  PencilIcon, MapPinIcon, UserGroupIcon,
} from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { loadDetailedChapters, saveDetailedChapter } from '@/services/chapterService'
import { loadOutlineContent } from '@/services/outlineService'
import { logError } from '@/utils/logger'
import { stripHtml } from '@/utils/textUtils'
import { os, ost, osb } from './constants'
import { ChapterCard } from './ChapterCard'
import { ChapterEditModal } from './dialogs/ChapterEditModal'

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

  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingChapter, setEditingChapter] = useState<DetailedChapter | null>(null)
  const [editDraft, setEditDraft] = useState<DetailedChapter | null>(null)

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
    const normalized = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    const pp = projectPath.replace(/\\/g, '/').toLowerCase()
    if (normalized.includes('/detailed_outline/') && normalized.startsWith(pp)) {
      loadDetailedChapters(projectPath).then(setDetailedChapters)
      setFileEditNotify(null)
    }
  }, [fileEditNotify, projectPath])

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
      customContent: '',
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
    await fileService.deleteFile(`${projectPath}/summaries/${ch.id}.md`).catch(() => {})
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
        if (ch.customContent) content += `自定义内容:\n${ch.customContent}\n`
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
        overflow: 'hidden',
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
                  <div style={osb}>{stripHtml(outlineContent).slice(0, 500)}{stripHtml(outlineContent).length > 500 ? '...' : ''}</div>
                </div>
              )}
              {worldbuildingContent && (
                <div style={os}>
                  <div style={ost}>世界观</div>
                  <div style={osb}>{stripHtml(worldbuildingContent).slice(0, 500)}{stripHtml(worldbuildingContent).length > 500 ? '...' : ''}</div>
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

      {/* Right: Chapter card grid */}
      <div style={{ flex: '70%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 16px 24px', overflowX: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            minWidth: 0,
          }}>
            {detailedChapters.map((ch, idx) => (
              <ChapterCard
                key={ch.id}
                chapter={ch}
                index={idx}
                allChapters={detailedChapters}
                previewText={previewText}
                charPreview={charPreview}
                onOpen={openEditor}
                onDelete={handleDeleteChapter}
                onReorder={(updated) => {
                  setDetailedChapters(updated)
                  updated.forEach(c => saveDetailedChapterToFile(c))
                }}
              />
            ))}
          </div>
          {detailedChapters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <DocumentTextIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>暂无章节，点击"新建章节"创建</p>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Edit Modal */}
      <ChapterEditModal
        isOpen={!!editingChapter}
        editDraft={editDraft}
        isErotic={isErotic}
        onClose={closeEditor}
        onUpdate={updateDraft}
        onSave={modalSave}
        onSaveAndWrite={() => { modalSaveAndClose(); handleWriteChapter(editDraft!) }}
        onDelete={handleDeleteChapter}
      />
    </div>
  )
}
