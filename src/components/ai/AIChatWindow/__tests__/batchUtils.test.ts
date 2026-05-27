import { describe, it, expect } from 'vitest'
import { checkBatch, isProjectFilePath, PROJECT_DIR_PREFIXES } from '../batchUtils'

// ── isProjectFilePath ──

describe('isProjectFilePath', () => {
  it('returns true for outline paths', () => {
    expect(isProjectFilePath('outline/plot.md')).toBe(true)
    expect(isProjectFilePath('outline/worldbuilding.md')).toBe(true)
  })

  it('returns true for detailed_outline paths', () => {
    expect(isProjectFilePath('detailed_outline/ch1.json')).toBe(true)
  })

  it('returns true for characters paths', () => {
    expect(isProjectFilePath('characters/zhangsan.json')).toBe(true)
  })

  it('returns true for chapters paths', () => {
    expect(isProjectFilePath('chapters/chapter1.txt')).toBe(true)
  })

  it('returns true for summaries paths', () => {
    expect(isProjectFilePath('summaries/ch1.md')).toBe(true)
  })

  it('returns false for notes paths', () => {
    expect(isProjectFilePath('notes/inspiration.md')).toBe(false)
  })

  it('returns false for knowledge base paths', () => {
    expect(isProjectFilePath('knowledge_base/files/test.md')).toBe(false)
  })

  it('returns false for empty/undefined', () => {
    expect(isProjectFilePath('')).toBe(false)
    expect(isProjectFilePath('' as any)).toBe(false)
  })

  it('handles Windows backslash paths', () => {
    expect(isProjectFilePath('chapters\\ch1.txt')).toBe(true)
  })

  it('handles paths with project prefix', () => {
    expect(isProjectFilePath('myProject/outline/plot.md')).toBe(false)
  })
})

// ── checkBatch ──

describe('checkBatch', () => {
  function makeTc(name: string) {
    return { function: { name } }
  }

  it('returns needsApproval=false for small read-only batches (non-project files)', () => {
    const result = checkBatch(
      [makeTc('read_file'), makeTc('list_directory')],
      [{ file_path: 'notes/inspiration.md' }, { dir_path: '' }],
    )
    // notes/ is not a project file, and only 2 reads → no approval needed
    expect(result.needsApproval).toBe(false)
  })

  it('returns needsApproval=true when reads exceed 3', () => {
    const tcs = [
      makeTc('read_file'), makeTc('read_file'),
      makeTc('read_file'), makeTc('read_file'),
    ]
    const args = [
      { file_path: 'a.md' }, { file_path: 'b.md' },
      { file_path: 'c.md' }, { file_path: 'd.md' },
    ]
    expect(checkBatch(tcs, args).needsApproval).toBe(true)
  })

  it('returns needsApproval=true for any write operation', () => {
    expect(checkBatch([makeTc('edit_file')], [{ file_path: 'x.md', old_string: 'a', new_string: 'b' }]).needsApproval).toBe(true)
    expect(checkBatch([makeTc('create_file')], [{ file_path: 'x.md', content: 'test' }]).needsApproval).toBe(true)
    expect(checkBatch([makeTc('delete_file')], [{ file_path: 'x.md' }]).needsApproval).toBe(true)
  })

  it('returns needsApproval=true for rename_file', () => {
    expect(checkBatch(
      [makeTc('rename_file')],
      [{ file_path: 'a.md', new_path: 'b.md' }],
    ).needsApproval).toBe(true)
  })

  it('returns needsApproval=true for template creation', () => {
    expect(checkBatch(
      [makeTc('create_style_template')],
      [{ name: 'test' }],
    ).needsApproval).toBe(true)
  })

  it('returns needsApproval=true for image generation', () => {
    expect(checkBatch(
      [makeTc('generate_image')],
      [{ prompt: 'test' }],
    ).needsApproval).toBe(true)
  })

  it('returns needsApproval=true for prompt settings changes', () => {
    expect(checkBatch(
      [makeTc('toggle_prompt')],
      [{ prompt_id: 'p1', enabled: true }],
    ).needsApproval).toBe(true)
  })

  it('returns needsApproval=true when project file is read', () => {
    const result = checkBatch(
      [makeTc('read_file'), makeTc('read_file'), makeTc('read_file')],
      [
        { file_path: 'outline/plot.md' },
        { file_path: 'note.md' },
        { file_path: 'kb/test.md' },
      ],
    )
    expect(result.needsApproval).toBe(true)
  })

  it('populates summary categories correctly', () => {
    const result = checkBatch(
      [
        makeTc('read_file'), makeTc('edit_file'), makeTc('create_file'),
        makeTc('delete_file'), makeTc('list_directory'), makeTc('toggle_prompt'),
        makeTc('create_scene_template'), makeTc('generate_image'),
      ],
      [
        { file_path: 'outline/plot.md' },
        { file_path: 'outline/plot.md', old_string: 'a', new_string: 'b' },
        { file_path: 'new.json', content: '{}' },
        { file_path: 'old.txt' },
        { dir_path: 'chapters' },
        { prompt_id: 'p1', enabled: true },
        { name: '场景1' },
        { prompt: 'castle' },
      ],
    )
    expect(result.summary.reads).toHaveLength(1)
    expect(result.summary.writes).toHaveLength(1)
    expect(result.summary.creates).toHaveLength(1)
    expect(result.summary.deletes).toHaveLength(1)
    expect(result.summary.lists).toHaveLength(1)
    expect(result.summary.settings).toHaveLength(1)
    expect(result.summary.templates).toHaveLength(1)
    expect(result.summary.images).toHaveLength(1)
  })

  it('includes edit diffs in previews', () => {
    const result = checkBatch(
      [makeTc('edit_file')],
      [{ file_path: 'outline/plot.md', old_string: 'hello world', new_string: 'goodbye' }],
    )
    expect(result.previews.editDiffs).toHaveLength(1)
    expect(result.previews.editDiffs[0].path).toBe('outline/plot.md')
    expect(result.previews.editDiffs[0].old).toBe('hello world')
    expect(result.previews.editDiffs[0].new).toBe('goodbye')
  })

  it('includes create previews with truncated content', () => {
    const result = checkBatch(
      [makeTc('create_file')],
      [{ file_path: 'chapters/ch1.txt', content: 'x'.repeat(500) }],
    )
    expect(result.previews.createPreviews).toHaveLength(1)
    expect(result.previews.createPreviews[0].content.length).toBe(200)
  })

  it('truncates long old_string in diffs', () => {
    const result = checkBatch(
      [makeTc('edit_file')],
      [{ file_path: 'x.txt', old_string: 'y'.repeat(200), new_string: 'z' }],
    )
    expect(result.previews.editDiffs[0].old.length).toBe(100)
  })

  it('handles empty args gracefully', () => {
    const result = checkBatch([makeTc('read_file')], [{}])
    expect(result.summary.reads).toEqual(['(unknown)'])
  })

  it('handles mixed tools with no modifications', () => {
    const result = checkBatch(
      [makeTc('kb_list'), makeTc('list_notes'), makeTc('read_note')],
      [{}, {}, { note_name: 'test.md' }],
    )
    expect(result.needsApproval).toBe(false)
  })

  it('detects project file in list_directory', () => {
    // list_directory counts as read in needsApproval threshold but not isProjectFilePath
    const result = checkBatch(
      [makeTc('list_directory'), makeTc('list_directory')],
      [{ dir_path: '' }, { dir_path: '' }],
    )
    // 2 reads, no modifications, no project file read → should be false
    expect(result.needsApproval).toBe(false)
  })
})
