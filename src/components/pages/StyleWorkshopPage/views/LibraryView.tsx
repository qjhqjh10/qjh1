// @ts-nocheck
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '@/components/common/GlassCard';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import ScrollArea from '@/components/common/ScrollArea';
import { inputStyle } from '@/components/common/styles';
import { DIMENSION_META, NOVEL_TYPE_DIMS, NOVEL_TYPES, NOVEL_TYPE_LABELS } from '@/types/story';
import { getTemplateDims } from '@/types/styleTemplate';
import { SparklesIcon, PlusIcon, TrashIcon, XMarkIcon, DocumentTextIcon, PaintBrushIcon, FolderOpenIcon, MagnifyingGlassIcon, ArrowsUpDownIcon, ArrowPathIcon, TagIcon } from '@heroicons/react/24/outline';
import { FEATURE_LABELS, SORT_OPTIONS, WORLD_TYPE_PRESETS, ATTITUDE_PRESETS, presetBtn, linkBtn, labelStyle, cardActionBtn } from '../constants';
import EmptyState from '@/components/common/EmptyState';

export function LibraryView({ ws }: { ws: any }) {
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
                  {ws.projects.map(p => (
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
                          <Button size="sm" variant="ghost" onClick={() => { ws.handleEnterProject(p); setTimeout(() => setShowApply(true), 100) }}>应用</Button>
                          {p.hasProfile && (
                            <Button size="sm" variant="ghost" onClick={async () => {
                              const proj = await styleProjectService.loadProject(p.id) as StyleProject
                              ws.setSelectedProject(proj)
                              setTimeout(() => handleSaveAsTemplate(), 100)
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
                  {ws.filteredAndSortedTemplates.map(t => {
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
                      onClick={() => ws.handleCreateFromType(type)}
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
          {ws.editTemplate !== null && (
            <Modal isOpen={true} onClose={() => { ws.setEditTemplate(null); setExpandedDims(new Set()); ws.setCustomWorldType(''); ws.setCustomAttitude(''); ws.setAiGenLoading(false) }} title={ws.editTemplate.id ? `编辑模板 — ${ws.editTemplate.name}` : '新建模板'} width={720}>
              <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }} className="custom-scrollbar">
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
                </div>

                {/* Tone section */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(236,72,153,0.03)', border: '1px solid rgba(236,72,153,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', marginBottom: 10 }}>🎭 叙事基调</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>基调词</div>
                      <input value={ws.editTemplate.tone?.word || ''} onChange={e => ws.setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: e.target.value, description: ws.editTemplate.tone?.description || '', attitude: ws.editTemplate.tone?.attitude || '' } })} style={inputStyle as any} placeholder="如: 冷酷复仇的性支配" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>叙述者态度</div>
                      <select
                        value={(() => {
                          if (!ws.editTemplate.tone?.attitude) return ''
                          return ATTITUDE_PRESETS.includes(ws.editTemplate.tone.attitude) ? ws.editTemplate.tone.attitude : '__custom__'
                        })()}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') {
                            ws.setCustomAttitude('')
                            ws.setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: ws.editTemplate.tone?.word || '', description: ws.editTemplate.tone?.description || '', attitude: '__custom__' } })
                          } else {
                            ws.setCustomAttitude('')
                            ws.setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: ws.editTemplate.tone?.word || '', description: ws.editTemplate.tone?.description || '', attitude: v } })
                          }
                        }}
                        style={{ ...inputStyle as any, cursor: 'pointer' }}
                      >
                        <option value="">未设置</option>
                        {ATTITUDE_PRESETS.map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                        <option value="__custom__">✎ 自定义...</option>
                      </select>
                      {(!ATTITUDE_PRESETS.includes(ws.editTemplate.tone?.attitude || '') && ws.editTemplate.tone?.attitude) && (
                        <input
                          value={ws.customAttitude || (ws.editTemplate.tone?.attitude === '__custom__' ? '' : ws.editTemplate.tone?.attitude || '')}
                          onChange={e => {
                            ws.setCustomAttitude(e.target.value)
                            ws.setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: ws.editTemplate.tone?.word || '', description: ws.editTemplate.tone?.description || '', attitude: e.target.value || '__custom__' } })
                          }}
                          style={{ ...inputStyle as any, marginTop: 4, fontSize: 11 }}
                          placeholder="输入自定义叙述者态度..."
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={labelStyle}>基调描述</div>
                    <textarea value={ws.editTemplate.tone?.description || ''} onChange={e => ws.setEditTemplate({ ...editTemplate, tone: { ...editTemplate.tone, word: ws.editTemplate.tone?.word || '', description: e.target.value, attitude: ws.editTemplate.tone?.attitude || '' } })} rows={2} style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="50-100字基调描述" />
                  </div>
                </div>

                {/* AI辅助填充维度 */}
                <div style={{ marginBottom: 14, padding: '14px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.1)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>✨ AI辅助填充维度</div>
                  <p style={{ fontSize: 11, color: '#6b5e54', margin: '0 0 8px' }}>描述你想要的写作风格，AI 将自动填充模板的维度描述、词汇和写作规则。</p>
                  <textarea
                    id="aiDescInput"
                    placeholder="例如：适合修仙小说的风格，战斗场面招式华丽，日常对话幽默轻松，古风文言和现代白话交织，节奏紧凑步步推进..."
                    style={{ width: '100%', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, outline: 'none', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', color: '#2d2520', background: '#fff', padding: 10, minHeight: 80, resize: 'vertical' }}
                  />
                  <button
                    disabled={ws.aiGenLoading || !activeConfigId}
                    onClick={async () => {
                      const desc = (document.getElementById('aiDescInput') as HTMLTextAreaElement)?.value?.trim()
                      if (!desc) { alert('请描述你想要的写作风格'); return }
                      ws.setAiGenLoading(true)
                      try {
                        const dimKeys = getTemplateDims(ws.editTemplate.type)
                        const dimList = dimKeys.map(k => `${k}(${DIMENSION_META[k]?.label || k})`).join(', ')
                        const prompt = `你是专业的写作风格分析师。请根据以下风格描述，为${ws.editTemplate.type}生成风格模板的维度数据。

风格描述: ${desc}

需要填充的维度: ${dimList}

对每个维度，请用JSON格式输出：
{
  "dimensions": {
    "维度key": { "description": "该维度的特征描述(100-200字)", "examples": ["原文例证1", "例证2"], "writingRules": ["写作规则1", "规则2"], "vocabularyList": ["词汇1", "词汇2"] },
    ...
  },
  "fullDescription": "整体风格综述(200-400字)",
  "tone": { "word": "叙事基调词", "description": "基调描述(50-100字)" }
}

只输出JSON，不要markdown。`
                        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId!)
                        const m = reply.match(/\{[\s\S]*\}/)
                        if (m) {
                          const json = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
                          ws.setEditTemplate(prev => prev ? {
                            ...prev,
                            fullDescription: json.fullDescription || prev.fullDescription,
                            tone: json.tone ? { ...prev.tone, ...json.tone } : prev.tone,
                            dimensions: { ...prev.dimensions, ...(json.dimensions || {}) },
                            source: prev.source === 'ai-generated' ? 'ai-generated' : 'manual',
                            description: prev.description || (json.fullDescription || '').slice(0, 100),
                          } : prev)
                        }
                      } catch (err) { logError('AI填充失败', err); alert('AI填充失败: ' + (err instanceof Error ? err.message : '未知错误')) }
                      ws.setAiGenLoading(false)
                    }}
                    style={{ marginTop: 8, padding: '8px 18px', borderRadius: 8, border: 'none', background: activeConfigId ? '#7c3aed' : '#d4ccc4', color: '#fff', fontSize: 12, fontWeight: 600, cursor: activeConfigId ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <SparklesIcon style={{ width: 14, height: 14 }} /> {ws.aiGenLoading ? '生成中...' : 'AI填充维度'}
                  </button>
                  {ws.editTemplate.fullDescription && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#6b5e54', lineHeight: 1.6, maxHeight: 100, overflow: 'auto', padding: 8, borderRadius: 6, background: '#fff' }}>
                      {ws.editTemplate.fullDescription}
                    </div>
                  )}
                </div>

                {/* Dimension accordion list */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>
                      维度编辑 · {
                        getTemplateDims(ws.editTemplate.type).filter(dk => (ws.editTemplate.dimensions?.[dk] as DimAnalysis)?.description).length
                      }/{getTemplateDims(ws.editTemplate.type).length} 已填充
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setExpandedDims(new Set(getTemplateDims(ws.editTemplate.type)))}
                        style={{
                          padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.12)',
                          background: 'rgba(124,58,237,0.03)', color: '#7c3aed', fontSize: 10,
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        全部展开
                      </button>
                      <button
                        onClick={() => setExpandedDims(new Set())}
                        style={{
                          padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
                          background: 'rgba(0,0,0,0.02)', color: '#6b5e54', fontSize: 10,
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        全部折叠
                      </button>
                    </div>
                  </div>

                  {/* Dimension overview tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                    {getTemplateDims(ws.editTemplate.type).map(dk => {
                      const dim = (ws.editTemplate.dimensions?.[dk] || {}) as DimAnalysis
                      const filled = !!dim.description
                      const label = DIMENSION_META[dk]?.label || dk
                      return (
                        <motion.button
                          key={dk}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => ws.toggleDimExpanded(dk)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            padding: '4px 10px', borderRadius: 8, border: 'none',
                            cursor: 'pointer', fontFamily: 'inherit',
                            borderColor: filled ? 'rgba(16,185,129,0.3)' : 'rgba(0,0,0,0.08)',
                            borderStyle: 'solid', borderWidth: 1,
                            background: ws.expandedDims.has(dk)
                              ? (filled ? 'rgba(16,185,129,0.08)' : 'rgba(124,58,237,0.05)')
                              : (filled ? 'rgba(16,185,129,0.03)' : 'rgba(0,0,0,0.01)'),
                            color: filled ? '#16a34a' : '#9b8e84',
                            fontSize: 10, fontWeight: filled ? 600 : 400,
                            transition: 'all 0.15s',
                          }}
                        >
                          {filled ? '✓' : '—'} {label}
                        </motion.button>
                      )
                    })}
                  </div>

                  {/* Expanded dimension editors */}
                  {getTemplateDims(ws.editTemplate.type).filter(dk => ws.expandedDims.has(dk)).map(dk => {
                    const meta = DIMENSION_META[dk]
                    const dim = (ws.editTemplate.dimensions?.[dk] || { description: '', examples: [], writingRules: [], vocabularyList: [] }) as DimAnalysis
                    return (
                      <motion.div
                        key={dk}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.05)', overflow: 'hidden' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{meta?.label || dk}</span>
                            <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 10, marginLeft: 6 }}>({meta?.category || ''})</span>
                          </div>
                          <button onClick={() => ws.toggleDimExpanded(dk)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }}>
                            <XMarkIcon style={{ width: 14, height: 14 }} />
                          </button>
                        </div>

                        {/* Description */}
                        <textarea
                          value={dim.description || ''}
                          onChange={e => ws.updateDim(dk, 'description', e.target.value)}
                          rows={2}
                          style={{ ...inputStyle as any, width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 11, marginBottom: 10 }}
                          placeholder="维度描述（200-400字）"
                        />

                        {/* Vocabulary tags */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            词汇清单 ({(dim.vocabularyList || []).length})
                            <button onClick={() => ws.addVocabItem(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(dim.vocabularyList || []).map((v: string, i: number) => (
                              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <input value={v} onChange={e => ws.updateVocabItem(dk, i, e.target.value)} style={{ width: 80, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="词" />
                                <button onClick={() => ws.removeVocabItem(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 10 }}>×</button>
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Writing rules */}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            写作规则 ({(dim.writingRules || []).length})
                            <button onClick={() => ws.addRule(dk)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ 添加</button>
                          </div>
                          {(dim.writingRules || []).map((r: string, i: number) => (
                            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                              <input value={r} onChange={e => ws.updateRule(dk, i, e.target.value)} style={{ flex: 1, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, fontFamily: 'inherit' }} placeholder="规则" />
                              <button onClick={() => ws.removeRule(dk, i)} style={{ background: 'none', border: 'none', color: '#9b8e84', cursor: 'pointer', fontSize: 12 }}>×</button>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0ece8' }}>
                <Button variant="secondary" onClick={() => { ws.setEditTemplate(null); setExpandedDims(new Set()); ws.setCustomWorldType(''); ws.setCustomAttitude(''); ws.setAiGenLoading(false) }}>取消</Button>
                <Button onClick={ws.handleSaveTemplate} disabled={!ws.editTemplate.name.trim()}>保存模板</Button>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
  );
}
