import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { loadCharacters, saveCharacter, parseCharacterFromAI, normalizeRole } from '@/services/characterService'
import { loadWorldbuildingContent } from '@/services/outlineService'
import { nanoid } from 'nanoid'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { SkeletonList } from '@/components/common/Skeleton'
import ImageLightbox from '@/components/common/ImageLightbox'
import CharacterForm from '../CharacterForm'
import RelationshipGraphModal from '@/components/common/RelationshipGraphModal'
import { PlusIcon, SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import type { Character } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import { logError } from '@/utils/logger'
import { AI_FORMAT_INSTRUCTION, type CharactersPanelProps } from './constants'
import { CharacterGrid } from './CharacterGrid'
import { AICharacterGenerateDialog } from './dialogs/AICharacterGenerateDialog'
import { useRelationshipGraph } from './hooks/useRelationshipGraph'

export default function CharactersPanel({ showWorldbuildingPanel = true, standalone = true }: CharactersPanelProps) {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const fileVersion = useStore(s => s.fileVersion)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const characters = useStore(s => s.characters)
  const setCharacters = useStore(s => s.setCharacters)
  const removeCharacter = useStore(s => s.removeCharacter)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)

  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const promptTemplates = useSettingsStore(s => s.prompts)

  const [editingChar, setEditingChar] = useState<Character | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(true)

  const [showAIGen, setShowAIGen] = useState(false)
  const [aiGenDesc, setAiGenDesc] = useState('')
  const [aiGenLoading, setAiGenLoading] = useState(false)
  const [aiGenConfigId, setAiGenConfigId] = useState(activeConfigId)
  const [aiGenImageNote, setAiGenImageNote] = useState('')

  const graph = useRelationshipGraph({ projectPath, activeProjectId, activeConfigId })

  const openLightbox = async (image: string, pp: string) => {
    if (image.startsWith('data:')) { setLightboxImage(image); return }
    if (!pp) return
    const imagePath = image.includes('/') ? image : `images/${image}`
    const ext = image.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    try {
      const b64 = await fileService.readBinary(`${pp}/${imagePath}`)
      if (b64) setLightboxImage(`data:${mime};base64,${b64}`)
    } catch { /* silently fail */ }
  }

  useEffect(() => {
    if (!activeProjectId) { if (standalone) navigate('/'); return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    if (!worldbuildingContent) {
      loadWorldbuildingContent(pp).then(c => {
        if (c) useStore.getState().setWorldbuildingContent(c)
      })
    }
    setLoading(true)
    loadCharacters(pp).then(setCharacters).finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath, fileVersion])

  useEffect(() => {
    const p = (fileEditNotify?.filePath || '').replace(/\\/g, '/').toLowerCase()
    if (p.includes('/characters/') && activeProjectId) {
      const pp = `${projectsBasePath}/${activeProjectId}`
      loadCharacters(pp).then(setCharacters)
      setFileEditNotify(null)
    }
  }, [fileEditNotify])

  const handleNew = () => {
    setEditingChar({ ...EMPTY_CHARACTER, id: nanoid(8) })
    setShowModal(true)
  }

  const handleEdit = (char: Character) => {
    setEditingChar({ ...char })
    setShowModal(true)
  }

  const handleDelete = async (char: Character) => {
    await fileService.deleteFile(`${projectPath}/characters/${char.id}.yaml`)
    removeCharacter(char.id)
  }

  const handleUploadImage = (char: Character) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async () => {
        let imagePath: string | undefined
        try {
          const fn = await fileService.saveImageUrl(reader.result as string, projectPath)
          if (fn) imagePath = fn
        } catch { /* fallback to base64 */ }
        const updatedChar: Character = { ...char, image: imagePath || reader.result as string }
        await saveCharacter(projectPath, updatedChar)
        const refreshed = await loadCharacters(projectPath)
        setCharacters(refreshed)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleSave = async () => {
    if (!editingChar || !editingChar.name.trim()) return
    const isNew = !characters.find(c => c.id === editingChar.id)
    await saveCharacter(projectPath, editingChar)
    setShowModal(false)
    setEditingChar(null)
    const refreshedChars = await loadCharacters(projectPath)
    setCharacters(refreshedChars)
    if (graph.showGraph && isNew) {
      graph.handleAnalyzeRelationships(true, refreshedChars, graph.graphData)
    }
  }

  const handleAIGenerate = async () => {
    const genConfigId = aiGenConfigId || activeConfigId
    if (!aiGenDesc.trim() || !genConfigId) return
    setAiGenLoading(true)
    try {
      const rolePrompt = promptTemplates.find(p => p.type === '角色' && p.enabled)
      const rolePromptContent = rolePrompt?.content || ''
      const messages = [{
        role: 'user' as const,
        content: `${rolePromptContent ? `[提示词模板]\n${rolePromptContent}\n\n` : ''}[格式要求]\n${AI_FORMAT_INSTRUCTION}\n\n[用户需求]\n请根据以下描述生成角色：\n${aiGenDesc}`,
      }]
      const reply = await chatAI(messages, genConfigId, activeProjectId || undefined)
      const parsed = parseCharacterFromAI(reply)
      const imagePromptMatch = reply.match(/形象图描述[:：]\s*(.+)/)
      const imagePrompt = imagePromptMatch?.[1]?.trim() || ''
      let characterImage: string | undefined
      let note = ''
      if (imagePrompt && projectPath) {
        try {
          const results = await aiService.executeFileTools([{
            callId: nanoid(6), toolName: 'search_images', args: { query: imagePrompt, count: 1 },
          }])
          const r = results[0]
          if (r?.status === 'success' && r?.detail) {
            const detail = JSON.parse(r.detail) as { path: string; description: string }[]
            if (detail.length > 0) { characterImage = detail[0].path } else { note = '未找到匹配图片，可手动上传' }
          } else {
            note = r?.status === 'error' ? `图片搜索失败: ${r.summary}` : '图片搜索暂不可用'
          }
        } catch { note = '图片搜索暂不可用（可能限流或网络问题）' }
      }
      setAiGenImageNote(note)
      const newChar: Character = { ...EMPTY_CHARACTER, id: nanoid(8), ...parsed, image: characterImage }
      setEditingChar(newChar)
      setShowAIGen(false)
      setAiGenDesc('')
      setShowModal(true)
    } catch (err) {
      logError('AI generate character failed', err)
      alert(`AI 生成角色失败: ${err instanceof Error ? err.message : '未知错误'}`)
    }
    setAiGenLoading(false)
  }

  if (!activeProjectId) return null

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* Left: Worldbuilding reference */}
      {showWorldbuildingPanel && (
        <div className="glass" style={{ width: '30%', borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>世界观设定框</h3>
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 16 }}>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#4a3f38', whiteSpace: 'pre-wrap' }}>
              {worldbuildingContent || '暂无世界观设定'}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Right: Character grid */}
      <div className="glass" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 16px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>角色档案库</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => { setAiGenConfigId(activeConfigId); setAiGenImageNote(''); setShowAIGen(true) }}
              disabled={!activeConfigId && configs.length === 0}
              icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>AI生成角色</Button>
            <Button onClick={handleNew} icon={<PlusIcon style={{ width: 16, height: 16 }} />} variant="secondary">新建角色</Button>
            <Button onClick={graph.handleOpenGraph} disabled={characters.length < 2}
              icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />} variant="ghost">关系图</Button>
          </div>
        </div>
        <div style={{ margin: '0 28px', height: 1, background: 'rgba(0,0,0,0.06)' }} />
        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 24 }}>
          {loading ? (
            <div style={{ maxWidth: 600, margin: '0 auto' }}><SkeletonList count={6} /></div>
          ) : (
            <CharacterGrid characters={characters} projectPath={projectPath}
              onEdit={handleEdit} onDelete={handleDelete} onLightbox={openLightbox} onUploadImage={handleUploadImage} />
          )}
        </ScrollArea>
      </div>

      {/* Character Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingChar(null) }} title="角色详情" width={760} draggable>
        {editingChar && <CharacterForm char={editingChar} onChange={setEditingChar} onSave={handleSave} onClose={() => { setShowModal(false); setEditingChar(null) }} projectPath={projectPath} />}
      </Modal>

      {/* Relationship Graph Modal */}
      <RelationshipGraphModal
        isOpen={graph.showGraph}
        graphData={graph.graphData}
        loading={graph.graphLoading}
        error={graph.graphError}
        characters={characters}
        onClose={() => graph.setShowGraph(false)}
        onRegenerate={() => graph.handleAnalyzeRelationships(false)}
        onIncrementalRefresh={() => graph.handleAnalyzeRelationships(true)}
        onNodeClick={() => {}}
        onEditCharacter={(char) => { setEditingChar(char); setShowModal(true) }}
        onNewCharacter={() => { setEditingChar({ ...EMPTY_CHARACTER, id: nanoid(8) }); setShowModal(true) }}
      />

      {/* AI Generate Modal */}
      <AICharacterGenerateDialog
        isOpen={showAIGen}
        aiGenDesc={aiGenDesc}
        aiGenConfigId={aiGenConfigId}
        aiGenLoading={aiGenLoading}
        aiGenImageNote={aiGenImageNote}
        configs={configs}
        promptTemplates={promptTemplates}
        activeConfigId={activeConfigId}
        onClose={() => setShowAIGen(false)}
        onDescChange={setAiGenDesc}
        onConfigChange={setAiGenConfigId}
        onGenerate={handleAIGenerate}
      />

      {/* 形象图灯箱 */}
      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}
