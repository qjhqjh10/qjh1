import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import RichTextEditor from '@/components/common/RichTextEditor'
import { logError } from '@/utils/logger'

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
  const fileName = worldbuilding ? 'worldbuilding.json' : 'outline.json'
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Auto-save debounced
  const handleChange = useCallback((html: string) => {
    setContent(html)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!activeProjectId || !projectsBasePath) return
      const pp = `${projectsBasePath}/${activeProjectId}`
      try {
        const data = { content: html, updatedAt: new Date().toISOString() }
        await fileService.write(`${pp}/outline/${fileName}`, JSON.stringify(data, null, 2))
      } catch (err) { logError(`保存${worldbuilding ? '世界观' : '大纲'}失败`, err) }
    }, 1000)
  }, [activeProjectId, projectsBasePath, fileName, setContent, worldbuilding])

  // Auto-refresh when AI edits the file
  useEffect(() => {
    if (!fileEditNotify || !activeProjectId || !projectsBasePath) return
    const expectedPath = `${projectsBasePath}/${activeProjectId}/outline/${fileName}`.replace(/\\/g, '/')
    if (fileEditNotify.filePath.replace(/\\/g, '/') === expectedPath) {
      try {
        const data = JSON.parse(fileEditNotify.newContent)
        setContent(data.content || fileEditNotify.newContent)
      } catch {
        setContent(fileEditNotify.newContent)
      }
      setFileEditNotify(null)
    }
    return () => { setFileEditNotify(null) }
  }, [fileEditNotify])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  return (
    <RichTextEditor
      content={content}
      onContentChange={handleChange}
      placeholder={worldbuilding ? '在这里编写世界观设定...' : '在这里编写小说基础设定...'}
    />
  )
}
