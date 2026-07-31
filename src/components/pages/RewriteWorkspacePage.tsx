import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rewriteService, fileService, dialogService, rewriteTemplateService } from '@/services/fileService'
import { STAGE_STEPS, STAGE_NAMES, STEP_KEY_TO_STAGE, STAGE_ORDER } from '@/types/rewrite'
import type { RewriteProject, RewriteChapter, ChapterAnalysis, ChapterRewrite, ContextMarker } from '@/types/rewrite'
import type { RewritePromptTemplate } from '@/types/rewritePrompts'
import { formatWordCount, splitChaptersByHeadings, countCJKChars } from '@/utils/textUtils'
import { chatAI } from '@/utils/chatAI'
import { useSettingsStore } from '@/store'
import EmptyState from '@/components/common/EmptyState'
import ScrollArea from '@/components/common/ScrollArea'
import RewriteEditor from '@/components/common/RewriteEditor'
import RewriteCompareModal from '@/components/common/RewriteCompareModal'
import { findTextInContent, extractSceneSegment, buildSceneGuidanceMap, buildSegmentRewritePrompt, assembleRewrittenChapterFromSimple, assembleRewrittenChapter } from '@/utils/rewriteSegmentUtils'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  SparklesIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  EyeIcon,
  PencilIcon,
} from '@heroicons/react/24/outline'


// ── Stage colors ──
const stageColors: Record<string, string> = {
  imported: '#f59e0b',
  split: '#3b82f6',
  summarized: '#8b5cf6',
  identified: '#6366f1',
  rewritten: '#ec4899',
  merged: '#10b981',
}

// ── Word count pass check: must ≥ original words; if target set, must achieve ≥50% of target ──
function calcIsPassing(rewriteWc: number, chapterWc: number, rewriteTarget?: number): boolean {
  const minExpected = chapterWc + (rewriteTarget && rewriteTarget > 0 ? rewriteTarget * 0.5 : 0)
  return rewriteWc >= Math.max(chapterWc, minExpected)
}

// ── Analysis prompt builder ──
function buildAnalysisPrompt(chapterContent: string, template?: RewritePromptTemplate | null): string {
  // Build scene recognition rules from template
  let sceneRulesSection = ''
  if (template && template.sceneRules.length > 0) {
    sceneRulesSection = `\n请根据以下场景类型对章节内容进行分类：\n${template.sceneRules.map((s, i) => `${i + 1}. ${s.name}：${s.triggerCondition}`).join('\n')}\n请将识别出的场景填入 categories 字段，name 使用上述场景名称。`
  }

  // Build precise marker instructions
  const markerInstructions = template && template.sceneRules.length > 0
    ? `每个识别出的场景，请在 contextMarkers 中创建一条记录。

⚠️ 极其重要 — 精确位置锚定要求：
- startText 必须从原文中逐字原样复制该场景段落的开头约15个字，一字不差
- endText 必须从原文中逐字原样复制该场景段落的末尾约15个字，一字不差
- 这两个字段是改写系统定位原文段落的唯一依据，必须绝对准确
- ⛔ 禁止使用 location 字段代替 startText/endText
- ⛔ 禁止使用自己的话概括，必须从原文直接复制粘贴
- 示例：如果原文段落开头是"高先在课堂上命令同桌杨幂"，startText 就必须是"高先在课堂上命令同桌杨幂"，不能写成"高先命令同桌"或"课堂上"

如果一个段落同时属于多个场景（如既是"亲吻场景"又是"亲密场景"），请分别创建两条 marker，可以指向相同或重叠的文本段。
- ⚠️ 合并规则：如果同一场景类型在原文中连续出现多段（如连续3段都是战斗场景），请合并为一条 contextMarker，startText 取第一段的开头，endText 取最后一段的末尾。不要为连续的同类型场景创建多条记录。`
    : ''

  return `你是一位专业的小说分析助手。请分析以下章节，提取结构化信息。

章节内容：
${chapterContent}
${sceneRulesSection}
${markerInstructions ? '\n' + markerInstructions : ''}
请严格按以下JSON格式返回（不要包含markdown代码块标记，直接返回纯JSON）：
{
  "plotSummary": "情节概要，100-200字",
  "characters": [
    { "name": "角色名", "traits": "外貌/性格/能力等特征", "role": "主角/配角/龙套", "description": "在本章中的角色表现" }
  ],
  "keyEvents": [
    "关键事件一句话描述1",
    "关键事件一句话描述2"
  ],
  "categories": [
    { "name": "场景类型", "count": 该类型出现次数 }
  ],
  "contextMarkers": [
    { "sceneName": "场景类型名称（必填）", "description": "该场景段落的一句话剧情描述", "startText": "该场景段落的开头~15字（必须从原文逐字原样复制）", "endText": "该场景段落的末尾~15字（必须从原文逐字原样复制）" }
  ],
  "needsRewrite": true或false（如果本章包含任何上述场景类型，则必须标记为true；纯过渡章节且完全不包含任何上述场景才标记为false）
}`
}

// ── Rewrite prompt builder ──
function buildRewritePrompt(chapterContent: string, analysis: ChapterAnalysis | null, template?: RewritePromptTemplate | null, wordTarget?: number, chapterId?: string, disabledMarkerKeys?: Set<string>): string {
  // Filter out user-disabled markers if chapterId is provided
  const effectiveMarkers = analysis && chapterId && disabledMarkerKeys
    ? analysis.contextMarkers.filter((_, i) => !disabledMarkerKeys.has(`${chapterId}:${i}`))
    : analysis?.contextMarkers || []

  let context = `原文内容：\n${chapterContent}`
  if (analysis) {
    context += `\n\n章节分析：\n情节概要：${analysis.plotSummary}`
    if (analysis.characters.length > 0) {
      context += `\n出场角色：${analysis.characters.map(c => `${c.name}(${c.role})`).join('、')}`
    }
    if (analysis.keyEvents.length > 0) {
      context += `\n关键事件：${analysis.keyEvents.join('；')}`
    }
    if (analysis.categories.length > 0) {
      context += `\n识别场景：${analysis.categories.map(c => `${c.name}(${c.count}次)`).join('、')}`
    }
  }

  // Build precise scene location markers with startText/endText anchors
  let sceneMarkerSection = ''
  if (effectiveMarkers.length > 0) {
    // Detect overlapping markers: same sceneName appearing multiple times, or similar startText/endText
    const markerGroups: Map<string, ContextMarker[]> = new Map()
    for (const m of effectiveMarkers) {
      const key = m.startText && m.endText ? `${m.startText}|${m.endText}` : m.sceneName
      if (!markerGroups.has(key)) markerGroups.set(key, [])
      markerGroups.get(key)!.push(m)
    }

    const markerLines: string[] = []
    let idx = 1
    for (const [key, markers] of markerGroups) {
      const primary = markers[0]
      const sceneNames = [...new Set(markers.map(m => m.sceneName))]
      const isOverlap = markers.length > 1

      // Build text anchor: startText ... endText
      const anchor = primary.startText && primary.endText
        ? `「${primary.startText}……${primary.endText}」`
        : '（无精确位置标记）'

      // Build description
      const desc = primary.description || markers.map(m => m.description).filter(Boolean).join('；')
      let line = `${idx}. ${anchor}`
      if (isOverlap) {
        line += `\n   场景类型：${sceneNames.join(' + ')}（重叠场景，改写时需综合以下规则）`
      } else {
        line += `\n   场景类型：${primary.sceneName}`
      }
      line += `\n   剧情：${desc}`

      // Add scene-specific guidance for each overlapping scene
      if (template && template.sceneGuidance) {
        const guidanceMap = buildSceneGuidanceMap(template)
        const guidances = sceneNames
          .filter(n => guidanceMap[n])
          .map(n => `【${n}】${guidanceMap[n]}`)
        if (guidances.length > 0) {
          line += `\n   改写规则：${guidances.join('；')}`
        }
      }

      markerLines.push(line)
      idx++
    }

    sceneMarkerSection = `\n需要改写的场景段落（按原文中出现顺序）：\n${markerLines.join('\n\n')}`
  }

  // Add template rewrite rules (universal + scene-specific that weren't covered by markers)
  let rewriteRules = ''
  if (template) {
    if (template.universalGuidance) {
      rewriteRules += `\n通用改写指导：\n${template.universalGuidance}`
    }
    // Add scene-specific guidance for categories not covered by contextMarkers
    if (analysis && analysis.categories.length > 0 && template.sceneGuidance) {
      const guidanceMap = buildSceneGuidanceMap(template)
      const markerSceneNames = new Set(effectiveMarkers.map(m => m.sceneName))
      const uncoveredGuidance = analysis.categories
        .filter(c => guidanceMap[c.name] && !markerSceneNames.has(c.name))
        .map(c => `【${c.name}】${guidanceMap[c.name]}`)
      if (uncoveredGuidance.length > 0) {
        rewriteRules += `\n补充场景指导：\n${uncoveredGuidance.join('\n')}`
      }
    }
  }

  // Add word target instruction if configured
  let wordTargetInstruction = ''
  if (wordTarget && wordTarget > 0) {
    wordTargetInstruction = `\n- 请在保持原文核心情节的基础上，适当扩充内容，改写后字数目标约为${wordTarget}字`
  }

  return `你是一位专业的小说改写助手。请基于原文和章节分析，对本章进行改写。

${context}
${sceneMarkerSection}
${rewriteRules}

改写要求：
- 保持核心情节和人物关系不变
- 提升文笔质量和可读性
- 保持与原文相近的字数范围
- 保持原有的场景分类和叙事节奏${wordTargetInstruction}
- 对于标记了精确位置的场景段落，仅改写该段文字，其余部分可保留原文
- 如果一个段落被标记为多个重叠场景，请综合所有场景的改写规则对该段进行改写
- 段落格式：每段之间用空行分隔（即两个换行），不要用缩进表示分段

请直接输出改写后的章节内容，不要包含任何解释或标记。`
}

