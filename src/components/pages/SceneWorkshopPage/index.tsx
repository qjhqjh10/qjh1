import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { templateService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ConfirmModal from '@/components/common/ConfirmModal'
import ScrollArea from '@/components/common/ScrollArea'
import { SkeletonList } from '@/components/common/Skeleton'
import EmptyState from '@/components/common/EmptyState'
import { inputStyle, headingMd, headingSm, captionText } from '@/components/common/styles'
import type { EroticSceneConfig, NovelSceneConfig, SceneTemplate, SceneTemplateType } from '@/types/story'
import { PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { DEFAULT_EROTIC, DEFAULT_NOVEL, SECTIONS } from '../sceneWorkshopConstants'
import type { EditorType } from '../sceneWorkshopConstants'

import { getSectionSummary, sectionIsAuto, novelSectionIsAuto, SectionCard, getNovelSectionSummary, NovelSectionCard, NOVEL_SECTIONS } from "./helpers";

import { EroticSectionEditor } from './EroticSectionEditor';
import { NovelSectionEditor } from './NovelSectionEditor';


export default function SceneWorkshopPage() {
  const characters = useStore(s => s.characters)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const [saving, setSaving] = useState(false)
  const [editorType, setEditorType] = useState<EditorType>(null)
  const [templateType, setTemplateType] = useState<SceneTemplateType>('普通小说')
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [editingTemplate, setEditingTemplate] = useState<SceneTemplate | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [eroticConfig, setEroticConfig] = useState<EroticSceneConfig>(DEFAULT_EROTIC)
  const [novelConfig, setNovelConfig] = useState<NovelSceneConfig>(DEFAULT_NOVEL)
  const [novelGenreType, setNovelGenreType] = useState('都市')
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [showNovelSectionModal, setShowNovelSectionModal] = useState(false)
  const [editingNovelSection, setEditingNovelSection] = useState<number | null>(null)
  const [editTagMode, setEditTagMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  useEffect(() => { setActivePage('scene-workshop'); loadTemplates() }, [])

  // Reload templates when AI creates scene templates
  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('scene_templates')) loadTemplates()
  }, [fileEditNotify])

  const toggleEroticAuto = (field: string, v: boolean) => setEroticConfig({ ...eroticConfig, autoFields: { ...eroticConfig.autoFields, [field]: v } })
  const toggleNovelAuto = (field: string, v: boolean) => setNovelConfig({ ...novelConfig, autoFields: { ...novelConfig.autoFields, [field]: v } })

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const globalRaw = await templateService.list() as any[]
      let projectRaw: any[] = []
      if (activeProjectId && projectsBasePath) {
        try {
          projectRaw = await templateService.listProject(`${projectsBasePath}/${activeProjectId}`) as any[]
        } catch { /* project dir may not exist */ }
      }
      // Normalize all templates to SceneTemplate shape (handle AI custom formats)
      const normalize = (raw: any, fromProject: boolean): SceneTemplate => ({
        id: raw.id || raw.templateId || `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
        name: raw.name || raw.templateName || '未命名模板',
        type: raw.type || '普通小说',
        config: raw.config || raw,
        createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
        _fromProject: fromProject,
      } as SceneTemplate & { _fromProject?: boolean })
      const globalList = globalRaw.map(t => normalize(t, false))
      const projectList = projectRaw.map(t => normalize(t, true))
      const seen = new Set(globalList.map(t => t.id))
      const merged = [...globalList]
      for (const t of projectList) { if (!seen.has(t.id)) { merged.push(t); seen.add(t.id) } }
      setTemplates(merged)
    } catch { setTemplates([]) }
    setLoading(false)
  }

  const handleEnterType = (tmplType: SceneTemplateType) => {
    const editType = tmplType === '情色小说' ? 'erotic' : 'novel'
    setEditorType(editType); setEditingTemplate(null); setTemplateName('')
    setEroticConfig(DEFAULT_EROTIC); setNovelConfig(DEFAULT_NOVEL); loadTemplates()
    setTemplateType(tmplType)
  }

  const handleNewTemplate = () => {
    setEditingTemplate(null); setTemplateName(''); setEditTagMode(false)
    setEroticConfig(DEFAULT_EROTIC); setNovelConfig(DEFAULT_NOVEL); setNovelGenreType('都市'); setShowEditor(true)
  }

  const handleEditTemplate = (tpl: SceneTemplate) => {
    setEditTagMode(false)
    const isErotic = tpl.type === '情色小说'
    setEditorType(isErotic ? 'erotic' : 'novel')
    setTemplateType(tpl.type || '普通小说')
    setEditingTemplate(tpl); setTemplateName(tpl.name)
    if (isErotic) {
      const cfg = { ...DEFAULT_EROTIC, ...(tpl.config || {}) } as EroticSceneConfig
      if (Array.isArray((cfg as any).customPOVs)) (cfg as any).customPOVs = ((cfg as any).customPOVs as unknown as string[]).join(',')
      setEroticConfig(cfg)
    }
    else {
      const cfg = { ...DEFAULT_NOVEL, ...(tpl.config || {}) } as NovelSceneConfig
      setNovelConfig(cfg)
    }
    setShowEditor(true)
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) { alert('请输入模板名称'); return }
    if (saving) return
    const tpl: SceneTemplate = {
      id: editingTemplate?.id || nanoid(8), name: templateName.trim(), type: templateType,
      config: editorType === 'erotic' ? eroticConfig : novelConfig,
      createdAt: editingTemplate?.createdAt || new Date().toISOString(),
    } as SceneTemplate
    setSaving(true)
    try {
      const saved = await templateService.save(tpl)
      setFileEditNotify({ filePath: 'scene_templates/' + (saved.id || ''), newContent: '' })
      setShowEditor(false); loadTemplates()
    } catch { alert('保存失败，请重试') }
    setSaving(false)
  }

  const handleDeleteTemplate = (id: string) => setDeleteConfirmId(id)

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmId) return
    await templateService.delete(deleteConfirmId); loadTemplates()
    setDeleteConfirmId(null)
  }

  const handleDuplicateTemplate = (tpl: SceneTemplate) => {
    setEditTagMode(false)
    const isErotic = tpl.type === '情色小说'
    setEditorType(isErotic ? 'erotic' : 'novel')
    setTemplateType(tpl.type || '普通小说')
    setEditingTemplate(null); setTemplateName(tpl.name + ' (副本)')
    if (isErotic) setEroticConfig({ ...DEFAULT_EROTIC, ...(tpl.config || {}) } as EroticSceneConfig)
    else setNovelConfig({ ...DEFAULT_NOVEL, ...(tpl.config || {}) } as NovelSceneConfig)
    setShowEditor(true)
  }



  // Group templates by type
  const groupedTemplates = templates.reduce((acc, tpl) => {
    const type = tpl.type || '普通小说'
    if (!acc[type]) acc[type] = []
    acc[type].push(tpl)
    return acc
  }, {} as Record<string, SceneTemplate[]>)

  const TYPE_COLORS: Record<string, string> = {
    '情色小说': '#dc2626', '普通小说': '#3b82f6', '都市小说': '#06b6d4', '修仙小说': '#7c3aed',
    '武侠小说': '#f59e0b', '恋爱小说': '#ec4899', '古风小说': '#8b5cf6', '悬疑小说': '#6366f1',
    '历史小说': '#b45309', '科幻小说': '#10b981', '穿越小说': '#14b8a6',
  }


  return (
    <div className="page-enter" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {editorType ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditorType(null)}>← 返回</Button>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: editorType === 'erotic' ? '#dc2626' : '#3b82f6' }}>
              {editorType === 'erotic' ? '🔥 情色场景模板' : '📖 普通场景模板'}
            </h2>
          </>
        ) : (
          <h2 style={headingMd}>场景工坊</h2>
        )}
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={handleNewTemplate} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建模板</Button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Template list (always visible, grouped by type) */}
        <div className="glass" style={{ width: 280, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 14px', ...headingSm, fontSize: 11, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            场景模板 ({templates.length})
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {loading ? (
                <div style={{ padding: 12 }}><SkeletonList count={4} /></div>
              ) : templates.length === 0 ? (
                <EmptyState icon="🎬" title="暂无场景模板" description="新建模板开始配置场景" action={{ label: '新建模板', onClick: handleNewTemplate }} />
              ) : (
                Object.entries(groupedTemplates).map(([type, tpls]) => (
                  <div key={type}>
                    <div style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', marginBottom: 4,
                      color: TYPE_COLORS[type] || '#6b7280',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ width: 3, height: 14, borderRadius: 2, background: TYPE_COLORS[type] || '#6b7280', display: 'inline-block' }} />
                      {type} · {tpls.length}
                    </div>
                    {tpls.map(tpl => (
                      <div key={tpl.id} onClick={() => handleEditTemplate(tpl)} className="interactive" style={{
                        padding: '8px 10px 8px 14px', borderRadius: 8, cursor: 'pointer',
                        background: '#fff', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 3,
                        fontSize: 12,
                      }}>
                        <div style={{ fontWeight: 600, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</div>
                        <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>
                          {tpl.createdAt ? new Date(tpl.createdAt).toLocaleDateString() : ''}
                          <span style={{ float: 'right', display: 'inline-flex', gap: 2 }}>
                            <span onClick={e => { e.stopPropagation(); handleDuplicateTemplate(tpl) }} title="复制" style={{ cursor: 'pointer', color: '#9b8e84' }}>📋</span>
                            <span onClick={e => { e.stopPropagation(); handleDeleteTemplate(tpl.id) }} title="删除" style={{ cursor: 'pointer', color: '#d4ccc4' }}>🗑</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Content area */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!editorType ? (
            /* Type selection grid */
            <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
              <p style={{ ...captionText, fontSize: 13, marginBottom: 20 }}>选择场景类型创建新模板，或从左侧选择已有模板编辑</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {(['普通小说','情色小说','玄幻小说','奇幻小说','灵异小说','游戏小说','末世小说','轻小说','都市小说','修仙小说','武侠小说','恋爱小说','古风小说','悬疑小说','历史小说','科幻小说','穿越小说'] as SceneTemplateType[]).map(type => {
                  const isErotic = type === '情色小说'
                  const count = groupedTemplates[type]?.length || 0
                  return (
                    <button key={type} onClick={() => handleEnterType(type)} className="interactive stagger-item" style={{
                      padding: '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
                      border: isErotic ? '1px solid rgba(220,38,38,0.15)' : '1px solid rgba(124,58,237,0.1)',
                      background: isErotic ? 'rgba(220,38,38,0.03)' : 'rgba(124,58,237,0.02)',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isErotic ? '#dc2626' : '#3b82f6', marginBottom: 4 }}>{type.replace('小说','')}</div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>{isErotic ? '26区块' : '10区块'} · {count}个模板</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : !showEditor ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}>
              <DocumentTextIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.2 }} />
              <p style={{ fontSize: 14 }}>选择左侧模板编辑，或点击「新建模板」</p>
            </div>
          ) : editorType === 'erotic' ? (
            <>
              <div style={{ padding: '12px 16px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <input value={templateName} onChange={e => setTemplateName(e.target.value)} className="focus-ring" style={{ ...inputStyle, width: '100%', fontSize: 14, fontWeight: 600 }} placeholder="输入模板名称（必填）..." />
                  </div>
              <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
                <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {SECTIONS.map(s => (
                    <SectionCard key={s.id} id={s.id} label={s.label} summary={getSectionSummary(s.id, eroticConfig)} isAuto={sectionIsAuto(s.id, eroticConfig)} onClick={() => { setEditingSection(s.id); setShowSectionModal(true) }} />
                  ))}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
                    <Button variant="secondary" onClick={() => setShowEditor(false)}>取消</Button>
                    <Button onClick={handleSaveTemplate} disabled={saving}>{saving ? '保存中...' : '💾 保存模板'}</Button>
                  </div>
                </div>
              </ScrollArea>
              <Modal isOpen={showSectionModal} onClose={() => { setShowSectionModal(false); setEditTagMode(false) }} title={editingSection ? (SECTIONS.find(s => s.id === editingSection)?.label || '') : ''} width={1100} maxHeight="90vh">
                {editingSection && (
                  <div style={{ maxHeight: '82vh', overflowY: 'auto' }} className="custom-scrollbar">
                    {editingSection !== null && <EroticSectionEditor section={editingSection} eroticConfig={eroticConfig} editTagMode={editTagMode} onUpdateConfig={setEroticConfig} onToggleAuto={toggleEroticAuto} />}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12 }}>
                  <Button variant={editTagMode ? 'primary' : 'secondary'} size="sm" onClick={() => setEditTagMode(!editTagMode)}>{editTagMode ? '✓ 完成编辑' : '✎ 编辑标签'}</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setShowSectionModal(false); setEditTagMode(false) }}>关闭</Button>
                </div>
              </Modal>
            </>
          ) : (
            <>
              <div style={{ padding: '12px 16px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)} className="focus-ring" style={{ ...inputStyle, width: '100%', fontSize: 14, fontWeight: 600 }} placeholder="输入模板名称（必填）..." />
              </div>
              <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
                <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {NOVEL_SECTIONS.map(s => (
                    <NovelSectionCard key={s.id} id={s.id} label={s.label} summary={getNovelSectionSummary(s.id, novelConfig)} isAuto={novelSectionIsAuto(s.id, novelConfig)} onClick={() => { setEditingNovelSection(s.id); setShowNovelSectionModal(true) }} />
                  ))}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
                    <Button variant="secondary" onClick={() => setShowEditor(false)}>取消</Button>
                    <Button onClick={handleSaveTemplate} disabled={saving}>{saving ? '保存中...' : '💾 保存模板'}</Button>
                  </div>
                </div>
              </ScrollArea>
              <Modal isOpen={showNovelSectionModal} onClose={() => { setShowNovelSectionModal(false); setEditTagMode(false) }} title={editingNovelSection ? (NOVEL_SECTIONS.find(s => s.id === editingNovelSection)?.label || '') : ''} width={1100} maxHeight="90vh">
                {editingNovelSection && (
                  <div style={{ maxHeight: '82vh', overflowY: 'auto' }} className="custom-scrollbar">
                    {editingNovelSection !== null && <NovelSectionEditor section={editingNovelSection} novelConfig={novelConfig} characters={characters} novelGenreType={novelGenreType} editTagMode={editTagMode} onUpdateConfig={setNovelConfig} onSetNovelGenreType={setNovelGenreType} onToggleAuto={toggleNovelAuto} />}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12 }}>
                  <Button variant={editTagMode ? 'primary' : 'secondary'} size="sm" onClick={() => setEditTagMode(!editTagMode)}>{editTagMode ? '✓ 完成编辑' : '✎ 编辑标签'}</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setShowNovelSectionModal(false); setEditTagMode(false) }}>关闭</Button>
                </div>
              </Modal>
            </>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {deleteConfirmId && (
        <ConfirmModal
          isOpen={true}
          title="删除场景模板"
          message={`确定要删除场景模板「${templates.find(t => t.id === deleteConfirmId)?.name || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
