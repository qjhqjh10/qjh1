import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { settingsService, aiService, statsService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { ModelConfig, PromptTemplate, PromptType, AIAssistantSettings } from '@/types/settings'
import type { UsageResult } from '@/types/electron'
import { PROMPT_TYPES, DEFAULT_MODEL_CONFIG, DEFAULT_AI_SETTINGS, PROVIDER_PRESETS } from '@/types/settings'
import { inputStyle, textareaStyle, captionText } from '@/components/common/styles'
import { logError } from '@/utils/logger'
import { FormField, StatCard } from '../shared'
import { compressAndSaveImage, loadAvatar } from '@/utils/imageCompress'

export function AISettingsTab() {
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const setAISettings = useSettingsStore(s => s.setAISettings)

  const update = (k: keyof AIAssistantSettings, v: unknown) => setAISettings({ [k]: v })

  // Resolve avatar file paths to data URLs for display
  const [userAvatarSrc, setUserAvatarSrc] = useState('')
  const [aiAvatarSrc, setAiAvatarSrc] = useState('')
  useEffect(() => {
    loadAvatar(aiSettings.userAvatar || '').then(setUserAvatarSrc)
    loadAvatar(aiSettings.assistantAvatar || '').then(setAiAvatarSrc)
  }, [aiSettings.userAvatar, aiSettings.assistantAvatar])

  return (
    <div className="custom-scrollbar" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 能力总览面板 */}
        <div className="stagger-item glass-card-enhanced" style={{ padding: 20, background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(59,130,246,0.04))', border: '1px solid rgba(124,58,237,0.12)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#7c3aed' }}>AI 写作助手能力总览</h4>
          <p style={{ ...captionText, marginBottom: 14 }}>你的 AI 助手具备以下能力，覆盖写作全流程</p>

          {/* 工具清单 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 8 }}>32 个工具（核心 7 个 + 扩展 25 个）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                { n: 'read_file', t: '核心' }, { n: 'create_file', t: '核心' },
                { n: 'edit_file', t: '核心' }, { n: 'delete_file', t: '核心' },
                { n: 'list_directory', t: '核心' }, { n: 'search_content', t: '核心' },
                { n: 'tool_search', t: '核心' },
                { n: 'find_files', t: '只读' }, { n: 'batch_replace', t: '只读' },
                { n: 'rename_file', t: '需确认' },
                { n: 'create_project', t: '需确认' }, { n: 'delete_project', t: '需确认' },
              ].map(t => (
                <span key={t.n} title={t.n} style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10,
                  background: t.t === '核心' ? 'rgba(124,58,237,0.08)' : t.t === '只读' ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
                  color: t.t === '核心' ? '#7c3aed' : t.t === '只读' ? '#16a34a' : '#d97706',
                  fontWeight: 600, cursor: 'default',
                }}>{t.n}</span>
              ))}
              <span style={{ fontSize: 10, color: '#9b8e84', padding: '2px 4px' }}>+ 扩展 22 个（tool_search 按需发现）</span>
            </div>
          </div>

          {/* 工作模式 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 6 }}>特性</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#9b8e84' }}>
              <span>首条全量注入，后续精简 ~540 tokens</span>
              <span>Prompt 缓存（费用减免 90%+）</span>
              <span>tool_search 按需发现扩展工具</span>
              <span>风格/场景模板注入</span>
              <span>上下文自动压缩</span>
              <span>双协议（Anthropic+OpenAI）</span>
            </div>
          </div>
        </div>

        {/* AI Dialogue */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>AI 对话设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="工作模式">
              <select value={aiSettings.workMode || 'action'} onChange={e => update('workMode', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="plan">Plan 分析 — 仅可读取搜索，不可修改文件</option>
                <option value="action">Action 执行 — 全部工具可用，可修改文件</option>
              </select>
              <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 4 }}>聊天窗口中也可随时切换。Plan 模式安全无风险。</div>
            </FormField>

            <FormField label="默认角色">
              <select value={aiSettings.defaultRole} onChange={e => update('defaultRole', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                {aiSettings.customRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </FormField>
            <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>自定义角色 (可增删改)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aiSettings.customRoles.map((role, idx) => (
                  <div key={role.id} style={{ padding: '8px 10px', borderRadius: 8, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <input value={role.name} onChange={e => {
                        const roles = [...aiSettings.customRoles]
                        roles[idx] = { ...roles[idx], name: e.target.value }
                        update('customRoles', roles)
                      }} className="focus-ring" style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }} placeholder="角色名称" />
                      <button onClick={() => {
                        const deleted = aiSettings.customRoles[idx]
                        const remaining = aiSettings.customRoles.filter((_, i) => i !== idx)
                        update('customRoles', remaining)
                        if (aiSettings.defaultRole === deleted.id && remaining.length > 0) {
                          update('defaultRole', remaining[0].id)
                        }
                      }} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 4, borderRadius: 6 }}>
                        <TrashIcon style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                    <textarea value={role.prompt} onChange={e => {
                      const roles = [...aiSettings.customRoles]
                      roles[idx] = { ...roles[idx], prompt: e.target.value }
                      update('customRoles', roles)
                    }} className="focus-ring" style={{ ...textareaStyle, minHeight: 50, fontSize: 11 }} placeholder="角色系统提示词..." />
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => {
                  const roles = [...aiSettings.customRoles, { id: `role_${Date.now()}`, name: '新角色', prompt: '' }]
                  update('customRoles', roles)
                }} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加角色</Button>
              </div>
            </div>
            <FormField label="回复风格">
              <select value={aiSettings.responseStyle} onChange={e => update('responseStyle', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'concise', l: '简洁' }, { v: 'normal', l: '标准' }, { v: 'detailed', l: '详细' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
            <FormField label="自动应用到编辑器">
              <input type="checkbox" checked={aiSettings.autoApply} onChange={e => update('autoApply', e.target.checked)} />
            </FormField>
          </div>
        </div>

        {/* Context Priority — 信息调用优先级在上下文压缩中自动管理 */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>信息调用优先级</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="参考信息优先顺序">
              <select value={aiSettings.contextPriority} onChange={e => update('contextPriority', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="balanced">均衡 — 知识库 + 模型 + 搜索</option>
                <option value="kb-first">知识库优先 — 以知识库为准，模型补充</option>
                <option value="model-first">模型优先 — 以模型知识为准，知识库参考</option>
              </select>
            </FormField>
            <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
              {aiSettings.contextPriority === 'kb-first' && '知识库检索结果放在最前，指示 AI 优先参考知识库信息。适合需要依据设定集、资料库创作的场景。'}
              {aiSettings.contextPriority === 'model-first' && '减少知识库上下文的权重，让 AI 更多依靠自身知识。适合知识库内容可能触发安全策略的场景。'}
              {aiSettings.contextPriority === 'balanced' && '知识库、模型知识、网络搜索平等参与。适合大多数场景。'}
            </div>
          </div>
        </div>

        {/* Web Search */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>界面设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="显示新会话欢迎信息">
              <input type="checkbox" checked={aiSettings.showWelcome !== false} onChange={e => update('showWelcome', e.target.checked)} />
            </FormField>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, marginTop: 24, color: '#2d2520' }}>联网搜索设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="默认开启联网搜索">
              <input type="checkbox" checked={aiSettings.webSearchDefault} onChange={e => update('webSearchDefault', e.target.checked)} />
            </FormField>
            <FormField label={`搜索结果数量 (${aiSettings.searchResultCount})`}>
              <input type="range" min={1} max={10} value={aiSettings.searchResultCount} onChange={e => update('searchResultCount', parseInt(e.target.value))} style={{ width: '100%' }} />
            </FormField>
            <FormField label="安全搜索">
              <select value={aiSettings.safeSearch} onChange={e => update('safeSearch', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'strict', l: '严格' }, { v: 'moderate', l: '中等' }, { v: 'off', l: '关闭' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, marginTop: 24, color: '#2d2520' }}>🖼️ 图片搜索 Pexels</h4>
          <PexelsKeyField />
        </div>

        {/* Priority Sites */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>优先搜索网站</h4>
          <div style={{ marginBottom: 12 }}>
            <Button size="sm" onClick={() => {
              const id = nanoid()
              setAISettings({ prioritySites: [...aiSettings.prioritySites, { id, url: '', description: '', category: '百科' }] })
            }} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加网址</Button>
          </div>
          {aiSettings.prioritySites.map((site, i) => (
            <div key={site.id} className="interactive" style={{ padding: 12, borderRadius: 12, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={site.url} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], url: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="网址 (如 zh.wikipedia.org)" className="focus-ring" style={{ ...inputStyle, flex: 2 }} />
              <input value={site.description} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], description: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="描述" className="focus-ring" style={{ ...inputStyle, flex: 1 }} />
              <select value={site.category} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], category: e.target.value }
                setAISettings({ prioritySites: sites })
              }} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer', width: 100 }}>
                {['文学', '百科', '社区', '资料', '其他'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button variant="danger" size="sm" onClick={() => {
                setAISettings({ prioritySites: aiSettings.prioritySites.filter(s => s.id !== site.id) })
              }} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
            </div>
          ))}
        </div>

        {/* Budget */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>月度预算预警</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="月度预算上限 ($)">
              <input type="number" min={0} step={0.01} value={aiSettings.monthlyBudget} onChange={e => update('monthlyBudget', parseFloat(e.target.value) || 0)} className="focus-ring" style={inputStyle} placeholder="0=不限" />
            </FormField>
            <FormField label="启用预算预警">
              <input type="checkbox" checked={aiSettings.budgetWarning} onChange={e => update('budgetWarning', e.target.checked)} />
            </FormField>
          </div>
        </div>

        {/* Avatar Settings */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>会话头像</h4>
          <div style={{ display: 'flex', gap: 24 }}>
            {/* User Avatar */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b5e54' }}>你的头像</span>
              <div onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const f = i.files?.[0]; if (!f) return; compressAndSaveImage(f, 'user').then(path => update('userAvatar', path)).catch(e => alert(e.message)); }; i.click() }}
                className="interactive"
                style={{ width: 56, height: 56, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '2px dashed rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)' }}>
                {userAvatarSrc
                  ? <img src={userAvatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>✍️</span>}
              </div>
              {aiSettings.userAvatar && (
                <button onClick={() => update('userAvatar', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#ef4444', fontFamily: 'inherit' }}>清除</button>
              )}
            </div>
            {/* Assistant Avatar */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b5e54' }}>AI 头像</span>
              <div onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const f = i.files?.[0]; if (!f) return; compressAndSaveImage(f, 'assistant').then(path => update('assistantAvatar', path)).catch(e => alert(e.message)); }; i.click() }}
                className="interactive"
                style={{ width: 56, height: 56, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '2px dashed rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)' }}>
                {aiAvatarSrc
                  ? <img src={aiAvatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>📖</span>}
              </div>
              {aiSettings.assistantAvatar && (
                <button onClick={() => update('assistantAvatar', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#ef4444', fontFamily: 'inherit' }}>清除</button>
              )}
            </div>
          </div>
          <div style={{ marginTop: 10, ...captionText }}>点击头像可上传图片。上传后会话中的头像将替换为你的自定义图片。留空使用默认emoji。</div>
        </div>
      </div>
    </div>
  )
}

/** Pexels API 密钥管理 */
function PexelsKeyField() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsService.loadPexelsKey().then((k: string) => { if (k) setKey(k) }).catch(() => {})
  }, [])

  const save = async () => {
    await settingsService.savePexelsKey(key.trim())
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.5 }}>
        免费注册 <a href="https://www.pexels.com/api/" target="_blank" style={{ color: '#7c3aed' }}>pexels.com/api</a> 获取 API Key。
        200次/时，2万次/月。支持中文搜索，国内可直接访问。
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={key} onChange={e => setKey(e.target.value)}
          placeholder="粘贴 Pexels API Key..."
          className="focus-ring" style={{ ...inputStyle, flex: 1 }} />
        <button onClick={save}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: saved ? '#16a34a' : '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {saved ? '✓ 已保存' : '保存'}
        </button>
      </div>
    </div>
  )
}


// ====================== Display Settings Tab ======================
