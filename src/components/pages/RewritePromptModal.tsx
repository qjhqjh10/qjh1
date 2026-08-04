import { useState, useEffect, useCallback, useRef } from 'react'
import { rewriteTemplateService } from '@/services/fileService'
import type { RewritePromptTemplate, SceneRule } from '@/types/rewritePrompts'
import ScrollArea from '@/components/common/ScrollArea'
import EmptyState from '@/components/common/EmptyState'
import ConfirmModal from '@/components/common/ConfirmModal'
import {
  XMarkIcon,
  PlusIcon,
  DocumentTextIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ArrowLeftIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline'

// ── Helper: generate unique ID ──
function uid(): string {
  return 'sr_' + Math.random().toString(36).slice(2, 10)
}

// ── Empty template factory ──
function emptyTemplate(): RewritePromptTemplate {
  return {
    id: '',
    name: '未命名模板',
    systemPrompt: '',
    sceneRules: [],
    universalGuidance: '',
    sceneGuidance: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

type TabKey = 'systemPrompt' | 'sceneRules' | 'rewriteRules'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** v15.1: 打开时定位到指定模板（改写工作台「查看」按钮跳转） */
  initialTemplateId?: string | null
}

export default function RewritePromptModal({ isOpen, onClose, initialTemplateId }: Props) {
  // ── State ──
  const [templates, setTemplates] = useState<RewritePromptTemplate[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<RewritePromptTemplate | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('systemPrompt')
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const prevActiveIdRef = useRef<string | null>(null)
  // v15.1: 删除确认弹窗状态
  const [deleteTarget, setDeleteTarget] = useState<RewritePromptTemplate | null>(null)

  // ── Load templates ──
  const loadTemplates = useCallback(async () => {
    try {
      const list = await rewriteTemplateService.list()
      setTemplates(list)
      if (list.length > 0 && !activeId) {
        setActiveId(list[0].id)
      }
    } catch { /* ignore */ }
  }, [activeId])

  useEffect(() => {
    if (isOpen) {
      loadTemplates()
      setSearch('')
      // v15.1: 定位到指定模板（改写工作台「查看」跳转）
      if (initialTemplateId) setActiveId(initialTemplateId)
      else if (templates.length > 0 && !activeId) setActiveId(templates[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTemplateId])

  // ── Filtered templates (search) ──
  const filteredTemplates = search.trim()
    ? templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates

  // ── When activeId changes, load editing template (preserve tab on template refresh) ──
  useEffect(() => {
    const activeIdChanged = activeId !== prevActiveIdRef.current
    prevActiveIdRef.current = activeId

    if (activeId) {
      const t = templates.find(t => t.id === activeId)
      setEditing(t ? { ...t } : null)
    } else {
      setEditing(null)
    }
    // Only reset tab when switching to a different template, not on save refresh
    if (activeIdChanged) {
      setActiveTab('systemPrompt')
      setExpandedSceneId(null)
    }
  }, [activeId, templates])

  const active = activeId ? templates.find(t => t.id === activeId) : null

  // ── Actions ──
  const handleNew = async () => {
    try {
      const tmpl = emptyTemplate()
      const saved = await rewriteTemplateService.save(tmpl)
      await loadTemplates()
      setActiveId(saved.id)
    } catch (e: any) {
      alert('创建模板失败：' + (e.message || '未知错误'))
    }
  }

  const handleImport = async () => {
    try {
      const imported = await rewriteTemplateService.import()
      if (imported) {
        await loadTemplates()
        setActiveId(imported.id)
      }
    } catch (e: any) {
      alert('导入失败：' + (e.message || '未知错误'))
    }
  }

  const handleExport = async (id: string) => {
    try {
      const path = await rewriteTemplateService.export(id)
      if (!path) alert('导出已取消')
    } catch (e: any) {
      alert('导出失败：' + (e.message || '未知错误'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await rewriteTemplateService.delete(id)
      if (activeId === id) {
        const remaining = templates.filter(t => t.id !== id)
        setActiveId(remaining.length > 0 ? remaining[0].id : null)
      }
      await loadTemplates()
    } catch (e: any) {
      alert('删除失败：' + (e.message || '未知错误'))
    }
  }

  // v15.1: 复制模板 — 深拷贝并创建新模板，名称追加（N）数字后缀便于区分
  const handleDuplicate = async (id: string) => {
    try {
      const t = templates.find(x => x.id === id)
      if (!t) return
      // 生成最小未用的数字后缀：xxx → xxx（1）、xxx（2）…
      const usedNumbers = templates
        .filter(x => x.id !== id)
        .map(x => {
          const m = x.name.match(/^(.*)（(\d+)）$/)
          return m && m[1] === t.name ? Number(m[2]) : 0
        })
        .filter(n => n > 0)
      let n = 1
      while (usedNumbers.includes(n)) n++
      const copy: RewritePromptTemplate = {
        ...t,
        id: '',
        name: `${t.name}（${n}）`,
        sceneRules: t.sceneRules.map(r => ({ ...r, id: `sr_${Math.random().toString(36).slice(2, 10)}` })),
        sceneGuidance: { ...t.sceneGuidance },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const saved = await rewriteTemplateService.save(copy)
      await loadTemplates()
      setActiveId(saved.id)
    } catch (e: any) {
      alert('复制失败：' + (e.message || '未知错误'))
    }
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const saved = await rewriteTemplateService.save(editing)
      setEditing({ ...saved })
      await loadTemplates()
    } catch (e: any) {
      alert('保存失败：' + (e.message || '未知错误'))
    }
    setSaving(false)
  }

  // ── Scene rule helpers ──
  const handleAddSceneRule = () => {
    if (!editing) return
    const newRule: SceneRule = {
      id: uid(),
      name: '新场景',
      triggerCondition: '',
    }
    setEditing({
      ...editing,
      sceneRules: [...editing.sceneRules, newRule],
      sceneGuidance: { ...editing.sceneGuidance, [newRule.id]: '' },
    })
    setExpandedSceneId(newRule.id)
  }

  const handleDeleteSceneRule = (sceneId: string) => {
    if (!editing) return
    const newGuidance = { ...editing.sceneGuidance }
    delete newGuidance[sceneId]
    setEditing({
      ...editing,
      sceneRules: editing.sceneRules.filter(s => s.id !== sceneId),
      sceneGuidance: newGuidance,
    })
    if (expandedSceneId === sceneId) setExpandedSceneId(null)
  }

  const handleUpdateSceneRule = (sceneId: string, field: 'name' | 'triggerCondition', value: string) => {
    if (!editing) return
    setEditing({
      ...editing,
      sceneRules: editing.sceneRules.map(s =>
        s.id === sceneId ? { ...s, [field]: value } : s
      ),
    })
  }

  const handleUpdateSceneGuidance = (sceneId: string, value: string) => {
    if (!editing) return
    setEditing({
      ...editing,
      sceneGuidance: { ...editing.sceneGuidance, [sceneId]: value },
    })
  }

  // ── Render helpers ──
  const renderSystemPromptTab = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 0' }}>
      <textarea
        value={editing?.systemPrompt || ''}
        onChange={e => {
          if (editing) setEditing({ ...editing, systemPrompt: e.target.value })
        }}
        placeholder="在此填写系统破甲提示词..."
        style={{
          flex: 1, minHeight: 350, padding: '14px 16px',
          borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)',
          fontSize: 15, lineHeight: 1.8, color: '#1a1410',
          resize: 'vertical', fontFamily: '"Noto Serif SC", "Source Han Serif SC", SimSun, serif',
          background: '#fff', outline: 'none',
        }}
      />
    </div>
  )

  const renderSceneRulesTab = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 0', minHeight: 0 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}>剧情场景规则</span>
          <span style={{
            fontSize: 13, padding: '2px 10px', borderRadius: 12,
            background: 'rgba(124,58,237,0.1)', color: '#7c3aed', fontWeight: 600,
          }}>
            {editing?.sceneRules.length || 0} 个场景
          </span>
        </div>
        <button
          onClick={handleAddSceneRule}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '7px 16px', borderRadius: 8, border: '1px solid #7c3aed',
            cursor: 'pointer', background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            transition: 'all 0.12s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
        >
          <PlusIcon style={{ width: 15, height: 15 }} /> 添加场景规则
        </button>
      </div>

      {/* Scene list */}
      <ScrollArea style={{ flex: 1 }}>
        {editing && editing.sceneRules.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {editing.sceneRules.map(rule => {
              const isExpanded = expandedSceneId === rule.id
              return (
                <div key={rule.id} style={{
                  borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)',
                  background: isExpanded ? 'rgba(124,58,237,0.02)' : '#fff',
                  overflow: 'hidden', transition: 'all 0.15s ease',
                }}>
                  {/* Collapsed row */}
                  <div
                    onClick={() => setExpandedSceneId(isExpanded ? null : rule.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#9b8e84', transition: 'transform 0.2s ease', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      ▶
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', flex: 1 }}>
                      {rule.name || '未命名场景'}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSceneRule(rule.id) }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#9b8e84', padding: 4, borderRadius: 4,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#9b8e84'; e.currentTarget.style.background = 'transparent' }}
                      title="删除场景"
                    >
                      <TrashIcon style={{ width: 16, height: 16 }} />
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Scene name */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }}>场景名称</div>
                        <input
                          type="text"
                          value={rule.name}
                          onChange={e => handleUpdateSceneRule(rule.id, 'name', e.target.value)}
                          placeholder="如：恋爱场景、战斗场景、日常对话..."
                          style={{
                            width: '100%', padding: '9px 14px', borderRadius: 8,
                            border: '1px solid rgba(0,0,0,0.12)', fontSize: 14,
                            color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                            background: '#fff', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      {/* Trigger condition */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }}>触发条件</div>
                        <textarea
                          value={rule.triggerCondition}
                          onChange={e => handleUpdateSceneRule(rule.id, 'triggerCondition', e.target.value)}
                          placeholder="描述AI如何识别该场景，如：出现情侣互动、亲密描写、感情纠葛等..."
                          rows={3}
                          style={{
                            width: '100%', padding: '9px 14px', borderRadius: 8,
                            border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, lineHeight: 1.6,
                            color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                            background: '#fff', resize: 'vertical', boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
            <EmptyState icon="🎬" title="暂无场景规则" description="点击「添加场景规则」创建自定义场景类型" />
          </div>
        )}
      </ScrollArea>
    </div>
  )

  const renderRewriteRulesTab = () => (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '16px 0', minHeight: 0 }}>
      {/* Left: 通用指导 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>通用指导</div>
        <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 10 }}>适用于所有场景的统一改写规则</div>
        <textarea
          value={editing?.universalGuidance || ''}
          onChange={e => {
            if (editing) setEditing({ ...editing, universalGuidance: e.target.value })
          }}
          placeholder="在此填写适用于所有场景的通用改写指导..."
          style={{
            flex: 1, minHeight: 250, padding: '12px 14px',
            borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
            fontSize: 15, lineHeight: 1.8, color: '#1a1410',
            resize: 'vertical', fontFamily: '"Noto Serif SC", "Source Han Serif SC", SimSun, serif',
            background: '#fff', outline: 'none',
          }}
        />
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(0,0,0,0.06)', flexShrink: 0 }} />

      {/* Right: 场景特定 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>场景特定</div>
        <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 10 }}>
          {editing && editing.sceneRules.length > 0
            ? '为每个场景类型填写针对性的改写指导'
            : '请先在「场景识别」中添加场景规则'}
        </div>
        <ScrollArea style={{ flex: 1, minHeight: 250 }}>
          {editing && editing.sceneRules.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {editing.sceneRules.map(rule => (
                <div key={rule.id}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }}>
                    {rule.name || '未命名场景'}
                  </div>
                  <textarea
                    value={editing.sceneGuidance[rule.id] || ''}
                    onChange={e => handleUpdateSceneGuidance(rule.id, e.target.value)}
                    placeholder={`针对「${rule.name || '未命名场景'}」的改写指导...`}
                    rows={4}
                    style={{
                      width: '100%', padding: '9px 14px', borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, lineHeight: 1.6,
                      color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                      background: '#fff', resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
              <EmptyState icon="📝" title="暂无场景" description="请先在「场景识别」中添加场景规则" />
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'systemPrompt': return renderSystemPromptTab()
      case 'sceneRules': return renderSceneRulesTab()
      case 'rewriteRules': return renderRewriteRulesTab()
      default: return null
    }
  }

  // ── Auto-save on close (overlay click or back button) ──
  const handleClose = useCallback(async () => {
    if (editing) {
      try {
        await rewriteTemplateService.save(editing)
      } catch { /* silent save on close */ }
    }
    onClose()
  }, [editing, onClose])

  // ── Don't render if not open ──
  if (!isOpen) return null

  // ── Tab config ──
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'systemPrompt', label: '系统破甲' },
    { key: 'sceneRules', label: '场景识别' },
    { key: 'rewriteRules', label: '改写规则' },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
    }} onClick={handleClose}>
      <div style={{
        width: '90vw', height: '85vh', maxWidth: 1400,
        background: '#fff', borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* ═══ Header ═══ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleClose}
              title="保存并返回"
              style={{
                width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#6b5e54',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.08)'; e.currentTarget.style.color = '#7c3aed' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b5e54' }}
            >
              <ArrowLeftIcon style={{ width: 20, height: 20 }} />
            </button>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', margin: 0 }}>提示词管理</h3>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleNew}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
            >
              <PlusIcon style={{ width: 16, height: 16 }} /> 新建模板
            </button>
            <button
              onClick={handleImport}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '8px 18px', borderRadius: 10, border: '1px solid #7c3aed',
                cursor: 'pointer', background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
            >
              <ArrowUpTrayIcon style={{ width: 16, height: 16 }} /> 导入模板
            </button>
          </div>
        </div>

        {/* ═══ Body ═══ */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* ── Left: Template list (3/11) ── */}
          <div style={{
            width: '27%', flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.5)',
          }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#9b8e84', textTransform: 'uppercase', letterSpacing: 1 }}>
                模板列表
              </div>
              <div style={{ fontSize: 14, color: '#6b5e54', marginTop: 2 }}>
                {search.trim() ? `${filteredTemplates.length}/${templates.length} 个模板` : `${templates.length} 个模板`}
              </div>
            </div>
            {/* Search input */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索模板名称..."
                style={{
                  width: '100%', padding: '7px 12px', borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.1)', fontSize: 13,
                  color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                  background: '#fff', boxSizing: 'border-box',
                }}
              />
            </div>
            <ScrollArea style={{ flex: 1 }}>
              {filteredTemplates.map(tmpl => (
                <div
                  key={tmpl.id}
                  onClick={() => setActiveId(tmpl.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 14px', cursor: 'pointer',
                    background: activeId === tmpl.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                    borderLeft: activeId === tmpl.id ? '3px solid #7c3aed' : '3px solid transparent',
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={e => { if (activeId !== tmpl.id) e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
                  onMouseLeave={e => { if (activeId !== tmpl.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <DocumentTextIcon style={{ width: 16, height: 16, flexShrink: 0, color: activeId === tmpl.id ? '#7c3aed' : '#9b8e84' }} />
                  <span style={{
                    flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: activeId === tmpl.id ? '#7c3aed' : '#2d2520', fontWeight: activeId === tmpl.id ? 600 : 400,
                  }}>
                    {tmpl.name}
                  </span>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); handleExport(tmpl.id) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2, borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#9b8e84' }}
                      title="导出模板"
                    >
                      <ArrowDownTrayIcon style={{ width: 14, height: 14 }} />
                    </button>
                    {/* v15.1: 复制模板 */}
                    <button
                      onClick={e => { e.stopPropagation(); handleDuplicate(tmpl.id) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2, borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#9b8e84' }}
                      title="复制模板（创建相同副本）"
                    >
                      <DocumentDuplicateIcon style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(tmpl) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2, borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#dc2626' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#9b8e84' }}
                      title="删除模板"
                    >
                      <TrashIcon style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
              ))}
              {templates.length === 0 ? (
                <div style={{ padding: 20 }}>
                  <EmptyState icon="📋" title="暂无模板" description="点击「新建模板」或「导入模板」" />
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div style={{ padding: 20 }}>
                  <EmptyState icon="🔍" title="无匹配模板" description={`没有名称包含"${search}"的模板`} />
                </div>
              ) : null}
            </ScrollArea>
          </div>

          {/* v15.1: 删除确认弹窗（替代原 window.confirm） */}
          <ConfirmModal
            isOpen={deleteTarget !== null}
            title="删除提示词模板"
            message={`确定要删除模板「${deleteTarget?.name || ''}」吗？\n删除后不可恢复，已使用该模板的改写项目将不再引用它。`}
            confirmLabel="删除"
            danger
            onConfirm={() => {
              if (deleteTarget) { handleDelete(deleteTarget.id); setDeleteTarget(null) }
            }}
            onCancel={() => setDeleteTarget(null)}
          />

          {/* ── Right: Template details (8/11) ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {editing ? (
              <>
                {/* Template name row */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)',
                  background: 'rgba(255,255,255,0.4)', flexShrink: 0,
                }}>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="模板名称"
                    style={{
                      flex: 1, padding: '8px 14px', borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.12)', fontSize: 16, fontWeight: 600,
                      color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                      background: '#fff',
                    }}
                  />
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '8px 22px', borderRadius: 10, border: 'none',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                      opacity: saving ? 0.6 : 1, transition: 'all 0.12s ease',
                    }}
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>

                {/* Tab buttons */}
                <div style={{
                  display: 'flex', gap: 0,
                  padding: '0 20px', borderBottom: '1px solid rgba(0,0,0,0.04)',
                  flexShrink: 0,
                }}>
                  {tabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      style={{
                        padding: '10px 20px', border: 'none', cursor: 'pointer',
                        background: 'transparent', fontFamily: 'inherit',
                        fontSize: 15, fontWeight: activeTab === tab.key ? 700 : 500,
                        color: activeTab === tab.key ? '#7c3aed' : '#9b8e84',
                        borderBottom: activeTab === tab.key ? '2px solid #7c3aed' : '2px solid transparent',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { if (activeTab !== tab.key) e.currentTarget.style.color = '#4a3f38' }}
                      onMouseLeave={e => { if (activeTab !== tab.key) e.currentTarget.style.color = '#9b8e84' }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div style={{ flex: 1, padding: '0 20px', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {renderTabContent()}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <EmptyState icon="📋" title="选择左侧模板" description="或点击「新建模板」创建" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
