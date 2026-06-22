import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { rewriteService, rewriteTemplateService } from '@/services/fileService'
import { STAGE_NAMES, STAGE_STEPS } from '@/types/rewrite'
import type { RewriteProject } from '@/types/rewrite'
import type { RewritePromptTemplate } from '@/types/rewritePrompts'
import { formatWordCount } from '@/utils/textUtils'
import { useSettingsStore } from '@/store'
import EmptyState from '@/components/common/EmptyState'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import RewritePromptModal from '@/components/pages/RewritePromptModal'
import RewriteCreateWizard from '@/components/pages/RewriteCreateWizard'
import {
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
  BookOpenIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  SparklesIcon,
  CogIcon,
} from '@heroicons/react/24/outline'

const stageColors: Record<string, string> = {
  imported: '#f59e0b',
  split: '#3b82f6',
  summarized: '#8b5cf6',
  rewritten: '#ec4899',
  merged: '#10b981',
}

export default function RewritePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<RewriteProject[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RewriteProject | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const configs = useSettingsStore(s => s.configs)

  // Load template name for settings display
  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await rewriteService.list()
      setProjects(list)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const active = activeId ? projects.find(p => p.id === activeId) : null

  const [templateName, setTemplateName] = useState<string | null>(null)
  useEffect(() => {
    if (showSettingsModal && active?.templateId) {
      rewriteTemplateService.read(active.templateId).then((t: RewritePromptTemplate | null) => {
        setTemplateName(t?.name || null)
      }).catch(() => setTemplateName(null))
    } else {
      setTemplateName(null)
    }
  }, [showSettingsModal, active?.templateId])

  const handleOpenWizard = () => setShowWizard(true)

  const handleWizardCreated = async (project: RewriteProject) => {
    setShowWizard(false)
    await loadProjects()
    navigate(`/rewrite-workspace?id=${project.id}`)
  }

  const handleDelete = async (project: RewriteProject) => {
    try {
      await rewriteService.delete(project.id)
      if (activeId === project.id) setActiveId(null)
      await loadProjects()
    } catch (e: any) {
      alert('删除失败：' + (e.message || '未知错误'))
    }
  }

  const handleEnterProject = (project: RewriteProject) => {
    navigate(`/rewrite-workspace?id=${project.id}`)
  }

  const handleStartRename = (project: RewriteProject) => {
    setEditingName(project.id)
    setEditValue(project.name)
  }

  const handleConfirmRename = async () => {
    if (!editingName || !editValue.trim()) {
      setEditingName(null)
      return
    }
    const project = projects.find(p => p.id === editingName)
    if (!project) { setEditingName(null); return }
    try {
      await rewriteService.save({ ...project, name: editValue.trim() })
      setEditingName(null)
      await loadProjects()
    } catch (e: any) {
      alert('重命名失败：' + (e.message || '未知错误'))
    }
  }

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* ── Left Panel: Project List ── */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.35)',
      }}>
        <div style={{ padding: '20px 16px 12px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>小说改写</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleOpenWizard}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
                color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.2s ease',
              }}
            >
              <PlusIcon style={{ width: 15, height: 15 }} /> 新建项目
            </button>
          </div>
        </div>

        {/* Separator */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '0 16px' }} />

        {/* 项目列表 label */}
        <div style={{ padding: '10px 16px 4px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#6b5e54', textTransform: 'uppercase', letterSpacing: 1 }}>项目列表</span>
        </div>

        <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '0 10px 12px' }}>
          {projects.map(project => {
            const isActive = activeId === project.id
            return (
              <div
                key={project.id}
                onClick={() => setActiveId(project.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  marginBottom: 4, borderRadius: 12, cursor: 'pointer',
                  background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
                  borderLeft: isActive ? '3px solid #7c3aed' : '3px solid transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: isActive ? 700 : 500, color: isActive ? '#7c3aed' : '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.name}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#9b8e84', marginTop: 2, alignItems: 'center' }}>
                    <span>{project.chapterCount}章</span>
                    <span>{formatWordCount(project.wordCount)}字</span>
                    <span style={{
                      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                      fontSize: 10, fontWeight: 600,
                      background: `${stageColors[project.stage]}18`,
                      color: stageColors[project.stage],
                    }}>
                      {STAGE_NAMES[project.stage]}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
          {projects.length === 0 && !loading && (
            <div style={{ padding: 16 }}>
              <EmptyState icon="📖" title="暂无改写项目" description="点击「新建项目」导入小说TXT" />
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Detail / Empty ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.25)' }}>
        {/* Header — aligned with left panel new-project button + separator */}
        <div style={{ padding: '20px 16px 12px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>项目详情</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowPromptModal(true)}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '9px 0', borderRadius: 10, border: '1px solid rgba(124,58,237,0.2)',
                cursor: 'pointer', background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
            >
              <SparklesIcon style={{ width: 14, height: 14 }} /> 提示词
            </button>
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '0 16px' }} />

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {active ? (
          <div style={{
            width: '82%', minWidth: 520, maxWidth: 880, minHeight: '75vh', margin: '40px auto',
            padding: '44px 48px', borderRadius: 24,
            background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
          }}>
            {/* Project Name (editable) */}
            <div style={{ marginBottom: 40 }}>
              {editingName === active.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') setEditingName(null) }}
                    autoFocus
                    style={{
                      flex: 1, fontSize: 24, fontWeight: 700, color: '#1a1410',
                      padding: '4px 12px', borderRadius: 8, border: '2px solid #7c3aed',
                      outline: 'none', fontFamily: 'inherit', background: '#fff',
                    }}
                  />
                  <button onClick={handleConfirmRename} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', padding: 4 }}>
                    <CheckIcon style={{ width: 20, height: 20 }} />
                  </button>
                  <button onClick={() => setEditingName(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 4 }}>
                    <XMarkIcon style={{ width: 20, height: 20 }} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ fontSize: 24, fontWeight: 700, color: '#2d2520', margin: 0 }}>
                    {active.name}
                  </h3>
                  <button
                    onClick={() => handleStartRename(active)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 4, borderRadius: 6 }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = 'rgba(124,58,237,0.08)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#9b8e84'; e.currentTarget.style.background = 'transparent' }}
                    title="重命名"
                  >
                    <PencilIcon style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              )}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 40, borderRadius: 16, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.06)', overflow: 'hidden' }}>
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{active.chapterCount}</div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>章节数</div>
              </div>
              <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>{formatWordCount(active.wordCount)}</div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>字数</div>
              </div>
              <div style={{ width: 1, background: 'rgba(124,58,237,0.06)' }} />
              <div className="stagger-item" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: stageColors[active.stage], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: stageColors[active.stage], display: 'inline-block' }} />
                  {STAGE_NAMES[active.stage]}
                </div>
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>当前阶段</div>
              </div>
            </div>

            {/* Stage progress */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 48 }}>
              {STAGE_STEPS.map(step => {
                const stageMap: Record<string, string> = { splitting: 'split', summarizing: 'summarized', rewriting: 'rewritten', merging: 'merged' }
                const reqStage = stageMap[step.key]
                const stageOrder = ['imported', 'split', 'summarized', 'rewritten', 'merged']
                const isReached = stageOrder.indexOf(active.stage) >= stageOrder.indexOf(reqStage)
                return (
                  <div key={step.key} style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: isReached ? '#7c3aed' : '#e5e0da',
                      color: isReached ? '#fff' : '#9b8e84',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, fontWeight: 700, margin: '0 auto',
                      transition: 'all 0.3s ease',
                    }}>
                      {step.num}
                    </div>
                    <div style={{ fontSize: 10, color: isReached ? '#7c3aed' : '#9b8e84', marginTop: 4, fontWeight: isReached ? 600 : 400 }}>
                      {step.label}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24, paddingTop: 28, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <Button
                variant="accent-gradient"
                onClick={() => handleEnterProject(active)}
                icon={<ArrowRightIcon style={{ width: 16, height: 16 }} />}
                style={{ flex: 1, justifyContent: 'center', padding: '12px 0', fontSize: 14 }}
              >
                进入项目
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowSettingsModal(true)}
                icon={<CogIcon style={{ width: 14, height: 14 }} />}
                style={{ padding: '12px 24px' }}
              >
                查看设置
              </Button>
              <Button
                variant="danger"
                onClick={() => setDeleteTarget(active)}
                icon={<TrashIcon style={{ width: 14, height: 14 }} />}
                style={{ padding: '12px 24px' }}
              >
                删除
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState icon="📖" title="小说改写" description="选择左侧项目查看详情，或点击「新建项目」导入小说TXT" />
        )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="删除改写项目" width={440}>
        <p style={{ fontSize: 14, color: '#4a3f38', lineHeight: 1.8 }}>
          确定删除项目「<strong>{deleteTarget?.name}</strong>」吗？
        </p>
        <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8, lineHeight: 1.6 }}>
          该操作不可撤销，项目内所有内容（原书、拆分章节、总结、改写、合并输出）将被永久删除。
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="danger" onClick={() => { if (deleteTarget) { handleDelete(deleteTarget); setDeleteTarget(null) } }}>确定删除</Button>
        </div>
      </Modal>

      {/* View Settings Modal */}
      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="项目设置" width={520}>
        {active && (() => {
          const modelConfig = active.modelConfigId ? configs.find(c => c.id === active.modelConfigId) : null
          const settingsRows = [
            { icon: '📄', label: '源文件', value: active.sourceFileName },
            { icon: '📑', label: '章节数', value: `${active.chapterCount} 章` },
            { icon: '📝', label: '总字数', value: formatWordCount(active.wordCount) },
            { icon: '⚙️', label: '模型配置', value: modelConfig ? `${modelConfig.name} (${modelConfig.model})` : (active.modelConfigId ? '(已删除)' : '使用全局默认') },
            { icon: '🔗', label: '并发线程', value: `${active.concurrentThreads || 3} 个线程` },
            { icon: '✏️', label: '改写字数', value: `${active.rewriteWordTarget || 4000} 字/章` },
            { icon: '📋', label: '提示词模板', value: active.templateId ? (templateName || '加载中...') : '不使用模板' },
          ]
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {settingsRows.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 0',
                  borderBottom: i < settingsRows.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{row.icon}</span>
                  <span style={{ fontSize: 13, color: '#9b8e84', width: 72, flexShrink: 0 }}>{row.label}</span>
                  <span style={{ fontSize: 14, color: '#2d2520', fontWeight: 500, wordBreak: 'break-all' }}>{row.value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
                <Button variant="secondary" onClick={() => setShowSettingsModal(false)}>关闭</Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Prompt Template Modal */}
      <RewritePromptModal isOpen={showPromptModal} onClose={() => setShowPromptModal(false)} />

      {/* New Project Wizard */}
      <RewriteCreateWizard isOpen={showWizard} onClose={() => setShowWizard(false)} onCreated={handleWizardCreated} />
    </div>
  )
}
