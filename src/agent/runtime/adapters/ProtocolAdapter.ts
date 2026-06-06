// ── Protocol Adapter Interface ──
// Abstraction over OpenAI vs Anthropic API differences.
// Runtime stores messages in canonical OpenAI format internally;
// the adapter converts at the API boundary via callModel().

import type { Message, ToolCallRequest } from '../../state/types'

/** Protocol capability flags — control runtime behavior differences. */
export interface ProtocolCapabilities {
  /** Whether to use progressive tool disclosure (core first, extended at iteration 3+). */
  progressiveDisclosure: boolean
  /** Whether iteration hints should be injected as role:'system' (splice) or role:'user' (push). */
  systemRoleHints: boolean
}

/** Canonical model response — protocol-agnostic. Runtime only sees this format. */
export interface NormalizedModelResponse {
  text: string
  toolCalls: ToolCallRequest[]
  finishReason: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  reasoningContent?: string
}

/** Protocol adapter — one implementation per API protocol. */
export interface ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities

  /** Make a model call. Adapter handles all format conversion internally. */
  callModel(params: {
    messages: Message[]
    tools: unknown[]
    configId: string
    projectId?: string
    signal: AbortSignal
  }): Promise<NormalizedModelResponse>

  /** Abort the current (streaming) API call. */
  abortStream(): void
}
