// ── Credential Broker ──
// Agents receive capability handles instead of real credentials.
// Handles are scoped: tool, path, operation count, session lifetime.

export interface CapabilityHandle {
  id: string
  sessionId: string
  issuedAt: number
  expiresAt: number     // session end or max duration
  scopes: CapabilityScope[]
}

export interface CapabilityScope {
  tool: string
  pathPrefix?: string
  operation?: 'read' | 'write' | 'delete' | 'execute'
  maxOps?: number
}

export interface DelegationEntry {
  from: string         // 'user' | 'agent' | 'subagent:{name}'
  to: string
  handleId: string
  timestamp: number
}

export class CredentialBroker {
  private handles = new Map<string, CapabilityHandle>()
  private delegationChain: DelegationEntry[] = []

  issue(sessionId: string, scopes: CapabilityScope[], maxDurationMs = 3600000): CapabilityHandle {
    const handle: CapabilityHandle = {
      id: `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId, issuedAt: Date.now(),
      expiresAt: Date.now() + maxDurationMs,
      scopes,
    }
    this.handles.set(handle.id, handle)
    return handle
  }

  verify(handleId: string, toolName: string, filePath?: string): { valid: boolean; reason?: string } {
    const handle = this.handles.get(handleId)
    if (!handle) return { valid: false, reason: '能力句柄不存在' }
    if (Date.now() > handle.expiresAt) return { valid: false, reason: '能力句柄已过期' }

    const matchingScope = handle.scopes.find(s =>
      s.tool === toolName || s.tool === '*'
    )
    if (!matchingScope) return { valid: false, reason: `句柄不覆盖工具: ${toolName}` }

    if (matchingScope.pathPrefix && filePath && !filePath.startsWith(matchingScope.pathPrefix)) {
      return { valid: false, reason: `路径不在句柄范围内: ${filePath}` }
    }

    return { valid: true }
  }

  revoke(handleId: string): void {
    this.handles.delete(handleId)
  }

  revokeSession(sessionId: string): void {
    for (const [id, h] of this.handles) {
      if (h.sessionId === sessionId) this.handles.delete(id)
    }
  }

  recordDelegation(from: string, to: string, handleId: string): void {
    this.delegationChain.push({ from, to, handleId, timestamp: Date.now() })
  }

  getDelegationChain(): DelegationEntry[] {
    return [...this.delegationChain]
  }

  get activeHandles(): number {
    return this.handles.size
  }
}
