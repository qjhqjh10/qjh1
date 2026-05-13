import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { useFileSync } from '@/hooks/useFileSync'
import { loadCharacters } from '@/components/pages/CharactersPage'
import WordCount from '@/components/common/WordCount'
import Button from '@/components/common/Button'
import RichTextEditor from '@/components/common/RichTextEditor'
import ScrollArea from '@/components/common/ScrollArea'
import { UserIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import type { Character } from '@/types/character'

export default function OutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileContent = useStore(s => s.outlineContent)
  const setFileContent = useStore(s => s.setOutlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const characters = useStore(s => s.characters)

  const [filePath, setFilePath] = useState<string | null>(null)
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const { save } = useFileSync(filePath, fileContent, setFileContent)

  const handleClearOutline = useCallback(async () => {
    setFileContent('')
    if (filePath) {
      await fileService.write(filePath, '')
    }
  }, [filePath, setFileContent])

  useEffect(() => {
    if (!activeProjectId) {
      navigate('/')
      return
    }
    const pp = `${projectsBasePath}/${activeProjectId}`
    const path = `${pp}/outline/outline.txt`
    setFilePath(path)

    fileService.read(path).then(c => { setFileContent(c) })

    // Load worldbuilding for reference
    if (!worldbuildingContent) {
      fileService.read(`${pp}/worldbuilding/worldbuilding.txt`).then(c => {
        useStore.getState().setWorldbuildingContent(c)
      })
    }
    // Load characters if store is empty (e.g. first visit to project)
    if (characters.length === 0) {
      loadCharacters(pp).then(chars => {
        useStore.getState().setCharacters(chars)
      })
    }
  }, [activeProjectId, projectsBasePath])

  if (!activeProjectId) return null

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Main body: 3:7 split */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* ====== LEFT PANEL (30%) ====== */}
        <div style={{
          width: '30%',
          minWidth: 260,
          borderRight: '1px solid rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.35)',
        }}>
          {/* Top: Worldbuilding reference (60%) */}
          <div style={{ height: '60%', display: 'flex', flexDirection: 'column', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px 10px' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>世界观</h3>
            </div>
            <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 18px 14px' }}>
              <div style={{
                fontSize: 12,
                lineHeight: 1.7,
                color: '#4a3f38',
                whiteSpace: 'pre-wrap',
              }}>
                {worldbuildingContent || '暂无世界观设定'}
              </div>
            </ScrollArea>
          </div>

          {/* Bottom: Characters */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {selectedChar ? (
              /* Character detail view (in-place, left panel) */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setSelectedChar(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#7c3aed', display: 'flex' }}
                  >
                    <ArrowLeftIcon style={{ width: 16, height: 16 }} />
                  </button>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>{selectedChar.name || '未命名'}</span>
                  {selectedChar.role && (
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontWeight: 600 }}>
                      {selectedChar.role}
                    </span>
                  )}
                </div>
                <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <CharDetail label="性别" value={selectedChar.gender} />
                    <CharDetail label="年龄" value={selectedChar.age} />
                    <CharDetail label="职业/身份" value={selectedChar.occupation} />
                    <CharDetail label="背景设定" value={selectedChar.background} />
                    <CharDetail label="外观特征" value={selectedChar.appearance} />
                    <CharDetail label="性格特征" value={selectedChar.personality} />
                    <CharDetail label="能力" value={selectedChar.abilities} />
                    <CharDetail label="弱点" value={selectedChar.weaknesses} />
                    <CharDetail label="角色关系网" value={selectedChar.relationships} />
                    <CharDetail label="角色成长弧线" value={selectedChar.arc} />
                  </div>
                </ScrollArea>
              </div>
            ) : (
              /* Character card list */
              <>
                <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>角色</h3>
                  <span style={{ fontSize: 11, color: '#9b8e84' }}>{characters.length}个</span>
                </div>
                <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 14px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...characters].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).map(char => (
                      <button
                        key={char.id}
                        onClick={() => setSelectedChar(char)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid rgba(0,0,0,0.05)',
                          background: '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <UserIcon style={{ width: 14, height: 14, color: '#7c3aed', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{char.name || '未命名'}</span>
                          {char.role && (
                            <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{char.role}</span>
                          )}
                        </div>
                        {char.personality && (
                          <p style={{ fontSize: 11, color: '#6b5e54', marginTop: 4, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {char.personality}
                          </p>
                        )}
                      </button>
                    ))}
                    {characters.length === 0 && (
                      <div style={{ textAlign: 'center', padding: 20, color: '#9b8e84', fontSize: 12 }}>
                        暂无角色
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>

        {/* ====== RIGHT PANEL (70%) - Outline Editor ====== */}
        <div style={{
          flex: '70%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Top bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 28px',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
          }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>小说大纲构思</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <WordCount text={fileContent} />
              <Button variant="secondary" size="sm" onClick={handleClearOutline}>清空内容</Button>
              <Button size="sm" onClick={save}>保存</Button>
            </div>
          </div>

          {/* Editor body */}
          <div style={{ flex: 1, overflow: 'hidden', padding: '12px 28px 24px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', height: '100%' }}>
              <div className="custom-scrollbar" style={{ height: '100%', overflowY: 'auto' }}>
                <RichTextEditor
                  content={fileContent}
                  onContentChange={setFileContent}
                  placeholder="在这里编写你的小说大纲..."
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CharDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#4a3f38' }}>{value}</div>
    </div>
  )
}
