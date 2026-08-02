// ── Subagent Tools (v15) ──
// analyze_file / edit_file_task：主 agent 委托子 agent（独立上下文窗口）处理大文件。
// 仿 analyze_text_style 的"executor 内嵌子任务"模式——此处子任务是一个独立 V4UnifiedRuntime。
// 上下文隔离：子 agent 的 messagesForApi 不进入主 agent 上下文，只返回结构化 detail + subAgentUsage。

import type { ToolDefinition, ToolResult } from '../types'

// v14.8: 惰性化重构 — 不再顶层 import SubagentService（其链会经 V4UnifiedRuntime 拉到 @/store 的
// zustand persist，Node 环境（scripts/export-tool-schemas.ts 等）下无 localStorage 导致挂起。
// executor 内 await import + promise 缓存（与下方 getSettingsStore 同款，兼容 vitest 并发 mock）。

let subagentServicePromise: Promise<typeof import('../../subagent/SubagentService')> | null = null
function getSubagentService(): Promise<typeof import('../../subagent/SubagentService')> {
  if (!subagentServicePromise) subagentServicePromise = import('../../subagent/SubagentService')
  return subagentServicePromise
}

/**
 * v14.8: 本地镜像（原 re-export 自 SubagentService — 重构后不再触发其模块求值）。
 * 与 SubagentService.ts 的 SUBAGENT_TOOL_NAMES 保持一致；另有 ToolExecutor.ts 的
 * SUBAGENT_TOOL_NAMES_LOCAL 同源，三处变更需同步。
 */
export const SUBAGENT_TOOL_NAMES = new Set(['analyze_file', 'edit_file_task', 'verify_task', 'subagent_ask', 'kb_analyze'])  // v14.8: +kb_analyze

/** detail 回灌主上下文的截断上限（防撑爆）— v14.3: 随子代理输出上限放宽（2500/1200 字）提升 */
const MAX_DETAIL_CHARS: Record<string, number> = {
  analyze_file: 8000,
  edit_file_task: 4000,
  verify_task: 8000,
  subagent_ask: 8000,
}

/**
 * v14.5.0: 从文本提取首个配对括号包裹的 JSON 对象。
 * 原贪婪正则 /\{[\s\S]*\}/ 会把 JSON 之后散文中的 {} 吞入导致 JSON.parse 失败。
 * 注意：调用方（SubagentService 拼接）承诺 detail/summary 不含 {}，保持约束不变。
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * v14.2.1: 共享 store 模块（promise 缓存）— 并行委托时多个 executor 并发执行，
 * 若各自 `await import('@/store')`，vitest 的 mock 解析器在并发动态 import 下
 * 会返回原始模块（activeConfigId=null → 误报"未配置AI"）；promise 缓存让所有
 * 并发调用复用同一次 import。生产 ESM 无此竞态，但缓存同样减少重复解析。
 */
let settingsStorePromise: Promise<typeof import('@/store')> | null = null
function getSettingsStore(): Promise<typeof import('@/store')> {
  if (!settingsStorePromise) settingsStorePromise = import('@/store')
  return settingsStorePromise
}

function buildTaskMessage(
  toolName: string,
  filePath: string,
  extra: string,
): string {
  const lines = [
    `任务文件: ${filePath}`,
    extra,
  ]
  if (toolName === 'analyze_file') {
    lines.push('请读取该文件并按要求输出结构化分析摘要。')
  } else {
    lines.push('请按上述指令精确定位并修改该文件，输出修改前后摘要。')
  }
  return lines.join('\n')
}

