import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import RichTextEditor from '@/components/common/RichTextEditor'
import { PlusIcon, TrashIcon, MagnifyingGlassIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

interface NoteFile {
  name: string
  projectId: string
  projectName: string
}

export default function ScratchpadPage() {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projects = useStore(s => s.projects)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setActiveProject = useStore(s => s.setActiveProject)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [notes, setNotes] = useState<NoteFile[]>([])
  const [selectedNote, setSelectedNote] = useState<NoteFile | null>(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef(content)

  // Keep contentRef in sync
  useEffect(() => { contentRef.current = content }, [content])

  // Load note list from all projects
  const loadNotes = useCallback(async () => {
    const allNotes: NoteFile[] = []
    for (const p of projects) {
      const pp = `${projectsBasePath}/${p.id}`
      try {
        const entries = await fileService.listDir(`${pp}/notes`)
        for (const name of entries) {
          if (name.endsWith('.md')) {
            allNotes.push({ name, projectId: p.id, projectName: p.name })
          }
        }
      } catch { /* project has no notes/ directory */ }
    }
    setNotes(allNotes)
  }, [projects, projectsBasePath])

  useEffect(() => { loadNotes() }, [loadNotes])

  // Auto-refresh when AI edits a note file
  useEffect(() => {
    if (!fileEditNotify || !selectedNote) return
    const projectsBasePath = useStore.getState().projectsBasePath
    const expectedPath = `${projectsBasePath}/${selectedNote.projectId}/notes/${selectedNote.name}`.replace(/\\/g, '/')
    if (fileEditNotify.filePath.replace(/\\/g, '/') === expectedPath) {
      setContent(fileEditNotify.newContent)
      setFileEditNotify(null)
    }
    return () => { setFileEditNotify(null) }
  }, [fileEditNotify, selectedNote])

  // Load content when selected note changes
  useEffect(() => {
    if (!selectedNote) { setContent(''); setTitle(''); setLastSaved(null); return }
    const pp = `${projectsBasePath}/${selectedNote.projectId}`
    fileService.read(`${pp}/notes/${selectedNote.name}`).then(c => {
      setContent(c)
      setTitle(selectedNote.name.replace(/\.md$/, ''))
      setLastSaved(null)
    }).catch(() => { setContent(''); setTitle(selectedNote.name.replace(/\.md$/, '')) })
  }, [selectedNote, projectsBasePath])

  // Auto-save with debounce
  const scheduleSave = useCallback((newContent: string, note: NoteFile) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        const pp = `${projectsBasePath}/${note.projectId}`
        const fileName = note.name.endsWith('.md') ? note.name : `${note.name}.md`
        await fileService.write(`${pp}/notes/${fileName}`, newContent)
        setLastSaved(new Date().toLocaleTimeString())
      } catch { /* save failed */ }
      setSaving(false)
    }, 800)
  }, [projectsBasePath])

  // Trigger save on content change
  useEffect(() => {
    if (selectedNote && content) {
      scheduleSave(content, selectedNote)
    }
  }, [content, selectedNote, scheduleSave])

  // Cleanup timer
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  // Create new note
  const handleCreate = async () => {
    if (!activeProjectId) return
    const name = `新草稿_${Date.now().toString(36)}.md`
    const pp = `${projectsBasePath}/${activeProjectId}`
    try {
      await fileService.write(`${pp}/notes/${name}`, '')
      await loadNotes()
      const project = projects.find(p => p.id === activeProjectId)
      setSelectedNote({ name, projectId: activeProjectId, projectName: project?.name || '' })
    } catch { /* create failed */ }
  }

  // Rename note
  const handleRename = async () => {
    if (!selectedNote) return
    const newTitle = prompt('新标题:', title)
    if (!newTitle || newTitle === title) return
    const pp = `${projectsBasePath}/${selectedNote.projectId}`
    const oldPath = `${pp}/notes/${selectedNote.name}`
    const newName = `${newTitle}.md`
    const newPath = `${pp}/notes/${newName}`
    try {
      const c = await fileService.read(oldPath)
      await fileService.write(newPath, c)
      await fileService.deleteFile(oldPath)
      await loadNotes()
      const project = projects.find(p => p.id === selectedNote.projectId)
      setSelectedNote({ name: newName, projectId: selectedNote.projectId, projectName: project?.name || '' })
    } catch (e) { /* rename failed, keep old */ }
  }

  // Delete note
  const handleDelete = async () => {
    if (!selectedNote) return
    if (!confirm(`确定删除草稿「${title}」？此操作不可恢复。`)) return
    const pp = `${projectsBasePath}/${selectedNote.projectId}`
    try {
      await fileService.deleteFile(`${pp}/notes/${selectedNote.name}`)
      await loadNotes()
      setSelectedNote(null)
    } catch { /* delete failed */ }
  }

  // Filtered and grouped notes
  const filteredNotes = useMemo(() => {
    const q = search.toLowerCase()
    return notes.filter(n =>
      !q || n.name.toLowerCase().includes(q) || n.projectName.toLowerCase().includes(q)
    )
  }, [notes, search])

  const groupedNotes = useMemo(() => {
    const groups: Record<string, { projectName: string; notes: NoteFile[] }> = {}
    for (const n of filteredNotes) {
      if (!groups[n.projectId]) groups[n.projectId] = { projectName: n.projectName, notes: [] }
      groups[n.projectId].notes.push(n)
    }
    return Object.entries(groups).sort(([, a], [, b]) => a.projectName.localeCompare(b.projectName))
  }, [filteredNotes])

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>草稿本</h2>
        <button
          onClick={handleCreate}
          disabled={!activeProjectId}
          title={!activeProjectId ? '请先打开一个项目' : '新建草稿'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px',
            borderRadius: 10, border: 'none', background: activeProjectId ? '#7c3aed' : '#d4ccc4',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: activeProjectId ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', opacity: activeProjectId ? 1 : 0.6,
          }}
        >
          <PlusIcon style={{ width: 14, height: 14 }} /> 新建
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        {/* Left panel — note list */}
        <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.01)' }}>
          {/* Search */}
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

          {/* Note list */}
          <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
            {groupedNotes.map(([projectId, group]) => (
              <div key={projectId} style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#9b8e84', padding: '6px 8px 4px',
                  textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />
                  {group.projectName}
                </div>
                {group.notes.map(note => (
                  <button
                    key={`${note.projectId}/${note.name}`}
                    onClick={() => setSelectedNote(note)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                      padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: selectedNote?.name === note.name && selectedNote?.projectId === note.projectId
                        ? 'rgba(124,58,237,0.08)' : 'transparent',
                      color: selectedNote?.name === note.name && selectedNote?.projectId === note.projectId
                        ? '#7c3aed' : '#4a3f38',
                      fontSize: 12, fontWeight: selectedNote?.name === note.name && selectedNote?.projectId === note.projectId ? 600 : 400,
                      fontFamily: 'inherit', transition: 'all 0.1s ease',
                    }}
                  >
                    <DocumentTextIcon style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.6 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.name.replace(/\.md$/, '')}
                    </span>
                  </button>
                ))}
              </div>
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
              {/* Title bar */}
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
                <button
                  onClick={handleDelete}
                  title="删除草稿"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                    borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)',
                    color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <TrashIcon style={{ width: 12, height: 12 }} /> 删除
                </button>
              </div>

              {/* Content editor */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <RichTextEditor
                  content={content}
                  onContentChange={setContent}
                  placeholder="在此输入草稿内容...（支持图片和排版）"
                />
              </div>

              {/* Status bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 10, color: '#9b8e84' }}>
                <span>
                  归属项目: <button
                    onClick={() => {
                      if (selectedNote) {
                        setActiveProject(selectedNote.projectId)
                        setActivePage('home')
                      }
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed',
                      fontWeight: 600, fontFamily: 'inherit', fontSize: 10, padding: 0, textDecoration: 'underline',
                    }}
                  >
                    {selectedNote.projectName}
                  </button>
                </span>
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
  )
}
