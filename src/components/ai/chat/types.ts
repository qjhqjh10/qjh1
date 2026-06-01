export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
  wordCount?: number
  insertion?: { keyword: string; position: 'before' | 'after'; content: string; mode?: 'insert' | 'rewrite' }
  sources?: { kb: { fileName: string; score: number }[]; web: { title: string; url: string }[] }
  tool_call_id?: string
  toolName?: string
  tool_calls?: Array<{
    id: string
    function: { name: string; arguments: string }
  }>
  images?: string[]
  compressedSummary?: boolean
  compressedCount?: number
  compressedTokens?: number
  breakdown?: { label: string; chars: number }[]
  hallucinationWarning?: string
  toolsUsed?: string[]
  thinkingPlan?: { intent: string; files: string[]; steps: { tool: string; action: string }[] }
  reasoningContent?: string
  outputBreakdown?: { label: string; tokens: number }[]
  iterationCount?: number
  totalIterations?: number
  /** V9.5.2: 软件功能/能力自述消息 — 仅显示，不进入对话上下文 */
  displayOnly?: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  totalTokens: number
  lastPromptTokens: number
  peakPromptTokens: number
}
