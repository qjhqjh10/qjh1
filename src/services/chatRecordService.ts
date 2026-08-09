// ── 会话记录导出服务（v16）──
// 每个 AI 写作助手会话 → .appdata/chat-records/<会话名>/ 一个文件夹，内含：
//   conversation.json  — 完整对话流（消息/工具/usage/apiCallDetails）
//   api-calls.jsonl    — 每轮 API 明细（缓存命中率可算）
//   tools.jsonl        — 工具执行明细
//   summary.json       — 会话摘要（轮数/费用/缓存命中率/工具统计）
// 目的：用户把会话文件夹直接交给分析方（如 Claude），即可完整分析对话/工具/缓存。

import type { Conversation } from '@/components/ai/chat/types'

// 会话名清洗（Windows 非法字符 → 下划线，截断 40 字）
function sanitizeConvName(name: string): string {
  let s = String(name || '会话')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 40)
  if (!s) s = '会话'
  return s
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function fmtTs(ts?: number): string {
  if (!ts) return 'unknown'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

// 命中率计算（真实口径：read / (input + read)）
function hitRate(input: number, read: number): number {
  const total = input + read
  return total > 0 ? Math.round(read / total * 1000) / 10 : 0
}

// 导出单个会话到 .appdata/chat-records/<会话名>/
// 幂等：同会话重复导出覆盖同文件夹（会话名+首消息时间戳作目录名，保证唯一）
export async function exportConversationRecord(conv: Conversation): Promise<string | null> {
  try {
    const { fileService } = await import('@/services/fileService')
    const dir = await getRecordsDir()
    if (!dir) return null

    const firstTs = conv.messages.find(m => m.timestamp)?.timestamp || conv.createdAt || Date.now()
    const dirName = `${fmtTs(firstTs)}_${sanitizeConvName(conv.title)}`
    const convDir = `${dir}/${dirName}`
    await fileService.ensureDir(convDir)

    // ── 1. conversation.json — 完整对话流 ──
    await fileService.write(`${convDir}/conversation.json`, JSON.stringify(conv, null, 2))

    // ── 2. api-calls.jsonl — 每轮 API 明细（从消息的 apiCallDetails 汇总）──
    const apiLines: string[] = []
    for (const m of conv.messages) {
      const details = (m as any).apiCallDetails as Array<{
        iteration: number; inputTokens: number; outputTokens: number
        cacheReadTokens: number; cacheCreationTokens: number; durationMs: number
        toolCall: boolean; model: string; finishReason: string
      }> | undefined
      if (details && details.length > 0) {
        for (const d of details) {
          apiLines.push(JSON.stringify({
            messageId: m.id,
            time: m.timestamp,
            ...d,
            hitRate: hitRate(d.inputTokens, d.cacheReadTokens),
          }))
        }
      }
    }
    if (apiLines.length > 0) {
      await fileService.write(`${convDir}/api-calls.jsonl`, apiLines.join('\n') + '\n')
    }

    // ── 3. tools.jsonl — 工具执行明细 ──
    const toolLines: string[] = []
    for (const m of conv.messages) {
      const steps = (m as any).toolCallSteps as Array<{ tool: string; status: string; summary?: string; arguments?: string }> | undefined
      if (steps && steps.length > 0) {
        for (const s of steps) {
          toolLines.push(JSON.stringify({
            messageId: m.id,
            time: m.timestamp,
            tool: s.tool,
            status: s.status,
            summary: s.summary || '',
            arguments: s.arguments || '',
          }))
        }
      }
      if ((m as any).toolsUsed && (m as any).toolsUsed.length > 0) {
        for (const t of (m as any).toolsUsed) {
          toolLines.push(JSON.stringify({ messageId: m.id, time: m.timestamp, tool: t, status: 'used' }))
        }
      }
    }
    if (toolLines.length > 0) {
      await fileService.write(`${convDir}/tools.jsonl`, toolLines.join('\n') + '\n')
    }

    // ── 4. summary.json — 会话摘要 ──
    let totalInput = 0, totalOutput = 0, totalRead = 0, totalCreation = 0, totalCost = 0
    let apiCount = 0, toolCount = 0, durationSum = 0
    const toolStats: Record<string, number> = {}
    for (const m of conv.messages) {
      const u = m.usage
      if (u) {
        totalInput += u.prompt_tokens || 0
        totalOutput += u.completion_tokens || 0
        totalRead += u.cacheHitTokens || 0
        totalCreation += u.cacheCreationTokens || 0
        totalCost += u.cost || 0
      }
      const details = (m as any).apiCallDetails as Array<{ durationMs: number }> | undefined
      if (details) { apiCount += details.length; for (const d of details) durationSum += d.durationMs || 0 }
      const steps = (m as any).toolCallSteps as Array<{ tool: string }> | undefined
      if (steps) { toolCount += steps.length; for (const s of steps) toolStats[s.tool] = (toolStats[s.tool] || 0) + 1 }
      const used = (m as any).toolsUsed as string[] | undefined
      if (used) { for (const t of used) toolStats[t] = (toolStats[t] || 0) + 1 }
    }
    const summary = {
      conversationId: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      messageCount: conv.messages.length,
      userMessageCount: conv.messages.filter(m => m.role === 'user' && !(m as any).displayOnly).length,
      api: {
        callCount: apiCount,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheReadTokens: totalRead,
        totalCacheCreationTokens: totalCreation,
        cacheHitRate: hitRate(totalInput, totalRead),
        totalCost,
        avgDurationMs: apiCount > 0 ? Math.round(durationSum / apiCount) : 0,
      },
      tools: {
        callCount: toolCount,
        byName: toolStats,
      },
      generatedAt: Date.now(),
    }
    await fileService.write(`${convDir}/summary.json`, JSON.stringify(summary, null, 2))

    return convDir
  } catch (err) {
    console.warn('[ChatRecord] 导出会话记录失败:', err)
    return null
  }
}

// 记录目录（与 chat-conversations.json 同根 .appdata/chat-records/）
async function getRecordsDir(): Promise<string | null> {
  try {
    const { useStore } = await import('@/store')
    const base = useStore.getState().projectsBasePath
    if (base) {
      const appDir = base.replace(/[/\\]projects[/\\]?$/, '')
      if (appDir && appDir !== base) return appDir + '/.appdata/chat-records'
    }
  } catch {}
  try {
    const { appService } = await import('@/services/fileService')
    const base = await appService?.getProjectsBasePath?.()
    if (base) {
      const appDir = base.replace(/[/\\]projects[/\\]?$/, '')
      if (appDir && appDir !== base) return appDir + '/.appdata/chat-records'
    }
  } catch {}
  return null
}
