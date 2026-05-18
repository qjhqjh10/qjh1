import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { exportService, dialogService } from '@/services/fileService'
import Modal from './Modal'
import Button from './Button'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  projectPath: string
}

type ExportMode = 'single' | 'merge'
type ExportType = 'summary' | 'body'

export function ChapterExportModal({ isOpen, onClose, projectPath }: Props) {
  const detailedChapters = useStore(s => s.detailedChapters)
  const writingChapters = useStore(s => s.writingChapters)

  const [exportMode, setExportMode] = useState<ExportMode>('single')
  const [exportType, setExportType] = useState<ExportType>('body')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (isOpen) setSelectedIds(new Set(detailedChapters.map(c => c.id)))
  }, [isOpen])

  const toggleChapter = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleExport = async () => {
    if (exportMode === 'single') {
      const first = detailedChapters.find(c => selectedIds.has(c.id))
      if (!first) return
      const content = exportType === 'body' ? writingChapters[first.id]?.content || '' : first.summary || ''
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
            : ch.summary || '暂无摘要',
        }))
      await exportService.exportChapters({ chapters, outputPath, type: exportType })
    }
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="导出章节" width={560}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
        {(['single', 'merge'] as ExportMode[]).map(mode => (
          <button key={mode} onClick={() => setExportMode(mode)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
            background: exportMode === mode ? '#7c3aed' : '#fff',
            color: exportMode === mode ? '#fff' : '#6b5e54',
            fontWeight: exportMode === mode ? 600 : 400,
          }}>
            {mode === 'single' ? '单章导出' : '合并导出'}
          </button>
        ))}
      </div>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleExport} disabled={selectedIds.size === 0}>确定导出</Button>
      </div>
    </Modal>
  )
}
