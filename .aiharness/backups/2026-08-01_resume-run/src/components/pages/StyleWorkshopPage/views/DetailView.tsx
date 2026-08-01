import type { StyleProject, StyleChapter, ChapterAnalysis, StyleProfile, StyleProjectMeta } from '@/types/story';
import type { ResultTab } from '../constants';
import { DIMENSION_META, NOVEL_TYPE_DIMS, NOVEL_TYPES } from '@/types/story';
import { styleProjectService } from '@/services/fileService';
import { logError } from '@/utils/logger';
import Button from '@/components/common/Button';
import ScrollArea from '@/components/common/ScrollArea';
import GlassCard from '@/components/common/GlassCard';
import Modal from '@/components/common/Modal';
import ConfirmModal from '@/components/common/ConfirmModal';
import { inputStyle } from '@/components/common/styles';
import { ArrowLeftIcon, TrashIcon, SparklesIcon, CheckCircleIcon, XMarkIcon, ArrowPathIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { FEATURE_LABELS, parsePromptDescription, presetBtn, linkBtn, labelStyle, cardActionBtn } from '../constants';

export function DetailView({ ws }: { ws: any }) {
  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { ws.setView('library'); ws.setProjectBoth(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', display: 'flex', padding: 4 }}><ArrowLeftIcon style={{ width: 20, height: 20 }} /></button>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{ws.selectedProject.name}</h2>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>{ws.selectedProject.chapters.length}章 {(ws.selectedProject.totalCharCount/10000).toFixed(1)}万字</span>
          {ws.selectedProject.profile && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ 已总结</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => ws.setShowApply(true)}>应用到项目</Button>
          <Button size="sm" variant="danger" onClick={() => ws.handleDeleteProject({ id: ws.selectedProject.id, name: ws.selectedProject.name, sourceFileName: '', chapterCount: 0, totalCharCount: 0, hasProfile: false, createdAt: '', novelType: '通用' })} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
        </div>
      </div>

      {/* Analyze bar */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap' }}>
        <button onClick={() => ws.setAnalyzeIds(new Set(ws.selectedProject.chapters.map((c: { id: string }) => c.id)))} style={linkBtn}>全选</button>
        <button onClick={() => ws.setAnalyzeIds(new Set())} style={linkBtn}>清空</button>
        <button onClick={() => ws.setAnalyzeIds(new Set(ws.selectedProject.chapters.slice(0, 50).map((c: { id: string }) => c.id)))} style={linkBtn}>前50章</button>
        <button onClick={() => ws.setAnalyzeIds(new Set(ws.selectedProject.chapters.slice(0, 10).map((c: { id: string }) => c.id)))} style={linkBtn}>前10章</button>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>已选 {ws.analyzeIds.size}章</span>
        <select value={ws.analyzeMode} onChange={e => ws.setAnalyzeMode(e.target.value as 'precise' | 'quick')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}><option value="precise">全量分析</option><option value="quick">抽样分析</option></select>
        <Button size="sm" variant="secondary" onClick={() => ws.setShowDimConfig(true)}>配置维度 ({ws.enabledDimensions.length})</Button>
        <Button size="sm" variant="ghost" onClick={() => ws.setShowDimDetail(true)}>维度详情</Button>
        <Button size="sm" onClick={ws.handleAnalyze} disabled={ws.analyzeLoading || !ws.activeConfigId || ws.analyzeIds.size === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>{ws.analyzeLoading ? '分析中...' : '开始分析'}</Button>
        {ws.analyzedChapters.length > 0 && <Button size="sm" variant="secondary" onClick={() => { ws.setShowResult(true); ws.setResultTab('chapters') }}>分析结果 ({ws.analyzedChapters.length}章)</Button>}
        {ws.analyzeProgress && <span style={{ fontSize: 11, color: '#7c3aed' }}>{ws.analyzeProgress}</span>}
      </div>

      {/* Main: left chapters + right content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: chapter list */}
        <div style={{ width: 340, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 6 }}>
            {ws.selectedProject.chapters.map((ch: any) => (
              <div key={ch.id} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', cursor: 'pointer',
                borderRadius: 8, background: ws.selectedChapterId === ch.id ? 'rgba(124,58,237,0.06)' : 'transparent',
                fontSize: 12, color: ws.selectedChapterId === ch.id ? '#7c3aed' : '#2d2520',
                fontWeight: ws.selectedChapterId === ch.id ? 600 : 400,
              }} onClick={() => ws.setSelectedChapterId(ch.id)}>
                <input type="checkbox" checked={ws.analyzeIds.has(ch.id)} onChange={() => ws.toggleAnalyzeId(ch.id)}
                  style={{ width: 13, height: 13, accentColor: '#7c3aed', flexShrink: 0 }} onClick={e => e.stopPropagation()} />
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, wordBreak: 'break-all' }}>{ch.title}</span>
                <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{(ch.charCount/1000).toFixed(0)}k</span>
                {ch.analyzed && <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                {ch.analyzed && (
                  <button onClick={e => { e.stopPropagation(); ws.clearChapterAnalysis(ch.id) }}
                    title="清除本章分析" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#d4ccc4', display: 'flex', flexShrink: 0 }}>
                    <XMarkIcon style={{ width: 11, height: 11 }} />
                  </button>
                )}
              </div>
            ))}
          </ScrollArea>
        </div>

        {/* Right: chapter content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {ws.selectedChapter ? (
            <div style={{ flex: 1, padding: '20px 28px', overflowY: 'auto', fontSize: 18, lineHeight: 2.0, color: '#4a3f38', whiteSpace: 'pre-wrap' }} className="custom-scrollbar">
              {ws.selectedChapter.content || '（本章无内容）'}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
              <div style={{ textAlign: 'center' }}><DocumentTextIcon style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.3 }} /><p>选择左侧章节查看内容</p></div>
            </div>
          )}
        </div>
      </div>

      {/* Analysis Result Modal */}
      <Modal isOpen={ws.showResult} onClose={() => ws.setShowResult(false)} title={`分析结果 — ${ws.selectedProject.name}`} width={window.innerWidth > 1300 ? 1200 : 680 * 2}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
            {([['chapters', '章节分析'], ['overall', '小说整体风格']] as [ResultTab, string][]).map(([k, label]) => (
              <button key={k} onClick={() => ws.setResultTab(k)} style={{
                padding: '8px 20px', border: 'none', background: 'transparent', fontSize: 13,
                fontWeight: ws.resultTab === k ? 700 : 500, color: ws.resultTab === k ? '#7c3aed' : '#6b5e54',
                borderBottom: ws.resultTab === k ? '2px solid #7c3aed' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -2, transition: 'all 0.15s ease',
              }}>{label}</button>
            ))}
          </div>

          {ws.resultTab === 'chapters' && (
            <div className="custom-scrollbar" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {ws.analyzedChapters.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9b8e84', fontSize: 13, padding: 40 }}>暂无已分析的章节</p>
              ) : (
                ws.analyzedChapters.map((ch: any) => (
                  <div key={ch.id} style={{ padding: '12px 14px', borderRadius: 12, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>{ch.title}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#9b8e84' }}>{ch.analysis!.analyzedAt ? new Date(ch.analysis!.analyzedAt).toLocaleString() : ''}</span>
                        <button onClick={() => ws.clearChapterAnalysis(ch.id)} style={{ ...linkBtn, color: '#9b8e84', fontSize: 11 }}>清除</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {Object.entries(FEATURE_LABELS).filter(([k]) => !['narrativeTone','descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop','sceneMechanics','somaticTension','identityDissolution'].includes(k)).map(([k, label]) => (
                        <div key={k} style={{ fontSize: 11 }}>
                          <span style={{ fontWeight: 600, color: '#7c3aed' }}>{label}:</span>
                          <span style={{ color: '#4a3f38' }}> {(ch.analysis![k as keyof ChapterAnalysis] as string) || '未检测到'}</span>
                        </div>
                      ))}
                    </div>
                    {/* dimAnalyses: 显示所有 V1 字符串字段之外的维度（情色专属/泛用技法等） */}
                    {ch.analysis!.dimAnalyses && Object.keys(ch.analysis!.dimAnalyses).length > 0 && (() => {
                      const v1StringKeys = ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','subtextStyle']
                      const extraDims = Object.entries(ch.analysis!.dimAnalyses!).filter(([k]) => !v1StringKeys.includes(k))
                      if (extraDims.length === 0) return null
                      return (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>深度分析维度:</div>
                          {extraDims.map(([dk, da]: any) => (
                            <div key={dk} style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 11, lineHeight: 1.5, color: '#4a3f38' }}>
                              <span style={{ fontWeight: 700, color: '#7c3aed' }}>{FEATURE_LABELS[dk] || DIMENSION_META[dk]?.label || dk}:</span>
                              <span> {da.description?.slice(0, 200) || '(无描述)'}</span>
                              {da.vocabularyList && da.vocabularyList.length > 0 && (
                                <div style={{ marginTop: 3, fontSize: 10, color: '#9b8e84' }}>
                                  词汇: {da.vocabularyList.slice(0, 10).join('、')}{da.vocabularyList.length > 10 ? ` 等${da.vocabularyList.length}个` : ''}
                                </div>
                              )}
                              {da.writingRules && da.writingRules.length > 0 && (
                                <div style={{ marginTop: 2, fontSize: 10, color: '#9b8e84' }}>
                                  规则: {da.writingRules.slice(0, 3).join('；')}{da.writingRules.length > 3 ? ` 等${da.writingRules.length}条` : ''}
                                </div>
                              )}
                              {da.examples && da.examples.length > 0 && (
                                <div style={{ marginTop: 3, fontSize: 10, color: '#6b5e84', fontStyle: 'italic', borderLeft: '2px solid rgba(124,58,237,0.15)', paddingLeft: 6 }}>
                                  例句: {da.examples.slice(0, 3).map((ex: string, i: number) => (
                                    <span key={i}>「{ex.slice(0, 60)}{ex.length > 60 ? '…' : ''}」{i < Math.min(da.examples.length, 3) - 1 ? ' ' : ''}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                    {ch.analysis!.excerpt && (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#9b8e84', fontStyle: 'italic' }}>摘录: "{ch.analysis!.excerpt}" — {ch.analysis!.excerptNote}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {ws.resultTab === 'overall' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: '#6b5e54' }}>已分析章节: {ws.analyzedChapters.length}章</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={ws.handleSummarize} disabled={ws.summarizeLoading || ws.analyzedChapters.length === 0} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
                  {ws.summarizeLoading ? '总结中...' : 'AI总结'}
                </Button>
                {ws.selectedProject.profile && <Button size="sm" variant="secondary" onClick={ws.handleSaveAsTemplate}>保存为模板</Button>}
                {ws.selectedProject.profile && <Button size="sm" variant="danger" onClick={ws.handleClearProfile}>清空总结</Button>}
              </div>
              {ws.selectedProject.profile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.8, color: '#4a3f38', padding: 12, borderRadius: 10, background: '#faf9f8' }}>
                    <strong>风格综述：</strong>{ws.selectedProject.profile.fullDescription}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                    {Object.entries(ws.selectedProject.profile.features).filter(([k]) => !['narrativeTone','descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop','sceneMechanics','somaticTension','identityDissolution'].includes(k)).map(([k, v]) => (
                      <div key={k} style={{ padding: '10px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>{FEATURE_LABELS[k]}</div>
                        <div style={{ color: '#4a3f38', lineHeight: 1.6 }}>{(v as string) || '未检测到'}</div>
                      </div>
                    ))}
                  </div>
                  {/* dimAnalyses: 维度数据统一在此展示。complexKeys 仅用于颜色标记（区分情色专属/技法维度），不作过滤 */}
                  {ws.selectedProject.profile.dimAnalyses && Object.keys(ws.selectedProject.profile.dimAnalyses).length > 0 && (() => {
                    const v1ShownKeys = ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','subtextStyle']
                    const complexKeys = ['descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','sceneMechanics','somaticTension','identityDissolution','shameVoyeurLoop']
                    const extraDims = Object.entries(ws.selectedProject.profile.dimAnalyses!).filter(([k]) => !v1ShownKeys.includes(k))
                    if (extraDims.length === 0) return null
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b5e54', marginTop: 4 }}>深度分析维度 ({extraDims.length}维)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          {extraDims.map(([dk, da]: any) => {
                            const isErotic = DIMENSION_META[dk]?.category === '情色专属'
                            const isComplex = complexKeys.includes(dk)
                            const accentColor = isErotic ? '#ec4899' : '#7c3aed'
                            const bgColor = isErotic ? 'rgba(236,72,153,0.03)' : 'rgba(124,58,237,0.03)'
                            const borderColor = isErotic ? 'rgba(236,72,153,0.12)' : 'rgba(124,58,237,0.1)'
                            return (
                              <div key={dk} style={{ padding: '10px 14px', borderRadius: 10, background: bgColor, border: `1px solid ${borderColor}`, fontSize: 12, lineHeight: 1.7 }}>
                                <div style={{ fontWeight: 700, color: accentColor, marginBottom: 4 }}>{FEATURE_LABELS[dk] || DIMENSION_META[dk]?.label || dk}</div>
                                <div style={{ color: '#4a3f38' }}>{da.description?.slice(0, 250) || '(无描述)'}</div>
                                {da.vocabularyList && da.vocabularyList.length > 0 && (
                                  <div style={{ marginTop: 6, fontSize: 10, color: '#9b8e84', borderTop: '1px solid rgba(0,0,0,0.04)', paddingTop: 4 }}>
                                    <strong>词汇:</strong> {da.vocabularyList.slice(0, 15).join('、')}{da.vocabularyList.length > 15 ? ` 等${da.vocabularyList.length}个` : ''}
                                  </div>
                                )}
                                {da.writingRules && da.writingRules.length > 0 && (
                                  <div style={{ marginTop: 4, fontSize: 10, color: '#9b8e84' }}>
                                    <strong>规则:</strong> {da.writingRules.slice(0, 5).map((r: string, i: number) => <div key={i} style={{ paddingLeft: 8 }}>{i + 1}. {r}</div>)}
                                  </div>
                                )}
                                {da.examples && da.examples.length > 0 && (
                                  <div style={{ marginTop: 4, fontSize: 10, color: '#6b5e84', fontStyle: 'italic', borderLeft: '2px solid rgba(124,58,237,0.15)', paddingLeft: 6 }}>
                                    <strong>例句:</strong> {da.examples.slice(0, 3).map((ex: string, i: number) => (
                                      <span key={i}>「{ex.slice(0, 60)}{ex.length > 60 ? '…' : ''}」{i < Math.min(da.examples.length, 3) - 1 ? ' ' : ''}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                  <div style={{ fontSize: 10, color: '#9b8e84' }}>
                    总结时间: {new Date(ws.selectedProject.profile.analyzedAt).toLocaleString()} · 分析章节: {ws.selectedProject.profile.analyzedChapterCount}章
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: '#9b8e84', fontSize: 13, padding: 20 }}>尚未生成整体风格总结，请先分析章节后点击「AI总结」</p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => ws.setShowResult(false)}>关闭</Button>
          </div>
        </div>
      </Modal>

      {/* Dimension Detail Modal */}
      <Modal isOpen={ws.showDimDetail} onClose={() => ws.setShowDimDetail(false)} title="分析维度详情" width={1000} maxHeight="92vh">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NOVEL_TYPES.map(t => {
              const dims = NOVEL_TYPE_DIMS[t] || []
              return (
                <button key={t} onClick={() => ws.setDetailType(t)} style={{
                  ...presetBtn,
                  background: ws.detailType === t ? '#7c3aed' : '#fff',
                  color: ws.detailType === t ? '#fff' : '#2d2520',
                  fontWeight: ws.detailType === t ? 700 : 400,
                }}>{t} ({dims.length}维)</button>
              )
            })}
          </div>
          {[...new Set(Object.values(DIMENSION_META).map(m => m.category))].map(cat => {
            const dimsInCat = Object.entries(DIMENSION_META).filter(([, m]) => m.category === cat)
            if (dimsInCat.length === 0) return null
            const activeIds = NOVEL_TYPE_DIMS[ws.detailType] || []
            const activeInCat = dimsInCat.filter(([k]) => activeIds.includes(k))
            const inactiveInCat = dimsInCat.filter(([k]) => !activeIds.includes(k))
            return (
              <div key={cat}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : cat === '泛用技法' ? '#16a34a' : '#7c3aed', marginBottom: 8 }}>{cat === '情色专属' ? '涩涩专属' : cat} ({activeInCat.length}维)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeInCat.map(([k, m]) => (
                    <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', fontSize: 12, lineHeight: 1.7 }}>
                      <span style={{ fontWeight: 700, color: '#7c3aed' }}>{m.label}</span>
                      <span style={{ color: '#4a3f38', marginLeft: 8 }}>{parsePromptDescription(m.prompt)}</span>
                    </div>
                  ))}
                  {inactiveInCat.map(([k, m]) => (
                    <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', fontSize: 12, lineHeight: 1.7, opacity: 0.5 }}>
                      <span style={{ fontWeight: 600, color: '#9b8e84' }}>{m.label}</span>
                      <span style={{ color: '#9b8e84', marginLeft: 8 }}>{parsePromptDescription(m.prompt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <span style={{ fontSize: 12, color: '#6b5e54' }}>{ws.detailType} · {(NOVEL_TYPE_DIMS[ws.detailType] || []).length} 个维度</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => ws.setShowDimDetail(false)}>关闭</Button>
              <Button onClick={() => { ws.setEnabledDimensions(NOVEL_TYPE_DIMS[ws.detailType] || []); ws.setShowDimDetail(false) }}>应用此类型</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Dimension Config Modal */}
      <Modal isOpen={ws.showDimConfig} onClose={() => ws.setShowDimConfig(false)} title={`选择分析维度 (${ws.enabledDimensions.length})`} width={800} maxHeight="88vh">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Presets */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>预设:</span>
            <button onClick={() => ws.setEnabledDimensions(Object.keys(DIMENSION_META).filter(k => ['基础文风','进阶技法'].includes(DIMENSION_META[k].category)))} style={presetBtn}>✨ 基础通用</button>
            <button onClick={() => ws.setEnabledDimensions(NOVEL_TYPE_DIMS['情色'] || [])} style={presetBtn}>🔞 涩涩全维</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginLeft: 8 }}>类型:</span>
            {['通用','情色','玄幻','奇幻','灵异','游戏','末世','轻小说','都市','修仙','恋爱','古风','悬疑'].map(genre => (
              <button key={genre} onClick={() => {
                let dims = ws.enabledDimensions.filter((k: string) => (DIMENSION_META as any)[k].category !== '类型专属' && (DIMENSION_META as any)[k].category !== '情色专属')
                if (genre === '情色') { ws.setEnabledDimensions(NOVEL_TYPE_DIMS['情色'] || []) }
                else if (genre === '通用') { ws.setEnabledDimensions(dims) }
                else {
                  const genreKeyMap: Record<string, string> = {'都市':'socialRealism','修仙':'cultivationCombat','恋爱':'romanceArc','古风':'archaicStyle','悬疑':'suspensePacing'}
                  const genreKey = genreKeyMap[genre]
                  if (genreKey) {
                    const others = Object.keys(DIMENSION_META).filter((k: string) => (DIMENSION_META as any)[k].category === '类型专属' && k !== genreKey)
                    ws.setEnabledDimensions([...dims.filter((k: string) => !others.includes(k)), genreKey])
                  }
                }
              }} style={presetBtn}>{genre === '情色' ? '涩涩' : genre}</button>
            ))}
            <button onClick={() => ws.setEnabledDimensions(Object.keys(DIMENSION_META))} style={{ ...presetBtn, fontSize: 10 }}>全选</button>
            <button onClick={() => ws.setEnabledDimensions([])} style={{ ...presetBtn, fontSize: 10, color: '#9b8e84' }}>清空</button>
          </div>
          {/* Grouped checkboxes */}
          {[...new Set(Object.values(DIMENSION_META).map(m => m.category))].map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cat === '情色专属' ? '#ec4899' : cat === '类型专属' ? '#f59e0b' : cat === '泛用技法' ? '#16a34a' : '#7c3aed', marginBottom: 6 }}>{cat === '情色专属' ? '涩涩专属' : cat}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {Object.entries(DIMENSION_META).filter(([, m]) => m.category === cat).map(([k, m]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                    <input type="checkbox" checked={ws.enabledDimensions.includes(k)} onChange={() => { ws.setEnabledDimensions((prev: string[]) => prev.includes(k) ? prev.filter((d: string) => d !== k) : [...prev, k]) }} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => { ws.setShowDimConfig(false); if (ws.selectedProject) { const updated = { ...ws.selectedProject, enabledDimensions: ws.enabledDimensions }; styleProjectService.saveProject(updated).catch(err => logError('保存维度配置失败', err)); ws.setProjectBoth(updated) } }}>确定</Button>
          </div>
        </div>
      </Modal>

      {/* Apply Style Modal */}
      <Modal isOpen={ws.showApply} onClose={() => ws.setShowApply(false)} title={`应用风格 — ${ws.selectedProject?.name || ''}`} width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: '#6b5e54' }}>选择要应用此风格的目标写作项目：</p>
          {ws.projectsList.map((p: any) => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#2d2520', background: ws.styleAssignments[p.id] === ws.selectedProject?.id ? 'rgba(124,58,237,0.04)' : 'transparent' }}>
              <input type="checkbox" checked={ws.styleAssignments[p.id] === ws.selectedProject?.id}
                onChange={e => ws.handleApplyStyle(p.id, e.target.checked ? (ws.selectedProject?.id || '') : '')}
                style={{ width: 16, height: 16, accentColor: '#7c3aed' }} />
              {p.name}
            </label>
          ))}
          {ws.projectsList.length === 0 && <p style={{ fontSize: 12, color: '#9b8e84' }}>暂无写作项目</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => ws.setShowApply(false)}>完成</Button>
          </div>
        </div>
      </Modal>

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
