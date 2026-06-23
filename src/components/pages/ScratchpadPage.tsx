import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import RichTextEditor from '@/components/common/RichTextEditor'
import { PlusIcon, TrashIcon, MagnifyingGlassIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import WordCount from '@/components/common/WordCount'
import ConfirmModal from '@/components/common/ConfirmModal'
import { htmlToMarkdown } from '@/utils/markdownConverter'

export default function ScratchpadPage() {
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [notes, setNotes] = useState<string[]>([])
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [content, setContent] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [title, setTitle] = useState('')
  const [search, setSearch] = useState('')
  const [showFind, setShowFind] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const notesDir = useMemo(() => {
    if (!projectsBasePath) return ''
    // notes 是全局的，放在 userData/notes/（与 AI 工具 + notes:search 统一）
    return projectsBasePath.replace(/[/\\]projects[/\\]?$/, '/notes').replace(/\\/g, '/')
  }, [projectsBasePath])

  const notePath = useCallback((name: string) => `${notesDir}/${name}`, [notesDir])

  useEffect(() => { setActivePage('scratchpad') }, [setActivePage])

  const loadNotes = useCallback(async () => {
    if (!notesDir) return
    try {
      const entries = await fileService.listDir(notesDir)
      setNotes(entries.filter((e: string) => e.endsWith('.md')).sort())
    } catch { setNotes([]) }
  }, [notesDir])

  useEffect(() => { loadNotes() }, [loadNotes])

  // AI 修改 notes 目录 → 刷新笔记列表
  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('notes/')) {
      loadNotes()
    }
  }, [fileEditNotify])
  // Sync raw content for character count (content may be HTML from RichTextEditor)
  useEffect(() => {
    if (/<[a-zA-Z][^>]*>/.test(content)) setRawContent(htmlToMarkdown(content))
  }, [content])

  // Auto-refresh when AI edits a note
  useEffect(() => {
    if (!fileEditNotify || !selectedNote) return
    const expectedPath = notePath(selectedNote)
    if (fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase() === expectedPath.toLowerCase()) {
      fileService.read(expectedPath).then(c => { setContent(c); setRawContent(c) }).catch(() => {})
      setFileEditNotify(null)
    }
  }, [fileEditNotify, selectedNote, notePath, setFileEditNotify])

  // Load content when selected note changes
  useEffect(() => {
    if (!selectedNote) { setContent(''); setTitle(''); setLastSaved(null); return }
    const pp = notePath(selectedNote)
    fileService.read(pp).then(c => {
      setContent(c)
      setRawContent(c)
      setTitle(selectedNote.replace(/\.md$/, ''))
      setLastSaved(null)
    }).catch(() => { setContent(''); setTitle(selectedNote.replace(/\.md$/, '')) })
  }, [selectedNote, notePath])

  // Auto-save with debounce
  const scheduleSave = useCallback((newContent: string, noteName: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fileService.write(notePath(noteName), newContent)
        setLastSaved(new Date().toLocaleTimeString())
      } catch { /* */ }
      setSaving(false)
    }, 800)
  }, [notePath])

  useEffect(() => {
    if (selectedNote && content) scheduleSave(content, selectedNote)
  }, [content, selectedNote, scheduleSave])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const handleCreate = async () => {
    if (!notesDir) return
    const name = `新草稿_${Date.now().toString(36)}.md`
    try {
      await fileService.write(`${notesDir}/${name}`, '')
      await loadNotes()
      setSelectedNote(name)
    } catch (err) { logError('创建草稿失败', err); alert('创建草稿失败') }
  }

  const handleRename = async () => {
    if (!selectedNote) return
    const newTitle = prompt('新标题:', title)
    if (!newTitle || newTitle === title) return
    const newName = `${newTitle}.md`
    try {
      const c = await fileService.read(notePath(selectedNote))
      await fileService.write(notePath(newName), c)
      await fileService.deleteFile(notePath(selectedNote))
      await loadNotes()
      setSelectedNote(newName)
    } catch (err) { logError('重命名草稿失败', err) }
  }

  const handleDelete = async () => {
    if (!selectedNote) return
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    if (!selectedNote) return
    try {
      await fileService.deleteFile(notePath(selectedNote))
      await loadNotes()
      setSelectedNote(null)
    } catch (err) { logError('删除草稿失败', err) }
    setShowDeleteConfirm(false)
  }

  const filteredNotes = useMemo(() => {
    const q = search.toLowerCase()
    return notes.filter(n => !q || n.toLowerCase().includes(q))
  }, [notes, search])

  return (
    <>
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>草稿本</h2>
        <button
          onClick={handleCreate}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px',
            borderRadius: 10, border: 'none', background: '#7c3aed',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <PlusIcon style={{ width: 14, height: 14 }} /> 新建
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        {/* Left panel — note list */}
        <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.01)' }}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.03)' }}>
              <MagnifyingGlassIcon style={{ width: 13, height: 13, color: '#9b8e84', flexShrink: 0 }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索草稿..."
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: '#2d2520', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
            {filteredNotes.map(note => (
              <button
                key={note}
                onClick={() => setSelectedNote(note)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                  padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: selectedNote === note ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: selectedNote === note ? '#7c3aed' : '#4a3f38',
                  fontSize: 12, fontWeight: selectedNote === note ? 600 : 400,
                  fontFamily: 'inherit', transition: 'all 0.1s ease',
                }}
              >
                <DocumentTextIcon style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.6 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {note.replace(/\.md$/, '')}
                </span>
              </button>
            ))}
            {filteredNotes.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#9b8e84' }}>
                {search ? '无匹配草稿' : '暂无草稿\n点击"新建"创建第一个草稿'}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedNote ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={handleRename}
                  style={{
                    flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 700,
                    color: '#2d2520', background: 'transparent', fontFamily: 'inherit',
                  }}
                  placeholder="草稿标题"
                />
                <button onClick={() => setShowFind(!showFind)} title="查找替换" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: showFind ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.6)',
                  color: showFind ? '#7c3aed' : '#6b5e54', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <MagnifyingGlassIcon style={{ width: 12, height: 12 }} /> 查找
                </button>
                <button
                  onClick={handleDelete}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                    borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)',
                    color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <TrashIcon style={{ width: 12, height: 12 }} /> 删除
                </button>
              </div>

              <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
                <RichTextEditor
                  content={content}
                  onContentChange={setContent}
                  placeholder="在此输入草稿内容...（支持图片和排版）"
                  showFind={showFind}
                  onToggleFind={() => setShowFind(!showFind)}
                />
              </div>

              <div style={{ padding: '8px 20px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 10, color: '#9b8e84', display: 'flex', justifyContent: 'space-between' }}>
                <WordCount text={content} rawText={rawContent} />
                <span>{saving ? '保存中...' : lastSaved ? `已保存 ${lastSaved}` : ''}</span>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 13 }}>
              选择左侧草稿开始编辑，或点击"新建"创建草稿
            </div>
          )}
        </div>
      </div>
    </div>
    {/* 草稿删除确认 */}
    {showDeleteConfirm && selectedNote && (
      <ConfirmModal
        isOpen={true}
        title="删除草稿"
        message={`确定要删除草稿「${selectedNote}」？此操作不可恢复。`}
        confirmLabel="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    )}
    </>
  )
}
