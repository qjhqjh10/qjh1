import { useEffect, useState, useMemo } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { styleProjectService, aiService, styleTemplateService } from '@/services/fileService'
import type { StyleTemplate } from '@/types/styleTemplate'
import { getTemplateDims } from '@/types/styleTemplate'
import type { DimAnalysis } from '@/types/story'
import { DIMENSION_META, NOVEL_TYPE_LABELS, NOVEL_TYPES, NOVEL_TYPE_DIMS } from '@/types/story'
import { nanoid } from 'nanoid'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { buildStyleAnalyzePromptV3, parseStyleAnalysisReplyV3, buildSummarizePromptV3 } from '@/services/extractionService'
import { logError } from '@/utils/logger'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import type { StyleProject, StyleChapter, StyleProfile, StyleProjectMeta, ChapterAnalysis } from '@/types/story'
import {
  SparklesIcon, PlusIcon, TrashIcon, XMarkIcon,
  DocumentTextIcon, PaintBrushIcon, FolderOpenIcon,
  ArrowLeftIcon, MagnifyingGlassIcon, ArrowsUpDownIcon,
  ArrowPathIcon, TagIcon,
} from '@heroicons/react/24/outline'

export type ViewMode = 'library' | 'detail'
export type ResultTab = 'chapters' | 'overall'
export type WorkspaceTab = 'archives' | 'templates'
export type SortKey = 'updatedAt' | 'name' | 'type' | 'dimCount'

export function splitChapters(content: string): StyleChapter[] {
  let chapterNum = 0
  return splitChaptersByHeadings(content).map(r => {
    chapterNum++
    return {
      id: `ch_${chapterNum}`, title: r.title, chapterNumber: chapterNum,
      chapterType: r.chapterType as StyleChapter['chapterType'],
      content: r.content, charCount: r.content.length, analyzed: false, analysis: null,
    }
  })
}
export const FEATURE_LABELS: Record<string, string> = {
  narrativeTone: '叙事基调', sentenceStyle: '句式', vocabularyStyle: '词汇', rhetoricStyle: '修辞',
  rhythmStyle: '节奏', dialogueStyle: '对话', moodStyle: '氛围',
  perspectiveStyle: '视角', bodyLanguageStyle: '身体', sensoryStyle: '感官',
  tensionStyle: '张力', subtextStyle: '暗示', descriptionPattern: '描写结构',
  corruptionArc: '人物演变', degradationRitual: '场景机制', narrativeVoice: '叙事声音', shameVoyeurLoop: '心理循环',
  socialRealism: '社会现实', cultivationCombat: '修炼战斗', romanceArc: '感情发展', archaicStyle: '古风文言', suspensePacing: '悬疑节奏',
  compoundWordPattern: '造词模式', onomatopoeiaSystem: '拟声词系统', sensoryPackFormula: '感官打包',
  bodyMindBetrayal: '身心背离', humiliationTemplate: '羞辱公式',
}

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '最新' },
  { key: 'name', label: '名称' },
  { key: 'type', label: '类型' },
  { key: 'dimCount', label: '维度' },
]

export const WORLD_TYPE_PRESETS = ['古代', '现代', '西幻', '日系', '末日', '科幻', '灵异', '架空历史', '玄幻', '游戏', '混合']
export const ATTITUDE_PRESETS = ['冷漠旁观', '欣赏把玩', '幽默调侃', '温柔包容', '神圣庄严', '冷酷写实', '热忱歌颂', '暧昧诱导', '疑惑探索']


// ── Post-component helpers ──

export function parsePromptDescription(prompt: string): string {
  if (prompt.startsWith('"') && !prompt.startsWith('"[') && !prompt.startsWith('"{')) {
    const inner = prompt.replace(/^"[^"]+":\s*"/, '').replace(/"$/, '')
    return inner.split('+').map(p => p.replace(/[:：].*/, '').trim()).filter(Boolean).join('、')
  }
  const fields: string[] = []
  const jsonMatch = prompt.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    const keyMatches = jsonMatch[0].matchAll(/"(\w+)":"([^"]+)"/g)
    for (const m of keyMatches) {
      if (fields.length < 5) fields.push(`${m[1]}: ${m[2].slice(0, 30)}`)
    }
    if (fields.length > 0) return fields.join('; ')
  }
  return prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt
}

export const presetBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', color: '#2d2520', fontWeight: 500,
}
export const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}
export const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }
export const cardActionBtn: React.CSSProperties = {
  fontSize: 10, padding: '3px 10px', borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.6)',
  cursor: 'pointer', color: '#6b5e54', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 3,
}
