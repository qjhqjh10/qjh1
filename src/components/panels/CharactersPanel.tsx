import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService } from '@/services/fileService'
import { loadCharacters, saveCharacter, parseCharacterFromAI, CHARACTER_FIELDS } from '@/services/characterService'
import { loadWorldbuildingContent } from '@/services/outlineService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, PencilIcon, UserIcon, SparklesIcon, TagIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import type { Character, CharacterRole, RelationshipGraph } from '@/types/character'
import { EMPTY_CHARACTER, RELATIONSHIP_TAGS } from '@/types/character'
import { inputStyle } from '@/components/common/styles'
import RelationshipGraphModal from '@/components/common/RelationshipGraphModal'
import { logError } from '@/utils/logger'

const ROLES: CharacterRole[] = ['男主', '女主', '男配', '女配', '反派', '其他']

const FIELD_TO_LABEL: Record<string, string> = Object.fromEntries(
  CHARACTER_FIELDS.map(f => [f.key as string, f.label])
)

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

注意：
- 每个字段都必须填写，不确定的可以写"暂无"
- 关系标签请从以下选择或自行发挥：恋人、后宫、父亲、母亲、姐姐、妹妹、哥哥、弟弟、师父、徒弟、挚友、敌人、宿敌、竞争对手、青梅竹马、初恋、暗恋对象等
- 只输出上述格式的角色信息，不要输出其他内容`

interface Props {
  showWorldbuildingPanel?: boolean
  standalone?: boolean
}

export default function CharactersPanel({ showWorldbuildingPanel = true, standalone = true }: Props) {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const characters = useStore(s => s.characters)
  const setCharacters = useStore(s => s.setCharacters)
  const addCharacter = useStore(s => s.addCharacter)
  const updateCharacter = useStore(s => s.updateCharacter)
  const removeCharacter = useStore(s => s.removeCharacter)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)

  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const promptTemplates = useSettingsStore(s => s.prompts)

  const [editingChar, setEditingChar] = useState<Character | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [projectPath, setProjectPath] = useState('')

  // AI generation state
  const [showAIGen, setShowAIGen] = useState(false)
  const [aiGenDesc, setAiGenDesc] = useState('')
  const [aiGenLoading, setAiGenLoading] = useState(false)
  const [aiGenConfigId, setAiGenConfigId] = useState(activeConfigId)

  // Relationship graph state
  const [showGraph, setShowGraph] = useState(false)
  const [graphData, setGraphData] = useState<RelationshipGraph | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState('')

  // Load existing graph from disk
  const loadGraph = async (pp: string) => {
    try {
      const raw = await fileService.read(`${pp}/relationship_graph.json`)
      if (raw) {
        const data = JSON.parse(raw) as RelationshipGraph
        if (data.nodes && data.edges) setGraphData(data)
      }
    } catch { /* no saved graph yet */ }
  }

  // Save graph to disk
  const saveGraph = async (pp: string, data: RelationshipGraph) => {
    await fileService.write(`${pp}/relationship_graph.json`, JSON.stringify(data, null, 2))
  }

  // AI analyze relationships
  const handleAnalyzeRelationships = async () => {
    const genConfigId = activeConfigId
    if (!genConfigId || !activeConfigId) {
      setGraphError('请先在系统设置中配置AI模型')
      setShowGraph(true)
      return
    }
    if (characters.length < 2) {
      setGraphError('至少需要2个角色才能分析关系。请先创建角色并填写"角色关系网"字段。')
      setShowGraph(true)
      return
    }

    setGraphLoading(true)
    setGraphError('')
    setShowGraph(true)

    try {
      const charList = characters.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role,
        relationships: c.relationships || '暂无',
      }))

      const prompt = `你是小说角色关系分析专家。根据以下角色列表和各自的"角色关系网"描述，提取所有角色之间的两两关系。

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
- 如果两个角色在各自的关系网中互相提及，只输出一条关系（选择更合适的 source/target 方向）
- 只输出有明确关系描述的角色对，不要臆测`

      const messages = [{ role: 'user' as const, content: prompt }]
      const reply = await aiService.chat(messages, genConfigId, activeProjectId || undefined)

      // Parse AI response: try to find JSON block
      let jsonStr = reply
      const jsonMatch = reply.match(/\{[\s\S]*"relationships"[\s\S]*\}/)
      if (jsonMatch) jsonStr = jsonMatch[0]

      const parsed = JSON.parse(jsonStr)
      const edges = (parsed.relationships || []).map((r: { source: string; target: string; relation: string; description: string }) => ({
        source: r.source,
        target: r.target,
        relation: r.relation,
        description: r.description,
      }))

      // Build node set from characters + edges (handle name matching)
      const nameToId = new Map(characters.map(c => [c.name, c.id]))
      const referencedIds = new Set<string>()
      for (const e of edges) {
        if (nameToId.has(e.source)) referencedIds.add(nameToId.get(e.source)!)
        if (nameToId.has(e.target)) referencedIds.add(nameToId.get(e.target)!)
      }

      // Convert name-based edges to id-based edges for G6
      const idEdges = edges
        .filter((e: { source: string; target: string }) => nameToId.has(e.source) && nameToId.has(e.target))
        .map((e: { source: string; target: string; relation: string; description: string }) => ({
          source: nameToId.get(e.source)!,
          target: nameToId.get(e.target)!,
          relation: e.relation,
          description: e.description,
        }))

      const graph: RelationshipGraph = {
        nodes: characters
          .filter(c => referencedIds.has(c.id))
          .map(c => ({ id: c.id, name: c.name, role: c.role })),
        edges: idEdges,
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

  const handleGraphNodeClick = (characterId: string) => {
    const char = characters.find(c => c.id === characterId)
    if (char) {
      setShowGraph(false)
      handleEdit(char)
    }
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
    loadGraph(pp)
  }, [activeProjectId, projectsBasePath])

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
    if (isNew) { addCharacter(editingChar) }
    else { updateCharacter(editingChar.id, editingChar) }
    setShowModal(false)
    setEditingChar(null)
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

      // Open character edit modal with AI-generated data pre-filled
      const newChar: Character = {
        ...EMPTY_CHARACTER,
        id: nanoid(8),
        ...parsed,
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
              onClick={() => { setAiGenConfigId(activeConfigId); setShowAIGen(true) }}
              disabled={!activeConfigId && configs.length === 0}
              icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
            >
              AI生成角色
            </Button>
            <Button onClick={handleNew} icon={<PlusIcon style={{ width: 16, height: 16 }} />} variant="secondary">
              新建角色
            </Button>
            <Button
              onClick={handleAnalyzeRelationships}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {characters.map(char => (
              <GlassCard key={char.id} onClick={() => handleEdit(char)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <UserIcon style={{ width: 16, height: 16, color: '#7c3aed' }} />
                      <h4 style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {char.name || '未命名角色'}
                      </h4>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      {char.role && (
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: 11, fontWeight: 600 }}>
                          {char.role}
                        </span>
                      )}
                      {char.importance !== undefined && char.importance >= 0 && (
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: 'rgba(230,126,0,0.08)', color: '#e67e00', fontSize: 11, fontWeight: 600 }}>
                          ★ {char.importance}
                        </span>
                      )}
                    </div>
                    {char.occupation && <p style={{ fontSize: 12, color: '#6b5e54', marginBottom: 2 }}>{char.occupation}</p>}
                    {char.gender && <p style={{ fontSize: 12, color: '#9b8e84' }}>{char.gender} {char.age && `· ${char.age}`}</p>}
                    {char.relationshipTags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                        {char.relationshipTags.slice(0, 5).map(t => (
                          <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.05)', color: '#7c3aed' }}>{t}</span>
                        ))}
                        {char.relationshipTags.length > 5 && <span style={{ fontSize: 10, color: '#9b8e84' }}>+{char.relationshipTags.length - 5}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    <button onClick={e => { e.stopPropagation(); handleEdit(char) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex' }}>
                      <PencilIcon style={{ width: 15, height: 15 }} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(char) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex' }}>
                      <TrashIcon style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                </div>
                {char.personality && (
                  <p style={{ fontSize: 12, color: '#6b5e54', marginTop: 8, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {char.personality}
                  </p>
                )}
                {char.appearance && (
                  <p style={{ fontSize: 12, color: '#6b5e54', marginTop: 6, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {char.appearance}
                  </p>
                )}
                {char.abilities && (
                  <p style={{ fontSize: 12, color: '#9b8e84', marginTop: 4, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                    {char.abilities}
                  </p>
                )}
              </GlassCard>
            ))}
          </div>
          {characters.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <UserIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>暂无角色，点击"AI生成角色"或"新建角色"创建</p>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Character Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingChar(null) }} title="角色详情" width={760}>
        {editingChar && <CharacterForm char={editingChar} onChange={setEditingChar} onSave={handleSave} onClose={() => { setShowModal(false); setEditingChar(null) }} />}
      </Modal>

      {/* Relationship Graph Modal */}
      <RelationshipGraphModal
        isOpen={showGraph}
        graphData={graphData}
        loading={graphLoading}
        error={graphError}
        onClose={() => setShowGraph(false)}
        onRegenerate={handleAnalyzeRelationships}
        onNodeClick={handleGraphNodeClick}
      />

      {/* AI Generate Modal */}
      <Modal isOpen={showAIGen} onClose={() => setShowAIGen(false)} title="AI 生成角色" width={560}>
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
    </div>
  )
}

// Character form sub-component
function CharacterForm({ char, onChange, onSave, onClose }: {
  char: Character
  onChange: (c: Character) => void
  onSave: () => void
  onClose: () => void
}) {
  const toggleTag = (tag: string) => {
    const tags = char.relationshipTags as string[]
    if (tags.includes(tag)) {
      onChange({ ...char, relationshipTags: (tags.filter(t => t !== tag) as Character['relationshipTags']) })
    } else {
      onChange({ ...char, relationshipTags: ([...tags, tag] as Character['relationshipTags']) })
    }
  }

  const set = (k: keyof Character, v: unknown) => onChange({ ...char, [k]: v })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Basic info row */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>姓名</label>
          <input type="text" value={char.name} onChange={e => set('name', e.target.value)} style={inputStyle} placeholder="角色姓名" />
        </div>
        <div style={{ width: 130 }}>
          <label style={labelStyle}>角色类型</label>
          <select value={char.role} onChange={e => set('role', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>性别</label>
          <input type="text" value={char.gender} onChange={e => set('gender', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>年龄</label>
          <input type="text" value={char.age} onChange={e => set('age', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>职业/身份</label>
          <input type="text" value={char.occupation} onChange={e => set('occupation', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>重要程度 ({char.importance ?? 50})</label>
          <input type="range" min="1" max="100" value={char.importance ?? 50} onChange={e => set('importance', parseInt(e.target.value))} style={{ width: '100%', accentColor: '#7c3aed', marginTop: 4 }} />
        </div>
      </div>

      {/* Text fields */}
      {(['background', 'appearance', 'personality', 'abilities', 'weaknesses', 'relationships', 'arc'] as const).map(k => (
        <div key={k}>
          <label style={labelStyle}>{FIELD_TO_LABEL[k]}</label>
          <textarea
            value={char[k] as string}
            onChange={e => set(k, e.target.value)}
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            placeholder={`${FIELD_TO_LABEL[k]}...`}
          />
        </div>
      ))}

      {/* Relationship Tags */}
      <div>
        <label style={labelStyle}>
          <TagIcon style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
          关系标签（点击选择/取消）
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {RELATIONSHIP_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                padding: '3px 10px', borderRadius: 8, border: char.relationshipTags.includes(tag) ? '1px solid #7c3aed' : '1px solid #e5e0da',
                background: char.relationshipTags.includes(tag) ? 'rgba(124,58,237,0.08)' : '#fff',
                color: char.relationshipTags.includes(tag) ? '#7c3aed' : '#6b5e54',
                fontSize: 11, cursor: 'pointer', fontWeight: char.relationshipTags.includes(tag) ? 600 : 400,
                transition: 'all 0.1s ease',
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        {char.relationshipTags.length > 0 && (
          <div style={{ fontSize: 11, color: '#9b8e84' }}>
            已选: {char.relationshipTags.join('、')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={onSave} disabled={!char.name.trim()}>保存角色设定</Button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4,
}
