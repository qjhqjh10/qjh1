import { useState, useCallback } from 'react'
import { GCAgent } from '@/agent/gc/GCAgent'
import type { GCIssue, GCReport } from '@/agent/gc/GCAgent'
import { fileService } from '@/services/fileService'

const SEVERITY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)', label: '严重' },
  warn: { color: '#e67e00', bg: 'rgba(230,126,0,0.06)', label: '警告' },
  info: { color: '#2563eb', bg: 'rgba(37,99,235,0.06)', label: '信息' },
}

const TYPE_LABELS: Record<string, string> = {
  oversized_file: '超大文件',
  stale_reference: '过期引用',
  orphan_file: '孤儿文件',
  doc_drift: '文档漂移',
}

export function HealthSection() {
  const [report, setReport] = useState<GCReport | null>(null)
  const [scanning, setScanning] = useState(false)

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const gc = new GCAgent()
      gc.reset()

      // Scan known directories for oversized files
      const dirs = ['src/agent', 'src/components', 'src/services', 'electron']
      for (const dir of dirs) {
        try {
          const files = await fileService.listDir(dir)
          for (const f of files) {
            if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.json')) {
              try {
                const content = await fileService.read(`${dir}/${f}`)
                gc.scanOversized(`${dir}/${f}`, content)
              } catch { /* skip */ }
            }
          }
        } catch { /* dir not found */ }
      }

      // Check CLAUDE.md references
      try {
        const claude = await fileService.read('CLAUDE.md')
        const refs = claude.match(/`[^`]+`/g) || []
        for (const ref of refs) {
          const path = ref.replace(/`/g, '')
          if (path.includes('/') || path.includes('.')) {
            try {
              await fileService.read(path)
              gc.scanStaleReference(path, true)
            } catch {
              gc.scanStaleReference(path, false)
            }
          }
        }
      } catch { /* no CLAUDE.md */ }

      setReport(gc.generateReport())
    } catch { /* scan failed */ }
    setScanning(false)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Scan button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={runScan}
          disabled={scanning}
          style={{
            padding: '8px 20px', borderRadius: 10, border: 'none',
            background: scanning ? 'rgba(124,58,237,0.3)' : 'rgba(124,58,237,0.08)',
            color: scanning ? '#fff' : '#7c3aed',
            fontSize: 13, fontWeight: 600, cursor: scanning ? 'wait' : 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {scanning ? '扫描中...' : '扫描项目健康'}
        </button>
        {report && (
          <span style={{ fontSize: 12, color: '#6b5e54' }}>
            发现 {report.totalIssues} 个问题
          </span>
        )}
      </div>

      {/* Summary */}
      {report && report.totalIssues === 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.15)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>项目健康状态良好</span>
          <div style={{ fontSize: 12, color: '#6b5e54', marginTop: 2 }}>未发现超大文件、过期引用或孤儿文件</div>
        </div>
      )}

      {/* Issues list */}
      {report && report.issues.length > 0 && (
        <div className="custom-scrollbar" style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {report.issues.map((issue, i) => {
            const sev = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info
            return (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 10,
                background: sev.bg, border: `1px solid ${sev.color}20`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#fff',
                    background: sev.color, borderRadius: 4, padding: '1px 6px',
                  }}>
                    {sev.label}
                  </span>
                  <span style={{ fontSize: 11, color: '#9b8e84' }}>{TYPE_LABELS[issue.type] || issue.type}</span>
                </div>
                <div style={{ fontSize: 12, color: '#2d2520', fontWeight: 500, marginBottom: 2 }}>{issue.location}</div>
                <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.5 }}>{issue.description}</div>
                {issue.fixInstruction && (
                  <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 4, fontStyle: 'italic' }}>
                    修复建议: {issue.fixInstruction}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!report && !scanning && (
        <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
          点击"扫描项目健康"按钮，Agent 将检查项目中的超大文件、过期引用、孤儿文件和文档漂移等问题。
        </p>
      )}
    </div>
  )
}
