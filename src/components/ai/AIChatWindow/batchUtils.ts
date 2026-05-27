import type { ToolCallArgs } from '@/types/fileOps'

export const PROJECT_DIR_PREFIXES = ['outline/', 'detailed_outline/', 'characters/', 'chapters/', 'summaries/']

export function isProjectFilePath(p: string): boolean {
  if (!p) return false
  const clean = p.replace(/\\/g, '/')
  return PROJECT_DIR_PREFIXES.some(prefix => clean.startsWith(prefix))
}

export function checkBatch(toolCalls: any[], rawArgs: Record<string, unknown>[]): {
  needsApproval: boolean
  summary: { reads: string[]; writes: string[]; creates: string[]; deletes: string[]; lists: string[]; settings: string[]; templates: string[]; images: string[] }
  previews: { editDiffs: Array<{ path: string; old: string; new: string }>; createPreviews: Array<{ path: string; content: string }> }
} {
  let readCount = 0, hasProjectFile = false
  const reads: string[] = [], writes: string[] = [], creates: string[] = [], deletes: string[] = [], lists: string[] = []
  const settings: string[] = [], templates: string[] = [], images: string[] = []
  const editDiffs: Array<{ path: string; old: string; new: string }> = []
  const createPreviews: Array<{ path: string; content: string }> = []

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    const args = rawArgs[i] || {}
    const fp = (args.file_path as string || '').replace(/\\/g, '/')
    const dp = (args.dir_path as string || '').replace(/\\/g, '/')
    const fn = tc.function?.name || ''

    if (fn === 'read_file') {
      readCount++
      if (isProjectFilePath(fp)) hasProjectFile = true
      reads.push(fp || '(unknown)')
    } else if (fn === 'edit_file') {
      writes.push(fp || '(unknown)')
      editDiffs.push({ path: fp, old: String(args.old_string || '').slice(0, 100), new: String(args.new_string || '').slice(0, 100) })
    } else if (fn === 'create_file') {
      creates.push(fp || '(unknown)')
      createPreviews.push({ path: fp, content: String(args.content || '').slice(0, 200) })
    } else if (fn === 'delete_file') {
      deletes.push(fp || '(unknown)')
    } else if (fn === 'rename_file') {
      const np = (args.new_path as string || '').replace(/\\/g, '/')
      writes.push(`${fp} → ${np}`)
    } else if (fn === 'list_directory') {
      readCount++
      lists.push(dp || '(root)')
    } else if (fn === 'generate_image') {
      images.push(String(args.prompt || '').slice(0, 80))
    } else if (fn === 'toggle_prompt' || fn === 'update_prompt') {
      settings.push(`${fn}: ${String(args.title || args.id || '')}`)
    } else if (fn === 'create_style_template' || fn === 'create_scene_template') {
      templates.push(`${fn}: ${String(args.name || '')}`)
    }
  }

  const hasModifications = writes.length > 0 || creates.length > 0 || deletes.length > 0
    || settings.length > 0 || templates.length > 0 || images.length > 0
  const needsApproval = hasModifications || hasProjectFile || readCount > 3

  return { needsApproval, summary: { reads, writes, creates, deletes, lists, settings, templates, images }, previews: { editDiffs, createPreviews } }
}
