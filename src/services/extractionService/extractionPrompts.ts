import type {
  ChapterExtraction, ExtractedCharacterRaw, ExtractedWorldElement,
  ExtractedItem, ExtractedPowerMention, ExtractedForeshadow,
  AggregatedResult, AggregatedCharacter,
  NovelExtraction, PacingTemplate,
  ChapterAnalysis, StyleProfile, StyleChapter, DimAnalysis,
  EroticExtractionData, EventPattern, ProgressionRhythm,
  CharacterArchetype, EmotionCurve,
} from '@/types/story'
import { splitChaptersByHeadings } from '@/utils/textUtils'


import { extractJSON } from './jsonParsers';
const DIM_SCHEMAS: Record<string, string> = {
  characters: `"characters": [
    {
      "name": "角色名",
      "aliases": ["别名1"],
      "role": "角色身份: 男主/女主/男配/女配/反派/其他(从上下文推断角色性别和定位)",
      "traits": ["性格特征"],
      "appearance": "外貌描写",
      "action": "本章中做了什么",
      "newInfo": "本章新揭示的关于此角色的信息(没有填'')"
    }
  ]`,
  worldbuilding: `"worldbuilding": [
    {
      "type": "location|faction|rule|history|other",
      "name": "名称",
      "description": "描述",
      "newInfo": "本章新信息"
    }
  ]`,
  items: `"items": [
    {
      "name": "物品/法宝/功法名",
      "type": "法宝|丹药|功法|武器|道具|其他",
      "grade": "等级/品阶(未知填'')",
      "owner": "持有者",
      "ability": "能力/效果",
      "acquisitionMethod": "获得方式"
    }
  ]`,
  powerSystem: `"powerSystem": [
    {
      "term": "等级术语(如'筑基期')",
      "context": "上下文描述",
      "inferredLevel": 数字(从低到高推测排序,练气=1,筑基=2...)
    }
  ]`,
  chapterSummary: `"chapterSummary": "本章150-300字详细剧情摘要（包含起因经过结果和情感转折，如有情色内容需描述情色场景和情绪变化）"`,
  events: `"events": ["本章关键事件1", "本章关键事件2", "本章关键事件3"]`,
  foreshadowing: `"foreshadowing": [
    {
      "description": "伏笔或回收描述",
      "type": "planted|resolved"
    }
  ]`,
  emotionalTone: `"emotionalTone": "本章情绪基调(紧张/温馨/悲伤/热血/悬疑...)"`,
  erotic: `"erotic": {
    "characterRoles": [
      {"name": "角色名", "domSub": "dom|sub|switch", "bodyState": "正常|发情|改造|退行|...", "kinks": ["束缚","露出","..."], "shameLevel": "高|中|低"}
    ],
    "sceneFlow": [
      {"phase": "前戏|渐进|主戏|高潮|收尾", "actions": ["具体动作"], "bodyReactions": ["身体反应"], "duration": "短|中|长"}
    ],
    "techniques": {"bodyFluids": ["精液","爱液","汗液","..."], "touchFocus": ["乳房","腿","..."], "soundStyle": "稀疏|适量|密集|极密集", "moanDensity": "稀疏|适量|密集|极密集"},
    "powerDynamics": "本章的权力关系和变化",
    "degradationPatterns": ["言语羞辱","公开暴露","..."]
  }`,
}


export function buildExtractionPrompt(chapterTitle: string, chapterContent: string, dims?: string[]): string {
  const selected = (dims && dims.length > 0) ? dims : ['characters', 'worldbuilding', 'items', 'powerSystem', 'chapterSummary', 'events', 'foreshadowing', 'emotionalTone']
  const fields = selected.map(k => `  ${DIM_SCHEMAS[k]}`).join(',\n')
  return `你是一位专业的小说分析师。请分析以下小说章节，提取结构化信息。

【章节标题】${chapterTitle}
【章节内容】
${chapterContent.slice(0, 15000)}

请严格输出以下 JSON（不要markdown，不要额外说明）。未选中的维度不要输出，选中的维度必须填写（无数据填[]或""）：
{
${fields}
}

要求:
1. 只提取文中明确写出或强烈暗示的信息，不要编造
2. 角色名使用文中原名称，保持一致性
3. 等级术语不要翻译，保持原文用词
4. 伏笔判断标准: 文中提到但未完全解释的信息=planted; 之前planted的信息在本章得到解释=resolved
5. chapterSummary按实际内容长度撰写，包含起因/经过/结果/情感转折。章节内容越丰富摘要越详细，过渡章/短章可少于150字
6. events按实际发生的事件列出，无显著事件填[]。过渡章/内心独白章可能只有1-2个事件`
}

