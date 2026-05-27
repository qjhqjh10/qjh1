// ── AiHarness Declarative Configuration System ──
// 3-layer merge: built-in defaults < user ~/.aiharness.json < project .aiharness/aiharness.json

export interface PermissionPolicy {
  id: string
  effect: 'allow' | 'deny' | 'ask'
  toolName: string | '*'
  pathPattern?: string            // glob: 'notes/**', '*.json'
  operation?: 'read' | 'write' | 'delete' | 'execute'
  conditions?: {
    workMode?: 'plan' | 'action'
    maxTokensPerSession?: number
  }
  autoApproveReason?: string
}

export interface HookDefinition {
  name: string
  event: 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionStop' | 'PreCompact'
  kind: 'shell' | 'webhook'
  command?: string      // shell: relative path in .aiharness/hooks/
  webhookUrl?: string
  webhookMethod?: 'GET' | 'POST'
  onMatch?: string      // tool name filter for Pre/PostToolUse
  timeout: number       // ms, default 10000
  failureStrategy: 'warn' | 'block' | 'passthrough'
}

export interface ParamConstraints {
  [paramName: string]: {
    must_start_with?: string[]
    must_not_contain?: string[]
    blocklist?: string[]
    must_not_match?: string[]
    max_items?: number
    max_length?: number
  }
}

export interface EvaluatorThreshold {
  dimension: string        // 'correctness' | 'quality' | 'architecture' | 'security'
  enabled: boolean
  passThreshold: number   // 0.0 - 1.0
}

export interface AiHarnessConfig {
  version: '1.0'
  permissions: {
    defaultEffect: 'deny' | 'allow'
    policies: PermissionPolicy[]
  }
  hooks: HookDefinition[]
  budget: {
    maxTokensPerSession: number
    compressThresholds: number[]  // [50, 60, 70, 85, 95] percent
  }
  evaluators: EvaluatorThreshold[]
  constraints: {
    enabled: boolean
    fileSizeLimit: number
    enforceNamingConvention: boolean
    enforceDependencyDirection: boolean
    jsonSchemaValidation: boolean
    enforceNoEmptyFiles: boolean
    enforceNoDuplicateCreate: boolean
  }
  tools: {
    enabledTools?: string[]
    disabledTools?: string[]
    constraints: Record<string, ParamConstraints>
  }
  circuitBreaker: {
    maxConsecutiveFailures: number
    cooldownMs: number
    maxTokenRatePerMinute?: number
  }
  durableExecution: {
    enabled: boolean
    maxCheckpoints: number
    autoCheckpointOn: string[]
    idempotentRetry: {
      enabled: boolean
      maxRetries: number
      baseDelayMs: number
    }
  }
}

// ── Default config ──

export const DEFAULT_CONFIG: AiHarnessConfig = {
  version: '1.0',
  permissions: {
    defaultEffect: 'allow',   // backward-compatible: allow-by-default
    policies: [],
  },
  hooks: [],
  budget: {
    maxTokensPerSession: 500000,
    compressThresholds: [50, 60, 70, 85, 95],
  },
  evaluators: [],
  constraints: {
    enabled: true,
    fileSizeLimit: 500,
    enforceNamingConvention: true,
    enforceDependencyDirection: false,
    jsonSchemaValidation: true,
    enforceNoEmptyFiles: true,
    enforceNoDuplicateCreate: true,
  },
  tools: {
    constraints: {},
  },
  circuitBreaker: {
    maxConsecutiveFailures: 5,
    cooldownMs: 30000,
  },
  durableExecution: {
    enabled: false,
    maxCheckpoints: 50,
    autoCheckpointOn: ['CALLING_API', 'EXECUTING', 'ERROR'],
    idempotentRetry: {
      enabled: false,
      maxRetries: 3,
      baseDelayMs: 100,
    },
  },
}

// ── Deep merge utility ──

function deepMerge<T extends Record<string, unknown>>(base: T, override: T): T {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const bv = (result as Record<string, unknown>)[key]
    const ov = (override as Record<string, unknown>)[key]
    if (typeof bv === 'object' && bv !== null && !Array.isArray(bv)
      && typeof ov === 'object' && ov !== null && !Array.isArray(ov)) {
      (result as Record<string, unknown>)[key] = deepMerge(
        bv as Record<string, unknown>, ov as Record<string, unknown>,
      )
    } else {
      (result as Record<string, unknown>)[key] = ov
    }
  }
  return result
}

// ── Loader ──

export class AiHarnessConfigLoader {
  private projectRoot: string
  private userHome: string

  constructor(projectRoot: string, userHome: string) {
    this.projectRoot = projectRoot
    this.userHome = userHome
  }

  async load(): Promise<AiHarnessConfig> {
    let config = { ...DEFAULT_CONFIG }

    // Layer 1: user-level ~/.aiharness.json
    try {
      const userPath = `${this.userHome}/.aiharness.json`
      const userRaw = await this.readFile(userPath)
      if (userRaw) {
        config = deepMerge(config, JSON.parse(userRaw))
      }
    } catch { /* optional */ }

    // Layer 2: project-level .aiharness/aiharness.json
    try {
      const projPath = `${this.projectRoot}/.aiharness/aiharness.json`
      const projRaw = await this.readFile(projPath)
      if (projRaw) {
        config = deepMerge(config, JSON.parse(projRaw))
      }
    } catch { /* optional */ }

    return config
  }

  async loadProjectRules(): Promise<string[]> {
    const rules: string[] = []
    try {
      const { readdir } = await import('fs/promises')
      const { join } = await import('path')
      const dir = join(this.projectRoot, '.aiharness', 'rules')
      const files = await readdir(dir)
      for (const f of files) {
        if (f.endsWith('.md')) {
          const content = await this.readFile(join(dir, f))
          if (content) rules.push(content)
        }
      }
    } catch { /* optional */ }
    return rules
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      // Try Electron IPC first (renderer context)
      const { fileService } = await import('@/services/fileService')
      return await fileService.read(filePath)
    } catch {
      // Fallback: direct Node.js read (CLI / main process)
      try {
        const { readFile } = await import('fs/promises')
        return await readFile(filePath, 'utf-8')
      } catch {
        return null
      }
    }
  }
}
