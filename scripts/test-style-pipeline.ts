/**
 * 风格模板全链路测试脚本
 *
 * 用途: 测试新版风格模板（v12.5.1优化后）的完整链路
 *   TXT导入 → AI逐章分析 → 汇总 → StyleProfile → buildStylePrompt → AI模仿生成
 *
 * 运行:
 *   cd d:/3/novel-writing-app
 *   npx tsx scripts/test-style-pipeline.ts
 *
 * 环境变量:
 *   AI_API_KEY  - DeepSeek API key
 *   AI_MODEL    - 模型名 (默认 deepseek-chat)
 *   AI_BASE_URL - API地址 (默认 https://api.deepseek.com/v1)
 */

import { buildStyleAnalyzePrompt, parseStyleAnalysisReply, buildSummarizePrompt, buildFewShotExcerpts } from '../src/services/extractionService/styleAnalysis'
import { buildStylePrompt, convertTemplateToProfile } from '../src/utils/styleInjector'
import { classifyDimTiers } from '../src/utils/dimTiers'
import { DIMENSION_META } from '../src/types/story/storyTypes'
import { NOVEL_TYPE_DIMS } from '../src/types/story/storyTypes'
import type { StyleProfile, DimAnalysis, StyleChapter, ChapterAnalysis } from '../src/types/story/style'
import * as fs from 'fs'
import * as path from 'path'

// ── Config ──

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const MODEL = process.env.AI_MODEL || 'deepseek-chat'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
const NOVEL_TYPE = '情色'

// ── Input: read sample text ──

const SAMPLE_PATH = process.argv[2] || path.resolve(__dirname, '../风格蒸馏演示/sample-input.txt')

function loadSample(): string {
  const paths = [SAMPLE_PATH, 'd:/3/风格蒸馏演示/sample-input.txt']
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`[LOAD] 读取样本: ${p}`)
      return fs.readFileSync(p, 'utf-8')
    }
  }
  console.error('[ERROR] 未找到样本文件。请将文本放入 d:/3/风格蒸馏演示/sample-input.txt')
  process.exit(1)
}

// ── Split into chapters ──

function splitChapters(content: string): { title: string; content: string }[] {
  const headingRe = /^(第[一二三四五六七八九十百千\d]+[章回节]|序章|楔子|尾声|番外).*$/gm
  const matches = Array.from(content.matchAll(headingRe))
  if (matches.length === 0) {
    return [{ title: '全文', content }]
  }

  const chapters: { title: string; content: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length
    chapters.push({
      title: matches[i][0].trim(),
      content: content.slice(start, end).trim(),
    })
  }
  return chapters
}

// ── DeepSeek API call ──

