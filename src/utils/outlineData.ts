import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'

export async function loadOutlineData<T>(projectPath: string, filename: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fileService.read(`${projectPath}/outline/${filename}`)
    if (raw) return JSON.parse(raw) as T
  } catch { /* file doesn't exist yet */ }
  return defaultValue
}

export async function saveOutlineData<T>(projectPath: string, filename: string, data: T): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(`${projectPath}/outline/${filename}`, JSON.stringify(data, null, 2))
  } catch (err) {
    logError(`Failed to save outline data: ${filename}`, err)
  }
}
