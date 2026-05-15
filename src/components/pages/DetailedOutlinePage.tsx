import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService, dialogService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, DocumentTextIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { loadDetailedChapters, saveDetailedChapter } from '@/services/chapterService'

export default function DetailedOutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const detailedChapters = useStore(s => s.detailedChapters)
  const setDetailedChapters = useStore(s => s.setDetailedChapters)
  const addDetailedChapter = useStore(s => s.addDetailedChapter)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)
  const removeDetailedChapter = useStore(s => s.removeDetailedChapter)
  const outlineContent = useStore(s => s.outlineContent)

  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeProjectId) {
      navigate('/')
      return
    }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)

    if (!outlineContent) {
      fileService.read(`${pp}/outline/outline.txt`).then(c => {
        useStore.getState().setOutlineContent(c)
      })
    }

    setLoading(true)
    loadDetailedChapters(pp).then(setDetailedChapters).finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath])

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
      status: 'outline',
    }
    addDetailedChapter(newCh)
    await saveDetailedChapterToFile(newCh)
  }

  const handleSaveChapter = async (chId: string) => {
    // Read latest from store to avoid stale closure
    const latest = useStore.getState().detailedChapters.find(c => c.id === chId)
    if (!latest) return
    await saveDetailedChapterToFile(latest)
  }

  const handleDeleteChapter = async (ch: DetailedChapter) => {
    await fileService.deleteFile(`${projectPath}/detailed_outline/${ch.id}.json`)
    removeDetailedChapter(ch.id)
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
        if (ch.description) content += `描述: ${ch.description}\n`
        if (ch.summary) content += `摘要: ${ch.summary}\n`
        content += '\n'
      }
      await fileService.write(outputPath, content)
    } catch (err) {
      console.error('Failed to export detailed outline:', err)
    }
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
        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 16 }}>
          <div style={{
            fontSize: 13,
            lineHeight: 1.7,
            color: '#4a3f38',
            whiteSpace: 'pre-wrap',
          }}>
            {outlineContent || '暂无大纲内容'}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Chapter list */}
      <div style={{ flex: '70%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 28px 16px',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>
            章节预览（{detailedChapters.length}章）
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {detailedChapters.map((ch, idx) => (
              <GlassCard key={ch.id} hover={false}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                  onDrop={e => {
                    e.preventDefault()
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
                  <div style={{ display: 'flex', alignItems: 'center', color: '#d4ccc4', fontSize: 16, cursor: 'grab', paddingTop: 2 }} title="拖拽排序">⠿</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Title row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <span style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#7c3aed',
                        flexShrink: 0,
                      }}>
                        章节{idx + 1}
                      </span>
                      <select
                        value={ch.status || 'outline'}
                        onChange={e => {
                          updateDetailedChapter(ch.id, { ...ch, status: e.target.value as ChapterStatus })
                          handleSaveChapter(ch.id)
                        }}
                        style={{
                          padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)',
                          fontSize: 10, fontFamily: 'inherit', cursor: 'pointer',
                          color: { outline: '#f59e0b', draft: '#e67e00', revising: '#2563eb', final: '#16a34a' }[ch.status || 'outline'],
                          background: 'transparent', flexShrink: 0,
                        }}
                        title="章节状态"
                      >
                        <option value="outline">🟡 大纲</option>
                        <option value="draft">🟠 初稿</option>
                        <option value="revising">🔵 修改中</option>
                        <option value="final">🟢 定稿</option>
                      </select>
                      <input
                        type="text"
                        value={ch.title}
                        onChange={e => updateDetailedChapter(ch.id, { ...ch, title: e.target.value })}
                        style={{
                          flex: 1,
                          border: 'none',
                          borderBottom: '1px solid transparent',
                          outline: 'none',
                          fontSize: 15,
                          fontWeight: 600,
                          color: '#2d2520',
                          background: 'transparent',
                          padding: '2px 0',
                        }}
                        onFocus={e => { e.target.style.borderBottomColor = '#7c3aed' }}
                        onBlur={e => { e.target.style.borderBottomColor = 'transparent'; handleSaveChapter(ch.id) }}
                        placeholder="章节标题"
                      />
                      <Button size="sm" variant="ghost" onClick={() => handleSaveChapter(ch.id)}>
                        保存
                      </Button>
                      <button
                        onClick={() => handleWriteChapter(ch)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 12,
                          border: 'none',
                          background: '#7c3aed',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        撰写本章
                      </button>
                      <button
                        onClick={() => handleDeleteChapter(ch)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4', display: 'flex' }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.color = '#dc2626' }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.color = '#d4ccc4' }}
                      >
                        <TrashIcon style={{ width: 16, height: 16 }} />
                      </button>
                    </div>

                    {/* Description */}
                    <textarea
                      value={ch.description}
                      onChange={e => updateDetailedChapter(ch.id, { ...ch, description: e.target.value })}
                      onBlur={() => handleSaveChapter(ch.id)}
                      placeholder="描述输入框..."
                      className="custom-scrollbar"
                      style={{
                        width: '100%',
                        border: '1px solid rgba(0,0,0,0.06)',
                        borderRadius: 10,
                        outline: 'none',
                        resize: 'none',
                        fontSize: 15,
                        lineHeight: 1.8,
                        fontFamily: 'inherit',
                        color: '#4a3f38',
                        background: '#faf9f8',
                        padding: 14,
                        minHeight: 140,
                        maxHeight: 240,
                        overflowY: 'auto',
                      }}
                    />
                  </div>
                </div>
              </GlassCard>
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
    </div>
  )
}
