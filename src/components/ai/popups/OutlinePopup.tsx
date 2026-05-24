import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { htmlToMarkdown, markdownToHtml } from '@/utils/markdownConverter'

interface Props {
  worldbuilding?: boolean
}

export function OutlinePopup({ worldbuilding = false }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const outlineContent = useStore(s => s.outlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const content = worldbuilding ? worldbuildingContent : outlineContent
  const setContent = worldbuilding ? setWorldbuildingContent : setOutlineContent
  const fileName = worldbuilding ? 'worldbuilding.md' : 'plot.md'
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Auto-save debounced (plain text, no JSON wrapper)
  const handleChange = useCallback((text: string) => {
    setContent(text)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!activeProjectId || !projectsBasePath) return
      const pp = `${projectsBasePath}/${activeProjectId}`
      try {
        await fileService.write(`${pp}/outline/${fileName}`, htmlToMarkdown(text))
      } catch (err) { logError(`保存${worldbuilding ? '世界观' : '大纲'}失败`, err) }
    }, 1000)
  }, [activeProjectId, projectsBasePath, fileName, setContent, worldbuilding])

  // Auto-refresh when AI edits the file
  useEffect(() => {
    if (!fileEditNotify || !activeProjectId || !projectsBasePath) return
    const expectedPath = `${projectsBasePath}/${activeProjectId}/outline/${fileName}`.replace(/\\/g, '/')
    if (fileEditNotify.filePath.replace(/\\/g, '/') === expectedPath) {
      if (fileEditNotify.newContent === '__AI_EDITED__') {
        fileService.read(expectedPath).then(c => setContent(markdownToHtml(c))).catch(() => {})
      } else {
        setContent(markdownToHtml(fileEditNotify.newContent))
      }
      setFileEditNotify(null)
    }
    return () => { setFileEditNotify(null) }
  }, [fileEditNotify])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  return (
    <textarea
      value={content}
      onChange={e => handleChange(e.target.value)}
      placeholder={worldbuilding ? '在这里编写世界观设定...' : '在这里与AI讨论和记录故事剧情...'}
      style={{ width: '100%', height: '100%', border: 'none', outline: 'none', resize: 'none', padding: 16, fontSize: 13, lineHeight: 1.8, color: '#2d2520', fontFamily: 'inherit', background: 'transparent' }}
    />
  )
}
