import { useState, useEffect, useMemo } from 'react'
import { rewriteService, rewriteTemplateService } from '@/services/fileService'
import { DEFAULT_SUMMARY_CONFIG } from '@/types/rewrite'
import type { RewriteProject, RewriteChapter, RewriteSummaryConfig } from '@/types/rewrite'
import type { RewritePromptTemplate } from '@/types/rewritePrompts'
import type { ModelConfig } from '@/types/settings'
import { formatWordCount, splitChaptersByHeadings, countCJKChars } from '@/utils/textUtils'
import { chatAI } from '@/utils/chatAI'
import { useSettingsStore } from '@/store'
import EmptyState from '@/components/common/EmptyState'
import ScrollArea from '@/components/common/ScrollArea'
import {
  XMarkIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  CogIcon,
  SparklesIcon,
  CheckCircleIcon,
  EyeIcon,
  ArrowPathIcon,
  PlayIcon,
  AdjustmentsVerticalIcon,
} from '@heroicons/react/24/outline'

// ── Step definitions ──
// v15.1: preview 后新增「总结信息」步骤（可修改情节概要/角色信息/关键事件的要求，存到项目内）
const STEPS = [
  { key: 'import', num: 1, label: '导入文件', icon: FolderOpenIcon },
  { key: 'split', num: 2, label: '章节拆分', icon: DocumentTextIcon },
  { key: 'preview', num: 3, label: '预览信息', icon: EyeIcon },
  { key: 'summary', num: 4, label: '总结信息', icon: AdjustmentsVerticalIcon },
  { key: 'model', num: 5, label: '模型配置', icon: CogIcon },
  { key: 'prompt', num: 6, label: '提示词策略', icon: SparklesIcon },
  { key: 'confirm', num: 7, label: '确认创建', icon: CheckCircleIcon },
] as const

type StepKey = typeof STEPS[number]['key']

/**
 * H10: 自定义正则拆章。
 * 用 matchAll（免疫捕获组错位——原 split 方案对含捕获组的正则奇偶错位、无捕获组时标题被吞）。
 * 标题 = 匹配所在的整行（剥离行首 # 标记）——与用户"正则匹配标题行"的直觉一致；
 * 正文 = 标题行之后到下一标题行之前。首个匹配之前的内容丢弃（与原行为一致）；
 * 无匹配回退"全文"；零长匹配过滤。
 */
