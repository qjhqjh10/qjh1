import { fileService } from '@/services/fileService'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'

export async function loadVersionHistory(projectPath: string, chapterId: string): Promise<VersionRecord[]> {
  try {
    const dir = `${projectPath}/chapters/${chapterId}_versions`
    const files = await fileService.listDir(dir)
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    const versions: VersionRecord[] = []
    for (const f of jsonFiles) {
      try {
        const raw = await fileService.read(`${dir}/${f}`)
        versions.push(JSON.parse(raw))
      } catch { /* skip malformed */ }
    }
    return versions.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
  } catch { return [] }
}

export function templateStyle(selected: boolean, enabled?: boolean) {
  return {
    padding: 12, borderRadius: 12, cursor: 'pointer',
    background: selected ? '#f5f3ff' : '#faf9f8',
    border: selected ? '2px solid rgba(124,58,237,0.25)' : enabled ? '1px solid rgba(124,58,237,0.12)' : '1px solid rgba(0,0,0,0.04)',
    transition: 'all 0.15s ease',
  }
}
