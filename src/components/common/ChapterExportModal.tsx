import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { exportService, dialogService } from '@/services/fileService'
import Modal from './Modal'
import Button from './Button'
import { CheckCircleIcon, BookOpenIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  projectPath: string
}

type ExportMode = 'single' | 'merge' | 'epub'
type ExportType = 'summary' | 'body'

export function ChapterExportModal({ isOpen, onClose, projectPath }: Props) {
  const detailedChapters = useStore(s => s.detailedChapters)
  const writingChapters = useStore(s => s.writingChapters)
  const chapterSummaryMap = useStore(s => s.chapterSummaryMap)
  const activeProjectName = useStore(s => s.activeProjectName) || '未命名项目'

  const [exportMode, setExportMode] = useState<ExportMode>('single')
  const [exportType, setExportType] = useState<ExportType>('body')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [epubAuthor, setEpubAuthor] = useState('')

  useEffect(() => {
    if (isOpen) setSelectedIds(new Set(detailedChapters.map(c => c.id)))
  }, [isOpen])

  const toggleChapter = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const [exportError, setExportError] = useState('')

  const handleExport = async () => {
    if (exportMode === 'epub') {
      const chapters = detailedChapters
        .filter(c => selectedIds.has(c.id))
        .sort((a, b) => a.order - b.order)
        .map((ch, idx) => ({
          title: `第${idx + 1}章 ${ch.title}`,
          content: writingChapters[ch.id]?.content || '',
        }))
      if (chapters.length === 0) return
      const outputPath = await dialogService.saveFile(
        `${activeProjectName}.epub`.replace(/[<>:"/\\|?*]/g, '_'),
      )
      if (!outputPath) return
      // v14.6.1: 导出失败可见（原为 unhandled rejection，用户点了导出毫无反馈）
      try {
        await exportService.exportEpub({
          title: activeProjectName,
          author: epubAuthor || '未知作者',
          chapters,
          outputPath,
        })
      } catch (e) {
        setExportError(e instanceof Error ? e.message : '导出失败，请重试')
        return
      }
      onClose()
      return
    }

    try {
      if (exportMode === 'single') {
        const first = detailedChapters.find(c => selectedIds.has(c.id))
        if (!first) return
        const content = exportType === 'body' ? writingChapters[first.id]?.content || '' : chapterSummaryMap[first.id] || ''
        const outputPath = await dialogService.saveFile(`${first.title}.txt`)
        if (!outputPath) return
        await exportService.exportSingleChapter({ title: first.title, content, outputPath })
      } else {
        const outputPath = await dialogService.saveFile('小说合并导出.txt')
        if (!outputPath) return
        const chapters = detailedChapters
          .filter(c => selectedIds.has(c.id))
          .sort((a, b) => a.order - b.order)
          .map((ch, idx) => ({
            title: `第${idx + 1}章 ${ch.title}`,
            content: exportType === 'body'
              ? writingChapters[ch.id]?.content || ''
              : chapterSummaryMap[ch.id] || '暂无摘要',
          }))
        await exportService.exportChapters({ chapters, outputPath, type: exportType })
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败，请重试')
      return
    }
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="导出章节" width={560} draggable resizable>
      {/* Export mode selector */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
        {(['single', 'merge', 'epub'] as ExportMode[]).map(mode => (
          <button key={mode} onClick={() => setExportMode(mode)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
            background: exportMode === mode ? '#7c3aed' : '#fff',
            color: exportMode === mode ? '#fff' : '#6b5e54',
            fontWeight: exportMode === mode ? 600 : 400,
          }}>
            {mode === 'single' ? '单章导出' : mode === 'merge' ? '合并导出' : 'EPUB 电子书'}
          </button>
        ))}
      </div>

      {/* Content type (TXT modes only) */}
      {exportMode !== 'epub' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['body', 'summary'] as ExportType[]).map(type => (
              <button key={type} onClick={() => setExportType(type)} style={{
                flex: 1, padding: '12px 16px', borderRadius: 14,
                border: exportType === type ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.06)',
                background: exportType === type ? 'rgba(124,58,237,0.06)' : '#fff',
                cursor: 'pointer', textAlign: 'center',
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: exportType === type ? '#7c3aed' : '#4a3f38' }}>
                  {type === 'body' ? '章节正文' : '章节摘要'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* EPUB info */}
      {exportMode === 'epub' && (
        <div style={{
          marginBottom: 16, padding: 14, borderRadius: 14,
          background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <BookOpenIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>EPUB 3.0 标准电子书</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 3 }}>书名</label>
              <input type="text" value={activeProjectName} disabled style={{
                width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
                fontSize: 12, background: '#f5f3f0', color: '#6b5e54', fontFamily: 'inherit',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 3 }}>作者</label>
              <input type="text" value={epubAuthor} onChange={e => setEpubAuthor(e.target.value)} placeholder="作者名" style={{
                width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
                fontSize: 12, background: '#fff', color: '#2d2520', fontFamily: 'inherit', outline: 'none',
              }} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#9b8e84' }}>
            章节中的图片将自动提取嵌入 EPUB。可在手机、Kindle、Apple Books 等设备阅读。
          </div>
        </div>
      )}

      {/* Chapter selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#6b5e54', fontWeight: 600 }}>
          已选择章节 {selectedIds.size}/{detailedChapters.length}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set(detailedChapters.map(c => c.id)))}>全选</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>取消全选</Button>
        </div>
      </div>
      <div className="custom-scrollbar" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {detailedChapters.map((ch, idx) => (
            <button key={ch.id} onClick={() => toggleChapter(ch.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)',
              background: selectedIds.has(ch.id) ? 'rgba(124,58,237,0.04)' : '#fff',
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: 6,
                border: selectedIds.has(ch.id) ? '2px solid #7c3aed' : '2px solid #d9d2cc',
                background: selectedIds.has(ch.id) ? '#7c3aed' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {selectedIds.has(ch.id) && <CheckCircleIcon style={{ width: 14, height: 14, color: '#fff' }} />}
              </div>
              <span style={{ fontSize: 13, color: '#4a3f38', fontWeight: selectedIds.has(ch.id) ? 600 : 400 }}>
                章节{idx + 1}: {ch.title || '未命名'}
              </span>
            </button>
          ))}
        </div>
      </div>
      {exportError && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)',
          fontSize: 12, color: '#b91c1c',
        }}>
          {exportError}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleExport} disabled={selectedIds.size === 0}>
          {exportMode === 'epub' ? '导出 EPUB' : '确定导出'}
        </Button>
      </div>
    </Modal>
  )
}