export function splitByCustomRegex(content: string, customRegex: string): Array<{ title: string; content: string }> {
  if (!customRegex.trim()) throw new Error('请输入自定义拆分正则')
  const re = new RegExp(customRegex, 'gm') // 'm': 用户按直觉写 ^第.+章 锚定行首时逐行匹配（审查修正）
  const matches = [...content.matchAll(re)].filter(m => m[0].length > 0)
  if (matches.length === 0) return [{ title: '全文', content }]
  // 预先计算每个匹配所在行的行首/行尾偏移
  const bounds = matches.map(m => {
    const lineStart = content.lastIndexOf('\n', m.index - 1) + 1
    let lineEnd = content.indexOf('\n', m.index)
    if (lineEnd === -1) lineEnd = content.length
    return { lineStart, lineEnd }
  })
  return matches.map((m, i) => {
    const title = content.slice(bounds[i].lineStart, bounds[i].lineEnd).replace(/^#{1,6}\s*/, '').trim() || `章节${i + 1}`
    const start = bounds[i].lineEnd
    const end = i + 1 < bounds.length ? bounds[i + 1].lineStart : content.length
    return { title, content: content.slice(start, end).trim() }
  })
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: (project: RewriteProject) => void
}

export default function RewriteCreateWizard({ isOpen, onClose, onCreated }: Props) {
  // ── Navigation ──
  const [step, setStep] = useState<StepKey>('import')

  // ── Step 1: 导入文件 ──
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [sourceFileName, setSourceFileName] = useState('')

  // ── Step 2: 章节拆分 ──
  const [splitMethod, setSplitMethod] = useState<'heading' | 'customRegex'>('heading')
  const [customRegex, setCustomRegex] = useState('')
  const [splitPreview, setSplitPreview] = useState<{ title: string; wordCount: number }[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── Step 3: 预览信息 ──
  const [projectName, setProjectName] = useState('')

  // ── Step 4: 总结信息（v15.1 — 可修改情节概要/角色信息/关键事件的要求，保存到项目）──
  const [summaryConfig, setSummaryConfig] = useState<RewriteSummaryConfig>({ ...DEFAULT_SUMMARY_CONFIG })

  // ── Step 5: 模型配置 ──
  const configs = useSettingsStore(s => s.configs)
  const [configId, setConfigId] = useState('')
  const [concurrentThreads, setConcurrentThreads] = useState(3)
  const [rewriteWordTarget, setRewriteWordTarget] = useState(4000)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<'idle' | 'success' | 'fail'>('idle')

  // ── Step 5: 提示词策略 ──
  const [templates, setTemplates] = useState<RewritePromptTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [viewingTemplate, setViewingTemplate] = useState<RewritePromptTemplate | null>(null)
  const [templateDetailTab, setTemplateDetailTab] = useState<'systemPrompt' | 'sceneRules' | 'rewriteRules'>('systemPrompt')

  // ── Reset on open ──
  useEffect(() => {
    if (isOpen) {
      setStep('import')
      setFileName(''); setFileContent(''); setSourceFileName('')
      setSplitMethod('heading'); setCustomRegex(''); setSplitPreview(null)
      setProjectName('')
      setSummaryConfig({ ...DEFAULT_SUMMARY_CONFIG })
      setConfigId(''); setConcurrentThreads(3); setRewriteWordTarget(4000)
      setConnectionResult('idle')
      setTemplateId(''); setViewingTemplate(null); setTemplateDetailTab('systemPrompt')
    }
  }, [isOpen])

  // ── Load templates on mount ──
  useEffect(() => {
    if (isOpen) rewriteTemplateService.list().then(setTemplates).catch(() => {})
  }, [isOpen])

  // ── Auto-expand template detail when a template is selected ──
  useEffect(() => {
    const t = templates.find(t => t.id === templateId) || null
    setViewingTemplate(t)
    setTemplateDetailTab('systemPrompt')
  }, [templateId, templates])

  // ── Step 1: Import file ──
  const handleImportFile = async () => {
    try {
      const result = await rewriteService.importFile()
      if (!result) return
      setFileName(result.name)
      setFileContent(result.content)
      setSourceFileName(result.sourceFileName)
      setProjectName(result.name)
    } catch (e: any) {
      alert('导入失败：' + (e.message || '未知错误'))
    }
  }

  // ── Step 2: Preview split ──
  const handlePreviewSplit = async () => {
    if (!fileContent) return
    setPreviewLoading(true)
    await new Promise(r => setTimeout(r, 100)) // let UI render
    try {
      let results: { title: string; content: string }[]
      if (splitMethod === 'heading') {
        results = splitChaptersByHeadings(fileContent)
      } else {
        results = splitByCustomRegex(fileContent, customRegex)
      }

      if (results.length === 0) throw new Error('未检测到章节结构')

      const preview = results.map(r => ({
        title: r.title,
        wordCount: countCJKChars(r.content),
      }))
      setSplitPreview(preview)
    } catch (e: any) {
      alert('预览失败：' + (e.message || '未知错误'))
    }
    setPreviewLoading(false)
  }

  // ── Step 4: Test connection ──
  const handleTestConnection = async () => {
    if (!configId) return
    setTestingConnection(true)
    setConnectionResult('idle')
    try {
      await chatAI([{ role: 'user', content: '请回复"OK"两个字，不要回复其他任何内容。' }], configId)
      setConnectionResult('success')
    } catch {
      setConnectionResult('fail')
    }
    setTestingConnection(false)
  }

  // ── Compute chapter count and word count from preview ──
  const chapterCount = splitPreview?.length || 0
  const totalWordCount = splitPreview?.reduce((sum, c) => sum + c.wordCount, 0) || 0

  // ── Can advance check ──
  const canProceed = useMemo(() => {
    switch (step) {
      case 'import': return !!fileContent
      case 'split': return splitPreview !== null && splitPreview.length > 0
      case 'preview': return true
      case 'summary': return true
      case 'model': return true
      case 'prompt': return true
      case 'confirm': return !!fileContent && !!projectName
      default: return false
    }
  }, [step, fileContent, splitPreview, projectName])

  // ── Handle create ──
  const handleCreate = async () => {
    if (!fileContent || !projectName) return
    try {
      const project = await rewriteService.create({
        name: projectName,
        sourceFileName,
        content: fileContent,
      })

      // Split chapters
      let splitResults: { title: string; content: string }[]
      if (splitMethod === 'heading') {
        splitResults = splitChaptersByHeadings(fileContent)
      } else {
        splitResults = splitByCustomRegex(fileContent, customRegex)
      }

      const sourceWordCount = countCJKChars(fileContent)

      // Save chapters and config
      const updated = await rewriteService.saveChapters({
        projectId: project.id,
        sourceWordCount,
        chapters: splitResults.map(r => ({ title: r.title, content: r.content })),
      })

      // Save additional config (template, model, threads, word target, summary config)
      // v15.1: summaryConfig 默认值等于 DEFAULT_SUMMARY_CONFIG 时仍显式保存（保证项目内可编辑基线）
      const withConfig = {
        ...updated,
        templateId: templateId || undefined,
        modelConfigId: configId || undefined,
        concurrentThreads,
        rewriteWordTarget,
        summaryConfig: { ...DEFAULT_SUMMARY_CONFIG, ...summaryConfig },
      }
      const saved = await rewriteService.save(withConfig)
      onCreated(saved as RewriteProject)
    } catch (e: any) {
      alert('创建失败：' + (e.message || '未知错误'))
    }
  }

  // ── Render step content ──
  const renderStepContent = () => {
    switch (step) {
      case 'import': return renderImportStep()
      case 'split': return renderSplitStep()
      case 'preview': return renderPreviewStep()
      case 'summary': return renderSummaryStep()
      case 'model': return renderModelStep()
      case 'prompt': return renderPromptStep()
      case 'confirm': return renderConfirmStep()
      default: return null
    }
  }

  // ── Step 4: 总结信息（v15.1）──
  const renderSummaryStep = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 16, minHeight: 0 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>总结信息要求</div>
        <div style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
          以下要求将用于「内容总结」阶段，控制 AI 从每章提取的情节概要 / 角色信息 / 关键事件。
          可按需修改（如调整字数、补充需要提取的重点）；创建后也可在项目详情「查看设置」中修改。
        </div>
      </div>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', marginBottom: 6 }}>📌 情节概要要求</div>
            <input
              type="text"
              value={summaryConfig.plotSummary || ''}
              onChange={e => setSummaryConfig({ ...summaryConfig, plotSummary: e.target.value })}
              placeholder={DEFAULT_SUMMARY_CONFIG.plotSummary}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)', fontSize: 14,
                color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                background: '#fff', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8b5cf6', marginBottom: 6 }}>👥 角色信息要求</div>
            <textarea
              rows={3}
              value={summaryConfig.characters || ''}
              onChange={e => setSummaryConfig({ ...summaryConfig, characters: e.target.value })}
              placeholder={DEFAULT_SUMMARY_CONFIG.characters}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, lineHeight: 1.7,
                color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                background: '#fff', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#ec4899', marginBottom: 6 }}>⚡ 关键事件要求</div>
            <textarea
              rows={3}
              value={summaryConfig.keyEvents || ''}
              onChange={e => setSummaryConfig({ ...summaryConfig, keyEvents: e.target.value })}
              placeholder={DEFAULT_SUMMARY_CONFIG.keyEvents}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, lineHeight: 1.7,
                color: '#1a1410', outline: 'none', fontFamily: 'inherit',
                background: '#fff', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
            💡 提示：以上为预设要求，未修改时使用默认值。项目创建后如需调整，可在项目详情「查看设置」中修改，已总结章节需「重新总结」才会按新要求生成。
          </div>
        </div>
      </ScrollArea>
    </div>
  )

  const renderImportStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}>选择要改写的小说 TXT 文件</div>
      <div style={{ fontSize: 14, color: '#9b8e84', textAlign: 'center', lineHeight: 1.8, maxWidth: 420 }}>
        支持 UTF-8 / GBK 编码的 TXT 文件。<br/>导入后系统将自动检测编码并按章节拆分。
      </div>
      <button onClick={handleImportFile} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '16px 36px', borderRadius: 14, border: '2px dashed rgba(124,58,237,0.3)',
        cursor: 'pointer', background: 'rgba(124,58,237,0.04)', color: '#7c3aed',
        fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
        transition: 'all 0.15s ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.1)'; e.currentTarget.style.borderColor = '#7c3aed' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.04)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.3)' }}
      >
        <FolderOpenIcon style={{ width: 22, height: 22 }} /> 选择文件
      </button>
      {fileName && (
        <div style={{
          padding: '14px 24px', borderRadius: 10,
          background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <DocumentTextIcon style={{ width: 20, height: 20, color: '#10b981' }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>{fileName}.txt</div>
            <div style={{ fontSize: 13, color: '#9b8e84' }}>{formatWordCount(totalWordCount || countCJKChars(fileContent))}字</div>
          </div>
        </div>
      )}
    </div>
  )

  const renderSplitStep = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', minHeight: 0 }}>
      {/* Split method selection */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>拆分规则</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
            borderRadius: 10, cursor: 'pointer',
            background: splitMethod === 'heading' ? 'rgba(124,58,237,0.06)' : 'transparent',
            border: splitMethod === 'heading' ? '1px solid rgba(124,58,237,0.2)' : '1px solid transparent',
          }}>
            <input type="radio" name="splitMethod" checked={splitMethod === 'heading'} onChange={() => setSplitMethod('heading')} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>按标题拆分</div>
              <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>识别「第X章」「Chapter X」等常见章节标题格式</div>
            </div>
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
            borderRadius: 10, cursor: 'pointer',
            background: splitMethod === 'customRegex' ? 'rgba(124,58,237,0.06)' : 'transparent',
            border: splitMethod === 'customRegex' ? '1px solid rgba(124,58,237,0.2)' : '1px solid transparent',
          }}>
            <input type="radio" name="splitMethod" checked={splitMethod === 'customRegex'} onChange={() => setSplitMethod('customRegex')} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>自定义正则</div>
              <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>使用正则表达式匹配章节标题</div>
            </div>
          </label>
        </div>
        {splitMethod === 'customRegex' && (
          <input
            type="text"
            value={customRegex}
            onChange={e => setCustomRegex(e.target.value)}
            placeholder="如：(第[零一二三四五六七八九十百千]+章|Chapter \\d+)"
            style={{
              marginTop: 10, width: '100%', padding: '10px 14px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontFamily: 'monospace',
              color: '#1a1410', outline: 'none', background: '#fff',
              boxSizing: 'border-box',
            }}
          />
        )}
      </div>

      {/* Preview section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>章节预览</div>
        <button onClick={handlePreviewSplit} disabled={!fileContent || previewLoading} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '8px 18px', borderRadius: 8, border: 'none',
          cursor: (!fileContent || previewLoading) ? 'not-allowed' : 'pointer',
          background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
          color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          opacity: (!fileContent || previewLoading) ? 0.5 : 1, transition: 'all 0.12s ease',
        }}>
          <PlayIcon style={{ width: 15, height: 15 }} />
          {previewLoading ? '解析中...' : '预览'}
        </button>
      </div>

      {/* Preview results */}
      <ScrollArea style={{ flex: 1, minHeight: 0, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px', background: '#fff' }}>
        {splitPreview && splitPreview.length > 0 ? (
          <div>
            <div style={{ marginBottom: 10, color: '#6b5e54', fontSize: 13 }}>
              预计拆分 <strong style={{ color: '#7c3aed' }}>{splitPreview.length}</strong> 章 · 总字数 <strong style={{ color: '#7c3aed' }}>{formatWordCount(totalWordCount)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {splitPreview.map((ch, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 10px', borderRadius: 6,
                  background: i % 2 === 0 ? 'rgba(124,58,237,0.03)' : 'transparent',
                  fontSize: 13,
                }}>
                  <span style={{ color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    第{i + 1}章 {ch.title}
                  </span>
                  <span style={{ color: '#9b8e84', flexShrink: 0, marginLeft: 16, fontSize: 12 }}>{formatWordCount(ch.wordCount)}字</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150 }}>
            <EmptyState icon="📋" title="点击「预览」查看拆分结果" />
          </div>
        )}
      </ScrollArea>
    </div>
  )

  const renderPreviewStep = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>小说信息预览</div>

      {/* Info rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { label: '文件格式', value: 'TXT' },
          { label: '源文件名', value: sourceFileName },
          { label: '书名', value: fileName },
          { label: '章节数', value: chapterCount > 0 ? `${chapterCount} 章` : '待拆分' },
          { label: '总字数', value: totalWordCount > 0 ? formatWordCount(totalWordCount) : '待拆分' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span style={{ width: 90, fontSize: 13, color: '#9b8e84', flexShrink: 0 }}>{row.label}</span>
            <span style={{ fontSize: 14, color: '#2d2520', fontWeight: 500 }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Project name */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 8 }}>项目名称</div>
        <input
          type="text"
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.12)', fontSize: 16, fontWeight: 600,
            color: '#1a1410', outline: 'none', fontFamily: 'inherit',
            background: '#fff', boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  )

  const renderModelStep = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 18 }}>
      {/* Model selection */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 10 }}>选择模型</div>
        {configs.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <EmptyState icon="⚙️" title="暂无模型配置" description="请先在设置中配置AI模型" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {configs.map(cfg => (
              <label key={cfg.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderRadius: 10, cursor: 'pointer',
                background: configId === cfg.id ? 'rgba(124,58,237,0.06)' : '#fff',
                border: configId === cfg.id ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
              }}>
                <input type="radio" name="configId" checked={configId === cfg.id} onChange={() => { setConfigId(cfg.id); setConnectionResult('idle') }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>{cfg.name}</div>
                  <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>{cfg.model} · {cfg.provider}</div>
                </div>
              </label>
            ))}
          </div>
        )}
        {configId && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={handleTestConnection} disabled={testingConnection} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '7px 16px', borderRadius: 8, border: '1px solid #7c3aed',
              cursor: testingConnection ? 'not-allowed' : 'pointer',
              background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              opacity: testingConnection ? 0.5 : 1,
            }}>
              <ArrowPathIcon style={{ width: 14, height: 14, animation: testingConnection ? 'spin 1s linear infinite' : 'none' }} />
              {testingConnection ? '测试中...' : '测试连接'}
            </button>
            {connectionResult === 'success' && <span style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>✓ 连接成功</span>}
            {connectionResult === 'fail' && <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>✗ 连接失败</span>}
          </div>
        )}
      </div>

      {/* Concurrent threads */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>并发线程</div>
        <div style={{ fontSize: 13, color: '#9b8e84', marginBottom: 8 }}>
          同时进行多个章节的总结与改写。线程数：<strong style={{ color: '#7c3aed' }}>{concurrentThreads}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#9b8e84' }}>1</span>
          <input
            type="range"
            min={1}
            max={10}
            value={concurrentThreads}
            onChange={e => setConcurrentThreads(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#7c3aed' }}
          />
          <span style={{ fontSize: 12, color: '#9b8e84' }}>10</span>
        </div>
      </div>

      {/* Rewrite word target */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>改写字数</div>
        <div style={{ fontSize: 13, color: '#9b8e84', marginBottom: 8 }}>
          每个需要改写的章节额外加料的目标字数
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="number"
            min={0}
            max={10000}
            step={100}
            value={rewriteWordTarget}
            onChange={e => setRewriteWordTarget(Number(e.target.value))}
            style={{
              width: 140, padding: '10px 14px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.12)', fontSize: 15, fontWeight: 600,
              color: '#1a1410', outline: 'none', fontFamily: 'inherit',
              background: '#fff', boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: 13, color: '#4a3f38' }}>字/章</span>
        </div>
      </div>
    </div>
  )

  const renderPromptStep = () => {
    const selectedTemplate = templates.find(t => t.id === templateId)
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 16, minHeight: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>选择提示词策略</div>

        {templates.length === 0 ? (
          <EmptyState icon="📋" title="暂无提示词模板" description="可在小说改写页面右上方「提示词」中创建" />
        ) : (
          <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {templates.map(t => (
              <label key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderRadius: 10, cursor: 'pointer',
                background: templateId === t.id ? 'rgba(124,58,237,0.06)' : '#fff',
                border: templateId === t.id ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
              }}>
                <input type="radio" name="templateId" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>
                    {t.sceneRules.length} 个场景规则 · {t.systemPrompt ? '已配置系统破甲' : '未配置系统破甲'}
                    {t.universalGuidance ? ' · 已配置通用指导' : ''}
                  </div>
                </div>
              </label>
            ))}
            </div>
          </ScrollArea>
        )}

        {/* View template details — always expanded when template selected, tabbed like 提示词管理 */}
        {selectedTemplate && (
          <>
            <button onClick={() => setViewingTemplate(viewingTemplate ? null : selectedTemplate)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              cursor: 'pointer', background: '#fff', color: '#6b5e54',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              flexShrink: 0,
            }}>
              <EyeIcon style={{ width: 14, height: 14 }} />
              {viewingTemplate ? '收起详情' : '查看模板详情'}
            </button>

            {viewingTemplate && (
              <div style={{
                flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
                overflow: 'hidden',
              }}>
                {/* Template name header */}
                <div style={{
                  padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)',
                  fontWeight: 700, fontSize: 15, color: '#2d2520', flexShrink: 0,
                  background: 'rgba(124,58,237,0.02)',
                }}>
                  {viewingTemplate.name}
                </div>

                {/* Tab buttons */}
                <div style={{
                  display: 'flex', gap: 0, flexShrink: 0,
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  padding: '0 12px',
                }}>
                  {([
                    { key: 'systemPrompt' as const, label: '系统破甲' },
                    { key: 'sceneRules' as const, label: '场景识别' },
                    { key: 'rewriteRules' as const, label: '改写规则' },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setTemplateDetailTab(tab.key)}
                      style={{
                        padding: '8px 18px', border: 'none', cursor: 'pointer',
                        background: 'transparent', fontFamily: 'inherit',
                        fontSize: 14, fontWeight: templateDetailTab === tab.key ? 700 : 500,
                        color: templateDetailTab === tab.key ? '#7c3aed' : '#9b8e84',
                        borderBottom: templateDetailTab === tab.key ? '2px solid #7c3aed' : '2px solid transparent',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                  <div style={{ padding: '14px 16px' }}>
                  {templateDetailTab === 'systemPrompt' && (
                    <div style={{ fontSize: 14, color: '#2d2520', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {viewingTemplate.systemPrompt || '（未配置系统破甲提示词）'}
                    </div>
                  )}

                  {templateDetailTab === 'sceneRules' && (
                    viewingTemplate.sceneRules.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {viewingTemplate.sceneRules.map(rule => (
                          <div key={rule.id} style={{
                            padding: '10px 14px', borderRadius: 10,
                            border: '1px solid rgba(0,0,0,0.06)', background: '#fdfcfb',
                          }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>
                              {rule.name || '未命名场景'}
                            </div>
                            <div style={{ fontSize: 13, color: '#6b5e54', lineHeight: 1.6 }}>
                              {rule.triggerCondition || '（无触发条件）'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#9b8e84', textAlign: 'center', padding: 20 }}>
                        暂无场景规则
                      </div>
                    )
                  )}

                  {templateDetailTab === 'rewriteRules' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Universal guidance */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }}>📝 通用指导</div>
                        <div style={{ fontSize: 14, color: '#2d2520', lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: '8px 12px', borderRadius: 8, background: '#fdfcfb', border: '1px solid rgba(0,0,0,0.04)' }}>
                          {viewingTemplate.universalGuidance || '（未配置通用指导）'}
                        </div>
                      </div>
                      {/* Scene-specific guidance */}
                      {viewingTemplate.sceneRules.filter(s => viewingTemplate.sceneGuidance[s.id]).length > 0 && (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', marginBottom: 6 }}>🎯 场景特定指导</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {viewingTemplate.sceneRules.filter(s => viewingTemplate.sceneGuidance[s.id]).map(s => (
                              <div key={s.id} style={{ padding: '8px 12px', borderRadius: 8, background: '#fdfcfb', border: '1px solid rgba(0,0,0,0.04)' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{s.name}</div>
                                <div style={{ fontSize: 13, color: '#6b5e54', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                                  {viewingTemplate.sceneGuidance[s.id]}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const renderConfirmStep = () => {
    const selectedConfig = configs.find(c => c.id === configId)
    const selectedTemplate = templates.find(t => t.id === templateId)
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>确认创建项目</div>
        <div style={{ fontSize: 13, color: '#9b8e84', lineHeight: 1.8 }}>
          请确认以下设置，确认无误后点击「创建项目」。
        </div>

        {/* Summary sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { icon: '📄', title: '源文件', value: `${sourceFileName} · ${formatWordCount(totalWordCount || 0)}字` },
            { icon: '📖', title: '项目名称', value: projectName },
            { icon: '📑', title: '章节拆分', value: chapterCount > 0 ? `${chapterCount} 章（${splitMethod === 'heading' ? '按标题' : '自定义正则'}）` : '待拆分' },
            { icon: '⚙️', title: '模型配置', value: selectedConfig ? `${selectedConfig.name} (${selectedConfig.model})` : '未选择' },
            { icon: '🔗', title: '并发线程', value: `${concurrentThreads} 个线程` },
            { icon: '✏️', title: '改写字数', value: `${rewriteWordTarget} 字/章` },
            { icon: '📋', title: '提示词策略', value: selectedTemplate ? selectedTemplate.name : '不使用模板' },
            { icon: '📌', title: '总结信息', value: '情节概要 / 角色信息 / 关键事件（可修改）' },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{row.icon}</span>
              <div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>{row.title}</div>
                <div style={{ fontSize: 14, color: '#2d2520', fontWeight: 500 }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Create button */}
        <button onClick={handleCreate} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '16px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #10b981, #059669)',
          color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
          marginTop: 'auto', transition: 'all 0.15s ease',
        }}>
          <CheckCircleIcon style={{ width: 18, height: 18 }} /> 创建项目
        </button>
      </div>
    )
  }

  // ── Early return if not open ──
  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        width: '88vw', height: '82vh', maxWidth: 1200,
        background: '#fff', borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        display: 'flex', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* ═══ Left Panel: Step List ═══ */}
        <div style={{
          width: 240, flexShrink: 0,
          borderRight: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(124,58,237,0.02)',
        }}>
          {/* Header */}
          <div style={{ padding: '28px 20px 20px' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520', margin: 0 }}>新建项目</h2>
          </div>

          {/* Step list */}
          <div style={{ flex: 1, padding: '0 12px' }}>
            {STEPS.map((s, i) => {
              const isCurrent = step === s.key
              const isCompleted = STEPS.findIndex(x => x.key === step) > i
              const isDisabled = !canProceed && STEPS.findIndex(x => x.key === step) < i
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    if (isDisabled) return
                    // Allow going back anytime; going forward requires canProceed
                    const currentIdx = STEPS.findIndex(x => x.key === step)
                    const targetIdx = i
                    if (targetIdx <= currentIdx || canProceed) setStep(s.key)
                  }}
                  disabled={isDisabled}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', marginBottom: 2, borderRadius: 10,
                    border: 'none', cursor: isDisabled ? 'default' : 'pointer',
                    background: isCurrent ? 'rgba(124,58,237,0.1)' : 'transparent',
                    textAlign: 'left' as const, fontFamily: 'inherit',
                    opacity: isDisabled ? 0.35 : 1,
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent && !isDisabled) e.currentTarget.style.background = 'rgba(124,58,237,0.04)'
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent && !isDisabled) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {/* Step number circle */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: isCompleted ? '#10b981' : isCurrent ? '#7c3aed' : '#e5e0da',
                    color: isCompleted || isCurrent ? '#fff' : '#9b8e84',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                    transition: 'all 0.2s ease',
                  }}>
                    {isCompleted ? '✓' : s.num}
                  </div>
                  <div>
                    <div style={{
                      fontSize: 14, fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#7c3aed' : isCompleted ? '#2d2520' : '#6b5e54',
                    }}>
                      {s.label}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ═══ Right Panel: Step Content ═══ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Step header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 28px', borderBottom: '1px solid rgba(0,0,0,0.04)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {(() => {
                const s = STEPS.find(x => x.key === step)!
                const Icon = s.icon
                return (
                  <>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'rgba(124,58,237,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon style={{ width: 18, height: 18, color: '#7c3aed' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>步骤 {s.num}：{s.label}</div>
                      <div style={{ fontSize: 12, color: '#9b8e84' }}>
                        {s.key === 'import' && '选择要改写的小说文件'}
                        {s.key === 'split' && '配置章节拆分规则'}
                        {s.key === 'preview' && '确认小说的基本信息'}
                        {s.key === 'summary' && '设置总结信息提取要求（可修改）'}
                        {s.key === 'model' && '选择模型和改写参数'}
                        {s.key === 'prompt' && '选择改写提示词策略'}
                        {s.key === 'confirm' && '确认所有设置并创建'}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9b8e84', padding: 8, borderRadius: 8,
            }}>
              <XMarkIcon style={{ width: 20, height: 20 }} />
            </button>
          </div>

          {/* Step content */}
          <div style={{ flex: 1, padding: '0 28px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {renderStepContent()}
          </div>

          {/* Bottom nav */}
          {step !== 'confirm' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 28px', borderTop: '1px solid rgba(0,0,0,0.04)',
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  const idx = STEPS.findIndex(x => x.key === step)
                  if (idx > 0) setStep(STEPS[idx - 1].key)
                }}
                disabled={STEPS.findIndex(x => x.key === step) === 0}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
                  cursor: STEPS.findIndex(x => x.key === step) === 0 ? 'default' : 'pointer',
                  background: '#fff', color: '#4a3f38',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  opacity: STEPS.findIndex(x => x.key === step) === 0 ? 0.3 : 1,
                }}>
                上一步
              </button>
              <button
                onClick={() => {
                  const idx = STEPS.findIndex(x => x.key === step)
                  if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key)
                }}
                disabled={!canProceed}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '10px 24px', borderRadius: 8, border: 'none',
                  cursor: !canProceed ? 'not-allowed' : 'pointer',
                  background: canProceed ? 'linear-gradient(135deg, #7c3aed, #8b5cf6)' : '#e5e0da',
                  color: canProceed ? '#fff' : '#9b8e84',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                }}>
                下一步 <ArrowRightIcon style={{ width: 15, height: 15 }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
