import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '@/components/common/GlassCard';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import ConfirmModal from '@/components/common/ConfirmModal';
import ScrollArea from '@/components/common/ScrollArea';
import { inputStyle } from '@/components/common/styles';
import { DIMENSION_META, NOVEL_TYPE_DIMS, NOVEL_TYPES, NOVEL_TYPE_LABELS } from '@/types/story';
import { DIM_PRIORITY } from '@/utils/dimTiers';
import { getTemplateDims } from '@/types/styleTemplate';
import { SparklesIcon, PlusIcon, TrashIcon, XMarkIcon, DocumentTextIcon, PaintBrushIcon, FolderOpenIcon, MagnifyingGlassIcon, ArrowsUpDownIcon, ArrowPathIcon, TagIcon } from '@heroicons/react/24/outline';
import { SORT_OPTIONS, WORLD_TYPE_PRESETS, ATTITUDE_PRESETS, labelStyle, cardActionBtn } from '../constants';

// 按维度分层排序（T0→T1→T2→T3→无分层）
function getSortedDims(type: string): { dk: string; tier: number }[] {
  const dims = getTemplateDims(type)
  const priority = DIM_PRIORITY[type] || {}
  return dims.map(dk => ({ dk, tier: priority[dk]?.tier ?? 99 }))
    .sort((a, b) => a.tier - b.tier)
}
import EmptyState from '@/components/common/EmptyState';
import type { DimAnalysis, StyleProject } from '@/types/story';

import { styleProjectService, styleTemplateService } from '@/services/fileService';
import { useSettingsStore } from '@/store';
import type { WorkspaceTab } from '../constants';

