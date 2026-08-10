// ── Responses API 消息转换器（v14.8） ──
// 纯函数：canonical OpenAI 格式消息（runtime messagesForApi）→ Responses API items。
// 仅主进程使用（electron-vite 主进程 bundle 不能拉渲染层依赖——本文件零外部依赖）。
//
// 实测约束（2026-08-02 真实 API 冒烟）：
// - function_call_output.call_id 必须匹配对应 function_call item 的 call_id（不是 item id）
// - 历史轮次用全量 items 回传（previous_response_id 不被 DeepSeek 支持）
// - 无对应 function_call 的孤儿 tool 消息（M11 跨 run 还原的 hist_ 消息）转文本 user 保内容可见
//   （v16.0.3 起；不能作为 function_call_output 发送——Responses 对孤儿 function_call_output 400，
//    也不能丢弃——与 Anthropic 路径 F1 行为对齐，模型跨 run 续跑时能看到历史工具结果）
// - 历史 reasoning 不回传（每轮重新生成；thinking 输入无增益）
// - chat/completions 工具定义里的 cache_control 需剥离（responses 无此字段）

export interface ConverterMessage {
  role: string
  content: string | unknown
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface ResponseItem {
  type: string
  role?: string
  content?: Array<Record<string, unknown>>
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  [key: string]: unknown
}

function toTextItem(role: 'system' | 'user', text: string): ResponseItem {
  return { type: 'message', role, content: [{ type: 'input_text', text }] }
}

/**
 * canonical OpenAI 消息 → Responses items。
 * 规则：
 * 1. system/user → message item（input_text）
 * 2. assistant 纯文本 → message item；带 tool_calls → message + 每条 function_call item
 *    （call_id = 原 tc.id，function_call_output 同 id 回传）
 * 3. tool 消息 → function_call_output（call_id = tool_call_id；孤儿转文本 user 保内容可见）
 * 4. 连续同角色 user/system 消息不合并（Responses 对相邻同角色容忍度高于 chat completions，
 *    实测可直接发送；若遇 400 再在 converter 内合并）
 */
export function convertMessages(messages: ConverterMessage[]): ResponseItem[] {
  const items: ResponseItem[] = []
  // 收集历史 assistant 消息中出现的 function_call id（判孤儿 tool）
  const knownCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc && tc.id) knownCallIds.add(tc.id)
      }
    }
  }

  // v14.9(E): Responses 语义要求 system message 位于 input 开头——runtime 每轮注入的
  // [当前任务]/[任务边界]/[验收提示] 等 system 消息位于中段，中段 system 降级为 user 防 400
  let systemSeen = false
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ''
    if (m.role === 'system') {
      if (content) {
        items.push(toTextItem(systemSeen ? 'user' : 'system', content))
        systemSeen = true
      }
    } else if (m.role === 'user') {
      items.push(toTextItem('user', content))
    } else if (m.role === 'assistant') {
      const hasCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0
      if (content && !hasCalls) {
        // 纯文本 assistant（工具轮之间的说明/最终回答）
        items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] })
      } else if (hasCalls) {
        if (content) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] })
        for (const tc of m.tool_calls!) {
          items.push({
            type: 'function_call',
            // 实测：必须携带 call_id（= 原 tool_call id）；不带 id 字段亦可（服务端自行生成 item id）
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })
        }
      }
      // 历史 reasoning 不回传（每轮重新生成）
    } else if (m.role === 'tool') {
      if (!m.tool_call_id || !knownCallIds.has(m.tool_call_id)) {
        // v16.0.3(审查修复): 孤儿 tool 消息（M11 跨 run 还原的 hist_ 消息，无前置 assistant.tool_calls
        // 配对）——不能丢弃：Anthropic 路径已转 text 块保内容可见（F1），此处对齐。
        // 转 user 消息保内容可见（丢弃会让模型看不到历史工具结果，协议间行为不对称）。
        // 不能作为 function_call_output 发送（Responses 对孤儿 function_call_output 400）。
        const text = typeof m.content === 'string' ? m.content : ''
        let snippet = text
        try {
          const parsed = JSON.parse(text)
          const summary = parsed.summary || ''
          const detail = parsed.detail || ''
          snippet = `[历史工具结果${summary ? ` ${summary}` : ''}]\n${typeof detail === 'string' ? detail.slice(0, 500) : ''}`
        } catch { /* 非 JSON，保留原文 */ }
        if (snippet) items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: snippet.slice(0, 500) }] })
        continue
      }
      items.push({ type: 'function_call_output', call_id: m.tool_call_id, output: content })
    }
  }
  return items
}

/**
 * chat/completions 工具定义 → Responses tools。
 * - 剥离 cache_control（responses 无此前缀缓存字段，服务端自动缓存）
 * - function 工具 → {type:'function', name, description, parameters}
 * - nativeWebSearch 时追加 {type:'web_search'}（DeepSeek 实测支持 search_context_size）
 */
export function convertTools(tools: unknown[], nativeWebSearch: boolean): ResponseItem[] {
  const out: ResponseItem[] = []
  for (const raw of tools as Array<Record<string, unknown>>) {
    const fn = (raw?.function || raw) as Record<string, unknown> | undefined
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue
    out.push({
      type: 'function',
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: (fn.parameters as Record<string, unknown>) || { type: 'object', properties: {} },
    })
  }
  if (nativeWebSearch) {
    out.push({ type: 'web_search', search_context_size: 'high' })
  }
  return out
}

/**
 * Responses 输出 items → 工具调用列表（adapter 归一化用）。
 * function_call item 的 call_id 即工具调用 id（chat completions 语义对齐）。
 * 注：生产路径（ai:responses-chat）在流式聚合时直接收集 function_call，此函数供单测覆盖
 * 与防御性使用（v14.8 审查保留——逻辑与流式收集完全一致，避免双实现漂移）。
 */
export function collectFunctionCalls(output: ResponseItem[]): Array<{ id: string; name: string; arguments: string }> {
  const calls: Array<{ id: string; name: string; arguments: string }> = []
  for (const item of output) {
    if (item.type !== 'function_call') continue
    const id = typeof item.call_id === 'string' ? item.call_id : ''
    const name = typeof item.name === 'string' ? item.name : ''
    const args = typeof item.arguments === 'string' ? item.arguments : ''
    if (id && name) calls.push({ id, name, arguments: args })
  }
  return calls
}
