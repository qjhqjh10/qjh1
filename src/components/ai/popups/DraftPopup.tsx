import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'

interface Props {
  documentKey: string  // note file name, e.g. "灵感记录.md"
}

export function DraftPopup({ documentKey }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projects = useStore(s => s.projects)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const project = projects.find(p => p.id === activeProjectId)
  const projectPath = activeProjectId && projectsBasePath ? `${projectsBasePath}/${activeProjectId}` : ''

  // Load content
  useEffect(() => {
    if (!projectPath || !documentKey) return
    setLoading(true)
    fileService.read(`${projectPath}/notes/${documentKey}`).then(c => {
      setContent(c)
      setLoading(false)
    }).catch(() => { setContent(''); setLoading(false) })
  }, [projectPath, documentKey])

  // Auto-save debounced
  const handleChange = useCallback((value: string) => {
    setContent(value)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!projectPath) return
      try {
        await fileService.write(`${projectPath}/notes/${documentKey}`, value)
        setLastSaved(new Date().toLocaleTimeString())
      } catch (err) { logError('保存草稿失败', err) }
    }, 800)
  }, [projectPath, documentKey])

  // Auto-refresh when AI edits the file
  useEffect(() => {
    if (!fileEditNotify || !projectPath || !documentKey) return
    const expectedPath = `${projectPath}/notes/${documentKey}`.replace(/\\/g, '/')
    if (fileEditNotify.filePath.replace(/\\/g, '/') === expectedPath) {
      setContent(fileEditNotify.newContent)
      setFileEditNotify(null)
    }
    return () => { setFileEditNotify(null) }
  }, [fileEditNotify, projectPath, documentKey])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  if (loading) return <div style={{ padding: 20, color: '#9b8e84', fontSize: 12 }}>加载中...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <textarea
        value={content}
        onChange={e => handleChange(e.target.value)}
        style={{
          flex: 1, border: 'none', outline: 'none', resize: 'none',
          padding: '14px 16px', fontSize: 13, lineHeight: 1.7,
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
          color: '#2d2520',
        }}
        placeholder="在此输入草稿内容...（支持 Markdown）"
      />
      <div style={{ padding: '4px 14px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 9, color: '#9b8e84', display: 'flex', justifyContent: 'space-between' }}>
        <span>{project?.name || ''} / notes / {documentKey}</span>
        <span>{lastSaved ? `已保存 ${lastSaved}` : ''}</span>
      </div>
    </div>
  )
}
