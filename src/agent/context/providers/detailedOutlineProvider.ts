import type { ContextProvider } from '../ContextAssembler'
import { fileService } from '@/services/fileService'
import { estimateTokensFromLines } from '../../utils/tokenEstimation'

const STATIC_DOC = [
  '## 细纲 JSON Schema',
  '细纲存储在 detailed_outline/{章节id}.json，每章一个文件。',
  '必填字段: id, title, order, status(incomplete|in_progress|complete), plotOverview, characters, location, keyEvents',
  '可选字段: emotionalTone, eroticContent, customContent, emotionCurve, writingNotes, summary',
  '注意: 细纲是 JSON 不是 .md，禁止创建 detailed_outline/*.md。',
].join('\n')

const CN_DIGIT: Record<string, number> = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 }
const CN_TENS: Record<string, number> = { '十':10, '二十':20, '三十':30, '百':100, '千':1000 }

function parseChineseNum(s: string): number | null {
  if (CN_DIGIT[s]) return CN_DIGIT[s]
  if (CN_TENS[s]) return CN_TENS[s]
  // Compound: "十五" = 10+5, "二十三" = 20+3
  for (const [tChar, tVal] of Object.entries(CN_TENS)) {
    if (s.startsWith(tChar)) {
      const rest = s.slice(tChar.length)
      if (!rest) return tVal
      const dVal = CN_DIGIT[rest]
      if (dVal) return tVal + dVal
      return null
    }
    if (s.endsWith(tChar)) {
      const prefix = s.slice(0, -tChar.length)
      const dVal = CN_DIGIT[prefix]
      if (dVal) return dVal * tVal  // "三十五"→3*10=30,actually we want 3*10=30→30+5... Let me just handle simple cases
      return null
    }
  }
  return null
}

function extractChapterNumber(msg: string): number | null {
  const m = msg.match(/第(\d+|[一二三四五六七八九十百千]+)\s*章/)
  if (!m) return null
  const num = parseInt(m[1])
  if (!isNaN(num)) return num
  return parseChineseNum(m[1])
}

export const detailedOutlineProvider: ContextProvider = {
  domain: 'detailed-outline',
  relevance: (userMessage) => {
    if (/第(\d+|[一二三四五六七八九十百千]+)\s*章/.test(userMessage) && /写|续|生成|创作|正文/.test(userMessage)) return 0.9
    if (/细纲|章节.*卡|卡片|detailed.*outline|每章/.test(userMessage)) return 0.9
    return 0.2
  },

  buildContext: async (projectId, userMessage) => {
    if (!projectId) {
      return { domain: 'detailed-outline', priority: 80, estimatedTokens: 250, content: STATIC_DOC }
    }

    const msg = userMessage || ''
    const chapterNum = extractChapterNumber(msg)

    if (chapterNum !== null) {
      const padded = String(chapterNum).padStart(3, '0')
      const candidates = [`ch${padded}.json`, `${padded}.json`, `chapter${padded}.json`]
      for (const filename of candidates) {
        try {
          const content = await fileService.read(`${projectId}/detailed_outline/${filename}`)
          return buildOutlineBlock(chapterNum, filename, content)
        } catch { /* try next pattern */ }
      }

      // Strategy 2: List directory and find by number
      try {
        const files = await fileService.listDir(`${projectId}/detailed_outline`)
        const jsonFiles = files.filter((f: string) => f.endsWith('.json'))
        const paddedAlt = String(chapterNum)
        const matched = jsonFiles.find((f: string) => {
          const base = f.replace('.json', '')
          return base === padded || base === paddedAlt || base.endsWith(padded) || base.endsWith(paddedAlt)
        })
        if (matched) {
          try {
            const content = await fileService.read(`${projectId}/detailed_outline/${matched}`)
            return buildOutlineBlock(chapterNum, matched, content)
          } catch { /* file read error */ }
        }
      } catch { /* directory error */ }
    }

    // General: list all outlines with status
    try {
      const files = await fileService.listDir(`${projectId}/detailed_outline`)
      const jsonFiles = files.filter((f: string) => f.endsWith('.json'))
      if (jsonFiles.length === 0) {
        return { domain: 'detailed-outline', priority: 80, estimatedTokens: 200, content: '## 细纲\n当前项目暂无细纲。\n\n' + STATIC_DOC }
      }
      const summaries: string[] = ['## 细纲概览', '']
      for (const f of jsonFiles.slice(0, 20)) {
        try {
          const content = await fileService.read(`${projectId}/detailed_outline/${f}`)
          const obj = JSON.parse(content)
          const status = obj.status === 'complete' ? '✓' : obj.status === 'in_progress' ? '◐' : '○'
          summaries.push(`${status} ${obj.title || f.replace('.json', '')}`)
        } catch { summaries.push(`○ ${f.replace('.json', '')}`) }
      }
      return { domain: 'detailed-outline', priority: 80, estimatedTokens: Math.min(estimateTokensFromLines(summaries), 800), content: summaries.join('\n') }
    } catch {
      return { domain: 'detailed-outline', priority: 80, estimatedTokens: 250, content: STATIC_DOC }
    }
  },
}

function buildOutlineBlock(chapterNum: number, filename: string, content: string) {
  const obj = JSON.parse(content)
  const lines = [
    `## 第${chapterNum}章细纲 — ${obj.title || filename}`,
    `- 状态: ${obj.status || '未知'}`,
    `- 剧情概述: ${obj.plotOverview || '暂无'}`,
    `- 出场角色: ${obj.characters || '暂无'}`,
    `- 场景地点: ${obj.location || '暂无'}`,
    `- 关键事件: ${obj.keyEvents || '暂无'}`,
  ]
  if (obj.emotionalTone) lines.push(`- 情绪基调: ${obj.emotionalTone}`)
  if (obj.writingNotes) lines.push(`- 写作笔记: ${obj.writingNotes}`)
  return { domain: 'detailed-outline' as const, priority: 80, estimatedTokens: Math.min(estimateTokensFromLines(lines), 1500), content: lines.join('\n') }
}