export function LibraryView({ ws }: { ws: any }) {
  const [promptTarget, setPromptTarget] = useState<any>(null)
  const [promptText, setPromptText] = useState('')
  const [promptLoaded, setPromptLoaded] = useState(false)
  const [promptSaving, setPromptSaving] = useState(false)
  const [ruleTemplates, setRuleTemplates] = useState<any[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState<string>('')

  // Load rule templates list
  React.useEffect(() => {
    styleTemplateService.listRuleTemplates().then((list: any[]) => setRuleTemplates(list || [])).catch(() => {})
  }, [])

  // Load saved prompt when opening editor (no auto-generation)
  React.useEffect(() => {
    if (!promptTarget) { setPromptText(''); setPromptLoaded(false); return }
    setPromptLoaded(false)
    styleTemplateService.readPrompt(promptTarget.id).then(saved => {
      setPromptText(saved || '')
      setPromptLoaded(true)
    }).catch(() => {
      setPromptText('')
      setPromptLoaded(true)
    })
  }, [promptTarget?.id])
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  return (
      <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 32 }}>
        <ScrollArea style={{ flex: 1 }}>
        <div style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.03)', borderRadius: 14, padding: 4 }}>
              {([
                ['archives', '风格档案', PaintBrushIcon],
                ['ws.templates', '风格模板', TagIcon],
              ] as [WorkspaceTab, string, React.ComponentType<{ style?: React.CSSProperties }>][]).map(([tab, label, Icon]) => (
                <button key={tab} onClick={() => ws.setWorkspaceTab(tab)} className="interactive-accent" style={{
                  padding: '9px 22px', borderRadius: 11, border: 'none',
                  background: ws.workspaceTab === tab ? '#fff' : 'transparent',
                  color: ws.workspaceTab === tab ? '#7c3aed' : '#9b8e84',
                  fontSize: 13, fontWeight: ws.workspaceTab === tab ? 700 : 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: ws.workspaceTab === tab ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <Icon style={{ width: 16, height: 16 }} />{label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {ws.workspaceTab === 'archives' && (
                <Button onClick={ws.handleImport} disabled={ws.loading} icon={<FolderOpenIcon style={{ width: 16, height: 16 }} />}>
                  {ws.loading ? '导入中...' : '导入TXT小说'}
                </Button>
              )}
              {ws.workspaceTab === 'ws.templates' && (
                <Button onClick={() => ws.setShowCreateTemplate(true)} icon={<PlusIcon style={{ width: 16, height: 16 }} />}>
                  新建模板
                </Button>
              )}
            </div>
          </div>

          {/* Archives Tab */}
          {ws.workspaceTab === 'archives' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520', margin: '0 0 4px' }}>风格档案</h2>
                <p style={{ fontSize: 13, color: '#9b8e84', margin: 0 }}>导入名家作品，AI分析提取写作风格</p>
              </div>
              {ws.projects.length === 0 ? (
                <EmptyState icon="🎨" title="暂无风格档案" description="导入名家作品，AI分析提取写作风格" action={{ label: '导入TXT小说', onClick: ws.handleImport }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {ws.projects.map((p: any) => (
                    <GlassCard key={p.id} hover={false} className="stagger-item" style={{ padding: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', marginBottom: 6 }}>{p.name}</h3>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#9b8e84' }}>
                            <span>{p.sourceFileName}</span>
                            <span>{p.chapterCount}章</span>
                            <span>{(p.totalCharCount/10000).toFixed(1)}万字</span>
                            <span style={{ color: '#7c3aed' }}>{p.novelType || '通用'}</span>
                            {p.hasProfile && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ 已总结</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button size="sm" onClick={() => ws.handleEnterProject(p)}>查看详情</Button>
                          <Button size="sm" variant="ghost" onClick={() => { ws.handleEnterProject(p); setTimeout(() => ws.setShowApply(true), 100) }}>应用</Button>
                          {p.hasProfile && (
                            <Button size="sm" variant="ghost" onClick={async () => {
                              const proj = await styleProjectService.loadProject(p.id) as StyleProject
                              ws.setProjectBoth(proj)
                              // v13.x: 直接传项目对象，避免 setTimeout 旧闭包读到过期 selectedProject
                              ws.handleSaveAsTemplate(proj)
                            }}>存为模板</Button>
                          )}
                          <button onClick={() => ws.handleDeleteProject(p)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#d4ccc4', borderRadius: 6 }}>
                            <TrashIcon style={{ width: 16, height: 16 }} />
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ───── 风格模板 Tab ───── */}
          {ws.workspaceTab === 'ws.templates' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520', margin: '0 0 4px' }}>风格模板</h2>
                <p style={{ fontSize: 13, color: '#9b8e84', margin: 0 }}>管理风格模板，让AI写出你想要的文风</p>
              </div>

              {/* Search + Sort bar */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
                <div className="glass" style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 12,
                }}>
                  <MagnifyingGlassIcon style={{ width: 16, height: 16, color: '#9b8e84', flexShrink: 0 }} />
                  <input
                    value={ws.templateSearch}
                    onChange={e => ws.setTemplateSearch(e.target.value)}
                    placeholder="搜索模板名称或描述..."
                    className="focus-ring"
                    style={{
                      flex: 1, border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 13, color: '#2d2520', fontFamily: 'inherit',
                    }}
                  />
                  {ws.templateSearch && (
                    <button onClick={() => ws.setTemplateSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 0, display: 'flex' }}>
                      <XMarkIcon style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 3 }}>
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => ws.setTemplateSort(opt.key)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: 'none',
                        background: ws.templateSort === opt.key ? '#fff' : 'transparent',
                        color: ws.templateSort === opt.key ? '#7c3aed' : '#9b8e84',
                        fontSize: 11, fontWeight: ws.templateSort === opt.key ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: ws.templateSort === opt.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt.key === 'updatedAt' && <ArrowsUpDownIcon style={{ width: 12, height: 12 }} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type filter tag cloud */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['all', ...Object.keys(NOVEL_TYPE_LABELS)] as const).map(t => {
                  const selected = ws.templateTab === t
                  const isErotic = t === '情色小说'
                  return (
                    <motion.button
                      key={t}
                      onClick={() => ws.setTemplateTab(t)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      style={{
                        padding: '5px 14px', borderRadius: 20, border: selected
                          ? `1.5px solid ${isErotic ? 'rgba(236,72,153,0.3)' : 'rgba(124,58,237,0.25)'}`
                          : '1px solid rgba(0,0,0,0.06)',
                        background: selected
                          ? isErotic ? 'rgba(236,72,153,0.06)' : 'rgba(124,58,237,0.06)'
                          : 'transparent',
                        color: selected ? (isErotic ? '#ec4899' : '#7c3aed') : '#9b8e84',
                        fontSize: 11, fontWeight: selected ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 0.15s, border 0.15s',
                      }}
                    >
                      {t === 'all' ? '全部' : NOVEL_TYPE_LABELS[t] || t}
                    </motion.button>
                  )
                })}
              </div>

              {/* Template Cards Grid */}
              {ws.filteredAndSortedTemplates.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    textAlign: 'center', padding: 64, color: '#9b8e84',
                    background: 'rgba(255,255,255,0.4)', borderRadius: 20,
                    border: '2px dashed rgba(0,0,0,0.06)',
                  }}
                >
                  <TagIcon style={{ width: 44, height: 44, margin: '0 auto 12px', opacity: 0.25 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#6b5e54' }}>
                    {ws.templateSearch ? '没有匹配的模板' : '暂无风格模板'}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {ws.templateSearch ? '换个搜索词试试' : (
                      <>切换到「<span style={{ color: '#7c3aed', fontWeight: 600, cursor: 'pointer' }} onClick={() => ws.setWorkspaceTab('archives')}>风格档案</span>」导入小说分析后保存为模板，或点击"新建模板"手动创建</>
                    )}
                  </div>
                  {!ws.templateSearch && (
                    <Button size="sm" style={{ marginTop: 12 }} onClick={() => ws.setShowCreateTemplate(true)} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>
                      新建模板
                    </Button>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}
                >
                  {ws.filteredAndSortedTemplates.map((t: any) => {
                    const totalDims = getTemplateDims(t.type).length
                    const filledDims = Object.values(t.dimensions || {}).filter(d => (d as DimAnalysis)?.description).length
                    const fillPct = totalDims > 0 ? Math.round((filledDims / totalDims) * 100) : 0
                    const isErotic = t.type === '情色小说'
                    const accentColor = isErotic ? '#ec4899' : '#7c3aed'
                    const accentBg = isErotic ? 'rgba(236,72,153,0.06)' : 'rgba(124,58,237,0.06)'

                    return (
                      <motion.div
                        key={t.id}
                        variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
                        whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(124,58,237,0.08)' }}
                        onClick={() => ws.setEditTemplate(t)}
                        style={{
                          padding: '18px 20px', borderRadius: 16,
                          background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)',
                          border: '1px solid rgba(255,255,255,0.6)',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
                          cursor: 'pointer', transition: 'box-shadow 0.2s ease',
                          display: 'flex', flexDirection: 'column', gap: 10,
                        }}
                      >
                        {/* Top row: type badge + source */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
                            background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}08)`,
                            color: accentColor, border: `1px solid ${accentColor}20`,
                          }}>
                            {isErotic ? '🔥 ' : '📖 '}{NOVEL_TYPE_LABELS[t.type] || t.type}
                          </span>
                          <span style={{ fontSize: 10, color: '#9b8e84' }}>
                            {t.source === 'ai-generated' ? '🤖 AI' : '✏️ 手动'}
                          </span>
                        </div>

                        {/* Name */}
                        <h4 style={{
                          fontSize: 15, fontWeight: 700, color: '#2d2520',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          margin: 0, lineHeight: 1.3,
                        }}>
                          {t.name || '未命名模板'}
                        </h4>

                        {/* Description */}
                        <p style={{
                          fontSize: 11, color: '#6b5e54', margin: 0,
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          lineHeight: 1.5, minHeight: 33,
                        }}>
                          {t.description || t.fullDescription?.slice(0, 100) || '暂无描述'}
                        </p>

                        {/* Progress bar */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}>
                            <span style={{ color: '#9b8e84' }}>维度填充</span>
                            <span style={{ color: fillPct > 0 ? accentColor : '#9b8e84', fontWeight: 600 }}>
                              {filledDims}/{totalDims} ({fillPct}%)
                            </span>
                          </div>
                          <div style={{
                            height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.05)',
                            overflow: 'hidden',
                          }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${fillPct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                              style={{
                                height: '100%', borderRadius: 2,
                                background: fillPct > 0
                                  ? `linear-gradient(90deg, ${accentColor}80, ${accentColor})`
                                  : 'rgba(0,0,0,0.04)',
                              }}
                            />
                          </div>
                        </div>

                        {/* Info row */}
                        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#9b8e84', flexWrap: 'wrap' }}>
                          {t.worldType && <span>🌍 {t.worldType}</span>}
                          {t.tone?.word && <span>🎭 {t.tone.word.slice(0, 8)}</span>}
                          <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', paddingTop: 4, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                          <button onClick={(e) => { e.stopPropagation(); ws.setEditTemplate(t) }} style={cardActionBtn}>
                            ✎ 编辑
                          </button>
                          <button onClick={async (e) => {
                            e.stopPropagation()
                            const latest = await styleTemplateService.read(t.id)
                            setPromptTarget(latest || t)
                          }} style={{ ...cardActionBtn, color: '#7c3aed' }}>
                            📝 Prompt
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); ws.handleCloneTemplate(t) }} style={cardActionBtn}>
                            <ArrowPathIcon style={{ width: 10, height: 10 }} /> 复制
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); ws.handleDeleteTemplate(t) }} style={{ ...cardActionBtn, color: '#dc2626' }}>
                            <TrashIcon style={{ width: 10, height: 10 }} /> 删除
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </motion.div>
              )}
            </div>
          )}
        </div>
        </ScrollArea>

        {/* ───── 新建模板：选择类型 ───── */}
        <AnimatePresence>
          {ws.showCreateTemplate && (
            <Modal isOpen={ws.showCreateTemplate} onClose={() => ws.setShowCreateTemplate(false)} title="新建风格模板" width={600}>
              <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 4 }}>输入模板名称（可选）：</div>
              <input id="newTmplName" style={{ ...inputStyle, marginBottom: 14 }} placeholder="例如: 古风武侠·华丽战斗风格" />
              <div style={{ fontSize: 13, color: '#6b5e54', marginBottom: 10 }}>选择小说类型：</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {Object.entries(NOVEL_TYPE_LABELS).map(([type, label]) => {
                  const dimCount = getTemplateDims(type).length
                  const isErotic = type === '情色小说'
                  return (
                    <motion.button
                      key={type}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => { const inp = document.getElementById('newTmplName') as HTMLInputElement | null; ws.handleCreateFromType(type, inp?.value || '') }}
                      style={{
                        padding: '14px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        border: isErotic ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(124,58,237,0.1)',
                        background: isErotic ? 'rgba(239,68,68,0.02)' : 'rgba(124,58,237,0.02)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: isErotic ? '#dc2626' : '#7c3aed', marginBottom: 3 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>{dimCount}个维度</div>
                    </motion.button>
                  )
                })}
              </div>
            </Modal>
          )}
        </AnimatePresence>

        {/* ───── 编辑模板 Modal ───── */}
        <AnimatePresence>
          {ws.editTemplate !== null && (() => { const editTemplate = ws.editTemplate!; return (
            <Modal isOpen={true} onClose={() => { if (ws.isDirty.current && !confirm('有未保存的修改，确定关闭？')) return; ws.isDirty.current = false; ws.setEditTemplate(null); ws.setExpandedDims(new Set()); ws.setCustomWorldType(''); ws.setCustomAttitude(''); ws.setAiGenLoading(false) }} title={editTemplate.id ? `编辑模板 — ${editTemplate.name}` : '新建模板'} width={1200} maxHeight="92vh">
              <div style={{ maxHeight: '84vh', overflowY: 'auto', paddingRight: 8 }} className="custom-scrollbar">
                {/* Basic info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>模板名称</div>
                      <input value={ws.editTemplate.name} onChange={e => ws.setEditTemplate({ ...editTemplate, name: e.target.value })} style={inputStyle as any} placeholder="输入模板名称" />
                    </div>
                    <div style={{ width: 180 }}>
                      <div style={labelStyle}>世界观</div>
                      <select
                        value={(() => {
                          if (!ws.editTemplate.worldType) return ''
                          return WORLD_TYPE_PRESETS.includes(ws.editTemplate.worldType) ? ws.editTemplate.worldType : '__custom__'
                        })()}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') {
                            ws.setCustomWorldType('')
                            ws.setEditTemplate({ ...editTemplate, worldType: '__custom__' })
                          } else {
                            ws.setCustomWorldType('')
                            ws.setEditTemplate({ ...editTemplate, worldType: v })
                          }
                        }}
                        style={{ ...inputStyle as any, cursor: 'pointer' }}
                      >
                        <option value="">未设置</option>
                        {WORLD_TYPE_PRESETS.map(w => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                        <option value="__custom__">✎ 自定义...</option>
                      </select>
                      {(!WORLD_TYPE_PRESETS.includes(ws.editTemplate.worldType) && ws.editTemplate.worldType) && (
                        <input
                          value={ws.customWorldType || (ws.editTemplate.worldType === '__custom__' ? '' : ws.editTemplate.worldType)}
                          onChange={e => {
                            ws.setCustomWorldType(e.target.value)
                            ws.setEditTemplate({ ...editTemplate, worldType: e.target.value || '__custom__' })
                          }}
                          style={{ ...inputStyle as any, marginTop: 4, fontSize: 11 }}
                          placeholder="输入自定义世界观..."
                        />
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>简介</div>
                    <input value={ws.editTemplate.description} onChange={e => ws.setEditTemplate({ ...editTemplate, description: e.target.value })} style={inputStyle as any} placeholder="一句话描述这个风格" />
                  </div>
                  {/* v12.12.0: Rule template binding */}
                  <div>
                    <div style={labelStyle}>规则模板</div>
                    <select value={ws.editTemplate.ruleTemplateId || ''}
                      onChange={e => ws.setEditTemplate({ ...editTemplate, ruleTemplateId: e.target.value || undefined })}
                      style={{ ...inputStyle as any, color: '#5c4a3a' }}>
                      <option value="">使用硬编码默认规则</option>
                      {ruleTemplates.map((rt: any) => (
                        <option key={rt.id} value={rt.id}>{rt.isSystem ? '📌' : '📐'} {rt.name} ({rt.type === 'erotic' ? '涩涩' : '通用'})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* AI辅助填充维度 */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SparklesIcon style={{ width: 16, height: 16 }} /> AI 辅助填充
                  </div>

                  {/* Dimension selection — uses aiFillDims, NOT expandedDims */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>勾选要填充的维度</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { label: '全选', fn: () => ws.setAiFillDims(new Set(getSortedDims(ws.editTemplate.type).map(s => s.dk))) },
                          { label: '仅未填', fn: () => { const s = new Set<string>(); getSortedDims(ws.editTemplate.type).forEach(x => { if (!(ws.editTemplate.dimensions?.[x.dk] as DimAnalysis)?.description) s.add(x.dk) }); ws.setAiFillDims(s) } },
                          { label: '仅T1', fn: () => { const s = new Set<string>(); getSortedDims(ws.editTemplate.type).filter(x => x.tier === 1).forEach(x => s.add(x.dk)); ws.setAiFillDims(s) } },
                          { label: '清空', fn: () => ws.setAiFillDims(new Set()) },
                        ].map(({ label, fn }) => (
                          <button key={label} onClick={fn} style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(124,58,237,0.15)', background: '#fff', color: '#7c3aed', fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {(() => {
                      const aiTiers = [{ tier: 0, color: '#7c3aed' }, { tier: 1, color: '#dc2626' }, { tier: 2, color: '#d97706' }, { tier: 3, color: '#6b7280' }, { tier: 99, color: '#0891b2' }]
                      const sortedDims = getSortedDims(ws.editTemplate.type)
                      const toggleAiDim = (dk: string) => { const next = new Set(ws.aiFillDims); next.has(dk) ? next.delete(dk) : next.add(dk); ws.setAiFillDims(next) }
                      return aiTiers.map(tg => {
                        const tierDims = sortedDims.filter(s => s.tier === tg.tier)
                        if (tierDims.length === 0) return null
                        const sel = tierDims.filter(s => ws.aiFillDims.has(s.dk)).length
                        return (
                          <div key={tg.tier} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: tg.color, width: 28, flexShrink: 0 }}>T{tg.tier === 99 ? '·' : tg.tier}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, flex: 1 }}>
                              {tierDims.map(({ dk }) => {
                                const checked = ws.aiFillDims.has(dk)
                                return (
                                  <label key={dk} onClick={() => toggleAiDim(dk)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 9, background: checked ? `${tg.color}14` : '#fff', border: `1px solid ${checked ? tg.color + '40' : 'rgba(0,0,0,0.06)'}`, color: checked ? tg.color : '#9b8e84', fontWeight: checked ? 600 : 400 }}>
                                    {checked ? '✓' : ''} {DIMENSION_META[dk]?.label || dk}
                                  </label>
                                )
                              })}
                            </div>
                            <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{sel}/{tierDims.length}</span>
                          </div>
                        )
                      })
                    })()}
                  </div>

                  <textarea id="aiDescInput" placeholder="自定义要求（可选）：补充具体的方向指引，如「战斗场面多用短句，突破境界时加入天地异象描写」..."
                    style={{ width: '100%', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, outline: 'none', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', color: '#2d2520', background: '#fff', padding: 10, minHeight: 60, resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <button
                      disabled={ws.aiGenLoading || !activeConfigId}
                      onClick={async () => {
                        const desc = (document.getElementById('aiDescInput') as HTMLTextAreaElement)?.value?.trim()
                        if (!desc) { alert('请描述你想要的写作风格'); return }
                        const selectedDims = getSortedDims(ws.editTemplate.type).filter(s => ws.aiFillDims.has(s.dk)).map(s => s.dk)
                        await ws.handleAIFillDimensions(desc, selectedDims)
                      }}
                      style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: activeConfigId ? '#7c3aed' : '#d4ccc4', color: '#fff', fontSize: 12, fontWeight: 600, cursor: activeConfigId ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <SparklesIcon style={{ width: 14, height: 14 }} /> {ws.aiGenLoading ? '生成中...' : 'AI 填充选中维度'}
                    </button>
                  </div>
                </div>

                {/* v12.11.0 Gap C: 叙事基调与综述直接编辑 */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>🎭 叙事基调与综述</div>
                  <p style={{ fontSize: 10, color: '#6b5e54', margin: '0 0 10px' }}>直接编辑，留空则使用 AI 填充的值。</p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input placeholder="基调词（如：冷热交织）" value={ws.editTemplate.toneEditable?.word || ws.editTemplate.tone?.word || ''}
                      onChange={e => ws.updateToneEditable('word', e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 12 }} />
                    <select value={(() => {
                        const att = ws.editTemplate.toneEditable?.attitude || ws.editTemplate.tone?.attitude || ''
                        return ATTITUDE_PRESETS.includes(att) ? att : (att ? '__custom__' : '')
                      })()}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__custom__') ws.updateToneEditable('attitude', '')
                        else ws.updateToneEditable('attitude', v)
                      }}
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}>
                      <option value="">叙事态度（未设置）</option>
                      {ATTITUDE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                      <option value="__custom__">自定义…</option>
                    </select>
                  </div>
                  {(() => {
                    const att = ws.editTemplate.toneEditable?.attitude || ws.editTemplate.tone?.attitude || ''
                    if (!ATTITUDE_PRESETS.includes(att) && att) {
                      return (
                        <input value={att} placeholder="自定义叙事态度…"
                          onChange={e => ws.updateToneEditable('attitude', e.target.value)}
                          style={{ width: '100%', padding: '6px 10px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 12, marginBottom: 8 }} />
                      )
                    }
                    return null
                  })()}
                  <textarea placeholder="基调描述" value={ws.editTemplate.toneEditable?.description || ws.editTemplate.tone?.description || ''}
                    onChange={e => ws.updateToneEditable('description', e.target.value)}
                    rows={2} style={{ width: '100%', padding: '6px 10px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 12, resize: 'vertical', marginBottom: 8 }} />
                  <textarea placeholder="风格综述（fullDescription，AI 注入时作为速览块）" value={ws.editTemplate.fullDescriptionEditable || ws.editTemplate.fullDescription || ''}
                    onChange={e => ws.updateFullDescriptionEditable(e.target.value)}
                    rows={4} style={{ width: '100%', padding: '6px 10px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 12, resize: 'vertical' }} />
                </div>

                {/* 五类词库编辑 */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>📚 涩涩词库（五类分类词汇）</div>
                  <p style={{ fontSize: 10, color: '#6b5e54', margin: '0 0 10px' }}>AI 分析原文后自动提取。每类 3-5 个代表性词即可。生成时 AI 参考这些词 + 构造公式创造新词。</p>
                  {[
                    { key: 'sexBody', label: '性器官/体液', color: '#ef4444', desc: '用功能性描述替换解剖学术语，如小穴/幽谷/奶子/肉穴' },
                    { key: 'roleIdentity', label: '角色/身份', color: '#f59e0b', desc: '降格称谓，如精液厕所/母狗/性玩偶/孕奴' },
                    { key: 'actionTechnique', label: '动作/技法', color: '#3b82f6', desc: '性行为动词，如打桩机/直捣黄龙/深喉/搅动' },
                    { key: 'sceneCostume', label: '场景/装扮', color: '#8b5cf6', desc: '服装道具的涩涩语义，如丝袜/长筒靴/短裤' },
                    { key: 'moanOnomatopoeia', label: '叫床/淫叫', color: '#ec4899', desc: '拟声词，如啪啪啪/咕叽咕叽/噗嗤/哦齁' },
                  ].map(({ key, label, color, desc }) => {
                    const words = (ws.editTemplate.categorizedVocab?.[key] || []).join('、')
                    return (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 70 }}>{label}</span>
                          <input
                            value={words}
                            onChange={e => ws.updateCategorizedVocab(key, e.target.value)}
                            style={{ flex: 1, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontFamily: 'inherit', background: '#fff' }}
                            placeholder={desc}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Dimension editing — tier-grouped */}
                <div style={{ marginBottom: 8 }}>
                  {(() => {
                    const sorted = getSortedDims(ws.editTemplate.type)
                    const totalDims = sorted.length
                    const filledCount = sorted.filter(({ dk }) => (ws.editTemplate.dimensions?.[dk] as DimAnalysis)?.description).length
                    const tiers = [
                      { tier: 0, label: '总基调', color: '#7c3aed', bg: 'rgba(124,58,237,0.04)', border: 'rgba(124,58,237,0.12)', desc: '定调全文走向，几十字决定全文气质' },
                      { tier: 1, label: '技法核心', color: '#dc2626', bg: 'rgba(220,38,38,0.03)', border: 'rgba(220,38,38,0.10)', desc: '直接决定感官质地，最重要最详细' },
                      { tier: 2, label: '结构支撑', color: '#d97706', bg: 'rgba(217,119,6,0.03)', border: 'rgba(217,119,6,0.10)', desc: '公式化输出场景结构' },
                      { tier: 3, label: '辅助维度', color: '#6b7280', bg: 'rgba(107,114,128,0.03)', border: 'rgba(107,114,128,0.10)', desc: '有证据则简述，补充质感' },
                      { tier: 99, label: '泛用技法', color: '#0891b2', bg: 'rgba(8,145,178,0.03)', border: 'rgba(8,145,178,0.10)', desc: '通用维度' },
                    ]

                    return (
                      <>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1410' }}>维度编辑</span>
                            <span style={{ fontSize: 11, color: '#9b8e84', marginLeft: 8 }}>{filledCount}/{totalDims} 已填充</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => ws.setExpandedDims(new Set(getSortedDims(ws.editTemplate.type).map(s => s.dk)))} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>全部展开</button>
                            <button onClick={() => ws.setExpandedDims(new Set())} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>全部折叠</button>
                          </div>
                        </div>

                        {/* Flat overview tag cloud — always visible, click to expand individual dim */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
                          {sorted.map(({ dk, tier }) => {
                            const dim = (ws.editTemplate.dimensions?.[dk] || {}) as DimAnalysis
                            const filled = !!dim.description
                            const label = DIMENSION_META[dk]?.label || dk
                            const tierColor = tiers.find(t => t.tier === tier)?.color || '#9b8e84'
                            return (
                              <motion.button
                                key={dk}
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={() => ws.toggleDimExpanded(dk)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  padding: '6px 12px', borderRadius: 8,
                                  cursor: 'pointer', fontFamily: 'inherit',
                                  border: `1px solid ${ws.expandedDims.has(dk) ? (filled ? `${tierColor}50` : `${tierColor}25`) : (filled ? 'rgba(16,185,129,0.25)' : 'rgba(0,0,0,0.05)')}`,
                                  background: ws.expandedDims.has(dk) ? (filled ? `${tierColor}14` : `${tierColor}06`) : (filled ? 'rgba(16,185,129,0.04)' : '#fff'),
                                  color: filled ? '#16a34a' : '#9b8e84',
                                  fontSize: 11, fontWeight: filled ? 600 : 400,
                                }}
                              >
                                {filled ? '✓' : ''} {label}
                              </motion.button>
                            )
                          })}
                        </div>

                        {/* Tier-grouped sections */}
                        {tiers.map(tg => {
                          const tierDims = sorted.filter(s => s.tier === tg.tier)
                          if (tierDims.length === 0) return null
                          const tierFilled = tierDims.filter(({ dk }) => (ws.editTemplate.dimensions?.[dk] as DimAnalysis)?.description).length
                          const anyExpanded = tierDims.some(({ dk }) => ws.expandedDims.has(dk))

                          return (
                            <div key={tg.tier} style={{
                              marginBottom: 10, borderRadius: 12, overflow: 'hidden',
                              border: `1px solid ${anyExpanded ? tg.border : 'rgba(0,0,0,0.04)'}`,
                              background: anyExpanded ? tg.bg : '#fafaf9',
                              transition: 'all 0.2s',
                            }}>
                              {/* Tier header */}
                              <button
                                onClick={() => {
                                  const next = new Set(ws.expandedDims)
                                  const allExpanded = tierDims.every(({ dk }) => next.has(dk))
                                  tierDims.forEach(({ dk }) => allExpanded ? next.delete(dk) : next.add(dk))
                                  ws.setExpandedDims(next)
                                }}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '11px 16px', border: 'none', background: 'transparent',
                                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as any,
                                }}>
                                <span style={{
                                  width: 28, height: 28, borderRadius: 7,
                                  background: `${tg.color}15`, color: tg.color,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 12, fontWeight: 800, flexShrink: 0,
                                }}>T{tg.tier === 99 ? '·' : tg.tier}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{tg.label}</div>
                                  <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 1 }}>{tg.desc} · {tierFilled}/{tierDims.length} 维已填充</div>
                                </div>
                                <span style={{ fontSize: 10, color: '#9b8e84' }}>
                                  {anyExpanded ? '收起 ▲' : '展开 ▼'}
                                </span>
                              </button>


                              {/* Expanded editors — only for individually toggled dims */}
                              {tierDims.filter(({ dk }) => ws.expandedDims.has(dk)).length > 0 && (
                                <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${tg.border}`, background: tg.bg }}>
                                  {tierDims.filter(({ dk }) => ws.expandedDims.has(dk)).map(({ dk }) => {
                                    const meta = DIMENSION_META[dk]
                                    const dim = (ws.editTemplate.dimensions?.[dk] || { description: '', examples: [], writingRules: [], vocabularyList: [] }) as DimAnalysis
                                    return (
                                      <motion.div
                                        key={dk}
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        style={{
                                          marginBottom: 10, padding: '14px 16px', borderRadius: 10,
                                          background: '#fff', border: `1px solid ${tg.border}`,
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{meta?.label || dk}</span>
                                            <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 10 }}>{meta?.category || ''}</span>
                                          </div>
                                          <button onClick={() => ws.toggleDimExpanded(dk)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }}>
                                            <XMarkIcon style={{ width: 14, height: 14 }} />
                                          </button>
                                        </div>
                                        <textarea value={dim.description || ''} onChange={e => ws.updateDim(dk, 'description', e.target.value)}
                                          rows={3} style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 12, marginBottom: 10 }}
                                          placeholder="维度描述（100-400字）" />

                                        <div style={{ marginBottom: 8 }}>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                            例句 ({(dim.examples || []).length})
                                            <button onClick={() => ws.addExampleItem(dk)} style={{ background: 'none', border: 'none', color: tg.color, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ 添加</button>
                                          </div>
                                          {(dim.examples || []).map((ex: string, i: number) => (
                                            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'flex-start' }}>
                                              <textarea value={ex} onChange={e => ws.updateExampleItem(dk, i, e.target.value)}
                                                rows={1} style={{ flex: 1, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', minHeight: 24 }}
                                                placeholder={`例句 ${i + 1}`} />
                                              <button onClick={() => ws.removeExampleItem(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 13, paddingTop: 2 }}>×</button>
                                            </div>
                                          ))}
                                        </div>

                                        <div style={{ marginBottom: 8 }}>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                            词汇 ({(dim.vocabularyList || []).length})
                                            <button onClick={() => ws.addVocabItem(dk)} style={{ background: 'none', border: 'none', color: tg.color, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ 添加</button>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {(dim.vocabularyList || []).map((v: string, i: number) => (
                                              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                <input value={v} onChange={e => ws.updateVocabItem(dk, i, e.target.value)}
                                                  style={{ width: 90, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontFamily: 'inherit', background: '#fafaf9' }} placeholder="词" />
                                                <button onClick={() => ws.removeVocabItem(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 10 }}>×</button>
                                              </span>
                                            ))}
                                          </div>
                                        </div>

                                        <div>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                            写作规则 ({(dim.writingRules || []).length})
                                            <button onClick={() => ws.addRule(dk)} style={{ background: 'none', border: 'none', color: tg.color, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ 添加</button>
                                          </div>
                                          {(dim.writingRules || []).map((r: string, i: number) => (
                                            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                                              <input value={r} onChange={e => ws.updateRule(dk, i, e.target.value)}
                                                style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontFamily: 'inherit', background: '#fafaf9' }} placeholder="写作规则" />
                                              <button onClick={() => ws.removeRule(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 12 }}>×</button>
                                            </div>
                                          ))}
                                        </div>
                                      {/* v12.11.0 Gap A: 复杂维度 YAML 结构化数据编辑器 */}
                                      {(['descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop'] as string[]).includes(dk) && (
                                        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 6 }}>📋 扩展结构化数据（YAML 格式，高级用户）</div>
                                          <textarea
                                            value={(ws.editTemplate.complexData as any)?.[dk] || ''}
                                            onChange={e => ws.updateComplexData(dk, e.target.value)}
                                            rows={6}
                                            placeholder={`# ${meta.label || dk} 的结构化数据（YAML）\n# 留空则使用 AI 分析自动填充的值`}
                                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e0d8cc', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', resize: 'vertical', background: '#fafaf9' }}
                                          />
                                        </div>
                                      )}
                                      </motion.div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
                <Button variant="secondary" onClick={() => { if (ws.isDirty.current && !confirm('有未保存的修改，确定关闭？')) return; ws.isDirty.current = false; ws.setEditTemplate(null); ws.setExpandedDims(new Set()); ws.setCustomWorldType(''); ws.setCustomAttitude(''); ws.setAiGenLoading(false) }}>取消</Button>
                <Button onClick={ws.handleSaveTemplate} disabled={!editTemplate.name.trim() || ws.templateSaving}>{ws.templateSaving ? '保存中...' : '保存模板'}</Button>
              </div>
            </Modal>
          ); })()}
        </AnimatePresence>

        {/* v12.12.0: Prompt 编辑弹窗 */}
        {promptTarget && (() => {
          const t = promptTarget
          return (
            <Modal isOpen={true} onClose={() => { setPromptTarget(null) }}
              title={`📝 Prompt 编辑 — ${t.name}`} width={1100} maxHeight="92vh">
              <div style={{ maxHeight: '82vh', overflow: 'auto', padding: '0 8px' }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={selectedRuleId || t.ruleTemplateId || ''}
                    onChange={e => setSelectedRuleId(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d4c4b0', background: '#fff', fontSize: 12, fontFamily: 'inherit', color: '#5c4a3a' }}>
                    <option value="">规则模板: 系统默认</option>
                    {ruleTemplates.map((rt: any) => (
                      <option key={rt.id} value={rt.id}>{rt.isSystem ? '📌' : '📐'} {rt.name} ({rt.type === 'erotic' ? '涩涩' : '通用'})</option>
                    ))}
                  </select>
                  <button onClick={async () => {
                    const gen = await ws.generatePrompt(t.id, selectedRuleId || undefined)
                    if (gen) setPromptText(gen)
                  }} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: promptText ? '#7c3aed' : '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {promptText ? '🔄 从模板重新生成' : '⚡ 生成 Prompt'}
                  </button>
                  <button onClick={() => {
                    navigator.clipboard.writeText(promptText)
                  }} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d4c4b0', background: '#fff', color: '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📋 复制全文
                  </button>
                  <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 8 }}>
                    {promptText.length.toLocaleString()} 字符
                  </span>
                </div>
                {/* Editor */}
                <textarea value={promptText} onChange={e => setPromptText(e.target.value)}
                  rows={30}
                  style={{ width: '100%', padding: '12px', border: '1px solid #e0d8cc', borderRadius: 8, fontSize: 11, fontFamily: 'monospace', resize: 'vertical', background: '#fafaf9', lineHeight: 1.6 }}
                />
                {!promptText && promptLoaded && (
                  <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 8, background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.12)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>尚未生成 Prompt</div>
                    <div style={{ fontSize: 11, color: '#6b5e54' }}>点击上方「⚡ 生成 Prompt」按钮，根据模板的维度数据、词库和规则自动生成 prompt 文本。生成后可自由编辑。</div>
                  </div>
                )}
                {promptText && (
                  <div style={{ marginTop: 8, fontSize: 10, color: '#9b8e84' }}>
                    直接编辑 prompt 全文。生成章节时优先使用此文本。模板维度数据变更后，点击「从模板重新生成」更新。
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
                <Button variant="secondary" onClick={() => setPromptTarget(null)}>取消</Button>
                <Button onClick={async () => {
                  setPromptSaving(true)
                  try {
                    await styleTemplateService.savePrompt(t.id, promptText)
                    setPromptTarget(null)
                  } catch { alert('保存失败') }
                  setPromptSaving(false)
                }} disabled={promptSaving}>{promptSaving ? '保存中...' : '保存 Prompt'}</Button>
              </div>
            </Modal>
          )
        })()}

        {/* 删除确认弹窗 */}
        {ws.deleteConfirm && (
          <ConfirmModal
            isOpen={true}
            title={ws.deleteConfirm.type === 'template' ? '删除风格模板' : '删除风格档案'}
            message={`确定要删除${ws.deleteConfirm.type === 'template' ? '风格模板' : '风格档案'}「${ws.deleteConfirm.name}」吗？此操作不可撤销。`}
            confirmLabel="删除"
            danger
            onConfirm={ws.confirmDelete}
            onCancel={ws.cancelDelete}
          />
        )}
      </div>
  );
}
