/**
 * 风格模板全链路测试 — 分析原文 + 生成模板 + AI仿写
 *
 * 用法:
 *   cd d:/3/novel-writing-app
 *   npx tsx scripts/analyze-and-imitate.ts [原文文件路径]
 *
 * 环境变量:
 *   TEST_RUN      - 测试轮次编号 (默认 '1'，所有输出文件以此编号为前缀)
 *   AI_API_KEY    - DeepSeek API key (默认内置)
 *   AI_MODEL      - 模型 (默认 deepseek-v4-flash)
 *   AI_PROTOCOL   - 协议: anthropic(默认) | openai
 *   AI_TEMPERATURE - temperature (默认 1.0)
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildStyleAnalyzePrompt, parseStyleAnalysisReply, buildSummarizePrompt, buildFewShotExcerpts } from '../src/services/extractionService/styleAnalysis'
import { buildStylePrompt } from '../src/utils/styleInjector'
import { classifyDimTiers } from '../src/utils/dimTiers'
import { DIMENSION_META, NOVEL_TYPE_DIMS } from '../src/types/story/storyTypes'
import type { StyleProfile, DimAnalysis, ChapterAnalysis, CategorizedVocab } from '../src/types/story/style'
import { DIM_PRIORITY } from '../src/utils/dimTiers'
import { chat } from './lib/chat'

// ── Config ──
const TEST_RUN = process.env.TEST_RUN || '1'
const ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL || 'deepseek-v4-flash'
const NOVEL_TYPE_LONG = '情色小说'
const NOVEL_TYPE_SHORT = '情色'
const OUT_DIR = 'd:/3/风格蒸馏演示'

// 输出文件命名: {轮次编号}{文件名}
const N = (name: string) => path.join(OUT_DIR, `${TEST_RUN}${name}`)

function splitChapters(content: string): { title: string; content: string }[] {
  // v13.3.0: 与 src/utils/textUtils.ts CHAPTER_PATTERNS 保持同步
  const re = /^(第\s*[一二三四五六七八九十百千\d]+\s*[章卷节回集]|序章|楔子|尾声|番外|引子|前言|终章|后记).*$/gm
  const matches = Array.from(content.matchAll(re))
  if (!matches.length) return [{ title: '全文', content }]
  const out: { title: string; content: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const s = matches[i].index!
    const e = i + 1 < matches.length ? matches[i + 1].index! : content.length
    const body = content.slice(s, e).trim()
    if (body.length < 10) continue
    out.push({ title: matches[i][0].trim(), content: body })
  }
  return out
}

// ── Main ──
async function main() {
  const inputPath = process.argv[2] || N('sample-input.txt')
  if (!fs.existsSync(inputPath)) { console.error('原文文件不存在:', inputPath); process.exit(1) }
  const sampleText = fs.readFileSync(inputPath, 'utf-8')
  const chapters = splitChapters(sampleText)
  const dims = NOVEL_TYPE_DIMS[NOVEL_TYPE_SHORT] || NOVEL_TYPE_DIMS['普通小说']
  const { mustAnalyze } = classifyDimTiers(dims, NOVEL_TYPE_LONG)

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log('═══════════════════════════════════════════')
  console.log(` 风格模板测试`)
  console.log(` 原文: ${path.basename(inputPath)} | 章节: ${chapters.length} | 维度: ${dims.length}`)
  console.log(` 协议: ${process.env.AI_PROTOCOL || 'anthropic'} | 模型: ${ANALYSIS_MODEL} | 温度: ${process.env.AI_TEMPERATURE || '1.0'}`)
  console.log('═══════════════════════════════════════════')

  // ── Stage 1: 逐章分析 ──
  console.log('\n[Stage 1] 逐章AI分析...')
  const chapterAnalyses: { title: string; analysis: ChapterAnalysis }[] = []
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const prompt = buildStyleAnalyzePrompt(dims, NOVEL_TYPE_LONG)
    const msg = `${prompt}

[${ch.title}]
${ch.content.slice(0, 8000)}`
    const reply = await chat([{ role: 'user', content: msg }], { maxTokens: 8192 })
    fs.writeFileSync(path.join(OUT_DIR, 'debug-raw-reply.txt'), reply, 'utf-8')
    const analysis = parseStyleAnalysisReply(reply, dims)
    const dCount = analysis.dimAnalyses ? Object.keys(analysis.dimAnalyses).length : 0
    const eCount = analysis.dimAnalyses
      ? Object.values(analysis.dimAnalyses).reduce((s, d: any) => s + (d.examples?.length || 0), 0)
      : 0
    console.log(`  [${i + 1}/${chapters.length}] ${ch.title}: ${dCount}维度 ${eCount}例句`)
    chapterAnalyses.push({ title: ch.title, analysis })
  }

// ── Stage 2: 汇总 ──
  console.log('\n[Stage 2] 全局汇总...')
  const aggregated: Record<string, DimAnalysis> = {}
  for (const { analysis } of chapterAnalyses) {
    if (!analysis.dimAnalyses) continue
    for (const [dk, da] of Object.entries(analysis.dimAnalyses)) {
      if (!aggregated[dk]) { aggregated[dk] = { ...da }; continue }
      aggregated[dk] = {
        description: aggregated[dk].description || da.description,
        examples: Array.from(new Set([...(aggregated[dk].examples || []), ...(da.examples || [])])).slice(0, 30),
        writingRules: Array.from(new Set([...(aggregated[dk].writingRules || []), ...(da.writingRules || [])])),
        vocabularyList: Array.from(new Set([...(aggregated[dk].vocabularyList || []), ...(da.vocabularyList || [])])).slice(0, 80),
      }
    }
  }

  // Aggregate categorizedVocab across chapters
  const aggregatedCategorizedVocab: CategorizedVocab = {
    sexBody: [], roleIdentity: [], actionTechnique: [], sceneCostume: [], moanOnomatopoeia: []
  }
  for (const { analysis } of chapterAnalyses) {
    const cv = analysis.categorizedVocab
    if (!cv) continue
    for (const cat of Object.keys(aggregatedCategorizedVocab) as (keyof CategorizedVocab)[]) {
      if (Array.isArray(cv[cat])) {
        aggregatedCategorizedVocab[cat].push(...cv[cat])
      }
    }
  }
  // Deduplicate each category
  for (const cat of Object.keys(aggregatedCategorizedVocab) as (keyof CategorizedVocab)[]) {
    aggregatedCategorizedVocab[cat] = [...new Set(aggregatedCategorizedVocab[cat])].slice(0, 10)
  }

  const dimSummary = chapterAnalyses.map(({ title, analysis }) => {
    if (!analysis.dimAnalyses) return ''
    return `[${title}]\n` + Object.entries(analysis.dimAnalyses)
      .map(([dk, da]) => `  ${dk}(${DIMENSION_META[dk]?.label || dk}): ${da.description?.slice(0, 150) || ''}`)
      .join('\n')
  }).filter(Boolean).join('\n\n')

  const summaryReply = await chat([{ role: 'user', content: buildSummarizePrompt(chapters.length, dimSummary, NOVEL_TYPE_LONG) }], { maxTokens: 4096, model: ANALYSIS_MODEL })
  const summaryAnalysis = parseStyleAnalysisReply(summaryReply, dims)
  if (summaryAnalysis.dimAnalyses) {
    for (const [dk, da] of Object.entries(summaryAnalysis.dimAnalyses)) {
      if (!aggregated[dk]) aggregated[dk] = da as DimAnalysis
      else aggregated[dk] = { ...aggregated[dk], description: (da as DimAnalysis).description || aggregated[dk].description }
    }
  }

  const excerpts = buildFewShotExcerpts(
    chapters.map((c, i) => ({ title: c.title, content: c.content, chapterNumber: i + 1 })), 5, 2, 250,
  )

  const fullDesc = Object.entries(summaryAnalysis.dimAnalyses || aggregated)
    .map(([k, d]) => `${DIMENSION_META[k]?.label || k}: ${(d as DimAnalysis).description?.slice(0, 80)}`).join('; ')

  const profile: StyleProfile = {
    features: {
      sentenceStyle: aggregated['sentenceStyle']?.description || '',
      vocabularyStyle: aggregated['vocabularyStyle']?.description || '',
      rhetoricStyle: aggregated['rhetoricStyle']?.description || '',
      rhythmStyle: aggregated['rhythmStyle']?.description || '',
      dialogueStyle: aggregated['dialogueStyle']?.description || '',
      moodStyle: aggregated['moodStyle']?.description || '',
      perspectiveStyle: aggregated['perspectiveStyle']?.description || '',
      bodyLanguageStyle: aggregated['bodyLanguageStyle']?.description || '',
      sensoryStyle: aggregated['sensoryStyle']?.description || '',
      tensionStyle: aggregated['tensionStyle']?.description || '',
      subtextStyle: aggregated['subtextStyle']?.description || '',
      descriptionPattern: null, corruptionArc: null, degradationRitual: null,
      narrativeVoice: null, sceneMechanics: null, somaticTension: null,
      identityDissolution: null, shameVoyeurLoop: null,
    },
    fullDescription: fullDesc,
    excerpts: excerpts.map(t => ({ text: t, note: '' })),
    analyzedAt: new Date().toISOString(),
    analyzedChapterCount: chapters.length,
    dimAnalyses: Object.keys(aggregated).length > 0 ? aggregated : undefined,
    categorizedVocab: Object.values(aggregatedCategorizedVocab).some(a => a.length > 0) ? aggregatedCategorizedVocab : undefined,
  }

  // Sort aggregated dims by priority tier
  const priority = DIM_PRIORITY[NOVEL_TYPE_LONG] || {}
  const sortedAggregated = Object.fromEntries(
    Object.entries(aggregated).sort(([a], [b]) => (priority[a]?.tier ?? 99) - (priority[b]?.tier ?? 99))
  )
  // Also sort profile.dimAnalyses if present
  let sortedProfileDims: Record<string, DimAnalysis> | undefined
  if (profile.dimAnalyses) {
    sortedProfileDims = Object.fromEntries(
      Object.entries(profile.dimAnalyses).sort(([a], [b]) => (priority[a]?.tier ?? 99) - (priority[b]?.tier ?? 99))
    )
  }

  const dCount = Object.keys(sortedAggregated).length
  const eCount = Object.values(sortedAggregated).reduce((s, d) => s + (d.examples?.length || 0), 0)
  console.log(`  汇总: ${dCount}维度 ${eCount}例句 ${excerpts.length}摘录`)

  // Build sorted profile
  const sortedProfile = { ...profile, dimAnalyses: sortedProfileDims }

  // Save profile
  fs.writeFileSync(N('测试-StyleProfile.json'), JSON.stringify({ profile: sortedProfile, aggregated: sortedAggregated, excerpts }, null, 2), 'utf-8')

  // ── Stage 3: 生成风格注入 Prompt ──
  console.log('\n[Stage 3] 生成风格注入 Prompt...')
  const stylePrompt = buildStylePrompt({ profile })
  const blockCount = (stylePrompt.match(/【/g) || []).length
  console.log(`  长度: ${stylePrompt.length} chars, ${blockCount} 约束块`)
  fs.writeFileSync(N('测试-风格注入Prompt.txt'), stylePrompt, 'utf-8')

  // ── Stage 4: 风格迁移仿写 ──
  console.log('\n[Stage 4] 风格迁移仿写...')

  const genPrompt = `你是一位专业的情色小说作家。以下是对目标原文的风格分析。请将原文的风格技法迁移到新的故事中。

${stylePrompt}

【创作要求】
创建新的角色和新的场景（不要重复原文的角色和情节）。

⚠️ 场景选择约束（极其重要——选错场景会毁掉整个仿写）：
- 选择与原文同类的场景：社交场合（宴会/派对/聚会/典礼）、权力场合（府邸/办公室/会议室）、日常空间（住宅/酒店/更衣室）、交通工具（车/船/飞机）。这些场景自然承载权力关系和身体接触。
- 禁止选择以下场景：实验室、医院、科研机构、检查中心、训练舱、基因工程设施、手术室。这些场景会诱导你用医学/数据/技术语言而非感官/体液/粗粝语言。
- 场景不是世界设定——不需要解释社会制度、不需要说明科技背景。场景只是情色事件发生的地点，用一两句交代即可。

⚠️ 词汇直白度（极其重要——文雅词汇是情色文学的死穴）：
- 性器官必须用最粗俗的词汇：用"鸡巴""肉棒"不用"阴茎"，用"骚穴""肉穴"不用"阴道"，用"奶子"不用"乳房"，用"屁眼"不用"肛门"。
- 性行为必须用最直接的动词：用"操"不用"性交"，用"插"不用"进入"，用"射"不用"射精"。
- 每个性器官前面至少堆叠2-3个定语："粗长滚烫的鸡巴""青涩紧窄的处子骚穴""肥美多汁的雪白奶子""沉甸甸的巨乳"。不是"她的乳房"——而是"她那对肥熟饱满、沉甸甸坠在胸前的大奶子"。

⚠️ 篇幅分配（极其重要——这是独立情色场景，不是长篇小说第一章）：
- 背景铺垫 ≤ 总篇幅的 15%（交代角色身份和场景即可，不要展开世界观）
- 情色互动 ≥ 总篇幅的 85%（从第一个身体接触开始，持续递进到高潮）
- 不写"故事的开头"——直接从情色张力的起点切入。读完你的文字，读者应该已经被感官轰炸，而非还在等待故事开始。

关键原则：你的任务是迁移原文的"情色技法"（感官密度/体液描写/叫床声/羞辱递进/权力对话），而非"世界设定"。世界设定只是承载技法的容器——用最简单的容器，把全部精力投入技法。

先写1-2句角色和场景简介，再写约2000-3000字的完整情色场景。直接输出，不需要额外说明。`

  const imitation = await chat([{ role: 'user', content: genPrompt }])
  fs.writeFileSync(path.join(OUT_DIR, '测试-AI模仿生成.txt'), imitation, 'utf-8')

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════')
  console.log(' 完成！输出文件:')
  console.log(`   ${N('测试-StyleProfile.json')}`)
  console.log(`   ${N('测试-风格注入Prompt.txt')}`)
  console.log(`   ${OUT_DIR}/测试-AI模仿生成.txt`)
  console.log(` 统计: ${dCount}维度 ${eCount}例句 ${excerpts.length}摘录 ${imitation.length}字生成`)
  console.log('═══════════════════════════════════════════')
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
