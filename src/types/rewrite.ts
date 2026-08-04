export interface RewriteChapter {
  id: string
  chapterNumber: number
  title: string
  fileName: string
  wordCount: number
}

export type RewriteStage = 'imported' | 'split' | 'summarized' | 'identified' | 'rewritten' | 'merged'

export const STAGE_NAMES: Record<RewriteStage, string> = {
  imported: '已导入',
  split: '已拆分',
  summarized: '已总结',
  identified: '已识别',
  rewritten: '已改写',
  merged: '已合并',
}

// v13.3: 5-stage pipeline
export const STAGE_STEPS = [
  { key: 'splitting' as const, num: 1, label: '书籍拆分' },
  { key: 'summarizing' as const, num: 2, label: '内容总结' },
  { key: 'identifying' as const, num: 3, label: '识别待处理' },
  { key: 'rewriting' as const, num: 4, label: 'AI改写' },
  { key: 'merging' as const, num: 5, label: '合并输出' },
]

/** Stage step key (action) → RewriteStage (completed state) mapping */
export type StageStepKey = typeof STAGE_STEPS[number]['key']

export const STEP_KEY_TO_STAGE: Record<StageStepKey, RewriteStage> = {
  splitting: 'split',
  summarizing: 'summarized',
  identifying: 'identified',
  rewriting: 'rewritten',
  merging: 'merged',
}

/** Ordered RewriteStage values (progressive milestones) */
export const STAGE_ORDER: RewriteStage[] = ['imported', 'split', 'summarized', 'identified', 'rewritten', 'merged']

/** v15.1: 项目级总结信息要求 — 新建向导「总结信息」步骤与项目设置中可修改，
 *  缺省使用 DEFAULT_SUMMARY_CONFIG，不影响历史项目 */
export interface RewriteSummaryConfig {
  plotSummary?: string    // 情节概要要求文本
  characters?: string     // 角色信息要求文本
  keyEvents?: string      // 关键事件要求文本
}

/** v15.1: 总结信息默认要求（新建向导预填 / 项目设置显示，可被项目级配置覆盖） */
export const DEFAULT_SUMMARY_CONFIG: Required<RewriteSummaryConfig> = {
  plotSummary: '情节概要，100-200字',
  characters: '每个出场角色一条，包含姓名、外貌/性格/能力等特征、主角/配角/龙套角色定位、在本章中的角色表现',
  keyEvents: '本章重要情节节点，每条一句话描述，3-6条',
}

export interface RewriteProject {
  id: string
  name: string
  sourceFileName: string
  stage: RewriteStage
  chapters: RewriteChapter[]
  chapterCount: number
  wordCount: number
  templateId?: string          // 关联的提示词模板 ID
  modelConfigId?: string       // 关联的模型配置 ID
  concurrentThreads?: number   // 并发线程数 (1-10)
  rewriteWordTarget?: number   // 每章改写目标加料字数
  summaryConfig?: RewriteSummaryConfig  // v15.1: 项目级总结信息要求
  createdAt: string
  updatedAt: string
}

// ── Stage 2+3: 章节分析（同一分析模板，不同视图） ──

export interface CharacterInfo {
  name: string
  traits: string
  role: string
  description?: string
}

export interface SceneCategory {
  name: string        // 场景名称，如"战斗""对话""内心独白"
  count: number       // 该场景在本章的出现次数
}

export interface ContextMarker {
  sceneName: string    // 关联的场景类型（对应 categories 中的 name，如"恋爱场景""战斗场景"）
  description: string  // 该场景段落的一句话剧情描述
  location?: string    // 在原文中的大致位置（v13.4.2+ 由 startText/endText 替代）
  startText?: string   // 该场景段落的开头15个字（从原文原样复制），用于定位改写起止点
  endText?: string     // 该场景段落的末尾15个字（从原文原样复制），用于定位改写起止点
}

/** 章节分析结果 — 一次 AI 调用产出，Stage 2 和 Stage 3 各显示不同字段 */
export interface ChapterAnalysis {
  chapterId: string
  // Stage 2 显示字段
  plotSummary: string           // 情节概要 100-200字
  characters: CharacterInfo[]   // 角色信息
  keyEvents: string[]           // 关键事件（多条，每条一句话）
  // Stage 3 显示字段
  categories: SceneCategory[]   // 识别分类
  contextMarkers: ContextMarker[] // 上下文标记
  // 元信息
  needsRewrite: boolean         // 是否需要改写
  analyzedAt: string
}

// ── Stage 4: 改写结果 ──

export interface ChapterRewrite {
  chapterId: string
  content: string
  wordCount: number
  targetWordCount: number
  isPassing: boolean            // 字数是否达标（≥原文章节字数的80%）
  rewrittenAt: string
}
