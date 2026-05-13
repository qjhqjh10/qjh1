import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { useFileSync } from '@/hooks/useFileSync'
import WordCount from '@/components/common/WordCount'
import Button from '@/components/common/Button'
import RichTextEditor from '@/components/common/RichTextEditor'

export default function WorldbuildingPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)

  const [filePath, setFilePath] = useState<string | null>(null)

  const fileContent = useStore(s => s.worldbuildingContent)
  const setFileContent = useStore(s => s.setWorldbuildingContent)
  const { save } = useFileSync(filePath, fileContent, setFileContent)

  useEffect(() => {
    if (!activeProjectId) {
      navigate('/')
      return
    }
    const path = `${projectsBasePath}/${activeProjectId}/worldbuilding/worldbuilding.txt`
    setFilePath(path)
    fileService.read(path).then(c => { setFileContent(c) })
  }, [activeProjectId, projectsBasePath])

  const handleClear = async () => {
    setFileContent('')
    if (filePath) {
      await fileService.write(filePath, '')
    }
  }

  if (!activeProjectId) return null

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 32px 16px',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
      }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>世界观设定</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <WordCount text={fileContent} />
          <Button variant="secondary" size="sm" onClick={handleClear}>清空</Button>
          <Button size="sm" onClick={save}>保存</Button>
        </div>
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px 24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', display: 'flex' }}>
          <div className="custom-scrollbar" style={{ width: '100%', overflowY: 'auto' }}>
            <RichTextEditor
              content={fileContent}
              onContentChange={setFileContent}
              placeholder="在这里编写你的世界观设定..."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