async function chatAI(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${err.slice(0, 300)}`)
  }

  const j = await res.json() as any
  return j.choices?.[0]?.message?.content || ''
}

// ── Main pipeline ──

async function main() {
  const sampleText = loadSample()
  const chapters = splitChapters(sampleText)
  const dims = NOVEL_TYPE_DIMS['情色'] || NOVEL_TYPE_DIMS['普通小说']
  const { mustAnalyze } = classifyDimTiers(dims, '情色小说')

  console.log(`[PIPELINE] 章节数: ${chapters.length}, 维度数: ${dims.length}, 模型: ${MODEL}`)

  // ── Stage 1: Per-chapter analysis ──
  console.log(`\n━━━ Stage 1: 逐章分析 ━━━`)
  const chapterAnalyses: { title: string; analysis: ChapterAnalysis }[] = []

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const prompt = buildStyleAnalyzePrompt(dims, NOVEL_TYPE)
    const userMsg = `${prompt}\n\n[${ch.title}]\n${ch.content.slice(0, 8000)}`

    console.log(`  [${i + 1}/${chapters.length}] 分析: ${ch.title} (${ch.content.length}字)...`)
    const reply = await chatAI([{ role: 'user', content: userMsg }])
    // Debug: save raw reply
    const debugDir = path.resolve(__dirname, '../风格蒸馏演示')
    fs.writeFileSync(path.join(debugDir, 'debug-raw-reply.txt'), reply, 'utf-8')

    // Fix parser compatibility: parser only parses text BEFORE first ---VOCABULARY/RULES/TONE
    // AI outputs these markers within the first dimension, breaking all subsequent dimensions.
    // Solution: extract TONE block, remove all VOCABULARY/RULES/TONE, append TONE at end.
    const firstHdr = reply.search(/^## /m)
    let cleaned = firstHdr >= 0 ? reply.slice(firstHdr) : reply
    // Extract TONE block (keep it)
    const toneMatch = cleaned.match(/\n---TONE---\n(\{[\s\S]*?\})/)
    const toneBlock = toneMatch ? `\n---TONE---\n${toneMatch[1]}` : ''
    // Remove ALL VOCABULARY/RULES/TONE blocks
    cleaned = cleaned.replace(/\n---VOCABULARY---\n\[[\s\S]*?\](\n|$)/g, '\n')
    cleaned = cleaned.replace(/\n---RULES---\n\[[\s\S]*?\](\n|$)/g, '\n')
    cleaned = cleaned.replace(/\n---TONE---\n\{[\s\S]*?\}(\n|$)/g, '\n')
    // Append TONE at end
    cleaned = cleaned.trimEnd() + toneBlock
    const analysis = parseStyleAnalysisReply(cleaned, dims)
    chapterAnalyses.push({ title: ch.title, analysis })
    const dimCount = analysis.dimAnalyses ? Object.keys(analysis.dimAnalyses).length : 0
    const exampleCount = analysis.dimAnalyses
      ? Object.values(analysis.dimAnalyses).reduce((sum, d: any) => sum + (d.examples?.length || 0), 0)
      : 0
    console.log(`    → ${dimCount} 维度, ${exampleCount} 例句`)
  }

  // ── Stage 2: Aggregate + Summarize ──
  console.log(`\n━━━ Stage 2: 全局汇总 ━━━`)

  // Aggregate dimAnalyses
  const aggregated: Record<string, DimAnalysis> = {}
  for (const { analysis } of chapterAnalyses) {
    if (!analysis.dimAnalyses) continue
    for (const [dk, da] of Object.entries(analysis.dimAnalyses)) {
      const existing = aggregated[dk]
      if (!existing) {
        aggregated[dk] = { ...da }
      } else {
        aggregated[dk] = {
          description: existing.description || da.description,
          examples: Array.from(new Set([...(existing.examples || []), ...(da.examples || [])])).slice(0, 30),
          writingRules: Array.from(new Set([...(existing.writingRules || []), ...(da.writingRules || [])])),
          vocabularyList: Array.from(new Set([...(existing.vocabularyList || []), ...(da.vocabularyList || [])])).slice(0, 80),
        }
      }
    }
  }

  // Build summary for AI
  const dimSummaryParts = chapterAnalyses.map(({ title, analysis }) => {
    if (!analysis.dimAnalyses) return ''
    const parts = [`[${title}]`]
    for (const [dk, da] of Object.entries(analysis.dimAnalyses)) {
      const meta = DIMENSION_META[dk]
      parts.push(`  ${dk}(${meta?.label || dk}): ${da.description?.slice(0, 150) || ''}`)
    }
    return parts.join('\n')
  }).filter(Boolean)

  const summaryPrompt = buildSummarizePrompt(chapters.length, dimSummaryParts.join('\n\n'), NOVEL_TYPE)
  console.log(`  发送汇总 prompt (${summaryPrompt.length} chars)...`)
  const summaryReply = await chatAI([{ role: 'user', content: summaryPrompt }])
  const summaryAnalysis = parseStyleAnalysisReply(summaryReply, dims)

  // Merge summary into aggregated
  if (summaryAnalysis.dimAnalyses) {
    for (const [dk, da] of Object.entries(summaryAnalysis.dimAnalyses)) {
      if (!aggregated[dk]) aggregated[dk] = da as DimAnalysis
      else aggregated[dk] = { ...aggregated[dk], description: (da as DimAnalysis).description || aggregated[dk].description }
    }
  }

  // Extract few-shot excerpts
  const excerpts = buildFewShotExcerpts(
    chapters.map((c, i) => ({ title: c.title, content: c.content, chapterNumber: i + 1 })),
    5, 2, 250,
  )

  const fullDescription = summaryAnalysis.dimAnalyses
    ? Object.entries(summaryAnalysis.dimAnalyses).map(([k, d]) =>
        `${DIMENSION_META[k]?.label || k}: ${(d as DimAnalysis).description?.slice(0, 80)}`).join('; ')
    : `已分析${chapters.length}章`

  // Build StyleProfile
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
    fullDescription,
    excerpts: excerpts.map(text => ({ text, note: '' })),
    analyzedAt: new Date().toISOString(),
    analyzedChapterCount: chapters.length,
    dimAnalyses: Object.keys(aggregated).length > 0 ? aggregated : undefined,
  }

  console.log(`  汇总完成: ${Object.keys(aggregated).length} 维度, ${excerpts.length} 摘录`)

  // ── Stage 3: Build style injection prompt ──
  console.log(`\n━━━ Stage 3: 生成风格注入 Prompt ━━━`)
  const stylePrompt = buildStylePrompt({ profile })
  console.log(`  风格prompt长度: ${stylePrompt.length} chars`)
  console.log(`  包含: ${(stylePrompt.match(/【/g) || []).length} 个约束块`)

  // ── Stage 4: Imitation generation ──
  console.log(`\n━━━ Stage 4: AI 模仿生成 ━━━`)

  const generationPrompt = `你是一位专业的情色小说作家。以下是对目标原文的风格分析和约束，请严格遵循所有规则，模仿原文的风格进行写作。

${stylePrompt}

【创作要求】
请根据以上风格约束，创作一段情色小说片段（约2000-3000字）。
内容要求：
- 创建一个新的场景和新的角色（不要重复原文的角色）
- 严格遵循上述所有风格约束（句式、用词、拟声词密度、体液描写标准、叙述者站姿、羞辱递进链等）
- 模仿原文的情色描写密度和直白程度——必须不低于原文水准

直接输出正文，不需要分析、注释或任何额外说明。`

  console.log(`  发送生成prompt (${generationPrompt.length} chars)...`)
  const imitation = await chatAI([{ role: 'user', content: generationPrompt }])

  // ── Output ──
  const outDir = path.resolve(__dirname, '../风格蒸馏演示')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  // Save style profile
  fs.writeFileSync(
    path.join(outDir, '测试-StyleProfile.json'),
    JSON.stringify({ profile, aggregated, excerpts }, null, 2),
    'utf-8',
  )

  // Save style prompt
  fs.writeFileSync(
    path.join(outDir, '测试-风格注入Prompt.txt'),
    stylePrompt,
    'utf-8',
  )

  // Save imitation
  fs.writeFileSync(
    path.join(outDir, '测试-AI模仿生成.txt'),
    imitation,
    'utf-8',
  )

  console.log(`\n━━━ 完成 ━━━`)
  console.log(`  输出文件:`)
  console.log(`    ${outDir}/测试-StyleProfile.json`)
  console.log(`    ${outDir}/测试-风格注入Prompt.txt`)
  console.log(`    ${outDir}/测试-AI模仿生成.txt`)
  console.log(`\n  统计:`)
  console.log(`    分析维度: ${Object.keys(aggregated).length}`)
  console.log(`    例句总数: ${Object.values(aggregated).reduce((s, d) => s + (d.examples?.length || 0), 0)}`)
  console.log(`    摘录段落: ${excerpts.length}`)
  console.log(`    生成字数: ${imitation.length}`)
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
