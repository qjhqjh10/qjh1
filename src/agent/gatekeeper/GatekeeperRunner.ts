// ── Gatekeeper Runner ──
// Runs hard verification scripts after agent completion.
// Produces binary pass/fail. Fail → inject feedback + one correction attempt.

export interface GatekeeperResult {
  script: string
  passed: boolean
  output: string
  duration: number
}

export class GatekeeperRunner {
  private scripts: string[] = []
  private projectRoot = ''

  loadScripts(scripts: string[], projectRoot: string): void {
    this.scripts = scripts
    this.projectRoot = projectRoot
  }

  async run(context: Record<string, unknown>): Promise<GatekeeperResult[]> {
    const results: GatekeeperResult[] = []
    for (const script of this.scripts) {
      const start = Date.now()
      try {
        const { execFile } = await import('child_process')
        const { join } = await import('path')
        const scriptPath = join(this.projectRoot, '.aiharness', 'evaluators', script)
        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
          execFile('node', [scriptPath], {
            env: { ...process.env, GATEKEEPER_CONTEXT: JSON.stringify(context) },
            timeout: 30000,
            cwd: this.projectRoot,
          }, (err, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? (err as any).code || 1 : 0 })
          })
        })
        results.push({
          script, passed: result.exitCode === 0,
          output: result.stderr || result.stdout,
          duration: Date.now() - start,
        })
      } catch {
        results.push({ script, passed: false, output: 'Gatekeeper 执行异常', duration: Date.now() - start })
      }
    }
    return results
  }

  buildFeedback(results: GatekeeperResult[]): string {
    const failed = results.filter(r => !r.passed)
    if (failed.length === 0) return ''
    return ['[Gatekeeper 验证未通过]', ...failed.map(r => `- ${r.script}: ${r.output}`)].join('\n')
  }
}