// ── Parse AI response to ChapterAnalysis ──
function parseAnalysisResponse(text: string): ChapterAnalysis | null {
  try {
    // Strip potential markdown code blocks
    let json = text.trim()
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    const obj = JSON.parse(json)
    return {
      chapterId: '',
      plotSummary: obj.plotSummary || '',
      characters: Array.isArray(obj.characters) ? obj.characters : [],
      keyEvents: Array.isArray(obj.keyEvents) ? obj.keyEvents : [],
      categories: Array.isArray(obj.categories) ? obj.categories : [],
      contextMarkers: Array.isArray(obj.contextMarkers) ? obj.contextMarkers : [],
      needsRewrite: obj.needsRewrite !== false,
      analyzedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── Post-process: if template has scene rules and analysis detected matching scenes, force needsRewrite ──
function enforceTemplateRewrite(analysis: ChapterAnalysis, template?: RewritePromptTemplate | null): ChapterAnalysis {
  if (!template || template.sceneRules.length === 0) return analysis
  if (analysis.needsRewrite) return analysis // Already marked, no change needed

  const templateSceneNames = new Set(template.sceneRules.map(s => s.name))
  const hasMatchingScene = analysis.categories.some(c => templateSceneNames.has(c.name))
  if (hasMatchingScene) {
    return { ...analysis, needsRewrite: true }
  }
  return analysis
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export default function RewriteWorkspacePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('id') || ''
  const activeConfigId = useSettingsStore(s => s.activeConfigId)

  // ── Core state ──
  const [project, setProject] = useState<RewriteProject | null>(null)

  // ── Effective model config: project-level overrides global ──
  const effectiveConfigId = project?.modelConfigId || activeConfigId
  const [activeStep, setActiveStep] = useState(1)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [chapterContent, setChapterContent] = useState('')
  const [error, setError] = useState('')

  // ── Stage 2+3: Analysis state ──
  const [analyses, setAnalyses] = useState<Map<string, ChapterAnalysis>>(new Map())
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisQueue, setAnalysisQueue] = useState<{ done: number; total: number; failed: number }>({ done: 0, total: 0, failed: 0 })
  const [analyzePaused, setAnalyzePaused] = useState(false)
  const analyzePausedRef = useRef(false)

  // ── Stage 3: 识别待处理 — marker toggle state ──
  const [disabledMarkerKeys, setDisabledMarkerKeys] = useState<Set<string>>(new Set())

  // ── Rewrite mode tracking (for compare view) ──
  const [rewriteMetaMap, setRewriteMetaMap] = useState<Map<string, { mode: 'scene-segment' | 'full-chapter'; sceneNames: string[] }>>(new Map())

  // ── Stage 5: 合并输出 — selected chapter ──
  const [mergeSelectedChapterId, setMergeSelectedChapterId] = useState<string | null>(null)

  // ── Stage 4: Rewrite state ──
  const [rewrites, setRewrites] = useState<Map<string, ChapterRewrite>>(new Map())
  const [rewriting, setRewriting] = useState(false)
  const [rewriteQueue, setRewriteQueue] = useState<{ done: number; total: number; failed: number }>({ done: 0, total: 0, failed: 0 })
  const [rewritePaused, setRewritePaused] = useState(false)
  const rewritePausedRef = useRef(false)
  const [rewriteStreaming, setRewriteStreaming] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [editorReadOnly, setEditorReadOnly] = useState(true)
  const [showPreserveChapters, setShowPreserveChapters] = useState(false)
  const [showNoRewriteChapters, setShowNoRewriteChapters] = useState(false)

  // ── Breathing light state for Stage 2 ──
  const [activeAnalyzingIds, setActiveAnalyzingIds] = useState<Set<string>>(new Set())
  const [failedAnalyzingIds, setFailedAnalyzingIds] = useState<Set<string>>(new Set())
  const [noSceneIds, setNoSceneIds] = useState<Set<string>>(new Set())

  // ── Breathing light state for Stage 4 ──
  const [activeRewritingIds, setActiveRewritingIds] = useState<Set<string>>(new Set())
  const [failedRewritingIds, setFailedRewritingIds] = useState<Set<string>>(new Set())
  const [attemptedRewriteIds, setAttemptedRewriteIds] = useState<Set<string>>(new Set())
  const [compareChapter, setCompareChapter] = useState<RewriteChapter | null>(null)
  const [compareOriginal, setCompareOriginal] = useState('')
  const [compareRewritten, setCompareRewritten] = useState('')
  const [compareOriginalWc, setCompareOriginalWc] = useState(0)
  const [compareRewrittenWc, setCompareRewrittenWc] = useState(0)
  const [compareMeta, setCompareMeta] = useState<{ mode: 'scene-segment' | 'full-chapter'; sceneNames: string[] } | null>(null)

  // ── Template state ──
  const [templates, setTemplates] = useState<RewritePromptTemplate[]>([])
  const [activeTemplate, setActiveTemplate] = useState<RewritePromptTemplate | null>(null)

  // ── Split state (Stage 1) ──
  const [splitting, setSplitting] = useState(false)

  // ═══════════════════════════════════════════════════════
  // Load project
  // ═══════════════════════════════════════════════════════
  const loadProject = useCallback(async () => {
    if (!projectId) return
    try {
      const p = await rewriteService.read(projectId)
      if (p) {
        setProject(p)
        if (p.stage === 'imported') setActiveStep(1)
        else if (p.stage === 'split') setActiveStep(1)
        else if (p.stage === 'summarized') setActiveStep(2)
        else if (p.stage === 'identified') setActiveStep(3)
        else if (p.stage === 'rewritten') setActiveStep(4)
        else if (p.stage === 'merged') setActiveStep(5)
      }
    } catch (e: any) {
      setError('加载项目失败：' + (e.message || '未知错误'))
    }
  }, [projectId])

  useEffect(() => { loadProject() }, [loadProject])

  // ── Load templates and active template ──
  useEffect(() => {
    rewriteTemplateService.list().then(list => {
      setTemplates(list)
      // If project has a templateId, load that template
      if (project?.templateId) {
        const tpl = list.find(t => t.id === project.templateId)
        setActiveTemplate(tpl || null)
      } else {
        setActiveTemplate(null)
      }
    }).catch(() => {})
  }, [project?.templateId])

  // ── Handle template selection change ──
  const handleTemplateChange = useCallback(async (templateId: string) => {
    if (!project) return
    const tpl = templates.find(t => t.id === templateId)
    setActiveTemplate(tpl || null)
    const updated = { ...project, templateId: templateId || undefined, updatedAt: new Date().toISOString() }
    try {
      const saved = await rewriteService.save(updated)
      setProject(saved)
    } catch { /* ignore */ }
  }, [project, templates])

  // ── Load all analyses from disk on mount / step change ──
  const loadAllAnalyses = useCallback(async () => {
    if (!project || !project.chapters.length) return
    const map = new Map<string, ChapterAnalysis>()
    for (const ch of project.chapters) {
      try {
        const raw = await rewriteService.readAnalysis(projectId, ch.fileName)
        if (raw) {
          const analysis = JSON.parse(raw) as ChapterAnalysis
          analysis.chapterId = ch.id
          map.set(ch.id, analysis)
        }
      } catch { /* not analyzed yet */ }
    }
    setAnalyses(map)
  }, [project, projectId])

  // ── Load all rewrites from disk ──
  const loadAllRewrites = useCallback(async () => {
    if (!project || !project.chapters.length) return
    const map = new Map<string, ChapterRewrite>()
    for (const ch of project.chapters) {
      try {
        const content = await rewriteService.readRewrite(projectId, ch.fileName)
        if (content) {
          map.set(ch.id, {
            chapterId: ch.id,
            content,
            wordCount: countCJKChars(content),
            targetWordCount: ch.wordCount,
            isPassing: calcIsPassing(countCJKChars(content), ch.wordCount),
            rewrittenAt: '',
          })
        }
      } catch { /* not rewritten yet */ }
    }
    setRewrites(map)
  }, [project, projectId])

  useEffect(() => {
    if (activeStep === 2 || activeStep === 3) loadAllAnalyses()
    if (activeStep === 4) loadAllRewrites()
  }, [activeStep, loadAllAnalyses, loadAllRewrites])

  // ── Load chapter content when selected ──
  const handleSelectChapter = useCallback(async (chapter: RewriteChapter) => {
    setSelectedChapterId(chapter.id)
    setEditorReadOnly(true)
    setShowOriginal(false)
    try {
      const content = await rewriteService.readChapter(projectId, chapter.fileName)
      setChapterContent(content)
    } catch {
      setChapterContent('')
    }
  }, [projectId])

  // ── Stage helpers (uses typed STEP_KEY_TO_STAGE / STAGE_ORDER) ──
  const stepComplete = (stepNum: number): boolean => {
    if (!project) return false
    const stepKey = STAGE_STEPS[stepNum - 1]?.key
    if (!stepKey) return false
    const reqStage = STEP_KEY_TO_STAGE[stepKey]
    return STAGE_ORDER.indexOf(project.stage) >= STAGE_ORDER.indexOf(reqStage)
  }

  const handleStepClick = async (step: number) => {
    if (step === 1) { setActiveStep(1); return }
    if (!project) return
    // Prerequisite: the stage BEFORE the clicked step must be completed
    const prevStepKey = STAGE_STEPS[step - 2]?.key
    if (prevStepKey) {
      const prereq = STEP_KEY_TO_STAGE[prevStepKey]
      if (STAGE_ORDER.indexOf(project.stage) < STAGE_ORDER.indexOf(prereq)) {
        setError(`请先完成${STAGE_STEPS[step - 2]?.label || '上一阶段'}`)
        return
      }
    }
    setActiveStep(step)
    setError('')

    // Auto-set stage to 'identified' when entering Stage 3 with analyses
    if (step === 3 && project.stage === 'summarized' && analyses.size > 0) {
      const updated = { ...project, stage: 'identified' as const, updatedAt: new Date().toISOString() }
      await rewriteService.save(updated)
      setProject(updated)
    }
  }

  const handleBack = () => navigate('/rewrite')

  // ═══════════════════════════════════════════════════════
  // Stage 1: 书籍拆分 (unchanged)
  // ═══════════════════════════════════════════════════════
  const handleSplit = async () => {
    if (!projectId || !project) return
    setSplitting(true)
    setError('')
    try {
      const projectPath = await rewriteService.getProjectPath(projectId)
      const originalDir = `${projectPath}/original`
      const files = await fileService.listDir(originalDir)
      if (files.length === 0) throw new Error('原书文件夹为空')
      const sourceContent = await fileService.read(`${originalDir}/${files[0]}`)

      const splitResults = splitChaptersByHeadings(sourceContent)
      if (splitResults.length === 0) throw new Error('未检测到章节标题，请确认TXT文件包含"第X章"等章节标记')

      const sourceWordCount = countCJKChars(sourceContent)

      const updated = await rewriteService.saveChapters({
        projectId,
        sourceWordCount,
        chapters: splitResults.map(r => ({ title: r.title, content: r.content })),
      })

      setProject(updated)
      if (updated.chapters.length > 0) {
        handleSelectChapter(updated.chapters[0])
      }
    } catch (e: any) {
      setError('拆分失败：' + (e.message || '未知错误'))
    }
    setSplitting(false)
  }

  // ═══════════════════════════════════════════════════════
  // Stage 2: 内容总结
  // ═══════════════════════════════════════════════════════
  const handleAnalyzeChapter = useCallback(async (chapter: RewriteChapter) => {
    if (!effectiveConfigId) { setError('请先在设置中配置并连接AI模型'); return }
    setAnalyzing(true)
    setError('')
    try {
      const content = await rewriteService.readChapter(projectId, chapter.fileName)
      if (!content.trim()) throw new Error('章节内容为空')

      const prompt = buildAnalysisPrompt(content, activeTemplate)
      const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
      const analysis = parseAnalysisResponse(reply)
      if (!analysis) throw new Error('AI返回格式异常，请重试')

      analysis.chapterId = chapter.id
      // Enforce: if template scene rules match detected scenes, must rewrite
      const finalAnalysis = enforceTemplateRewrite(analysis, activeTemplate)

      // Save to disk
      await rewriteService.saveAnalysis(projectId, chapter.fileName, JSON.stringify(finalAnalysis, null, 2))

      // Update local state
      setAnalyses(prev => {
        const next = new Map(prev)
        next.set(chapter.id, finalAnalysis)
        return next
      })

      // Update project stage if first analysis
      if (project && project.stage === 'split') {
        const updated = { ...project, stage: 'summarized' as const, updatedAt: new Date().toISOString() }
        await rewriteService.save(updated)
        setProject(updated)
      }
    } catch (e: any) {
      setError('总结失败：' + (e.message || '未知错误'))
      setFailedAnalyzingIds(prev => { const next = new Set(prev); next.add(chapter.id); return next })
    }
    setAnalyzing(false)
  }, [projectId, effectiveConfigId, project, activeTemplate])

  // ── Re-analyze single chapter (clear existing analysis first) ──
  const handleReanalyzeChapter = useCallback(async (chapter: RewriteChapter) => {
    if (!effectiveConfigId) { setError('请先配置AI模型'); return }
    try {
      // Delete analysis from disk
      await rewriteService.deleteAnalysis(projectId, chapter.fileName)
      // Clear from local state
      setAnalyses(prev => {
        const next = new Map(prev)
        next.delete(chapter.id)
        return next
      })
      setFailedAnalyzingIds(prev => { const next = new Set(prev); next.delete(chapter.id); return next })
      setNoSceneIds(prev => { const next = new Set(prev); next.delete(chapter.id); return next })
      // Clear disabled markers for this chapter
      setDisabledMarkerKeys(prev => {
        const next = new Set(prev)
        for (const k of prev) { if (k.startsWith(`${chapter.id}:`)) next.delete(k) }
        return next
      })
      // Re-analyze
      await handleAnalyzeChapter(chapter)
    } catch (e: any) {
      setError('重新总结失败：' + (e.message || '未知错误'))
    }
  }, [projectId, effectiveConfigId, handleAnalyzeChapter])

  const handleAnalyzeAll = useCallback(async () => {
    if (!project || !effectiveConfigId) { setError('请先配置AI模型'); return }
    setAnalyzing(true)
    setError('')
    analyzePausedRef.current = false
    setAnalyzePaused(false)
    // Reset breathing light state
    setActiveAnalyzingIds(new Set())
    setFailedAnalyzingIds(new Set())
    setNoSceneIds(new Set())

    // Only process chapters that haven't been analyzed yet
    const chs = project.chapters.filter(ch => !analyses.has(ch.id))
    if (chs.length === 0) { setError('所有章节已完成总结'); setAnalyzing(false); return }
    let done = 0; let failed = 0
    setAnalysisQueue({ done: 0, total: chs.length, failed: 0 })

    // Use concurrent threads from project config (default 3, min 1, max 10)
    const concurrency = Math.max(1, Math.min(project.concurrentThreads || 3, 10))

    // Process chapters in concurrent batches
    for (let i = 0; i < chs.length; i += concurrency) {
      const batch = chs.slice(i, i + concurrency)
      // Mark batch as active
      setActiveAnalyzingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.add(ch.id))
        return next
      })

      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const content = await rewriteService.readChapter(projectId, ch.fileName)
          if (!content.trim()) return { ch, success: false, error: '空章节' }

          const prompt = buildAnalysisPrompt(content, activeTemplate)
          const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
          const analysis = parseAnalysisResponse(reply)
          if (!analysis) return { ch, success: false, error: '解析失败' }

          analysis.chapterId = ch.id
          const finalAnalysis = enforceTemplateRewrite(analysis, activeTemplate)
          await rewriteService.saveAnalysis(projectId, ch.fileName, JSON.stringify(finalAnalysis, null, 2))
          return { ch, analysis: finalAnalysis, success: true, error: null }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { ch, analysis, success } = result.value
          if (success && analysis) {
            setAnalyses(prev => {
              const next = new Map(prev)
              next.set(ch.id, analysis)
              return next
            })
            // Check for no template scenes
            const hasMatchingScene = activeTemplate?.sceneRules?.some(sr =>
              analysis.categories.some(c => c.name === sr.name)
            ) ?? true
            if (!hasMatchingScene) {
              setNoSceneIds(prev => { const next = new Set(prev); next.add(ch.id); return next })
            }
            done++
          } else {
            setFailedAnalyzingIds(prev => { const next = new Set(prev); next.add(ch.id); return next })
            failed++
          }
        } else {
          failed++
        }
      }
      // Clear active state for this batch
      setActiveAnalyzingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.delete(ch.id))
        return next
      })
      setAnalysisQueue({ done, total: chs.length, failed })
      // Check pause
      if (analyzePausedRef.current) break
    }

    // Update project stage
    if (project) {
      const updated = { ...project, stage: 'summarized' as const, updatedAt: new Date().toISOString() }
      await rewriteService.save(updated)
      setProject(updated)
    }
    setAnalyzing(false)
    // analyses/disabledMarkerKeys 参与过滤，须在依赖中（否则旧闭包重复分析已处理章节）
  }, [project, projectId, effectiveConfigId, activeTemplate, analyses, disabledMarkerKeys])

  const handleRetryFailedAnalyses = useCallback(async () => {
    if (!project || !effectiveConfigId) { setError('请先配置AI模型'); return }
    const failedChapters = project.chapters.filter(ch => !analyses.has(ch.id))
    if (failedChapters.length === 0) { setError('没有需要重新总结的章节'); return }

    setAnalyzing(true)
    setError('')
    setActiveAnalyzingIds(new Set())
    setFailedAnalyzingIds(new Set())
    let done = 0; let failed = 0
    const totalFailed = failedChapters.length
    setAnalysisQueue({ done: 0, total: totalFailed, failed: 0 })

    const concurrency = Math.max(1, Math.min(project.concurrentThreads || 3, 10))

    for (let i = 0; i < failedChapters.length; i += concurrency) {
      const batch = failedChapters.slice(i, i + concurrency)
      setActiveAnalyzingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.add(ch.id))
        return next
      })

      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const content = await rewriteService.readChapter(projectId, ch.fileName)
          if (!content.trim()) return { ch, success: false, error: '空章节' }

          const prompt = buildAnalysisPrompt(content, activeTemplate)
          const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
          const analysis = parseAnalysisResponse(reply)
          if (!analysis) return { ch, success: false, error: '解析失败' }

          analysis.chapterId = ch.id
          const finalAnalysis = enforceTemplateRewrite(analysis, activeTemplate)
          await rewriteService.saveAnalysis(projectId, ch.fileName, JSON.stringify(finalAnalysis, null, 2))
          return { ch, analysis: finalAnalysis, success: true, error: null }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { ch, analysis, success } = result.value
          if (success && analysis) {
            setAnalyses(prev => {
              const next = new Map(prev)
              next.set(ch.id, analysis)
              return next
            })
            const hasMatchingScene = activeTemplate?.sceneRules?.some(sr =>
              analysis.categories.some(c => c.name === sr.name)
            ) ?? true
            if (!hasMatchingScene) {
              setNoSceneIds(prev => { const next = new Set(prev); next.add(ch.id); return next })
            }
            done++
          } else {
            setFailedAnalyzingIds(prev => { const next = new Set(prev); next.add(ch.id); return next })
            failed++
          }
        } else {
          failed++
        }
      }
      setActiveAnalyzingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.delete(ch.id))
        return next
      })
      setAnalysisQueue({ done, total: totalFailed, failed })
    }

    if (project && done > 0) {
      const updated = { ...project, stage: 'summarized' as const, updatedAt: new Date().toISOString() }
      await rewriteService.save(updated)
      setProject(updated)
    }
    setAnalyzing(false)
  }, [project, projectId, effectiveConfigId, activeTemplate, analyses])

  const handleExportSummary = async () => {
    if (!project) return
    const savePath = await dialogService.saveFile(`${project.name}_章节总结.txt`)
    if (!savePath) return

    const lines: string[] = [`《${project.name}》章节总结报告\n`, `生成时间：${new Date().toLocaleString()}\n`, '='.repeat(60) + '\n']

    for (const ch of project.chapters) {
      const analysis = analyses.get(ch.id)
      if (!analysis) continue
      lines.push(`\n第${ch.chapterNumber}章 ${ch.title}`)
      lines.push('-'.repeat(40))
      lines.push(`【情节概要】${analysis.plotSummary}`)
      if (analysis.characters.length > 0) {
        lines.push(`【角色信息】`)
        analysis.characters.forEach(c => lines.push(`  - ${c.name}（${c.role}）：${c.traits}${c.description ? ' — ' + c.description : ''}`))
      }
      if (analysis.keyEvents.length > 0) {
        lines.push(`【关键事件】`)
        analysis.keyEvents.forEach(e => lines.push(`  - ${e}`))
      }
      if (analysis.categories.length > 0) {
        lines.push(`【场景分类】${analysis.categories.map(c => `${c.name}(${c.count})`).join('、')}`)
      }
      if (analysis.contextMarkers.length > 0) {
        lines.push(`【上下文标记】`)
        analysis.contextMarkers.forEach(m => {
          const anchor = m.startText && m.endText ? ` 「${m.startText}……${m.endText}」` : (m.location ? ` (${m.location})` : '')
          lines.push(`  - [${m.sceneName}] ${m.description}${anchor}`)
        })
      }
      lines.push(`【需要改写】${analysis.needsRewrite ? '是' : '否'}`)
    }

    await fileService.write(savePath, lines.join('\n'))
  }

  // ═══════════════════════════════════════════════════════
  // Stage 4: AI改写
  // ═══════════════════════════════════════════════════════
  const handleRewriteChapter = useCallback(async (chapter: RewriteChapter) => {
    if (!effectiveConfigId) { setError('请先配置AI模型'); return }
    setRewriting(true)
    setRewriteStreaming('')
    setError('')
    // Clear previous rewrite from state before re-rewriting
    setRewrites(prev => { const next = new Map(prev); next.delete(chapter.id); return next })

    try {
      const content = await rewriteService.readChapter(projectId, chapter.fileName)
      if (!content.trim()) throw new Error('章节内容为空')

      // Try to load analysis for context
      let analysis: ChapterAnalysis | null = null
      try {
        const raw = await rewriteService.readAnalysis(projectId, chapter.fileName)
        if (raw) analysis = JSON.parse(raw)
      } catch { /* no analysis, rewrite without it */ }

      // ═══ Scene-segment rewriting path ═══
      const allMarkers = analysis?.contextMarkers?.filter(m => m.startText && m.endText) || []
      // Filter out user-disabled markers
      const markers = allMarkers.filter((_, i) => !disabledMarkerKeys.has(`${chapter.id}:${i}`))

      if (markers.length > 0) {
        // Group markers by startText|endText to handle overlapping scenes
        const markerGroups = new Map<string, ContextMarker[]>()
        for (const m of markers) {
          const key = `${m.startText}|${m.endText}`
          if (!markerGroups.has(key)) markerGroups.set(key, [])
          markerGroups.get(key)!.push(m)
        }

        // Extract segments and build prompts (word targets follow template scene rules)
        const segmentTasks = Array.from(markerGroups.entries())
          .map(([key, group]) => {
            const primary = group[0]
            const segment = extractSceneSegment(content, primary)
            if (!segment) return null
            const sceneNames = [...new Set(group.map(m => m.sceneName))]
            const description = group.map(m => m.description).filter(Boolean).join('；')
            const segPrompt = buildSegmentRewritePrompt(segment.text, sceneNames, description, activeTemplate)
            return { key, prompt: segPrompt, marker: primary, start: segment.start, end: segment.end }
          })
          .filter(Boolean) as { key: string; prompt: string; marker: ContextMarker; start: number; end: number }[]

        if (segmentTasks.length > 0) {
          // Process segments sequentially with progress display
          const rewrittenSegments: { marker: ContextMarker; start: number; end: number; rewritten: string }[] = []

          for (let i = 0; i < segmentTasks.length; i++) {
            const task = segmentTasks[i]
            setRewriteStreaming(`正在改写场景段落 ${i + 1}/${segmentTasks.length}...`)

            try {
              const reply = await chatAI([{ role: 'user', content: task.prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
              rewrittenSegments.push({
                marker: task.marker,
                start: task.start,
                end: task.end,
                rewritten: reply.trim(),
              })
            } catch {
              // Keep original text for this segment on failure
            }
          }

          // Assemble final chapter
          const finalContent = assembleRewrittenChapter(content, rewrittenSegments)
          setRewriteStreaming('')

          // Save rewrite metadata for compare view
          setRewriteMetaMap(prev => {
            const next = new Map(prev)
            next.set(chapter.id, { mode: 'scene-segment', sceneNames: [...new Set(rewrittenSegments.map(s => s.marker.sceneName))] })
            return next
          })

          await rewriteService.saveRewrite(projectId, chapter.fileName, finalContent)

          const wc = countCJKChars(finalContent)
          const rewrite: ChapterRewrite = {
            chapterId: chapter.id, content: finalContent, wordCount: wc,
            targetWordCount: chapter.wordCount,
            isPassing: calcIsPassing(wc, chapter.wordCount, project?.rewriteWordTarget),
            rewrittenAt: new Date().toISOString(),
          }
          setRewrites(prev => {
            const next = new Map(prev)
            next.set(chapter.id, rewrite)
            return next
          })

          if (project && (project.stage === 'summarized' || project.stage === 'identified')) {
            const updated = { ...project, stage: 'rewritten' as const, updatedAt: new Date().toISOString() }
            await rewriteService.save(updated)
            setProject(updated)
          }
          setRewriting(false)
          return  // Scene-segment path complete
        }
      }

      // ═══ Fallback: Full-chapter rewrite path (non-streaming) ═══
      const prompt = buildRewritePrompt(content, analysis, activeTemplate, project?.rewriteWordTarget, chapter.id, disabledMarkerKeys)

      const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
      const rewrittenContent = reply.trim()
      if (!rewrittenContent) throw new Error('AI返回空内容')

      // Save to disk
      await rewriteService.saveRewrite(projectId, chapter.fileName, rewrittenContent)

      const wc = countCJKChars(rewrittenContent)
      const rewrite: ChapterRewrite = {
        chapterId: chapter.id,
        content: rewrittenContent,
        wordCount: wc,
        targetWordCount: chapter.wordCount,
        isPassing: calcIsPassing(wc, chapter.wordCount, project?.rewriteWordTarget),
        rewrittenAt: new Date().toISOString(),
      }

      setRewrites(prev => {
        const next = new Map(prev)
        next.set(chapter.id, rewrite)
        return next
      })

      // Save rewrite metadata for compare view
      const sceneNames = analysis?.categories?.map(c => c.name) || []
      setRewriteMetaMap(prev => {
        const next = new Map(prev)
        next.set(chapter.id, { mode: 'full-chapter', sceneNames })
        return next
      })

      // Update project stage
      if (project && (project.stage === 'summarized' || project.stage === 'identified')) {
        const updated = { ...project, stage: 'rewritten' as const, updatedAt: new Date().toISOString() }
        await rewriteService.save(updated)
        setProject(updated)
      }
    } catch (e: any) {
      setError('改写失败：' + (e.message || '未知错误'))
    }
    setRewriting(false)
  }, [projectId, effectiveConfigId, project, activeTemplate])

  const handleRewriteAll = useCallback(async () => {
    if (!project || !effectiveConfigId) { setError('请先配置AI模型'); return }
    setRewriting(true)
    setError('')
    rewritePausedRef.current = false
    setRewritePaused(false)
    setActiveRewritingIds(new Set())
    setFailedRewritingIds(new Set())
    // Only process chapters that haven't been rewritten yet
    const chs = project.chapters.filter(ch => !rewrites.has(ch.id))
    if (chs.length === 0) { setError('所有章节已完成改写'); setRewriting(false); return }
    // Mark all target chapters as attempted
    setAttemptedRewriteIds(prev => {
      const next = new Set(prev)
      chs.forEach(c => next.add(c.id))
      return next
    })
    let done = 0; let failed = 0
    setRewriteQueue({ done: 0, total: chs.length, failed: 0 })

    // Use concurrent threads from project config (default 2 for rewrite, min 1, max 10)
    const concurrency = Math.max(1, Math.min(project.concurrentThreads || 2, 10))
    const wordTarget = project.rewriteWordTarget

    // Process chapters in concurrent batches (non-streaming for batch)
    for (let i = 0; i < chs.length; i += concurrency) {
      const batch = chs.slice(i, i + concurrency)
      setActiveRewritingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.add(ch.id))
        return next
      })

      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const content = await rewriteService.readChapter(projectId, ch.fileName)
          if (!content.trim()) return { ch, success: false }

          let analysis: ChapterAnalysis | null = null
          try {
            const raw = await rewriteService.readAnalysis(projectId, ch.fileName)
            if (raw) analysis = JSON.parse(raw)
          } catch { /* no analysis */ }

          // ═══ Scene-segment rewriting for batch ═══
          const allMarkers = analysis?.contextMarkers?.filter((m: ContextMarker) => m.startText && m.endText) || []
          const markers = allMarkers.filter((_, i) => !disabledMarkerKeys.has(`${ch.id}:${i}`))
          let rewrittenContent: string

          if (markers.length > 0) {
            // Group markers by startText|endText
            const markerGroups = new Map<string, ContextMarker[]>()
            for (const m of markers) {
              const key = `${m.startText}|${m.endText}`
              if (!markerGroups.has(key)) markerGroups.set(key, [])
              markerGroups.get(key)!.push(m)
            }

            // Extract segments (word targets follow template scene rules)
            const segmentTasks = Array.from(markerGroups.entries())
              .map(([key, group]) => {
                const primary = group[0]
                const segment = extractSceneSegment(content, primary)
                if (!segment) return null
                const sceneNames = [...new Set(group.map(g => g.sceneName))]
                const description = group.map(g => g.description).filter(Boolean).join('；')
                const segPrompt = buildSegmentRewritePrompt(segment.text, sceneNames, description, activeTemplate)
                return { prompt: segPrompt, start: segment.start, end: segment.end }
              })
              .filter(Boolean) as { prompt: string; start: number; end: number }[]

            if (segmentTasks.length > 0) {
              // Parallel segment rewrites within this chapter
              const segResults = await Promise.allSettled(
                segmentTasks.map(t =>
                  chatAI([{ role: 'user', content: t.prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
                    .then(reply => ({ ...t, rewritten: reply.trim() }))
                )
              )
              const rewrittenSegments: { start: number; end: number; rewritten: string }[] = []
              for (const r of segResults) {
                if (r.status === 'fulfilled' && r.value.rewritten) {
                  rewrittenSegments.push({ start: r.value.start, end: r.value.end, rewritten: r.value.rewritten })
                }
              }

              rewrittenContent = assembleRewrittenChapterFromSimple(content, rewrittenSegments)
            } else {
              // Fallback: full-chapter rewrite
              const prompt = buildRewritePrompt(content, analysis, activeTemplate, wordTarget, ch.id, disabledMarkerKeys)
              const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
              rewrittenContent = reply
            }
          } else {
            // No markers: full-chapter rewrite
            const prompt = buildRewritePrompt(content, analysis, activeTemplate, wordTarget, ch.id, disabledMarkerKeys)
            const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
            rewrittenContent = reply
          }

          if (!rewrittenContent.trim()) return { ch, success: false }

          await rewriteService.saveRewrite(projectId, ch.fileName, rewrittenContent)

          const wc = countCJKChars(rewrittenContent)
          return {
            ch, success: true,
            rewrite: {
              chapterId: ch.id,
              content: rewrittenContent,
              wordCount: wc,
              targetWordCount: ch.wordCount,
              isPassing: calcIsPassing(wc, ch.wordCount, project?.rewriteWordTarget),
              rewrittenAt: new Date().toISOString(),
            } as ChapterRewrite,
          }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { ch, rewrite } = result.value
          if (!rewrite) { failed++; continue }
          setRewrites(prev => {
            const next = new Map(prev)
            next.set(ch.id, rewrite)
            return next
          })
          done++
        } else {
          if (result.status === 'fulfilled') {
            setFailedRewritingIds(prev => { const next = new Set(prev); next.add(result.value.ch.id); return next })
          }
          failed++
        }
      }
      setActiveRewritingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.delete(ch.id))
        return next
      })
      setRewriteQueue({ done, total: chs.length, failed })
      // Check pause
      if (rewritePausedRef.current) break
    }

    if (project && done > 0) {
      const updated = { ...project, stage: 'rewritten' as const, updatedAt: new Date().toISOString() }
      await rewriteService.save(updated)
      setProject(updated)
    }
    setRewriting(false)
    // rewrites/disabledMarkerKeys 参与过滤，须在依赖中（否则旧闭包重复改写已处理章节）
  }, [project, projectId, effectiveConfigId, activeTemplate, rewrites, disabledMarkerKeys])

  const handleRetryWordCountFailures = useCallback(async () => {
    if (!project || !effectiveConfigId) return
    const failures = project.chapters.filter(ch => {
      const rw = rewrites.get(ch.id)
      return rw && !rw.isPassing
    })
    if (failures.length === 0) { setError('没有字数不达标的章节'); return }

    setRewriting(true)
    setError('')
    setActiveRewritingIds(new Set())
    setFailedRewritingIds(new Set())
    let done = 0; let failed = 0
    setRewriteQueue({ done: 0, total: failures.length, failed: 0 })

    // Use concurrent threads (default 2 for retry, min 1, max 10)
    const concurrency = Math.max(1, Math.min(project.concurrentThreads || 2, 10))

    for (let i = 0; i < failures.length; i += concurrency) {
      const batch = failures.slice(i, i + concurrency)
      setActiveRewritingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.add(ch.id))
        return next
      })

      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const content = await rewriteService.readChapter(projectId, ch.fileName)
          let analysis: ChapterAnalysis | null = null
          try {
            const raw = await rewriteService.readAnalysis(projectId, ch.fileName)
            if (raw) analysis = JSON.parse(raw)
          } catch { /* no analysis */ }

          const prevWc = rewrites.get(ch.id)?.wordCount || 0
          const wordCountNote = `\n\n特别注意：改写后字数必须至少达到${ch.wordCount}字（原文章节字数），当前改写字数${prevWc}字不达标。请扩充内容，确保改写后字数达到要求。`

          // ═══ Scene-segment rewriting for retry ═══
          const markers = analysis?.contextMarkers?.filter((m: ContextMarker) => m.startText && m.endText) || []
          let rewrittenContent: string

          if (markers.length > 0) {
            const markerGroups = new Map<string, ContextMarker[]>()
            for (const m of markers) {
              const key = `${m.startText}|${m.endText}`
              if (!markerGroups.has(key)) markerGroups.set(key, [])
              markerGroups.get(key)!.push(m)
            }

            const segmentTasks = Array.from(markerGroups.entries())
              .map(([key, group]) => {
                const primary = group[0]
                const segment = extractSceneSegment(content, primary)
                if (!segment) return null
                const sceneNames = [...new Set(group.map(g => g.sceneName))]
                const description = group.map(g => g.description).filter(Boolean).join('；')
                const segPrompt = buildSegmentRewritePrompt(segment.text, sceneNames, description, activeTemplate) + wordCountNote
                return { prompt: segPrompt, start: segment.start, end: segment.end }
              })
              .filter(Boolean) as { prompt: string; start: number; end: number }[]

            if (segmentTasks.length > 0) {
              const segResults = await Promise.allSettled(
                segmentTasks.map(t =>
                  chatAI([{ role: 'user', content: t.prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
                    .then(reply => ({ ...t, rewritten: reply.trim() }))
                )
              )
              const rewrittenSegments: { start: number; end: number; rewritten: string }[] = []
              for (const r of segResults) {
                if (r.status === 'fulfilled' && r.value.rewritten) {
                  rewrittenSegments.push({ start: r.value.start, end: r.value.end, rewritten: r.value.rewritten })
                }
              }
              rewrittenContent = assembleRewrittenChapterFromSimple(content, rewrittenSegments)
            } else {
              const prompt = buildRewritePrompt(content, analysis, activeTemplate, ch.wordCount, ch.id, disabledMarkerKeys) + wordCountNote
              const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
              rewrittenContent = reply
            }
          } else {
            const prompt = buildRewritePrompt(content, analysis, activeTemplate, ch.wordCount, ch.id, disabledMarkerKeys) + wordCountNote
            const reply = await chatAI([{ role: 'user', content: prompt }], effectiveConfigId, activeTemplate?.systemPrompt)
            rewrittenContent = reply
          }

          if (!rewrittenContent.trim()) return { ch, success: false }

          await rewriteService.saveRewrite(projectId, ch.fileName, rewrittenContent)

          const wc = countCJKChars(rewrittenContent)
          return {
            ch, success: true,
            rewrite: {
              chapterId: ch.id,
              content: rewrittenContent,
              wordCount: wc,
              targetWordCount: ch.wordCount,
              isPassing: calcIsPassing(wc, ch.wordCount, project?.rewriteWordTarget),
              rewrittenAt: new Date().toISOString(),
            } as ChapterRewrite,
          }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { ch, rewrite } = result.value
          if (!rewrite) { failed++; continue }
          setRewrites(prev => {
            const next = new Map(prev)
            next.set(ch.id, rewrite)
            return next
          })
          done++
        } else {
          if (result.status === 'fulfilled') {
            setFailedRewritingIds(prev => { const next = new Set(prev); next.add(result.value.ch.id); return next })
          }
          failed++
        }
      }
      setActiveRewritingIds(prev => {
        const next = new Set(prev)
        batch.forEach(ch => next.delete(ch.id))
        return next
      })
      setRewriteQueue({ done, total: failures.length, failed })
    }
    setRewriting(false)
  }, [project, projectId, effectiveConfigId, activeTemplate, rewrites])

  // ── Editor content change → save ──
  const handleEditorChange = useCallback(async (plainText: string) => {
    if (!selectedChapterId || !projectId) return
    const ch = project?.chapters.find(c => c.id === selectedChapterId)
    if (!ch) return

    const wc = countCJKChars(plainText)
    const rewrite: ChapterRewrite = {
      chapterId: selectedChapterId,
      content: plainText,
      wordCount: wc,
      targetWordCount: ch.wordCount,
      isPassing: calcIsPassing(wc, ch.wordCount, project?.rewriteWordTarget),
      rewrittenAt: new Date().toISOString(),
    }

    setRewrites(prev => {
      const next = new Map(prev)
      next.set(selectedChapterId, rewrite)
      return next
    })

    // Save to disk
    try {
      await rewriteService.saveRewrite(projectId, ch.fileName, plainText)
    } catch { /* ignore */ }
  }, [selectedChapterId, projectId, project?.chapters])

  // ── Pause / Continue handlers (defined after batch handlers) ──
  const handleToggleAnalyzePause = useCallback(() => {
    if (analyzePausedRef.current) {
      analyzePausedRef.current = false
      setAnalyzePaused(false)
      handleAnalyzeAll()
    } else {
      analyzePausedRef.current = true
      setAnalyzePaused(true)
    }
  }, [handleAnalyzeAll])

  const handleToggleRewritePause = useCallback(() => {
    if (rewritePausedRef.current) {
      rewritePausedRef.current = false
      setRewritePaused(false)
      handleRewriteAll()
    } else {
      rewritePausedRef.current = true
      setRewritePaused(true)
    }
  }, [handleRewriteAll])

  const handleOpenCompare = useCallback(async (chapter: RewriteChapter) => {
    try {
      const original = await rewriteService.readChapter(projectId, chapter.fileName)
      const rewrite = rewrites.get(chapter.id)
      const meta = rewriteMetaMap.get(chapter.id) || null
      setCompareChapter(chapter)
      setCompareOriginal(original)
      setCompareRewritten(rewrite?.content || '')
      setCompareOriginalWc(countCJKChars(original))
      setCompareRewrittenWc(countCJKChars(rewrite?.content || ''))
      setCompareMeta(meta)
    } catch {
      setError('无法加载对比内容')
    }
  }, [projectId, rewrites, rewriteMetaMap])

  // ═══════════════════════════════════════════════════════
  // Stage render routing
  // ═══════════════════════════════════════════════════════
  const renderStageContent = () => {
    if (!project) return null
    switch (activeStep) {
      case 1: return renderStageSplit()
      case 2: return renderStageSummary()
      case 3: return renderStageIdentify()
      case 4: return renderStageRewrite()
      case 5: return renderStageMerge()
      default: return null
    }
  }

  // ── Stage 1: 书籍拆分 ──
  const renderStageSplit = () => {
    const hasChapters = project!.chapters.length > 0
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chapter list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>章节列表</div>
            <div style={{ fontSize: 12, color: '#3a3530', marginTop: 2 }}>{hasChapters ? `${project!.chapters.length} 章` : '尚未拆分'}</div>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {project!.chapters.map(ch => (
              <button
                key={ch.id}
                onClick={() => handleSelectChapter(ch)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 14px', border: 'none', cursor: 'pointer',
                  background: selectedChapterId === ch.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                  borderLeft: selectedChapterId === ch.id ? '3px solid #7c3aed' : '3px solid transparent',
                  textAlign: 'left' as const, fontFamily: 'inherit',
                  fontSize: 12, color: selectedChapterId === ch.id ? '#7c3aed' : '#4a3f38',
                  fontWeight: selectedChapterId === ch.id ? 600 : 500,
                  transition: 'all 0.12s ease',
                }}
                onMouseEnter={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
                onMouseLeave={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'transparent' }}
              >
                <DocumentTextIcon style={{ width: 13, height: 13, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
{ch.title}
                  </div>
                  <div style={{ fontSize: 10, color: '#2d2520', marginTop: 1 }}>{formatWordCount(ch.wordCount)}字</div>
                </div>
              </button>
            ))}
            {!hasChapters && (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <EmptyState icon="📄" title="暂无章节" description="点击右侧「开始拆分」自动拆分章节" />
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chapter content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(255,255,255,0.4)' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
              {selectedChapterId
                ? project!.chapters.find(c => c.id === selectedChapterId)?.title || ''
                : hasChapters ? '请选择左侧章节' : '章节内容'}
            </span>
            {selectedChapterId && (() => {
              const ch = project!.chapters.find(c => c.id === selectedChapterId)
              return ch ? <span style={{ fontSize: 11, color: '#2d2520', marginLeft: 12 }}>{formatWordCount(ch.wordCount)}字</span> : null
            })()}
          </div>
          <ScrollArea style={{ flex: 1, padding: '20px 24px', background: '#fff' }}>
            {selectedChapterId ? (
              <div style={{ fontSize: 17, lineHeight: 2.0, color: '#1a1410', whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' }}>
                {chapterContent || '（空）'}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <EmptyState icon="📖" title={hasChapters ? '选择左侧章节查看内容' : '拆分后在此查看章节内容'} />
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Stats & action */}
        <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>书籍统计</div>
          </div>
          <div style={{ padding: '16px 14px', flex: 1 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#2d2520', marginBottom: 4 }}>总字数</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>{formatWordCount(project!.wordCount)}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#2d2520', marginBottom: 4 }}>章节数</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>{hasChapters ? project!.chapters.length : '-'}</div>
            </div>
            <div style={{ fontSize: 12, color: '#2d2520', marginTop: 4 }}>来源文件</div>
            <div style={{ fontSize: 12, color: '#4a3f38', marginTop: 2, wordBreak: 'break-all' }}>{project!.sourceFileName}</div>
          </div>
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
            <button onClick={handleSplit} disabled={splitting} style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: splitting ? 'wait' : 'pointer',
              background: hasChapters ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
              color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              opacity: splitting ? 0.7 : 1, transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <SparklesIcon style={{ width: 15, height: 15 }} />
              {splitting ? '拆分中...' : hasChapters ? '重新拆分' : '开始拆分'}
            </button>
            {hasChapters && <div style={{ fontSize: 12, color: '#2d2520', textAlign: 'center', marginTop: 4 }}>重新拆分将覆盖现有章节</div>}
          </div>
        </div>
      </div>
    )
  }

  // ── Stage 2: 内容总结 ──
  const renderStageSummary = () => {
    const chapters = project!.chapters
    const selectedAnalysis = selectedChapterId ? analyses.get(selectedChapterId) : null
    const analyzedCount = analyses.size
    const failedCount = failedAnalyzingIds.size

    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>章节列表</div>
            <div style={{ fontSize: 12, color: '#3a3530', marginTop: 2 }}>{chapters.length} 章 · 已总结 {analyzedCount}</div>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {chapters.map(ch => {
              const hasAnalysis = analyses.has(ch.id)
              const isActive = analyzing && activeAnalyzingIds.has(ch.id)
              const isFailed = failedAnalyzingIds.has(ch.id)
              const isNoScene = noSceneIds.has(ch.id)

              let dotColor: string
              let dotClass: string | undefined
              if (isActive) {
                dotColor = '#16a34a'; dotClass = 'breathe-dot'
              } else if (isFailed) {
                dotColor = '#dc2626'
              } else if (hasAnalysis && isNoScene) {
                dotColor = '#f59e0b'
              } else if (hasAnalysis) {
                dotColor = '#16a34a'
              } else {
                dotColor = '#d1d5db'
              }

              return (
                <button
                  key={ch.id}
                  onClick={() => handleSelectChapter(ch)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 14px', border: 'none', cursor: 'pointer',
                    background: selectedChapterId === ch.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                    borderLeft: selectedChapterId === ch.id ? '3px solid #7c3aed' : '3px solid transparent',
                    textAlign: 'left' as const, fontFamily: 'inherit',
                    fontSize: 14, color: selectedChapterId === ch.id ? '#7c3aed' : '#4a3f38',
                    fontWeight: selectedChapterId === ch.id ? 600 : 500,
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
                  onMouseLeave={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <span className={dotClass} style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: dotClass ? 'transparent' : dotColor,
                    color: dotColor, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
  {ch.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#2d2520', marginTop: 1, display: 'flex', gap: 6 }}>
                      <span>{formatWordCount(ch.wordCount)}字</span>
                      {(() => {
                        const a = analyses.get(ch.id)
                        if (!a || !activeTemplate?.sceneRules?.length) return null
                        const hasScene = activeTemplate.sceneRules.some(sr => a.categories.some(c => c.name === sr.name))
                        return hasScene ? <span style={{ color: '#6366f1', fontWeight: 600 }}>需改写</span> : null
                      })()}
                    </div>
                  </div>
                </button>
              )
            })}
          </ScrollArea>
        </div>

        {/* Center: Analysis display */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
              {selectedChapterId ? chapters.find(c => c.id === selectedChapterId)?.title || '' : '选择左侧章节查看总结'}
            </span>
            {selectedAnalysis && (
              <>
                <button
                  onClick={() => {
                    const ch = chapters.find(c => c.id === selectedChapterId)
                    if (ch && !analyzing) handleReanalyzeChapter(ch)
                  }}
                  disabled={analyzing}
                  title="清除本章总结并重新分析"
                  style={{
                    marginLeft: 'auto', padding: '4px 12px', borderRadius: 6,
                    border: '1px solid rgba(124,58,237,0.2)', cursor: analyzing ? 'not-allowed' : 'pointer',
                    background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    opacity: analyzing ? 0.5 : 1, whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.14-9.36L1 10"/></svg>
                  重新总结
                </button>
                <span style={{ fontSize: 12, color: '#2d2520' }}>
                  {new Date(selectedAnalysis.analyzedAt).toLocaleString('zh-CN')}
                </span>
              </>
            )}
          </div>
          <ScrollArea style={{ flex: 1, padding: '20px 24px', background: '#fff' }}>
            {selectedAnalysis ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* 情节概要 */}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />
                    情节概要
                  </h4>
                  <p style={{ fontSize: 14, lineHeight: 2, color: '#2d2520', margin: 0, textIndent: '2em' }}>
                    {selectedAnalysis.plotSummary || '（无）'}
                  </p>
                </section>

                {/* 角色信息 */}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#8b5cf6', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6', display: 'inline-block' }} />
                    角色信息
                  </h4>
                  {selectedAnalysis.characters.length > 0 ? (
                    <ScrollArea style={{ maxHeight: 560 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {selectedAnalysis.characters.map((c, i) => (
                          <div key={i} style={{
                            padding: '10px 12px', borderRadius: 10,
                            background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.08)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#4a3f38' }}>{c.name}</span>
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>{c.role}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#3a3530', lineHeight: 1.6 }}>{c.traits}</div>
                            {c.description && <div style={{ fontSize: 11, color: '#2d2520', marginTop: 2 }}>{c.description}</div>}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : <p style={{ fontSize: 13, color: '#2d2520', margin: 0 }}>（无角色信息）</p>}
                </section>

                {/* 关键事件 */}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec4899', display: 'inline-block' }} />
                    关键事件
                  </h4>
                  {selectedAnalysis.keyEvents.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selectedAnalysis.keyEvents.map((e, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#4a3f38', lineHeight: 1.8 }}>
                          <span style={{ color: '#ec4899', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                          <span>{e}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ fontSize: 13, color: '#2d2520', margin: 0 }}>（无关键事件）</p>}
                </section>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <EmptyState icon="🧠" title="选择左侧章节" description="点击右下角「内容总结」对选中章节进行AI分析" />
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Stats & controls */}
        <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>总结统计</div>
          </div>
          <div style={{ padding: '16px 14px', flex: 1 }}>
            {/* Failed / Completed */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{failedCount}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>失败章节</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{analyzedCount}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>已完成</div>
              </div>
            </div>

            {/* Progress */}
            {analyzing && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#2d2520', marginBottom: 4 }}>
                  总结进度 {analysisQueue.done}/{analysisQueue.total}
                </div>
                <div style={{ height: 6, borderRadius: 3, background: '#e5e0da', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                    width: analysisQueue.total > 0 ? `${(analysisQueue.done / analysisQueue.total) * 100}%` : '0%',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}

            {/* Retry failed chapters — always visible */}
            {(() => {
              const retryCount = chapters.length - analyzedCount
              const canRetry = retryCount > 0 && !analyzing
              return (
                <div style={{ marginBottom: 8 }}>
                  <button onClick={handleRetryFailedAnalyses} disabled={!canRetry} style={{
                    width: '100%', padding: '8px 0', borderRadius: 8,
                    border: '1px solid #dc2626', cursor: canRetry ? 'pointer' : 'default',
                    background: 'rgba(220,38,38,0.06)', color: '#dc2626',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    opacity: canRetry ? 1 : 0.4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    transition: 'all 0.15s ease',
                  }}
                    onMouseEnter={e => { if (canRetry) e.currentTarget.style.background = 'rgba(220,38,38,0.12)' }}
                    onMouseLeave={e => { if (canRetry) e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                  >
                    <ArrowPathIcon style={{ width: 13, height: 13 }} />
                    {retryCount > 0 ? `失败章节重新总结 (${retryCount})` : '无需重新总结'}
                  </button>
                </div>
              )
            })()}

            {/* Export button */}
            {analyzedCount > 0 && (
              <div style={{ marginBottom: 8 }}>
                <button onClick={handleExportSummary} style={{
                  width: '100%', padding: '8px 0', borderRadius: 8,
                  border: '1px solid #7c3aed', cursor: 'pointer',
                  background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  transition: 'all 0.15s ease',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                >
                  <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> 导出总结
                </button>
                <div style={{ fontSize: 12, color: '#2d2520', textAlign: 'center', marginTop: 4, lineHeight: 1.4 }}>
                  导出章节总结用于优化改写提示词
                </div>
              </div>
            )}
          </div>

          {/* Action buttons - bottom right */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Progress bar — always visible */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38', textAlign: 'center' }}>
              {analyzing
                ? `${analysisQueue.done}/${analysisQueue.total} 章`
                : `${analyzedCount}/${chapters.length} 章`}
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#e5e0da', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: 'linear-gradient(90deg, #7c3aed, #a78bfa, #7c3aed)',
                backgroundSize: '200% 100%',
                animation: analyzing && !analyzePaused ? 'gradientShift 1.5s linear infinite' : 'none',
                width: chapters.length > 0
                  ? `${((analyzing ? analysisQueue.done : analyzedCount) / chapters.length) * 100}%`
                  : '0%',
                transition: 'width 0.3s ease',
              }} />
            </div>

            {/* Pause / Continue — only during active analysis */}
            {analyzing && (
              <button onClick={handleToggleAnalyzePause} style={{
                width: '100%', padding: '6px 0', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer',
                background: analyzePaused ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                color: analyzePaused ? '#10b981' : '#d97706',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                {analyzePaused ? '▶ 继续总结' : '⏸ 暂停'}
              </button>
            )}

            {/* Batch analyze all chapters */}
            <button onClick={handleAnalyzeAll} disabled={analyzing || chapters.length === 0} style={{
              width: '100%', padding: '8px 0', borderRadius: 8, border: 'none',
              cursor: analyzing || chapters.length === 0 ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              opacity: analyzing || chapters.length === 0 ? 0.5 : 1, transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <SparklesIcon style={{ width: 13, height: 13 }} />
              {analyzing ? '总结中...' : `全部总结 (${chapters.length - analyzedCount}章)`}
            </button>

            {/* Single chapter analyze */}
            <button onClick={() => {
              if (selectedChapterId) {
                const ch = chapters.find(c => c.id === selectedChapterId)
                if (ch) handleAnalyzeChapter(ch)
              }
            }} disabled={analyzing || !selectedChapterId} style={{
              width: '100%', padding: '8px 0', borderRadius: 8, border: 'none',
              cursor: analyzing || !selectedChapterId ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
              color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              opacity: analyzing || !selectedChapterId ? 0.5 : 1, transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <SparklesIcon style={{ width: 13, height: 13 }} />
              {analyzing ? '总结中...' : '总结本章'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Stage 3: 识别待处理 ──
  const renderStageIdentify = () => {
    const chapters = project!.chapters
    const selectedAnalysis = selectedChapterId ? analyses.get(selectedChapterId) : null

    // Aggregate stats across all chapters
    const pendingRewrite = Array.from(analyses.values()).filter(a => a.needsRewrite).length
    const preserveOriginal = Array.from(analyses.values()).filter(a => !a.needsRewrite).length

    // Aggregate categories across all chapters
    const catMap = new Map<string, number>()
    for (const a of analyses.values()) {
      for (const c of a.categories) {
        catMap.set(c.name, (catMap.get(c.name) || 0) + c.count)
      }
    }
    const allCategories = Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>章节列表</div>
            <div style={{ fontSize: 14, color: '#3a3530', marginTop: 2 }}>
              {chapters.length} 章 · 需改写 {pendingRewrite}
              {!showPreserveChapters && preserveOriginal > 0 && (
                <span style={{ fontSize: 11, color: '#2d2520' }}>（{preserveOriginal}章保留原文已折叠）</span>
              )}
            </div>
          </div>
          {/* Toggle preserve chapters */}
          {preserveOriginal > 0 && (
            <button
              onClick={() => setShowPreserveChapters(!showPreserveChapters)}
              style={{
                margin: '4px 14px 0', padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer',
                background: showPreserveChapters ? 'rgba(16,185,129,0.08)' : 'transparent',
                color: '#10b981', fontSize: 12, fontWeight: 600,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                width: 'calc(100% - 28px)',
              }}
            >
              {showPreserveChapters ? '📌 折叠保留原文章节' : `📌 展开保留原文章节 (${preserveOriginal}章)`}
            </button>
          )}
          <ScrollArea style={{ flex: 1 }}>
            {(() => {
              const visibleChapters = showPreserveChapters
                ? chapters
                : chapters.filter(ch => {
                    const analysis = analyses.get(ch.id)
                    return !analysis || analysis.needsRewrite
                  })
              if (visibleChapters.length === 0) {
                return (
                  <div style={{ padding: 20, textAlign: 'center' }}>
                    <EmptyState icon="📌" title="所有章节已标记为保留原文" description="点击上方按钮展开查看" />
                  </div>
                )
              }
              return visibleChapters.map(ch => {
                const analysis = analyses.get(ch.id)
                const hasAnalysis = !!analysis
                return (
                  <button
                    key={ch.id}
                    onClick={() => handleSelectChapter(ch)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 14px', border: 'none', cursor: 'pointer',
                      background: selectedChapterId === ch.id ? 'rgba(99,102,241,0.08)' : 'transparent',
                      borderLeft: selectedChapterId === ch.id ? '3px solid #6366f1' : '3px solid transparent',
                      textAlign: 'left' as const, fontFamily: 'inherit',
                      fontSize: 14, color: selectedChapterId === ch.id ? '#6366f1' : '#4a3f38',
                      fontWeight: selectedChapterId === ch.id ? 600 : 500,
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'rgba(99,102,241,0.03)' }}
                    onMouseLeave={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ flexShrink: 0, fontSize: 12 }}>
                      {hasAnalysis ? (analysis!.needsRewrite ? '✏️' : '📌') : '○'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
    {ch.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#2d2520', marginTop: 1, display: 'flex', gap: 6 }}>
                        <span>{formatWordCount(ch.wordCount)}字</span>
                        {(() => {
                          if (!hasAnalysis || !activeTemplate?.sceneRules?.length) return null
                          const hasScene = activeTemplate.sceneRules.some(sr => analysis!.categories.some(c => c.name === sr.name))
                          return hasScene ? <span style={{ color: '#6366f1', fontWeight: 600 }}>需改写</span> : null
                        })()}
                      </div>
                    </div>
                  </button>
                )
              })
            })()}
          </ScrollArea>
        </div>

        {/* Center: Identification display */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
              {selectedChapterId ? chapters.find(c => c.id === selectedChapterId)?.title || '' : '选择左侧章节查看识别结果'}
            </span>
            {selectedAnalysis && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: selectedAnalysis.needsRewrite ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.1)', color: selectedAnalysis.needsRewrite ? '#6366f1' : '#10b981', marginLeft: 'auto' }}>
                {selectedAnalysis.needsRewrite ? '待改写' : '保留原文'}
              </span>
            )}
          </div>
          <ScrollArea style={{ flex: 1, padding: '20px 24px', background: '#fff' }}>
            {selectedAnalysis ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* 识别分类 */}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#6366f1', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
                    识别分类
                  </h4>
                  {selectedAnalysis.categories.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selectedAnalysis.categories.map((c, i) => (
                        <span key={i} style={{
                          padding: '4px 12px', borderRadius: 20,
                          background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)',
                          fontSize: 12, color: '#4a3f38',
                        }}>
                          {c.name} <span style={{ fontWeight: 600, color: '#6366f1' }}>×{c.count}</span>
                        </span>
                      ))}
                    </div>
                  ) : <p style={{ fontSize: 13, color: '#2d2520', margin: 0 }}>（无场景分类）</p>}
                </section>

                {/* 上下文标记 */}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                    上下文标记
                  </h4>
                  {selectedAnalysis.contextMarkers.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {selectedAnalysis.contextMarkers.map((m, i) => {
                        const markerKey = `${selectedChapterId}:${i}`
                        const isDisabled = disabledMarkerKeys.has(markerKey)
                        return (
                        <div key={i} style={{
                          padding: '16px 18px', borderRadius: 12,
                          background: isDisabled ? 'rgba(156,163,175,0.04)' : 'rgba(245,158,11,0.04)',
                          border: isDisabled ? '1px solid rgba(156,163,175,0.15)' : '1px solid rgba(245,158,11,0.15)',
                          opacity: isDisabled ? 0.5 : 1,
                          transition: 'all 0.15s ease',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <span style={{
                              fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                              background: isDisabled ? 'rgba(156,163,175,0.12)' : 'rgba(245,158,11,0.15)',
                              color: isDisabled ? '#9ca3af' : '#d97706', flexShrink: 0,
                            }}>{m.sceneName}</span>
                            <span style={{ fontSize: 14, color: '#2d2520', lineHeight: 1.6, flex: 1 }}>{m.description}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setDisabledMarkerKeys(prev => {
                                  const next = new Set(prev)
                                  if (isDisabled) next.delete(markerKey)
                                  else next.add(markerKey)
                                  return next
                                })
                              }}
                              title={isDisabled ? '点击恢复改写' : '点击跳过改写'}
                              style={{
                                padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)',
                                cursor: 'pointer', background: isDisabled ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.06)',
                                color: isDisabled ? '#10b981' : '#dc2626',
                                fontSize: 12, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isDisabled ? '↩ 恢复改写' : '✕ 跳过改写'}
                            </button>
                          </div>
                          {(m.startText || m.endText) && (
                            <div style={{
                              fontSize: 14, color: '#6366f1', lineHeight: 1.8,
                              padding: '10px 14px', borderRadius: 8,
                              background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.1)',
                              fontFamily: '"Noto Serif SC", "Source Han Serif SC", SimSun, serif',
                            }}>
                              「{m.startText || '…'}……{m.endText || '…'}」
                            </div>
                          )}
                          {!m.startText && !m.endText && m.location && (
                            <div style={{ fontSize: 14, color: '#6b5e54', marginTop: 6 }}>大致位置：{m.location}</div>
                          )}
                        </div>
                      )})}
                    </div>
                  ) : <p style={{ fontSize: 13, color: '#2d2520', margin: 0 }}>（无上下文标记）</p>}
                </section>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <EmptyState icon="🔍" title="选择左侧章节" description="查看识别分类和上下文标记结果" />
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Stats */}
        <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>识别统计</div>
          </div>
          <div style={{ padding: '16px 14px', flex: 1 }}>
            {/* Pending / Preserve */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#6366f1' }}>{pendingRewrite}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>待改写章节</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{preserveOriginal}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>保留原文</div>
              </div>
            </div>

            {/* Category list */}
            {allCategories.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1', marginBottom: 8 }}>识别分类</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allCategories.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                      <span style={{ color: '#2d2520', fontWeight: 500 }}>{c.name}</span>
                      <span style={{ fontWeight: 700, color: '#6366f1' }}>{c.count}次</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom: continue to next stage */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
            <button
              onClick={() => handleStepClick(4)}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              继续 <ArrowRightIcon style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Stage 4: AI改写 ──
  const renderStageRewrite = () => {
    const chapters = project!.chapters
    const selectedRewrite = selectedChapterId ? rewrites.get(selectedChapterId) : null
    const rewriteCount = rewrites.size
    const failedCount = rewriteQueue.failed
    const wordCountFailures = Array.from(rewrites.values()).filter(r => !r.isPassing)
    // Total chapters needing rewrite (based on analysis)
    const needsRewriteTotal = chapters.filter(ch => {
      const analysis = analyses.get(ch.id)
      return !analysis || analysis.needsRewrite
    }).length

    // Determine what to show in center
    const showOriginalContent = showOriginal && selectedChapterId

    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Chapter list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>章节列表</div>
            <div style={{ fontSize: 14, color: '#3a3530', marginTop: 2 }}>
              {chapters.length} 章 · 需改写 {needsRewriteTotal}
              {!showNoRewriteChapters && chapters.length > needsRewriteTotal && (
                <span style={{ fontSize: 11, color: '#2d2520' }}>（{chapters.length - needsRewriteTotal}章无需改写已折叠）</span>
              )}
            </div>
          </div>
          {/* Toggle no-rewrite chapters */}
          {chapters.length > needsRewriteTotal && (
            <button
              onClick={() => setShowNoRewriteChapters(!showNoRewriteChapters)}
              style={{
                margin: '4px 14px 0', padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer',
                background: showNoRewriteChapters ? 'rgba(16,185,129,0.08)' : 'transparent',
                color: '#10b981', fontSize: 12, fontWeight: 600,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                width: 'calc(100% - 28px)',
              }}
            >
              {showNoRewriteChapters ? '📌 折叠无需改写章节' : `📌 展开无需改写章节 (${chapters.length - needsRewriteTotal}章)`}
            </button>
          )}
          <ScrollArea style={{ flex: 1 }}>
            {(() => {
              const visibleChapters = showNoRewriteChapters
                ? chapters
                : chapters.filter(ch => {
                    const analysis = analyses.get(ch.id)
                    return !analysis || analysis.needsRewrite
                  })
              if (visibleChapters.length === 0) {
                return (
                  <div style={{ padding: 20, textAlign: 'center' }}>
                    <EmptyState icon="📌" title="无需改写的章节" description="所有场景章节已折叠" />
                  </div>
                )
              }
              return visibleChapters.map(ch => {
                const rw = rewrites.get(ch.id)
                const hasRewrite = !!rw
                const isPassing = rw?.isPassing !== false
                const isActive = rewriting && activeRewritingIds.has(ch.id)
                const isFailed = failedRewritingIds.has(ch.id)
                const analysis = analyses.get(ch.id)
                const needsRewrite = !analysis || analysis.needsRewrite

                let dotColor: string
                let dotClass: string | undefined
                if (isActive) { dotColor = '#16a34a'; dotClass = 'breathe-dot' }
                else if (isFailed) { dotColor = '#dc2626' }
                else if (hasRewrite && isPassing) { dotColor = '#16a34a' }
                else if (hasRewrite && !isPassing) { dotColor = '#f59e0b' }
                else { dotColor = '#d1d5db' }

                return (
                  <button
                    key={ch.id}
                    onClick={() => handleSelectChapter(ch)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 14px', border: 'none', cursor: 'pointer',
                      background: selectedChapterId === ch.id ? 'rgba(236,72,153,0.08)' : 'transparent',
                      borderLeft: selectedChapterId === ch.id ? '3px solid #ec4899' : '3px solid transparent',
                      textAlign: 'left' as const, fontFamily: 'inherit',
                      fontSize: 14, color: selectedChapterId === ch.id ? '#ec4899' : '#4a3f38',
                      fontWeight: selectedChapterId === ch.id ? 600 : 500,
                      transition: 'all 0.12s ease',
                    }}
                    onMouseEnter={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'rgba(236,72,153,0.03)' }}
                    onMouseLeave={e => { if (selectedChapterId !== ch.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span className={dotClass} style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: dotClass ? 'transparent' : dotColor,
                      color: dotColor, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
    {ch.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#2d2520', marginTop: 1, display: 'flex', gap: 6 }}>
                        <span>{formatWordCount(ch.wordCount)}字</span>
                        {(() => {
                          const rewriteAttempted = attemptedRewriteIds.has(ch.id)
                          if (hasRewrite && !isPassing) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>字数不达标</span>
                          if (rewriteAttempted && !hasRewrite) return <span style={{ color: '#dc2626', fontWeight: 600 }}>改写失败</span>
                          if (needsRewrite) return <span style={{ color: '#ec4899', fontWeight: 600 }}>需改写</span>
                          return null
                        })()}
                      </div>
                    </div>
                    {hasRewrite && !isPassing && (
                      <ExclamationTriangleIcon style={{ width: 12, height: 12, color: '#f59e0b', flexShrink: 0 }} />
                    )}
                  </button>
                )
              })
            })()}
          </ScrollArea>
        </div>

        {/* Center: Rewritten content + action bar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Action bar */}
          <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
              {selectedChapterId ? chapters.find(c => c.id === selectedChapterId)?.title || '' : '选择左侧章节'}
            </span>
            {selectedChapterId && (() => {
              const ch = chapters.find(c => c.id === selectedChapterId)
              // Precision anchor indicator
              const analysis = analyses.get(ch?.id || '')
              const precisionMarkers = analysis?.contextMarkers?.filter(m => m.startText && m.endText) || []
              const enabledMarkers = precisionMarkers.filter((_, i) => !disabledMarkerKeys.has(`${selectedChapterId}:${i}`))
              if (precisionMarkers.length > 0) {
                return (
                  <span style={{
                    fontSize: 12, padding: '2px 8px', borderRadius: 4,
                    background: enabledMarkers.length > 0 ? 'rgba(99,102,241,0.1)' : 'rgba(156,163,175,0.1)',
                    color: enabledMarkers.length > 0 ? '#6366f1' : '#9ca3af',
                    fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    🎯 精密改写 {enabledMarkers.length}/{precisionMarkers.length} 场景
                  </span>
                )
              }
              return null
            })()}
            {selectedChapterId && (() => {
              const ch = chapters.find(c => c.id === selectedChapterId)
              const originalWc = ch?.wordCount || 0
              if (showOriginal) {
                return <span style={{ fontSize: 13, color: '#2d2520' }}>· 原文 ({formatWordCount(originalWc)}字)</span>
              }
              if (selectedRewrite) {
                const addedWc = selectedRewrite.wordCount - originalWc
                const sign = addedWc >= 0 ? '+' : ''
                const diffColor = addedWc >= 0 ? '#16a34a' : '#dc2626'
                return (
                  <span style={{ fontSize: 13, color: '#2d2520', display: 'flex', gap: 14 }}>
                    <span>原文: {formatWordCount(originalWc)}字</span>
                    <span style={{ color: diffColor, fontWeight: 600 }}>
                      改写加料: {sign}{formatWordCount(Math.abs(addedWc))}字
                    </span>
                    <span style={{ fontWeight: 600, color: '#2d2520' }}>
                      总字数: {formatWordCount(selectedRewrite.wordCount)}字
                    </span>
                  </span>
                )
              }
              return <span style={{ fontSize: 13, color: '#2d2520' }}>· 未改写</span>
            })()}

            {/* Action buttons - right aligned */}
            {selectedChapterId && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {selectedRewrite && (
                  <button onClick={() => setEditorReadOnly(!editorReadOnly)} style={{
                    padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)',
                    cursor: 'pointer', background: editorReadOnly ? '#fff' : 'rgba(236,72,153,0.08)',
                    color: editorReadOnly ? '#6b5e54' : '#ec4899',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.12s ease',
                  }}>
                    <PencilIcon style={{ width: 13, height: 13 }} />
                    {editorReadOnly ? '编辑' : '只读'}
                  </button>
                )}
                <button onClick={() => setShowOriginal(!showOriginal)} style={{
                  padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)',
                  cursor: 'pointer', background: '#fff', color: '#3a3530',
                  fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'all 0.12s ease',
                }}>
                  <EyeIcon style={{ width: 13, height: 13 }} />
                  {showOriginal ? '返回改写内容' : '查看原文'}
                </button>

                {selectedRewrite && (
                  <button onClick={() => {
                    const ch = chapters.find(c => c.id === selectedChapterId)
                    if (ch) handleOpenCompare(ch)
                  }} style={{
                    padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)',
                    cursor: 'pointer', background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.12s ease',
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="9" height="18" rx="2" />
                      <rect x="13" y="3" width="9" height="18" rx="2" />
                    </svg>
                    查看对比
                  </button>
                )}

                <button onClick={() => {
                  const ch = chapters.find(c => c.id === selectedChapterId)
                  if (ch) handleRewriteChapter(ch)
                }} disabled={rewriting} style={{
                  padding: '5px 12px', borderRadius: 6, border: 'none',
                  cursor: rewriting ? 'not-allowed' : 'pointer',
                  background: 'linear-gradient(135deg, #ec4899, #f472b6)',
                  color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: rewriting ? 0.5 : 1, transition: 'all 0.12s ease',
                }}>
                  <ArrowPathIcon style={{ width: 13, height: 13 }} />
                  {rewriting ? '改写中...' : '重新改写'}
                </button>
              </div>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {rewriting && rewriteStreaming ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#ec4899', marginBottom: 8 }}>{rewriteStreaming}</div>
                  <div className="breathe-dot" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', color: '#ec4899' }} />
                </div>
              </div>
            ) : showOriginalContent ? (
              <ScrollArea style={{ flex: 1, padding: '20px 24px', background: '#fff' }}>
                <div style={{ fontSize: 17, lineHeight: 2.0, color: '#1a1410', whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' }}>
                  {chapterContent || '（空）'}
                </div>
              </ScrollArea>
            ) : selectedRewrite ? (
              <RewriteEditor
                content={selectedRewrite.content}
                onContentChange={handleEditorChange}
                configId={effectiveConfigId}
                projectId={projectId}
                readOnly={editorReadOnly}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <EmptyState icon="✨" title={selectedChapterId ? '该章节尚未改写' : '选择左侧章节'} description="点击「重新改写」开始AI改写" />
              </div>
            )}
          </div>
        </div>

        {/* Right: Stats & controls */}
        <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>改写统计</div>
          </div>
          <div style={{ padding: '16px 14px', flex: 1 }}>
            {/* Failed / Word-count substandard */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{failedCount}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>改写失败</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{wordCountFailures.length}</div>
                <div style={{ fontSize: 12, color: '#2d2520' }}>字数不达标</div>
              </div>
            </div>

            {/* Progress — removed, now in bottom bar */}

            {/* Word count failing chapters detail */}
            {wordCountFailures.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#2d2520', marginBottom: 4 }}>
                  字数不达标章节：
                </div>
                {wordCountFailures.map(r => {
                  const ch = chapters.find(c => c.id === r.chapterId)
                  return ch ? (
                    <div key={r.chapterId} style={{ fontSize: 10, color: '#3a3530', display: 'flex', justifyContent: 'space-between' }}>
                      <span>第{ch.chapterNumber}章</span>
                      <span style={{ color: '#f59e0b' }}>{formatWordCount(r.wordCount)}/{formatWordCount(r.targetWordCount)}</span>
                    </div>
                  ) : null
                })}
              </div>
            )}

            {/* Retry word-count failures */}
            {wordCountFailures.length > 0 && (
              <button onClick={handleRetryWordCountFailures} disabled={rewriting} style={{
                width: '100%', padding: '8px 0', borderRadius: 8,
                border: '1px solid #f59e0b', cursor: rewriting ? 'not-allowed' : 'pointer',
                background: 'rgba(245,158,11,0.06)', color: '#d97706',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                opacity: rewriting ? 0.5 : 1, transition: 'all 0.15s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
                onMouseEnter={e => { if (!rewriting) e.currentTarget.style.background = 'rgba(245,158,11,0.12)' }}
                onMouseLeave={e => { if (!rewriting) e.currentTarget.style.background = 'rgba(245,158,11,0.06)' }}
              >
                <ArrowPathIcon style={{ width: 13, height: 13 }} /> 重试字数不达标章节 ({wordCountFailures.length})
              </button>
            )}

            {/* Retry failed rewrites — only attempted-but-no-rewrite chapters */}
            {(() => {
              const failedRewriteCount = chapters.filter(ch => attemptedRewriteIds.has(ch.id) && !rewrites.has(ch.id)).length
              const canRetry = failedRewriteCount > 0 && !rewriting
              return (
                <button onClick={handleRewriteAll} disabled={!canRetry} style={{
                  width: '100%', padding: '8px 0', borderRadius: 8, marginTop: 6,
                  border: '1px solid #dc2626', cursor: canRetry ? 'pointer' : 'default',
                  background: 'rgba(220,38,38,0.06)', color: '#dc2626',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  opacity: canRetry ? 1 : 0.4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  transition: 'all 0.15s ease',
                }}
                  onMouseEnter={e => { if (canRetry) e.currentTarget.style.background = 'rgba(220,38,38,0.12)' }}
                  onMouseLeave={e => { if (canRetry) e.currentTarget.style.background = 'rgba(220,38,38,0.06)' }}
                >
                  <ArrowPathIcon style={{ width: 13, height: 13 }} />
                  {failedRewriteCount > 0 ? `重新改写失败章节 (${failedRewriteCount})` : '无需重新改写'}
                </button>
              )
            })()}
          </div>

          {/* Batch rewrite all chapters */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Progress bar — always visible */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38', textAlign: 'center' }}>
              {rewriting
                ? `${rewriteQueue.done}/${needsRewriteTotal} 章（需改写）`
                : `${rewriteCount}/${needsRewriteTotal} 章（需改写）`}
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#e5e0da', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: 'linear-gradient(90deg, #ec4899, #f472b6, #ec4899)',
                backgroundSize: '200% 100%',
                animation: rewriting && !rewritePaused ? 'gradientShift 1.5s linear infinite' : 'none',
                width: needsRewriteTotal > 0
                  ? `${((rewriting ? rewriteQueue.done : rewriteCount) / needsRewriteTotal) * 100}%`
                  : '0%',
                transition: 'width 0.3s ease',
              }} />
            </div>

            {/* Pause — only during active rewrite */}
            {rewriting && (
              <button onClick={handleToggleRewritePause} style={{
                width: '100%', padding: '6px 0', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer',
                background: rewritePaused ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                color: rewritePaused ? '#10b981' : '#d97706',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                {rewritePaused ? '▶ 继续改写' : '⏸ 暂停'}
              </button>
            )}

            <button onClick={handleRewriteAll} disabled={rewriting || chapters.length === 0} style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              cursor: rewriting || chapters.length === 0 ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg, #ec4899, #f472b6)',
              color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              opacity: rewriting || chapters.length === 0 ? 0.5 : 1, transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <SparklesIcon style={{ width: 15, height: 15 }} />
              {rewriting ? '改写中...' : `全部改写 (${needsRewriteTotal}章)`}
            </button>
          </div>
        </div>

        {/* Compare Modal */}
        <RewriteCompareModal
          isOpen={compareChapter !== null}
          onClose={() => { setCompareChapter(null); setCompareMeta(null) }}
          originalContent={compareOriginal}
          rewrittenContent={compareRewritten}
          chapterTitle={compareChapter ? compareChapter.title : ''}
          originalWordCount={compareOriginalWc}
          rewrittenWordCount={compareRewrittenWc}
          rewriteMeta={compareMeta}
        />
      </div>
    )
  }

  // ── Stage 5: 合并输出 ──
  const renderStageMerge = () => {
    const chapters = project!.chapters
    const rewriteCount = rewrites.size
    const wordCountFailures = Array.from(rewrites.values()).filter(r => !r.isPassing)

    const handleMerge = async () => {
      if (!project) return
      const savePath = await dialogService.saveFile(`${project.name}_改写版.txt`)
      if (!savePath) return
      try {
        const updated = await rewriteService.mergeRewrites(projectId, savePath)
        setProject(updated)
      } catch (e: any) {
        setError('合并失败：' + (e.message || '未知错误'))
      }
    }

    // Preview: all chapters, strip duplicate headings from content
    const previewLines: string[] = []
    for (const ch of chapters) {
      const rw = rewrites.get(ch.id)
      const titleSuffix = rw ? '（已改写）' : ''
      previewLines.push(`\n第${ch.chapterNumber}章 ${ch.title}${titleSuffix}\n`)
      let content = rw?.content || '（未改写）'
      // Strip leading chapter heading from content (e.g. "# 第一章 xxx" or "第一章 xxx")
      content = content.replace(/^[#\s]*第[一二三四五六七八九十百千零\d]+[章节回卷集部篇].*?\n+/, '')
      previewLines.push(content)
      previewLines.push('')
    }

    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Chapter checklist */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>章节列表</div>
            <div style={{ fontSize: 12, color: '#3a3530', marginTop: 2 }}>{chapters.length} 章 · 已改写 {rewriteCount}</div>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            {chapters.map(ch => {
              const rw = rewrites.get(ch.id)
              const hasRewrite = !!rw
              const isPassing = rw?.isPassing !== false
              return (
                <button
                  key={ch.id}
                  onClick={() => setMergeSelectedChapterId(mergeSelectedChapterId === ch.id ? null : ch.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 14px', border: 'none', cursor: 'pointer',
                    background: mergeSelectedChapterId === ch.id ? 'rgba(16,185,129,0.08)' : 'transparent',
                    borderLeft: mergeSelectedChapterId === ch.id ? '3px solid #10b981' : '3px solid transparent',
                    textAlign: 'left' as const, fontFamily: 'inherit',
                    fontSize: 14, color: mergeSelectedChapterId === ch.id ? '#059669' : '#4a3f38',
                    fontWeight: mergeSelectedChapterId === ch.id ? 600 : 500,
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={e => { if (mergeSelectedChapterId !== ch.id) e.currentTarget.style.background = 'rgba(16,185,129,0.03)' }}
                  onMouseLeave={e => { if (mergeSelectedChapterId !== ch.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ flexShrink: 0, fontSize: 12 }}>
                    {hasRewrite ? (isPassing ? '✅' : '⚠️') : '⭕'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
  {ch.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#2d2520', marginTop: 1 }}>
                      {hasRewrite ? `${formatWordCount(rw!.wordCount)}字` : `${formatWordCount(ch.wordCount)}字`}
                    </div>
                  </div>
                </button>
              )
            })}
          </ScrollArea>
        </div>

        {/* Center: Merge preview / Chapter content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 12 }}>
            {(() => {
              const selCh = mergeSelectedChapterId ? chapters.find(c => c.id === mergeSelectedChapterId) : null
              const selRw = selCh ? rewrites.get(selCh.id) : null
              return (
                <>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
                    {selCh ? selCh.title : '合并预览'}
                  </span>
                  <span style={{ fontSize: 11, color: '#2d2520' }}>
                    {selCh
                      ? (selRw ? `${formatWordCount(selRw.wordCount)}字（已改写）` : `${formatWordCount(selCh.wordCount)}字（原文）`)
                      : `${previewLines.join('').length} 字`}
                  </span>
                  {selCh && (
                    <button
                      onClick={() => setMergeSelectedChapterId(null)}
                      style={{
                        marginLeft: 'auto', padding: '3px 10px', borderRadius: 6,
                        border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer',
                        background: '#fff', color: '#6b5e54', fontSize: 12, fontWeight: 600,
                        fontFamily: 'inherit',
                      }}
                    >
                      ← 返回合并预览
                    </button>
                  )}
                </>
              )
            })()}
          </div>
          <ScrollArea style={{ flex: 1, padding: '20px 24px', background: '#fff' }}>
            {(() => {
              const selCh = mergeSelectedChapterId ? chapters.find(c => c.id === mergeSelectedChapterId) : null
              if (selCh) {
                // Show single chapter content
                const rw = rewrites.get(selCh.id)
                let content = rw?.content || '（未改写）'
                content = content.replace(/^[#\s]*第[一二三四五六七八九十百千零\d]+[章节回卷集部篇].*?\n+/, '')
                return (
                  <div style={{ fontSize: 17, lineHeight: 2.0, color: '#1a1410', whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' }}>
                    {`\n${selCh.title}\n\n${content}`}
                  </div>
                )
              }
              // Show full merge preview
              return rewriteCount > 0 ? (
                <div style={{ fontSize: 17, lineHeight: 2.0, color: '#1a1410', whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' }}>
                  {previewLines.join('\n')}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <EmptyState icon="📦" title="暂无改写内容" description="请先完成 Stage 4 AI改写" />
                </div>
              )
            })()}
          </ScrollArea>
        </div>

        {/* Right: Export stats */}
        {(() => {
          const totalOriginalWc = chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
          // Export word count: rewritten chapters use new count, unrewritten use original
          const totalExportWc = chapters.reduce((sum, ch) => {
            const rw = rewrites.get(ch.id)
            return sum + (rw ? rw.wordCount : ch.wordCount)
          }, 0)
          const addedWc = totalExportWc - totalOriginalWc
          const preserveCount = chapters.length - rewrites.size

          return (
            <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', textTransform: 'uppercase', letterSpacing: 1 }}>导出统计</div>
              </div>
              <div style={{ padding: '16px 14px', flex: 1 }}>
                {/* Word count comparison bar */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>
                    新增改写 +{formatWordCount(Math.max(0, addedWc))}字
                  </div>
                  <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                    {addedWc > 0 && (
                      <div style={{
                        flex: addedWc || 1, background: '#10b981',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 44,
                      }}>新增</div>
                    )}
                    <div style={{
                      flex: totalOriginalWc || 1, background: '#3b82f6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 44,
                    }}>原文</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: '#2d2520' }}>
                    <span>原书 {formatWordCount(totalOriginalWc)}字</span>
                    <span>导出 {formatWordCount(totalExportWc)}字</span>
                  </div>
                </div>

                {/* Chapter count comparison bar */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{
                      flex: rewrites.size || 1, background: '#10b981',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 36,
                    }}>改写</div>
                    {preserveCount > 0 && (
                      <div style={{
                        flex: preserveCount || 1, background: '#3b82f6',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 36,
                      }}>原文</div>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>
                    改写 {rewrites.size}章 · 原文 {preserveCount}章
                  </div>
                </div>

                {/* Project name */}
                <div style={{ fontSize: 12, color: '#2d2520', marginBottom: 4 }}>项目名称</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 16, wordBreak: 'break-all' }}>
                  {project?.name || '—'}
                </div>

                {/* Word count warning */}
                {wordCountFailures.length > 0 && (
                  <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, lineHeight: 1.4, fontWeight: 600 }}>
                    ⚠️ {wordCountFailures.length} 章字数不达标
                  </div>
                )}
              </div>
              <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={handleMerge} disabled={rewriteCount === 0} style={{
                  width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
                  cursor: rewriteCount === 0 ? 'not-allowed' : 'pointer',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  opacity: rewriteCount === 0 ? 0.5 : 1, transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <ArrowDownTrayIcon style={{ width: 15, height: 15 }} /> 导出合并
                </button>
                <button onClick={async () => {
                  try {
                    const pp = await rewriteService.getProjectPath(projectId)
                    await (window as any).electron.app.openFolder(pp)
                  } catch { /* ignore */ }
                }} style={{
                  width: '100%', padding: '8px 0', borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer',
                  background: '#fff', color: '#3a3530',
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  📂 打开文件夹
                </button>
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════
  // Loading / Error states
  // ═══════════════════════════════════════════════════════
  if (!project && !error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState icon="📖" title="加载中..." />
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════
  // Main Render
  // ═══════════════════════════════════════════════════════
  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top Bar ── */}
      <div style={{
        height: 56, flexShrink: 0, borderBottom: '1px solid rgba(0,0,0,0.06)',
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.5)',
        padding: '0 16px',
      }}>
        {/* Back button */}
        <button
          onClick={handleBack}
          title="返回小说改写项目列表"
          style={{
            width: 56, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 4, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#3a3530', fontSize: 14, fontWeight: 600,
            fontFamily: 'inherit', flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.08)'; e.currentTarget.style.color = '#7c3aed' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b5e54' }}
        >
          <ArrowLeftIcon style={{ width: 18, height: 18 }} />
          <span>返回</span>
        </button>

        <div style={{ width: 24, flexShrink: 0 }} />

        {/* Project name */}
        <div style={{ width: 200, flexShrink: 0, paddingRight: 12, borderRight: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project?.name || '—'}
          </div>
          <div style={{ fontSize: 12, color: '#2d2520', marginTop: 1 }}>
            {project ? `${project.chapterCount}章 · ${formatWordCount(project.wordCount)}字` : ''}
          </div>
        </div>

        {/* Template selector */}
        <div style={{ flexShrink: 0, padding: '0 12px', borderRight: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, color: '#3a3530', whiteSpace: 'nowrap' }}>提示词模板</span>
          <select
            value={activeTemplate?.id || ''}
            onChange={e => handleTemplateChange(e.target.value)}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)',
              fontSize: 13, color: '#1a1410', background: '#fff',
              fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
              maxWidth: 160,
            }}
          >
            <option value="">（不使用模板）</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Stage circles — centered */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 28 }}>
          {STAGE_STEPS.map(step => {
            const complete = stepComplete(step.num)
            const isCurrent = activeStep === step.num
            return (
              <button
                key={step.key}
                onClick={() => handleStepClick(step.num)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '4px 8px', borderRadius: 12,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.04)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: complete ? '#7c3aed' : isCurrent ? 'rgba(124,58,237,0.15)' : '#e5e0da',
                  color: complete ? '#fff' : isCurrent ? '#7c3aed' : '#9b8e84',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                  border: isCurrent && !complete ? '2px solid #7c3aed' : '2px solid transparent',
                  transition: 'all 0.3s ease',
                }}>
                  {step.num}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent ? '#7c3aed' : complete ? '#6b5e54' : '#9b8e84',
                }}>
                  {step.label}
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ width: 80, flexShrink: 0 }} />
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '8px 16px', background: 'rgba(220,38,38,0.06)', borderBottom: '1px solid rgba(220,38,38,0.12)',
          fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 14, padding: '0 4px' }}>✕</button>
        </div>
      )}

      {/* ── Stage Content ── */}
      {renderStageContent()}
    </div>
  )
}
