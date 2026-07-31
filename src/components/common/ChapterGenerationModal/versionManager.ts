import { fileService } from '@/services/fileService'
import type { VersionRecord } from './types'

export async function saveVersionRecord(projectPath: string, chapterId: string, record: VersionRecord) {
  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const version = { ...record, versionId: id }
  const dir = `${projectPath}/chapters/${chapterId}_versions`
  await fileService.ensureDir(dir)
  await fileService.write(`${dir}/${id}.json`, JSON.stringify(version, null, 2))
  return id
}
