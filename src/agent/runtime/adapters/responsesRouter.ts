// ── Responses API 路由决策（v14.8，v15.5 扩展） ──
// 单一决策源：agent 工具循环是否走 Responses API（服务端原生工具）。
// 两处路由（V4AgentChatBridge / createSubagentAdapter）共用，防止判定漂移。
//
// v15.5 扩展：OpenCode Go 端点 /zen/go/v1/responses（官方文档 2026-08 确认支持 GPT 5.6 Luna）。
// 判定两路：
//   A) DeepSeek V4 + 「原生联网」勾选（原逻辑）——web_search 服务端原生工具
//   B) OpenCode Go + 模型为 responses 端点模型（gpt-5.6-luna 等）——原生 responses 通道
//
// 实测（2026-08-02 真实 API 冒烟）：
// - DeepSeek /responses 支持 web_search 工具（服务端执行）、tool_choice:{type:'web_search'}
// - function 工具 auto 模式可用；thinking 模式下 tool_choice:{type:'function'} 被拒（400）
// - 多轮回传需全量 items（previous_response_id 不被支持）
// - v4-pro 尚未上线 Responses → 主进程 handler 捕获 UNSUPPORTED 自动降级 chat.completions

/** OpenCode Go 走 /v1/responses 端点的模型（官方 go.mdx Endpoints 表，2026-08：gpt-5.6-luna）——
 *  保守匹配 gpt- 前缀；OpenCode 未来若新增 o 系列推理模型再扩展 */
const OPENCODE_RESPONSES_MODELS = /^gpt-/i

export interface ResponsesRouterConfig {
  protocol?: string
  nativeWebSearch?: boolean
  model?: string
  apiUrl?: string
}

export function shouldUseResponses(config: ResponsesRouterConfig | undefined | null): boolean {
  if (!config) return false
  if (config.protocol === 'anthropic') return false
  const model = (config.model || '').trim().toLowerCase()
  const apiUrl = (config.apiUrl || '').toLowerCase()

  // 路 A：DeepSeek V4 + 原生联网 → Responses（服务端 web_search）
  if (config.nativeWebSearch && /deepseek/.test(model) && /v4/.test(model)) return true

  // 路 B：OpenCode Go 端点 + responses 模型（gpt-*）→ 原生 responses 通道
  // （OpenCode 官方：https://opencode.ai/zen/go/v1/responses 支持 gpt-5.6-luna）
  if (apiUrl.includes('opencode.ai') && OPENCODE_RESPONSES_MODELS.test(model)) return true

  return false
}
