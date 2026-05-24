import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService } from '@/services/fileService'
import { loadCharacters, saveCharacter, parseCharacterFromAI, CHARACTER_FIELDS, ROLES, normalizeRole } from '@/services/characterService'
import { loadWorldbuildingContent } from '@/services/outlineService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import ImageLightbox from '@/components/common/ImageLightbox'
import CharacterImage from './CharacterImage'
import CharacterForm from './CharacterForm'
import { PlusIcon, TrashIcon, PencilIcon, UserIcon, SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import type { Character, RelationshipGraph } from '@/types/character'
import { EMPTY_CHARACTER } from '@/types/character'
import RelationshipGraphModal from '@/components/common/RelationshipGraphModal'
import { logError } from '@/utils/logger'
import { safeStr } from '@/utils/safeStr'

const AI_FORMAT_INSTRUCTION = `
请严格按照以下格式输出角色信息（每行一个字段，标签与内容之间用英文冒号+空格）：

姓名: <角色姓名>
角色类型: <男主/女主/男配/女配/反派/其他>
性别: <性别>
年龄: <年龄>
职业/身份: <职业或身份>
背景设定: <背景故事>
外观特征: <外貌描述>
性格特征: <性格描述>
能力: <能力或技能>
弱点: <弱点或缺陷>
角色关系网: <与其他角色的关系描述>
角色成长弧线: <角色故事发展轨迹>
关系标签: <标签1、标签2、标签3>
重要程度: <1-100的整数，数值越大越重要，默认50>
形象图描述: <英文关键词描述，用于图片搜索，如"young swordsman with silver hair, blue eyes, dark armor, anime style, portrait">

注意：
- 每个字段都必须填写，不确定的可以写"暂无"
- 关系标签请从以下选择或自行发挥：恋人、后宫、父亲、母亲、姐姐、妹妹、哥哥、弟弟、师父、徒弟、挚友、敌人、宿敌、竞争对手、青梅竹马、初恋、暗恋对象等
- 形象图描述请使用英文关键词，描述角色外貌特征，便于搜索匹配的图片
- 只输出上述格式的角色信息，不要输出其他内容`

const ROLE_COLORS: Record<string, string> = {
  '男主': '#dc2626',
  '女主': '#ec4899',
  '男配': '#3b82f6',
  '女配': '#8b5cf6',
  '反派': '#f59e0b',
  '其他': '#6b7280',
}

interface Props {
  showWorldbuildingPanel?: boolean
  standalone?: boolean
}

export default function CharactersPanel({ showWorldbuildingPanel = true, standalone = true }: Props) {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileEditNotify = useStore(s => s.fileEditNotify)
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

  // Resolve image (file path or data URL) for lightbox display
  const openLightbox = async (image: string) => {
    if (image.startsWith('data:')) { setLightboxImage(image); return }
    if (!projectPath) return
    const imagePath = image.includes('/') ? image : `images/${image}`
    const ext = image.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    try {
      const b64 = await fileService.readBinary(`${projectPath}/${imagePath}`)
      if (b64) setLightboxImage(`data:${mime};base64,${b64}`)
    } catch { /* silently fail, image stays null */ }
  }

  // AI generation state
  const [showAIGen, setShowAIGen] = useState(false)
  const [aiGenDesc, setAiGenDesc] = useState('')
  const [aiGenLoading, setAiGenLoading] = useState(false)
  const [aiGenConfigId, setAiGenConfigId] = useState(activeConfigId)
  const [aiGenImageNote, setAiGenImageNote] = useState('')

  // Relationship graph state
  const [showGraph, setShowGraph] = useState(false)
  const [graphData, setGraphData] = useState<RelationshipGraph | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState('')

  // Save graph to disk
  const saveGraph = async (pp: string, data: RelationshipGraph) => {
    await fileService.write(`${pp}/relationship_graph.json`, JSON.stringify(data, null, 2))
  }

  // Open relationship graph: load saved first, fall back to AI
  const handleOpenGraph = async () => {
    if (!projectPath) return
    const existing = await loadGraphData(projectPath)
    if (existing) {
      setGraphData(existing)
      setGraphError('')
      setShowGraph(true)
    } else {
      handleAnalyzeRelationships(false)
    }
  }

  // Load graph from disk (returns null if not found)
  const loadGraphData = async (pp: string): Promise<RelationshipGraph | null> => {
    try {
      const raw = await fileService.read(`${pp}/relationship_graph.json`)
      if (raw) {
        const data = JSON.parse(raw) as RelationshipGraph
        if (data.nodes && data.edges) return data
      }
    } catch { /* no saved graph yet */ }
    return null
  }

  // AI analyze relationships. incremental=true: keep existing edges, only add new ones.
  const handleAnalyzeRelationships = async (incremental = false, _overrideChars?: Character[], _overrideGraph?: RelationshipGraph | null) => {
    const genConfigId = activeConfigId
    if (!genConfigId || !activeConfigId) {
      setGraphError('请先在系统设置中配置AI模型')
      setShowGraph(true)
      return
    }
    const chars = _overrideChars || characters
    if (chars.length < 2) {
      setGraphError('至少需要2个角色才能分析关系。请先创建角色并填写"角色关系网"字段。')
      setShowGraph(true)
      return
    }

    setGraphLoading(true)
    setGraphError('')
    setShowGraph(true)

    try {
      const activeGraph = _overrideGraph !== undefined ? _overrideGraph : graphData
      const existingEdges = incremental && activeGraph ? activeGraph.edges : []
      const existingNodeIds = new Set(incremental && activeGraph ? activeGraph.nodes.map(n => n.id) : [])
      const charList = chars.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role,
        relationships: c.relationships || '暂无',
      }))

      let prompt: string
      if (incremental && existingEdges.length > 0) {
        const newChars = charList.filter(c => !existingNodeIds.has(c.id))
        prompt = `你是小说角色关系分析专家。以下是已有角色关系图，现在新增了角色。

已有关系（请保留，不要修改或删除）：
${JSON.stringify(existingEdges, null, 2)}

新增角色列表：
${JSON.stringify(newChars, null, 2)}

已有全部角色（供参考姓名）：
${JSON.stringify(charList.map(c => ({ name: c.name, role: c.role })), null, 2)}

请仅分析新增角色与其他角色之间的新关系，输出 JSON（不要 markdown）：
{ "relationships": [
  { "source": "角色精确姓名", "target": "角色精确姓名", "relation": "关系类型", "description": "简述" }
] }

注意：只输出与新增角色相关的新关系，已有关系已在上面列出，不要重复。`
      } else {
        prompt = `你是小说角色关系分析专家。根据以下角色列表和各自的"角色关系网"描述，提取所有角色之间的两两关系。

角色列表：
${JSON.stringify(charList, null, 2)}

请分析每个角色的"角色关系网"描述，推断角色之间的所有关系，输出严格 JSON 格式（不要包含 markdown 标记）：

{
  "relationships": [
    { "source": "角色A的精确姓名", "target": "角色B的精确姓名", "relation": "关系类型(如师徒、父子、恋人、仇敌等)", "description": "关系简述，基于角色关系网描述" }
  ]
}

注意：
- source 和 target 必须使用角色列表中精确的姓名
- 如果角色关系网中提到了其他角色名字，务必提取该关系
- 如果两个角色在各自的关系网中互相提及，只输出一条关系
- 只输出有明确关系描述的角色对，不要臆测`
      }

      const messages = [{ role: 'user' as const, content: prompt }]
      const reply = await aiService.chat(messages, genConfigId, activeProjectId || undefined)

      let jsonStr = reply
      const jsonMatch = reply.match(/\{[\s\S]*"relationships"[\s\S]*\}/)
      if (jsonMatch) jsonStr = jsonMatch[0]

      const parsed = JSON.parse(jsonStr)
      const newEdges = (parsed.relationships || []).map((r: { source: string; target: string; relation: string; description: string }) => ({
        source: r.source,
        target: r.target,
        relation: r.relation,
        description: r.description,
      }))

      const nameToId = new Map(chars.map(c => [c.name, c.id]))

      // Convert new edges to id-based
      const idNewEdges = newEdges
        .filter((e: { source: string; target: string }) => nameToId.has(e.source) && nameToId.has(e.target))
        .map((e: { source: string; target: string; relation: string; description: string }) => ({
          source: nameToId.get(e.source)!,
          target: nameToId.get(e.target)!,
          relation: e.relation,
          description: e.description,
        }))

      // Merge: existing + new, dedup by source-target pair
      const allEdges = incremental ? [...existingEdges] : []
      const edgeKey = (s: string, t: string) => [s, t].sort().join('||')
      const seenPairs = new Set(allEdges.map(e => edgeKey(e.source, e.target)))
      for (const e of idNewEdges) {
        if (!seenPairs.has(edgeKey(e.source, e.target))) {
          allEdges.push(e)
          seenPairs.add(edgeKey(e.source, e.target))
        }
      }

      // Build node set from all edges
      const referencedIds = new Set<string>()
      for (const e of allEdges) {
        referencedIds.add(e.source)
        referencedIds.add(e.target)
      }

      const graph: RelationshipGraph = {
        nodes: chars
          .filter(c => referencedIds.has(c.id))
          .map(c => ({ id: c.id, name: c.name, role: c.role })),
        edges: allEdges,
        generatedAt: new Date().toISOString(),
      }

      setGraphData(graph)
      if (projectPath) saveGraph(projectPath, graph)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败'
      logError('AI 分析角色关系失败', err)
      setGraphError(msg)
    }
    setGraphLoading(false)
  }

  const handleAnalyzeFull = () => handleAnalyzeRelationships(false)

  const handleGraphNodeClick = (_characterId: string) => {
    // Modal handles selection display; edit action handled by onEditCharacter
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
    loadCharacters(pp).then(setCharacters)
  }, [activeProjectId, projectsBasePath])

  // Reload characters when AI creates/edits/deletes character files
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
    await fileService.deleteFile(`${projectPath}/characters/${char.id}.json`)
    removeCharacter(char.id)
  }

  const handleSave = async () => {
    if (!editingChar || !editingChar.name.trim()) return
    const isNew = !characters.find(c => c.id === editingChar.id)
    await saveCharacter(projectPath, editingChar)
    setShowModal(false)
    setEditingChar(null)

    // Reload characters from disk to get latest state
    const refreshedChars = await loadCharacters(projectPath)
    setCharacters(refreshedChars)

    // Incremental graph refresh when adding a new character while graph is open
    if (showGraph && isNew) {
      handleAnalyzeRelationships(true, refreshedChars, graphData)
    }
  }

  // AI generate
  const handleAIGenerate = async () => {
    const genConfigId = aiGenConfigId || activeConfigId
    if (!aiGenDesc.trim() || !genConfigId) return
    setAiGenLoading(true)
    try {
      // Get enabled "角色" type prompt
      const rolePrompt = promptTemplates.find(p => p.type === '角色' && p.enabled)
      const rolePromptContent = rolePrompt?.content || ''

      const messages = [
        {
          role: 'user' as const,
          content: `${rolePromptContent ? `[提示词模板]\n${rolePromptContent}\n\n` : ''}[格式要求]\n${AI_FORMAT_INSTRUCTION}\n\n[用户需求]\n请根据以下描述生成角色：\n${aiGenDesc}`,
        },
      ]

      const reply = await aiService.chat(messages, genConfigId, activeProjectId || undefined)
      const parsed = parseCharacterFromAI(reply)

      // Extract image prompt for Unsplash search
      const imagePromptMatch = reply.match(/形象图描述[:：]\s*(.+)/)
      const imagePrompt = imagePromptMatch?.[1]?.trim() || ''

      // Search for character image
      let characterImage: string | undefined
      let note = ''
      if (imagePrompt && projectPath) {
        try {
          const results = await aiService.executeFileTools([{
            callId: nanoid(6),
            toolName: 'search_images',
            args: { query: imagePrompt, count: 1 },
          }])
          const r = results[0]
          if (r?.status === 'success' && r?.detail) {
            const detail = JSON.parse(r.detail) as { path: string; description: string }[]
            if (detail.length > 0) {
              characterImage = detail[0].path
            } else {
              note = '未找到匹配图片，可手动上传'
            }
          } else {
            note = r?.status === 'error' ? `图片搜索失败: ${r.summary}` : '图片搜索暂不可用'
          }
        } catch {
          note = '图片搜索暂不可用（可能限流或网络问题）'
        }
      }
      setAiGenImageNote(note)

      // Open character edit modal with AI-generated data pre-filled
      const newChar: Character = {
        ...EMPTY_CHARACTER,
        id: nanoid(8),
        ...parsed,
        image: characterImage,
      }
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
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* Left: Worldbuilding reference (optional) */}
      {showWorldbuildingPanel && (
        <div style={{
          width: '30%', borderRight: '1px solid rgba(0,0,0,0.05)',
          display: 'flex', flexDirection: 'column',
        }}>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px 16px',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520' }}>角色档案库</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => { setAiGenConfigId(activeConfigId); setAiGenImageNote(''); setShowAIGen(true) }}
              disabled={!activeConfigId && configs.length === 0}
              icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
            >
              AI生成角色
            </Button>
            <Button onClick={handleNew} icon={<PlusIcon style={{ width: 16, height: 16 }} />} variant="secondary">
              新建角色
            </Button>
            <Button
              onClick={handleOpenGraph}
              disabled={characters.length < 2}
              icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}
              variant="ghost"
            >
              关系图
            </Button>
          </div>
        </div>
        <div style={{ margin: '0 28px', height: 1, background: 'rgba(0,0,0,0.06)' }} />

        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 24 }}>
          <style>{`
            .char-card { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
            .char-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(124,58,237,0.1), 0 4px 12px rgba(0,0,0,0.06) !important; }
            .char-img-box { transition: all 0.25s ease; }
            .char-card:hover .char-img-box { box-shadow: 0 0 20px rgba(124,58,237,0.15); }
            .char-card:hover .char-img-placeholder { border-color: rgba(124,58,237,0.25) !important; background: rgba(124,58,237,0.04) !important; }
            .char-card:hover .char-img-overlay { background: rgba(0,0,0,0.2) !important; }
            .char-card:hover .char-img-overlay span { opacity: 1 !important; }
            .role-group-header { transition: all 0.2s ease; }
            .role-group-header:hover { transform: translateX(4px); }
          `}</style>
          {characters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <UserIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>暂无角色，点击"AI生成角色"或"新建角色"创建</p>
            </div>
          ) : (
            (() => {
              const groupedChars = ROLES.map(role => ({
                role,
                chars: characters.filter(c => normalizeRole(c.role as string) === role),
              })).filter(g => g.chars.length > 0)

              return groupedChars.map((group, gi) => (
                <div key={group.role}>
                  {/* Section header */}
                  <div className="role-group-header" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: gi > 0 ? 28 : 0 }}>
                    <div style={{ width: 3, height: 22, borderRadius: 2, background: ROLE_COLORS[group.role] }} />
                    <span style={{
                      fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
                      background: `linear-gradient(135deg, ${ROLE_COLORS[group.role]}, ${ROLE_COLORS[group.role]}cc)`,
                      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    }}>{group.role}</span>
                    <span style={{ fontSize: 11, color: '#9b8e84', fontWeight: 500 }}>
                      {group.chars.length} 位
                    </span>
                  </div>
                  {/* Card grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
                    {group.chars.map(char => (
                      <GlassCard key={char.id} onClick={() => handleEdit(char)} className="char-card" style={{ display: 'flex', gap: 14, padding: 14, minHeight: 150 }}>
                        {/* 形象图 — 左侧，点击放大 */}
                        <div onClick={e => { e.stopPropagation(); if (char.image) openLightbox(char.image) }}
                          className="char-img-box"
                          style={{
                            width: 100, minHeight: 130, maxHeight: 160, borderRadius: 12,
                            overflow: 'hidden', flexShrink: 0,
                            cursor: char.image ? 'pointer' : 'default',
                            border: '1px solid rgba(0,0,0,0.06)', position: 'relative',
                          }}>
                          {char.image ? (
                            <>
                              <CharacterImage image={char.image} projectPath={projectPath} alt={char.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <div className="char-img-overlay" style={{
                                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
                                transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <span style={{ opacity: 0, transition: 'opacity 0.2s', color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>点击放大</span>
                              </div>
                            </>
                          ) : (
                            <div className="char-img-placeholder" style={{
                              width: '100%', height: '100%', minHeight: 130,
                              background: 'rgba(124,58,237,0.02)',
                              border: '2px dashed rgba(124,58,237,0.1)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.25s ease',
                            }}>
                              <UserIcon style={{ width: 28, height: 28, color: '#d4ccc4' }} />
                            </div>
                          )}
                        </div>
                        {/* Right: Info */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#1e1b2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, lineHeight: 1.3 }}>
                              {char.name || '未命名角色'}
                            </h4>
                            <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                              <button onClick={e => { e.stopPropagation(); handleEdit(char) }} title="编辑" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9b8e84', display: 'flex', borderRadius: 4 }}>
                                <PencilIcon style={{ width: 13, height: 13 }} />
                              </button>
                              <button onClick={e => { e.stopPropagation(); handleDelete(char) }} title="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9b8e84', display: 'flex', borderRadius: 4 }}>
                                <TrashIcon style={{ width: 13, height: 13 }} />
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {char.role && (
                              <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 5, background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(168,85,247,0.05))', color: '#7c3aed', fontSize: 10, fontWeight: 600 }}>{char.role}</span>
                            )}
                            {char.importance !== undefined && char.importance > 0 && (
                              <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 5, background: 'rgba(245,158,11,0.08)', color: '#e67e00', fontSize: 10, fontWeight: 600 }}>★ {char.importance}</span>
                            )}
                          </div>
                          {char.occupation && <p style={{ fontSize: 11, color: '#6b5e54', margin: 0, lineHeight: 1.4, fontWeight: 500 }}>{char.occupation}</p>}
                          {(char.gender || char.age) && <p style={{ fontSize: 11, color: '#9b8e84', margin: 0 }}>{[char.gender, char.age].filter(Boolean).join(' · ')}</p>}
                          {(char.relationshipTags || []).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 1 }}>
                              {(char.relationshipTags || []).slice(0, 3).map(t => (
                                <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(124,58,237,0.04)', color: '#7c3aed' }}>{t}</span>
                              ))}
                              {(char.relationshipTags || []).length > 3 && <span style={{ fontSize: 9, color: '#9b8e84' }}>+{(char.relationshipTags || []).length - 3}</span>}
                            </div>
                          )}
                          {char.personality && (
                            <p style={{ fontSize: 11, color: '#6b5e54', margin: 0, marginTop: 3, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {safeStr(char.personality)}
                            </p>
                          )}
                        </div>
                      </GlassCard>
                    ))}
                  </div>
                  {/* Divider between groups */}
                  {gi < groupedChars.length - 1 && (
                    <div style={{ height: 1, marginTop: 24, background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)' }} />
                  )}
                </div>
              ))
            })()
          )}
        </ScrollArea>
      </div>

      {/* Character Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingChar(null) }} title="角色详情" width={760} draggable>
        {editingChar && <CharacterForm char={editingChar} onChange={setEditingChar} onSave={handleSave} onClose={() => { setShowModal(false); setEditingChar(null) }} projectPath={projectPath} />}
      </Modal>

      {/* Relationship Graph Modal */}
      <RelationshipGraphModal
        isOpen={showGraph}
        graphData={graphData}
        loading={graphLoading}
        error={graphError}
        characters={characters}
        onClose={() => setShowGraph(false)}
        onRegenerate={handleAnalyzeFull}
        onIncrementalRefresh={() => handleAnalyzeRelationships(true)}
        onNodeClick={handleGraphNodeClick}
        onEditCharacter={(char) => { setEditingChar(char); setShowModal(true) }}
        onNewCharacter={() => {
          const newChar = { ...EMPTY_CHARACTER, id: nanoid(8) }
          setEditingChar(newChar)
          setShowModal(true)
        }}
      />

      {/* AI Generate Modal */}
      <Modal isOpen={showAIGen} onClose={() => setShowAIGen(false)} title="AI 生成角色" width={560} draggable>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 6 }}>
              描述你需要的角色
            </label>
            <textarea
              value={aiGenDesc}
              onChange={e => setAiGenDesc(e.target.value)}
              placeholder="例如：一个冷酷的剑客，曾是皇家护卫队长，因一场冤案被逐出师门，背负血海深仇寻找真相..."
              style={{
                width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
                resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                color: '#2d2520', background: '#faf9f8', padding: 14, minHeight: 140,
              }}
              autoFocus
            />
          </div>

          {/* Model config selector */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
              选择模型配置
            </label>
            <select
              value={aiGenConfigId || activeConfigId || ''}
              onChange={e => setAiGenConfigId(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10,
                border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
                background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
              }}
            >
              {configs.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
              ))}
            </select>
          </div>

          {/* Enabled prompt indicator */}
          {(() => {
            const rp = promptTemplates.find(p => p.type === '角色' && p.enabled)
            return (
              <div style={{
                fontSize: 12, color: rp ? '#7c3aed' : '#9b8e84',
                padding: '8px 12px', borderRadius: 8, background: rp ? 'rgba(124,58,237,0.04)' : '#f5f2f0',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <SparklesIcon style={{ width: 14, height: 14 }} />
                {rp ? `已加载提示词: ${rp.title}` : '未启用角色提示词，将使用默认格式'}
              </div>
            )
          })()}

          {!aiGenConfigId && !activeConfigId && (
            <div style={{ fontSize: 12, color: '#dc2626', padding: '8px 12px', borderRadius: 8, background: '#fee2e2' }}>
              请先在系统设置中配置AI模型
            </div>
          )}

          {aiGenImageNote && (
            <div style={{ fontSize: 11, color: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? '#e67e00' : '#16a34a', padding: '6px 10px', borderRadius: 8, background: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.06)' : 'rgba(16,163,74,0.04)', border: `1px solid ${aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.15)' : 'rgba(16,163,74,0.12)'}` }}>
              {aiGenImageNote}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowAIGen(false)}>取消</Button>
            <Button
              onClick={handleAIGenerate}
              disabled={!aiGenDesc.trim() || (!aiGenConfigId && !activeConfigId) || aiGenLoading}
              icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
            >
              {aiGenLoading ? '生成中...' : '生成角色'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 形象图灯箱 */}
      {lightboxImage && (
        <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  )
}

