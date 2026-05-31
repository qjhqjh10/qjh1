import { useEffect } from "react";
import { useStore } from "@/store";
import type { Character } from "@/types/character";
import { EMPTY_CHARACTER } from "@/types/character";
import { nanoid } from "nanoid";
import { logError } from "@/utils/logger";
import { buildStylePrompt } from "@/utils/styleInjector";

export function useWriteTabInjection(deps: {
  previewTab: string; novelType: string; extraction: any;
  outlineResults: Record<string, string>;
  detailGenResults: any[]; detailsResults: string;
}) {
  const { previewTab, novelType, extraction, outlineResults, detailGenResults, detailsResults } = deps;
  useEffect(() => {
    if (previewTab !== 'write') return
    // Inject characters
    if (outlineResults.characters) {
      try {
        const chars = JSON.parse(outlineResults.characters)
        if (Array.isArray(chars) && chars.length > 0) {
          const mapped: Character[] = chars.map((c: Record<string, unknown>) => ({ ...EMPTY_CHARACTER, id: nanoid(8), name: (c.name as string) || '', role: (['男主','女主','男配','女配','反派','其他'].includes(c.role as string) ? c.role : '其他') as Character['role'], personality: Array.isArray(c.traits) ? (c.traits as string[]).join('、') : ((c.traits as string) || ''), background: (c.background as string) || '', importance: 50 }))
          useStore.getState().setCharacters(mapped)
        }
      } catch (err) { logError('角色数据注入失败', err) }
    }
    // Inject worldbuilding (excludes erotic - that goes to outline for independence)
    const wbParts: string[] = []
    if (outlineResults.worldbuilding) wbParts.push('## 世界观\n' + outlineResults.worldbuilding)
    if (outlineResults.powerSystem) wbParts.push('## 等级体系\n' + outlineResults.powerSystem)
    if (outlineResults.items) wbParts.push('## 道具目录\n' + outlineResults.items)
    if (wbParts.length > 0) useStore.getState().setWorldbuildingContent(wbParts.join('\n\n'))
    // Inject outline (includes erotic - independent from worldbuilding toggle)
    const olParts: string[] = []
    if (outlineResults.erotic) olParts.push('## 情色设定\n' + outlineResults.erotic)
    if (outlineResults.powerSystem) olParts.push('## 等级体系\n' + outlineResults.powerSystem)
    if (outlineResults.foreshadowing) olParts.push('## 伏笔结构\n' + outlineResults.foreshadowing)
    if (outlineResults.emotionCurve) olParts.push('## 情绪模板\n' + outlineResults.emotionCurve)
    if (olParts.length > 0) useStore.getState().setOutlineContent(olParts.join('\n\n'))
    // Inject fake detailed chapters so ChapterGenerationModal can use chapter descriptions
    const results = detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()
    if (Array.isArray(results) && results.length > 0) {
      const fakeChapters = results.map(d => ({
        id: String(d.chapterNumber),
        title: d.title || `第${d.chapterNumber}章`,
        description: [
          d.summary || '',
          d.charactersAppearing?.length > 0 ? '出场: ' + d.charactersAppearing.join('、') : '',
          d.levelChange ? '等级变化: ' + d.levelChange : '',
          d.itemsUsed?.length > 0 ? '道具: ' + d.itemsUsed.join('、') : '',
          d.location ? '场景: ' + d.location : '',
          d.emotionalTone ? '情绪: ' + d.emotionalTone : '',
          d.eroticScene ? '【情色场景要求 — 必须写出完整情色内容】\n' + d.eroticScene : '',
        ].filter(Boolean).join('\n'),
        summary: [d.summary || '', d.eroticScene ? '【本章含情色场景】' : ''].filter(Boolean).join(' '),
        order: d.chapterNumber - 1,
        status: 'incomplete' as const,
      }))
      useStore.getState().setDetailedChapters(fakeChapters)
    }
    // Auto-inject erotic style dimensions for erotic novels
    if (novelType === 'erotic' && extraction?.styleProfile) {
      const stylePrompt = buildStylePrompt({ profile: extraction.styleProfile })
      if (stylePrompt) {
        const current = useStore.getState().outlineContent
        useStore.getState().setOutlineContent(current ? current + '\n\n---\n\n' + stylePrompt : stylePrompt)
      }
    }
  }, [previewTab, novelType, extraction, outlineResults.characters, outlineResults.worldbuilding, outlineResults.powerSystem, outlineResults.items, outlineResults.erotic, outlineResults.foreshadowing, outlineResults.emotionCurve, detailGenResults, detailsResults])
}