export const subagentTools: ToolDefinition[] = [
  {
    schema: {
      name: 'analyze_file',
      description:
        '委托子分析代理（独立上下文窗口）读取文件并输出结构化分析摘要。' +
        '适用于大文件（超过2万字符）或需要深入分析的文件内容——子代理读取全文但只把摘要返回给你，不占用你的上下文。' +
        '小文件请直接 read_file，不要使用本工具。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要分析的文件路径（相对路径）' },
          question: { type: 'string', description: '分析问题（可选，不传则输出通用结构摘要）' },
        },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      const question = String(args.question || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }

      try {
        const { useSettingsStore } = await getSettingsStore()
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const taskMessage = buildTaskMessage(
          'analyze_file', filePath,
          question ? `分析问题: ${question}` : '分析问题: 请输出文件的整体结构、核心内容与亮点。',
        )
        // v14.3: 委托成功后保存会话（供 subagent_ask 追问复用，避免重复读取大文件）
        const { runSubagent } = await getSubagentService()
        const result = await runSubagent({
          role: 'analyze',
          projectId: ctx.projectId,
          configId,
          userMessage: taskMessage,
          signal: ctx.signal,
          sessionKey: `${ctx.projectId ?? 'global'}::${filePath}`,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success ? `子代理分析完成: ${filePath}` : `子代理分析失败: ${filePath}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS.analyze_file),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `子代理分析异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
  {
    schema: {
      name: 'edit_file_task',
      description:
        '委托子编辑代理（独立上下文窗口）对长文件执行精确修改。' +
        '子代理定位目标区域、执行修改并返回修改前后摘要，不占用你的上下文。' +
        '适用于大文件（超过2万字符）或需要多处修改的长文件。小文件请直接 edit_file/batch_replace。' +
        '子代理只改指令要求的部分，不删除/重命名文件。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要修改的文件路径（相对路径）' },
          instruction: { type: 'string', description: '修改指令（要改什么、改成什么，尽量具体）' },
        },
        required: ['file_path', 'instruction'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      const instruction = String(args.instruction || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }
      if (!instruction) return { status: 'error', summary: 'instruction 为空' }

      try {
        const { useSettingsStore } = await getSettingsStore()
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const taskMessage = buildTaskMessage('edit_file_task', filePath, `修改指令: ${instruction}`)
        // v14.3: 委托成功后保存会话（供 subagent_ask 追问复用）
        const { runSubagent } = await getSubagentService()
        const result = await runSubagent({
          role: 'edit',
          projectId: ctx.projectId,
          configId,
          userMessage: taskMessage,
          signal: ctx.signal,
          sessionKey: `${ctx.projectId ?? 'global'}::${filePath}`,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success ? `子代理修改完成: ${filePath}` : `子代理修改失败: ${filePath}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS.edit_file_task),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `子代理修改异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
  {
    schema: {
      name: 'verify_task',
      description:
        '委托验收子代理（独立上下文窗口）对照验收标准逐项检查产物文件，返回结构化判定。' +
        '验收子代理只读文件、不修改，逐条核实"标准是否满足"，产出 {passed, items:[{criterion, passed, reason}]}。' +
        '适合在任务清单完成后自我验收产物质量（文件存在、关键内容、格式），验收失败可据 items 修复。',
      parameters: {
        type: 'object',
        properties: {
          file_paths: {
            type: 'array',
            items: { type: 'string' },
            description: '要验收的文件路径清单（相对路径），逐文件读取核对',
          },
          criteria: {
            type: 'array',
            items: { type: 'string' },
            description: '验收标准清单，每条一个明确可验证的要求（如"角色卡必须含姓名、性格字段"）',
          },
        },
        required: ['file_paths', 'criteria'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePaths = Array.isArray(args.file_paths) ? args.file_paths.map(String).filter(Boolean) : []
      const criteria = Array.isArray(args.criteria) ? args.criteria.map(String).filter(Boolean) : []
      if (filePaths.length === 0) return { status: 'error', summary: 'file_paths 为空' }
      if (criteria.length === 0) return { status: 'error', summary: 'criteria 为空' }

      try {
        const { useSettingsStore } = await getSettingsStore()
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const lines = [
          '验收文件清单（逐个读取核对）:',
          ...filePaths.map(p => `- ${p}`),
          '',
          '验收标准清单（逐条判定通过/不通过）:',
          ...criteria.map((c, i) => `${i + 1}. ${c}`),
        ]
        // v14.3: 会话 key 以首个文件为准（多文件验收以清单为准，追问按首文件复用）
        const { runSubagent } = await getSubagentService()
        const result = await runSubagent({
          role: 'verify',
          projectId: ctx.projectId,
          configId,
          userMessage: lines.join('\n'),
          signal: ctx.signal,
          sessionKey: `${ctx.projectId ?? 'global'}::${filePaths[0] ?? ''}`,
        })

        // 尝试解析 JSON 验收报告 → 结构化 detail（主 agent 可直接读 passed/items）
        // v14.3: 同时解析 passed 判定 → summary 三态（通过/未通过/中性），
        // 运行时据"验收未通过"字样识别验收失败并督促修复（错误路径保留"验收失败"文案，刻意区分）
        let detail = result.text.slice(0, MAX_DETAIL_CHARS.verify_task)
        let passed: boolean | null = null
        let failedCount = 0
        if (result.success) {
          // v14.5.0: 贪婪正则 /\{[\s\S]*\}/ 会吞入 JSON 尾部散文中的 {} → parse 失败静默降级。
          // 改为配对括号提取（首个 { 到与之配对的 }），嵌套结构正确截取。
          const jsonText = extractJsonObject(result.text)
          if (jsonText) {
            try {
              const parsed = JSON.parse(jsonText)
              if (parsed && typeof parsed.passed === 'boolean') {
                passed = parsed.passed
                failedCount = (parsed.items || []).filter((i: { passed?: boolean }) => i.passed === false).length
                detail = JSON.stringify({ passed: parsed.passed, items: (parsed.items || []).slice(0, 20) })
              }
            } catch { /* 坏 JSON → 走关键词降级 */ }
          }
          // 解析失败降级：关键词判定保留（与运行时 summary 关键词扫描一致，"验收未通过"触发修复督促闭环）
          if (passed === null) {
            if (/验收未通过|未通过/.test(result.text)) {
              passed = false
            } else if (/验收通过|全部满足/.test(result.text)) {
              passed = true
            }
          }
        }

        let summary: string
        if (result.success) {
          if (passed === true) {
            summary = `验收通过: ${criteria.length} 条标准全部满足`
          } else if (passed === false) {
            summary = `验收未通过: ${failedCount}/${criteria.length} 条标准未满足`
          } else {
            summary = `验收完成: ${filePaths.length} 个文件 × ${criteria.length} 条标准`
          }
        } else {
          summary = `验收失败: ${filePaths.join('、')}`
        }

        return {
          status: result.success ? 'success' : 'error',
          summary,
          detail,
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `验收子代理异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
  {
    schema: {
      name: 'subagent_ask',
      description:
        '追问子分析代理：复用该文件上次 analyze_file 委托建立的会话上下文（edit_file_task/verify_task 建立的会话不可追问，会退化为全新分析），' +
        '无需重新读取文件即可补充细节、追问结论。若该文件尚无 analyze_file 会话，则与 analyze_file 相同执行全新分析。' +
        '适用于大文件（超过2万字符）分析后的细节追问。注意：会话上下文基于之前的文件版本，文件可能已修改。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要追问的文件路径（相对路径，须与之前委托时一致）' },
          question: { type: 'string', description: '追问问题（具体细节、原文片段、结论补充等）' },
        },
        required: ['file_path', 'question'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    executor: async (args: Record<string, unknown>, ctx): Promise<ToolResult> => {
      const filePath = String(args.file_path || '').trim()
      const question = String(args.question || '').trim()
      if (!filePath) return { status: 'error', summary: 'file_path 为空' }
      if (!question) return { status: 'error', summary: 'question 为空' }

      try {
        const { useSettingsStore } = await getSettingsStore()
        const configId = useSettingsStore.getState().activeConfigId
        if (!configId) return { status: 'error', summary: '未配置AI' }

        const sessionKey = `${ctx.projectId ?? 'global'}::${filePath}`
        const taskMessage = [
          `任务文件: ${filePath}`,
          `追问: ${question}`,
          '（上下文基于该文件的之前分析，文件可能已修改——若内容与问题不符，请重新读取相关部分）',
          '请结合已有上下文回答追问，输出结构化分析摘要。',
        ].join('\n')
        const { runSubagent } = await getSubagentService()
        const result = await runSubagent({
          role: 'analyze',
          projectId: ctx.projectId,
          configId,
          userMessage: taskMessage,
          signal: ctx.signal,
          sessionKey,
        })

        return {
          status: result.success ? 'success' : 'error',
          summary: result.success ? `子代理追问完成: ${filePath}` : `子代理追问失败: ${filePath}`,
          detail: result.text.slice(0, MAX_DETAIL_CHARS.subagent_ask),
          subAgentUsage: result.usage,
        }
      } catch (e) {
        return { status: 'error', summary: `子代理追问异常: ${e instanceof Error ? e.message : '未知'}` }
      }
    },
  },
]
