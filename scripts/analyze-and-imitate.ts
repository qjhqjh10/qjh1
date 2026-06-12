/**
 * 风格模板全链路测试 — 分析原文 + 生成模板 + AI仿写
 *
 * 用法:
 *   cd d:/3/novel-writing-app
 *   npx tsx scripts/analyze-and-imitate.ts [原文文件路径]
 *
 * 环境变量:
 *   AI_API_KEY  - DeepSeek API key (默认内置)
 *   AI_MODEL    - 模型 (默认 deepseek-v4-flash)
 */

import * as fs from 'fs'
import * as path from 'path'
import { buildStyleAnalyzePrompt, parseStyleAnalysisReply, buildSummarizePrompt, buildFewShotExcerpts } from '../src/services/extractionService/styleAnalysis'
import { buildStylePrompt } from '../src/utils/styleInjector'
import { classifyDimTiers } from '../src/utils/dimTiers'
import { DIMENSION_META, NOVEL_TYPE_DIMS } from '../src/types/story/storyTypes'
import type { StyleProfile, DimAnalysis, ChapterAnalysis, CategorizedVocab } from '../src/types/story/style'

// ── Config ──
const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'
const ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
const NOVEL_TYPE_LONG = '情色小说'      // for DIM_PRIORITY and classifyDimTiers
const NOVEL_TYPE_SHORT = '情色'           // for NOVEL_TYPE_DIMS lookup
const OUT_DIR = 'd:/3/风格蒸馏演示'

// ── Utilities ──
async function chat(messages: { role: string; content: string }[], maxTokens = 4096, model?: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: model || MODEL, messages, temperature: 0.7, max_tokens: maxTokens }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return ((await res.json()) as any).choices?.[0]?.message?.content || ''
}

function splitChapters(content: string): { title: string; content: string }[] {
  const re = /^(第[一二三四五六七八九十百千\d]+[章回节]|序章|楔子|尾声|番外).*$/gm
  const matches = Array.from(content.matchAll(re))
  if (!matches.length) return [{ title: '全文', content }]
  const out: { title: string; content: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const s = matches[i].index!
    const e = i + 1 < matches.length ? matches[i + 1].index! : content.length
    out.push({ title: matches[i][0].trim(), content: content.slice(s, e).trim() })
  }
  return out
}

// ── Main ──
async function main() {
  const inputPath = process.argv[2] || path.join(OUT_DIR, 'sample-input.txt')
  if (!fs.existsSync(inputPath)) { console.error('原文文件不存在:', inputPath); process.exit(1) }
  const sampleText = fs.readFileSync(inputPath, 'utf-8')
  const chapters = splitChapters(sampleText)
  const dims = NOVEL_TYPE_DIMS[NOVEL_TYPE_SHORT] || NOVEL_TYPE_DIMS['普通小说']
  const { mustAnalyze } = classifyDimTiers(dims, NOVEL_TYPE_LONG)

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log('═══════════════════════════════════════════')
  console.log(` 风格模板测试`)
  console.log(` 原文: ${path.basename(inputPath)} | 章节: ${chapters.length} | 维度: ${dims.length}`)
  console.log(` 分析: ${ANALYSIS_MODEL} | 仿写: ${MODEL}`)
  console.log('═══════════════════════════════════════════')

  // ── Stage 1: 逐章分析 ──
  console.log('\n[Stage 1] 逐章AI分析...')
  const chapterAnalyses: { title: string; analysis: ChapterAnalysis }[] = []
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const prompt = buildStyleAnalyzePrompt(dims, NOVEL_TYPE_LONG)
    const msg = `${prompt}\n\n[${ch.title}]\n${ch.content.slice(0, 8000)}`
const reply = await chat([{ role: 'user', content: msg }], 8192)
    fs.writeFileSync(path.join(OUT_DIR, 'debug-raw-reply.txt'), reply, 'utf-8')
    const hdrs = (reply.match(/^## /gm) || []).length
    const analysis = parseStyleAnalysisReply(reply, dims)

    const dCount = analysis.dimAnalyses ? Object.keys(analysis.dimAnalyses).length : 0
    const eCount = analysis.dimAnalyses
      ? Object.values(analysis.dimAnalyses).reduce((s, d: any) => s + (d.examples?.length || 0), 0)
      : 0
    // Debug: check first dim's desc for > lines
    if (analysis.dimAnalyses) {
      const first = Object.entries(analysis.dimAnalyses)[0]
      if (first) console.log(`    DEBUG first dim[${first[0]}]: desc=${first[1].description?.length||0} chars, examples=${first[1].examples?.length||0}, > in desc=${(first[1].description?.match(/^>/gm)||[]).length}`)
    }
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

  const summaryReply = await chat([{ role: 'user', content: buildSummarizePrompt(chapters.length, dimSummary, NOVEL_TYPE_LONG) }], 4096, ANALYSIS_MODEL)
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

  const dCount = Object.keys(aggregated).length
  const eCount = Object.values(aggregated).reduce((s, d) => s + (d.examples?.length || 0), 0)
  console.log(`  汇总: ${dCount}维度 ${eCount}例句 ${excerpts.length}摘录`)

  // Save profile
  fs.writeFileSync(path.join(OUT_DIR, '测试-StyleProfile.json'), JSON.stringify({ profile, aggregated, excerpts }, null, 2), 'utf-8')

  // ── Stage 3: 生成风格注入 Prompt ──
  console.log('\n[Stage 3] 生成风格注入 Prompt...')
  const stylePrompt = buildStylePrompt({ profile })
  const blockCount = (stylePrompt.match(/【/g) || []).length
  console.log(`  长度: ${stylePrompt.length} chars, ${blockCount} 约束块`)
  fs.writeFileSync(path.join(OUT_DIR, '测试-风格注入Prompt.txt'), stylePrompt, 'utf-8')

  // ── Stage 4: 风格迁移仿写 ──
  console.log('\n[Stage 4] 风格迁移仿写...')

  const genPrompt = `你是一位专业的情色小说作家。以下是对目标原文的风格分析。请将原文的风格技法迁移到新的故事中。

${stylePrompt}

【创作要求】
创建新的角色和新的场景（不要重复原文的角色和情节）。世界背景可自由选择——关键是将上述风格技法完整地迁移到你的故事中。
先写2-3句剧情前提（新场景的设定和核心角色），再写约2000-3000字的完整场景。直接输出，不需要额外说明。`

  const imitation = await chat([{ role: 'user', content: genPrompt }])
  fs.writeFileSync(path.join(OUT_DIR, '测试-AI模仿生成.txt'), imitation, 'utf-8')

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════')
  console.log(' 完成！输出文件:')
  console.log(`   ${OUT_DIR}/测试-StyleProfile.json`)
  console.log(`   ${OUT_DIR}/测试-风格注入Prompt.txt`)
  console.log(`   ${OUT_DIR}/测试-AI模仿生成.txt`)
  console.log(` 统计: ${dCount}维度 ${eCount}例句 ${excerpts.length}摘录 ${imitation.length}字生成`)
  console.log('═══════════════════════════════════════════')
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
