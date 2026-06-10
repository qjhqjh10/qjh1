import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import WordCount from '@/components/common/WordCount'
import { SkeletonList } from '@/components/common/Skeleton'

interface Props {
  documentKey: string
}

export function DraftPopup({ documentKey }: Props) {
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const fileVersion = useStore(s => s.fileVersion)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [activeNote, setActiveNote] = useState(documentKey)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const notesDir = projectsBasePath ? projectsBasePath.replace(/[/\\]projects[/\\]?$/, '/notes') : ''

  // Load note list
  useEffect(() => {
    if (!notesDir) return
    fileService.listDir(notesDir).then(entries => {
      setNotes(entries.filter((e: string) => e.endsWith('.md')).sort())
    }).catch(() => setNotes([]))
  }, [notesDir, fileVersion])

  // Load content
  useEffect(() => {
    if (!notesDir || !activeNote) { setContent(''); setLoading(false); return }
    setLoading(true)
    fileService.read(`${notesDir}/${activeNote}`).then(c => {
      setContent(c)
      setLoading(false)
    }).catch(() => { setContent(''); setLoading(false) })
  }, [notesDir, activeNote])

  // Auto-save debounced
  const handleChange = useCallback((value: string) => {
    setContent(value)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!notesDir || !activeNote) return
      try {
        await fileService.write(`${notesDir}/${activeNote}`, value)
        setLastSaved(new Date().toLocaleTimeString())
        if (!notes.includes(activeNote)) setNotes(prev => [...prev, activeNote].sort())
      } catch (err) { logError('保存草稿失败', err) }
    }, 800)
  }, [notesDir, activeNote, notes])

  // Auto-refresh when AI edits
  useEffect(() => {
    if (!fileEditNotify || !notesDir || !activeNote) return
    const expectedPath = `${notesDir}/${activeNote}`.replace(/\\/g, '/')
    if (fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase() === expectedPath.toLowerCase()) {
      fileService.read(expectedPath).then(c => setContent(c)).catch(() => {})
      setFileEditNotify(null)
    }
  }, [fileEditNotify, notesDir, activeNote])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const createNew = () => {
    const name = prompt('新草稿名称（不含.md）:')
    if (!name) return
    setActiveNote(`${name}.md`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Note selector */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 6, background: '#faf9f8' }}>
        <select
          value={activeNote || ''}
          onChange={e => setActiveNote(e.target.value)}
          style={{ flex: 1, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit', background: '#fff' }}
        >
          {notes.length === 0 && <option value="">无草稿</option>}
          {notes.map(n => <option key={n} value={n}>{n.replace(/\.md$/, '')}</option>)}
        </select>
        <button onClick={createNew} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+ 新建</button>
      </div>

      {loading ? (
        <div style={{ padding: 20 }}><SkeletonList count={3} /></div>
      ) : (
        <textarea
          value={content}
          onChange={e => handleChange(e.target.value)}
          className="custom-scrollbar"
          style={{
            flex: 1, border: 'none', outline: 'none', resize: 'none',
            padding: '14px 16px', fontSize: 14, lineHeight: 1.8,
            fontFamily: 'inherit', color: '#2d2520', width: '100%',
          }}
          placeholder="在此输入草稿内容..."
        />
      )}

      <div style={{ padding: '4px 14px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 9, color: '#9b8e84', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>notes / {activeNote || '(未选择)'}</span>
        <WordCount text={content} rawText={content} />
        <span>{lastSaved ? `已保存 ${lastSaved}` : ''}</span>
      </div>
    </div>
  )
}
