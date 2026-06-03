import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService, styleTemplateService, templateService, settingsService } from '@/services/fileService'
import {
  XMarkIcon, PaperAirplaneIcon, SparklesIcon,
  ArrowDownTrayIcon, BookOpenIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClipboardIcon, ArrowRightIcon,
  PlusIcon, ArrowPathIcon, ListBulletIcon,
  ExclamationTriangleIcon, DocumentTextIcon, PhotoIcon,
  TrashIcon, Square2StackIcon,
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { FILE_TOOLS, READ_ONLY_TOOLS, DANGEROUS_TOOLS } from '@/types/fileOps'
import { debugApiSend, debugApiResponse, debugApiError, debugBatchCheck, debugBatchShow, debugBatchApprove, debugBatchDeny, debugBatchTimeout, debugToolCall, debugToolResult, debugSysError, debugSysWarn } from '@/services/debugLogService'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import { WELCOME_MSG, STORAGE_KEY, LAST_ACTIVE_KEY, WINDOW_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'
import ImageLightbox from '@/components/common/ImageLightbox'

export function makeConversation(id: string, title: string): Conversation {
  const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false
  return { id, title, messages: showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${id}` }] : [], createdAt: Date.now(), totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 }
}

export function parsePopupCommand(text: string): { text: string; popup?: { type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }; genTrigger?: string } {
  // Check for chapter gen trigger first
  const genMatch = text.match(/【生成(?:第(\S+?)章|本章)】/)
  if (genMatch) {
    const chapId = genMatch[1] // undefined for "生成本章" (current chapter)
    return { text: text.replace(genMatch[0], '').trim(), genTrigger: chapId || '__current__' }
  }

  const patterns: { pattern: RegExp; type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }[] = [
    { pattern: /【打开大纲】/, type: 'outline', title: '大纲' },
    { pattern: /【打开世界观】/, type: 'worldbuilding', title: '世界观' },
    { pattern: /【打开草稿(?:[：:]\s*(.+?))?】/, type: 'draft', title: '草稿本', documentKey: '草稿本.md' },
    { pattern: /【打开知识库】/, type: 'kb', title: '知识库' },
  ]
  for (const p of patterns) {
    const match = text.match(p.pattern)
    if (match) {
      const docKey = p.type === 'draft' ? (match[1]?.trim() || '草稿本.md') : undefined
      return { text: text.replace(p.pattern, '').trim(), popup: { type: p.type, title: p.title, documentKey: docKey } }
    }
  }
  return { text }
}

export function parseInsertionSuggestion(text: string): {
  plainText: string
  insertion: Message['insertion']
} {
  // Rewrite pattern: 【改写参考】...【改写内容】...
  const rewriteMatch = text.match(/【改写参考】\s*\n原文:\s*(.+?)\n\n【改写内容】\s*\n([\s\S]*?)$/)
  if (rewriteMatch) {
    const keyword = rewriteMatch[1].trim()
    const content = rewriteMatch[2].trim()
    const plainText = text.replace(/【改写参考】[\s\S]*?【改写内容】\s*\n?/, '').trim()
    return { plainText, insertion: { keyword, position: 'after', content, mode: 'rewrite' } }
  }

  // Insert pattern: 【插入参考】...【生成内容】...
  const match = text.match(/【插入参考】\s*\n原文关键词:\s*(.+?)\n建议位置:\s*(.+?)\n\n【生成内容】\s*\n([\s\S]*?)$/)
  if (!match) return { plainText: text, insertion: undefined }

  const keyword = match[1].trim()
  const posRaw = match[2].trim()
  const content = match[3].trim()
  const position = posRaw.includes('前') ? 'before' as const : 'after' as const

  const plainText = text.replace(/【插入参考】[\s\S]*?【生成内容】\s*\n?/, '').trim()

  return { plainText, insertion: { keyword, position, content, mode: 'insert' } }
}

/**
 * Detect when the AI claims it performed an action (e.g. "已创建", "已修改")
 * but didn't actually call the corresponding tool. Returns a warning string
 * or null if no hallucination detected.
 */
export function detectHallucination(text: string, toolsCalled: Set<string>): string | null {
  if (!text) return null

  const checks: { pattern: RegExp; tools: string[]; label: string }[] = [
    { pattern: /(?:已经|已).{0,10}(创建|新建|生成|写入|写好|做好|添加了)/, tools: ['create_file', 'create_project', 'create_style_template', 'create_scene_template', 'generate_image', 'kb_create_file'], label: '创建/生成' },
    { pattern: /(?:已经|已).{0,10}(修改|编辑|更新|替换|改写|改成|调整了|调整好)/, tools: ['edit_file', 'rename_file', 'create_file'], label: '修改/编辑' },
    { pattern: /(?:已经|已).{0,10}(读取|查看|读过|看过|查阅)/, tools: ['read_file', 'list_directory'], label: '读取/查看' },
    { pattern: /(?:已经|已).{0,10}(删除|移除|去掉)/, tools: ['delete_file'], label: '删除' },
    { pattern: /(?:已经|已).{0,10}(保存|存储)/, tools: ['create_file', 'edit_file', 'kb_create_file', 'kb_append_file'], label: '保存/写入' },
    { pattern: /(?:已经|已).{0,10}(搜索|检索|查找|找到)/, tools: ['search_content', 'list_directory'], label: '搜索' },
    { pattern: /(?:已经|已).{0,10}(追加|写入)/, tools: ['edit_file', 'create_file', 'kb_append_file'], label: '追加/写入' },
  ]

  for (const check of checks) {
    if (check.pattern.test(text)) {
      const hasTool = check.tools.some(t => toolsCalled.has(t))
      if (!hasTool) {
        return `[系统提示] AI回复中声称"${check.label}"操作，但在本轮对话中未实际调用对应工具。以下内容可能不准确，建议要求AI重新执行并确认工具调用结果。`
      }
    }
  }
  return null
}

/**
 * Parse the AI's thinking plan from [思考计划]...[/思考计划] block.
 * Extracts user intent, file list, and numbered steps with tool names.
 * Returns cleaned text (without the plan block) and the structured plan.
 */
export function parseThinkingPlan(text: string): {
  plainText: string
  plan?: { intent: string; files: string[]; steps: { tool: string; action: string }[] }
} {
  if (!text) return { plainText: text }

  const match = text.match(/\[思考计划\]\s*([\s\S]*?)\s*\[\/思考计划\]/)
  if (!match) return { plainText: text }

  const planContent = match[1].trim()
  const plainText = text.replace(match[0], '').trim()

  // Extract user intent
  let intent = ''
  const intentMatch = planContent.match(/用户意图[：:]\s*(.+)/)
  if (intentMatch) intent = intentMatch[1].trim()

  // Extract file list
  const files: string[] = []
  const filesMatch = planContent.match(/涉及文件[：:]\s*(.+)/)
  if (filesMatch) {
    const raw = filesMatch[1].trim()
    if (raw !== '无' && raw !== '无。') {
      files.push(...raw.split(/[,，、\s]+/).map(f => f.trim()).filter(Boolean))
    }
  }

  // Extract numbered steps with tool names
  const steps: { tool: string; action: string }[] = []
  const stepBlock = planContent.match(/计划步骤[：:]\s*([\s\S]*)/)
  if (stepBlock) {
    const stepLines = stepBlock[1].split('\n')
    for (const line of stepLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Match "第N步: [tool] → action" or "N. [tool] → action"
      const stepMatch = trimmed.match(/第\s*(\d+)\s*步[：:]\s*\[(.*?)\]\s*[→>]\s*(.+)/)
      if (stepMatch) {
        steps.push({ tool: stepMatch[2].trim(), action: stepMatch[3].trim() })
        continue
      }
      // Fallback: match bare numbered line
      const bareMatch = trimmed.match(/^(\d+)[\.\)、]\s*(.+)/)
      if (bareMatch) {
        steps.push({ tool: '', action: bareMatch[2].trim() })
      }
    }
  }

  // If no structured steps found, store the raw plan content as one step
  if (steps.length === 0) {
    steps.push({ tool: '', action: planContent })
  }

  return { plainText, plan: { intent, files, steps } }
}
