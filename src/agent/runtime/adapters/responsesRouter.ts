// ── Responses API 路由决策（v14.8） ──
// 单一决策源：模型配置勾选「原生联网搜索」且为 DeepSeek V4 系列时，agent 工具循环走
// Responses API（服务端 web_search 原生工具）。两处路由（V4AgentChatBridge /
// createSubagentAdapter）共用，防止判定漂移。
//
// 实测（2026-08-02 真实 API 冒烟）：
// - DeepSeek /responses 支持 web_search 工具（服务端执行）、tool_choice:{type:'web_search'}
// - function 工具 auto 模式可用；thinking 模式下 tool_choice:{type:'function'} 被拒（400）
// - 多轮回传需全量 items（previous_response_id 不被支持）
// - v4-pro 尚未上线 Responses → 主进程 handler 捕获 UNSUPPORTED 自动降级 chat.completions

export interface ResponsesRouterConfig {
  protocol?: string
  nativeWebSearch?: boolean
  model?: string
}

export function shouldUseResponses(config: ResponsesRouterConfig | undefined | null): boolean {
  if (!config) return false
  if (config.protocol === 'anthropic') return false
  if (!config.nativeWebSearch) return false
  if (!/deepseek/i.test(config.model || '')) return false
  if (!/v4/i.test(config.model || '')) return false
  return true
}
