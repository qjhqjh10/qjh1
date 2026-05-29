import type { HookDefinition, HookEvent, HookResult, HookContextMap } from './types'

export class HookEngine {
  private hooks: HookDefinition[] = []
  private projectRoot = ''

  loadFromDefinitions(defs: HookDefinition[], projectRoot: string): void {
    this.hooks = [...defs]
    this.projectRoot = projectRoot
  }

  getHooks(): readonly HookDefinition[] {
    return this.hooks
  }

  async fire<E extends HookEvent>(event: E, context: HookContextMap[E]): Promise<HookResult[]> {
    const matched = this.hooks.filter(h => h.event === event)
    if (matched.length === 0) return []

    const results: HookResult[] = []

    for (const hook of matched) {
      // Filter by onMatch (tool name)
      if (hook.onMatch) {
        const ctx = context as { toolName?: string }
        if (ctx.toolName && ctx.toolName !== hook.onMatch) continue
      }

      const startTime = Date.now()
      let result: HookResult

      try {
        if (hook.kind === 'shell' && hook.command) {
          result = await this.executeShell(hook, context)
        } else if (hook.kind === 'webhook' && hook.webhookUrl) {
          result = await this.executeWebhook(hook, context)
        } else {
          result = { hookName: hook.name, event, passed: true, feedback: '', stdout: '', duration: 0 }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        result = {
          hookName: hook.name, event, passed: hook.failureStrategy !== 'block',
          feedback: `Hook 执行异常: ${msg}`, stdout: '', duration: Date.now() - startTime,
        }
      }

      result.duration = Date.now() - startTime
      results.push(result)

      // Stop chain on block
      if (!result.passed && hook.failureStrategy === 'block') break
    }

    return results
  }

  buildBlockingFeedback(results: HookResult[]): string {
    const blocked = results.filter(r => !r.passed)
    if (blocked.length === 0) return ''
    const lines = blocked.map(r => `[Hook 阻断: ${r.hookName}] ${r.feedback}`)
    return lines.join('\n')
  }

  private async executeShell(hook: HookDefinition, context: unknown): Promise<HookResult> {
    const ctxJson = JSON.stringify(context)

    // Try direct Node.js execution (works in both Electron and CLI)
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const scriptPath = join(this.projectRoot, '.aiharness', 'hooks', hook.command!)
      // Sanitize env: only pass safe system variables + hook context
      const safeEnv: Record<string, string> = {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || process.env.USERPROFILE || '',
        TEMP: process.env.TEMP || process.env.TMP || '/tmp',
        NODE_ENV: process.env.NODE_ENV || 'production',
        HOOK_CONTEXT: ctxJson,
      }
      return new Promise((resolve) => {
        execFile('node', [scriptPath], {
          env: safeEnv,
          timeout: hook.timeout,
          cwd: this.projectRoot,
        }, (err, stdout, stderr) => {
          // Exit code 2 = explicit block; any other non-zero = error (treated as block for safety)
          const exitCode = err?.code ?? 0
          const passed = exitCode === 0  // only exit code 0 is a pass
          resolve({
            hookName: hook.name, event: hook.event,
            passed,
            feedback: stderr || stdout || (err ? `Hook 脚本退出码: ${exitCode}` : ''),
            stdout: stdout || '',
            duration: 0,
          })
        })
      })
    } catch {
      return { hookName: hook.name, event: hook.event, passed: false, feedback: 'Hook 脚本执行失败', stdout: '', duration: 0 }
    }
  }

  private async executeWebhook(hook: HookDefinition, context: unknown): Promise<HookResult> {
    try {
      const res = await fetch(hook.webhookUrl!, {
        method: hook.webhookMethod || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(hook.timeout),
      })
      const text = await res.text()
      // 2xx = passed, 409 = explicit block, other non-2xx = failure
      const passed = res.status >= 200 && res.status < 300
      return {
        hookName: hook.name, event: hook.event,
        passed,
        feedback: passed ? text : `Webhook 返回 ${res.status}: ${text}`,
        stdout: '',
        duration: 0,
      }
    } catch (err) {
      return {
        hookName: hook.name, event: hook.event,
        passed: hook.failureStrategy !== 'block',
        feedback: `Webhook 失败: ${err instanceof Error ? err.message : 'Unknown'}`,
        stdout: '', duration: 0,
      }
    }
  }
}