// Parse AI reply into ChapterExtraction
export function parseExtractionReply(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string, chapterType: StyleChapter['chapterType'] = 'chapter'): ChapterExtraction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI-generated JSON
  let parsed: Record<string, any>
  try {
    parsed = extractJSON(reply)
  } catch {
    throw new Error(`AI返回内容无法解析为JSON: ${reply.slice(0, 200)}...`)
  }
  return {
    chapterId, chapterNumber, chapterTitle, chapterContent, chapterType,
    characters: parsed.characters || [],
    worldbuilding: parsed.worldbuilding || [],
    items: (parsed.items || []).map((i: ExtractedItem & { firstChapter?: number }) => ({ ...i, firstChapter: i.firstChapter || chapterNumber })),
    powerSystem: parsed.powerSystem || [],
    chapterSummary: parsed.chapterSummary || '',
    events: parsed.events || [],
    foreshadowing: parsed.foreshadowing || [],
    emotionalTone: parsed.emotionalTone || '',
    extractedAt: new Date().toISOString(),
  }
}

export function splitChapters(content: string): { title: string; content: string; chapterNumber: number; chapterType: string }[] {
  return splitChaptersByHeadings(content).map(({ title, content: c, chapterNumber, chapterType }) => ({
    title, content: c, chapterNumber, chapterType,
  }))
}

// ---- Style analysis (shared with StyleWorkshopPage) ----


export function buildEroticExtractionPrompt(chapterTitle: string, chapterContent: string, dims?: string[]): string {
  let p = buildExtractionPrompt(chapterTitle, chapterContent, dims)
  p += `

【情色分析 — 仅情色小说执行】
请额外分析本章的情色要素，输出在 "erotic" 字段中（如果不含情色内容则输出 null）：
{
  "erotic": {
    "characterRoles": [
      {"name": "角色名", "domSub": "dom|sub|switch", "bodyState": "正常|发情|改造|退行|包茎|微型化|怀孕|哺乳期", "kinks": ["束缚","露出","..."], "shameLevel": "高|中|低→高"}
    ],
    "sceneFlow": [
      {"phase": "前戏|渐进|主戏|高潮|收尾", "actions": ["具体动作"], "bodyReactions": ["身体反应"], "duration": "短|中|长"}
    ],
    "techniques": {"bodyFluids": ["精液","爱液","汗液","..."], "touchFocus": ["乳房","腿","..."], "soundStyle": "稀疏|适量|密集|极密集", "moanDensity": "稀疏|适量|密集|极密集"},
    "powerDynamics": "本章的权力关系和变化",
    "degradationPatterns": ["言语羞辱","公开暴露","..."]
  }
}`
  return p
}

// Parse erotic extraction reply (extends parseExtractionReply)
export function parseExtractionReplyWithErotic(reply: string, chapterId: string, chapterNumber: number, chapterTitle: string, chapterContent: string, chapterType: StyleChapter['chapterType'] = 'chapter'): ChapterExtraction {
  const base = parseExtractionReply(reply, chapterId, chapterNumber, chapterTitle, chapterContent, chapterType)
  try {
    const parsed = extractJSON(reply)
    if (parsed.erotic) base.erotic = parsed.erotic as EroticExtractionData
  } catch { /* erotic parsing failed, continue without */ }
  return base
}

// ---- Convert extraction chapters to StyleChapter format ----
export function chaptersToStyleChapters(chapters: ChapterExtraction[]): StyleChapter[] {
  return chapters.map((ch, i) => ({
    id: `ch_${i + 1}`,
    title: ch.chapterTitle,
    chapterNumber: ch.chapterNumber,
    chapterType: ch.chapterType || 'chapter',
    content: ch.chapterContent,
    charCount: ch.chapterContent.length,
    analyzed: false,
    analysis: null,
  }))
}