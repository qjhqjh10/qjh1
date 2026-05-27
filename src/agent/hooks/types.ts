// ── Hook System Types ──

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionStop' | 'PreCompact'
export type HookKind = 'shell' | 'webhook'
export type FailureStrategy = 'warn' | 'block' | 'passthrough'

export interface HookContext {
  sessionId: string
  projectId: string | null
  configId: string
  timestamp: number
}

export interface PreToolUseContext extends HookContext {
  toolName: string
  toolArgs: Record<string, unknown>
}

export interface PostToolUseContext extends HookContext {
  toolName: string
  toolArgs: Record<string, unknown>
  toolResult: { status: string; summary: string; detail?: string }
}

export interface SessionStartContext extends HookContext {
  userMessage: string
  workMode: 'plan' | 'action'
}

export interface PreCompactContext extends HookContext {
  messageCount: number
  estimatedTokens: number
  contextWindow: number
}

export type HookContextMap = {
  PreToolUse: PreToolUseContext
  PostToolUse: PostToolUseContext
  SessionStart: SessionStartContext
  SessionStop: HookContext
  PreCompact: PreCompactContext
}

export interface HookDefinition {
  name: string
  event: HookEvent
  kind: HookKind
  command?: string
  webhookUrl?: string
  webhookMethod?: 'GET' | 'POST'
  onMatch?: string
  timeout: number
  failureStrategy: FailureStrategy
}

export interface HookResult {
  hookName: string
  event: HookEvent
  passed: boolean
  feedback: string
  stdout: string
  duration: number
}
