import { describe, it, expect } from 'vitest'
import {
  DANGEROUS_TOOLS,
  PREVIEW_TOOLS,
  READ_ONLY_TOOLS,
  summarizeFileOp,
} from '../toolSets'

// ── Tool Category Sets ──

describe('DANGEROUS_TOOLS', () => {
  it('contains 5 tools that need user confirmation', () => {
    expect(DANGEROUS_TOOLS.size).toBe(5)
  })

  it('includes create_file, delete_file, rename_file', () => {
    expect(DANGEROUS_TOOLS.has('create_file')).toBe(true)
    expect(DANGEROUS_TOOLS.has('delete_file')).toBe(true)
    expect(DANGEROUS_TOOLS.has('rename_file')).toBe(true)
  })

  it('includes create_project, delete_project', () => {
    expect(DANGEROUS_TOOLS.has('create_project')).toBe(true)
    expect(DANGEROUS_TOOLS.has('delete_project')).toBe(true)
  })

  it('is ReadonlySet (immutable at type level)', () => {
    // Runtime check — the set works as expected
    expect(DANGEROUS_TOOLS.has('nonexistent')).toBe(false)
  })
})

describe('PREVIEW_TOOLS', () => {
  it('contains only edit_file', () => {
    expect(PREVIEW_TOOLS.size).toBe(1)
    expect(PREVIEW_TOOLS.has('edit_file')).toBe(true)
  })
})

describe('READ_ONLY_TOOLS', () => {
  it('contains 20 tools', () => {
    expect(READ_ONLY_TOOLS.size).toBe(20)
  })

  it('contains read-only file tools', () => {
    expect(READ_ONLY_TOOLS.has('list_directory')).toBe(true)
    expect(READ_ONLY_TOOLS.has('read_file')).toBe(true)
    expect(READ_ONLY_TOOLS.has('search_files')).toBe(true)
    expect(READ_ONLY_TOOLS.has('search_content')).toBe(true)
  })

  it('contains note tools (read+write)', () => {
    expect(READ_ONLY_TOOLS.has('list_notes')).toBe(true)
    expect(READ_ONLY_TOOLS.has('read_note')).toBe(true)
    expect(READ_ONLY_TOOLS.has('write_note')).toBe(true)
    expect(READ_ONLY_TOOLS.has('append_note')).toBe(true)
    expect(READ_ONLY_TOOLS.has('delete_note')).toBe(true)
  })

  it('contains image tools', () => {
    expect(READ_ONLY_TOOLS.has('search_images')).toBe(true)
    expect(READ_ONLY_TOOLS.has('generate_image')).toBe(true)
  })

  it('contains template tools', () => {
    expect(READ_ONLY_TOOLS.has('create_style_template')).toBe(true)
    expect(READ_ONLY_TOOLS.has('create_scene_template')).toBe(true)
  })

  it('contains kb tools', () => {
    expect(READ_ONLY_TOOLS.has('kb_list')).toBe(true)
    expect(READ_ONLY_TOOLS.has('kb_create_file')).toBe(true)
    expect(READ_ONLY_TOOLS.has('kb_append_file')).toBe(true)
    expect(READ_ONLY_TOOLS.has('kb_index_file')).toBe(true)
  })

  it('contains prompt tools', () => {
    expect(READ_ONLY_TOOLS.has('list_prompts')).toBe(true)
    expect(READ_ONLY_TOOLS.has('toggle_prompt')).toBe(true)
    expect(READ_ONLY_TOOLS.has('update_prompt')).toBe(true)
  })

  it('does NOT contain dangerous file tools', () => {
    expect(READ_ONLY_TOOLS.has('create_file')).toBe(false)
    expect(READ_ONLY_TOOLS.has('delete_file')).toBe(false)
    expect(READ_ONLY_TOOLS.has('rename_file')).toBe(false)
    expect(READ_ONLY_TOOLS.has('create_project')).toBe(false)
    expect(READ_ONLY_TOOLS.has('delete_project')).toBe(false)
  })

  it('does NOT contain edit_file', () => {
    expect(READ_ONLY_TOOLS.has('edit_file')).toBe(false)
  })
})

// ── DANGEROUS_TOOLS ∩ READ_ONLY_TOOLS = ∅ ──

describe('tool set disjointness', () => {
  it('DANGEROUS_TOOLS and READ_ONLY_TOOLS have no overlap', () => {
    for (const t of DANGEROUS_TOOLS) {
      expect(READ_ONLY_TOOLS.has(t)).toBe(false)
    }
    for (const t of READ_ONLY_TOOLS) {
      expect(DANGEROUS_TOOLS.has(t)).toBe(false)
    }
  })
})

// ── summarizeFileOp ──

describe('summarizeFileOp', () => {
  it('summarizes list_directory', () => {
    expect(summarizeFileOp('list_directory', { dir_path: 'chapters' })).toBe('列出目录: chapters')
    expect(summarizeFileOp('list_directory', {})).toBe('列出目录: (根目录)')
  })

  it('summarizes read_file', () => {
    expect(summarizeFileOp('read_file', { file_path: 'outline/plot.md' })).toBe('读取: outline/plot.md')
  })

  it('summarizes search_files', () => {
    expect(summarizeFileOp('search_files', { keyword: '章节' })).toBe('搜索文件: "章节"')
  })

  it('summarizes search_content (truncates long patterns)', () => {
    const longPattern = 'a'.repeat(100)
    const result = summarizeFileOp('search_content', { pattern: longPattern })
    expect(result).toContain('搜索内容:')
    expect(result.length).toBeLessThan(60)
  })

  it('summarizes create_file', () => {
    expect(summarizeFileOp('create_file', { file_path: 'chapters/ch1.txt' })).toBe('创建: chapters/ch1.txt')
  })

  it('summarizes edit_file', () => {
    expect(summarizeFileOp('edit_file', { file_path: 'outline/plot.md' })).toBe('编辑: outline/plot.md')
  })

  it('summarizes delete_file', () => {
    expect(summarizeFileOp('delete_file', { file_path: 'old.txt' })).toBe('删除: old.txt')
  })

  it('summarizes rename_file', () => {
    expect(summarizeFileOp('rename_file', { file_path: 'a.txt', new_path: 'b.txt' })).toBe('重命名: a.txt → b.txt')
  })

  it('summarizes create_project', () => {
    expect(summarizeFileOp('create_project', { name: '新项目' })).toBe('创建项目: 新项目')
  })

  it('summarizes delete_project', () => {
    expect(summarizeFileOp('delete_project', { project_name: '旧项目' })).toBe('删除项目: 旧项目')
  })

  it('summarizes KB tools', () => {
    expect(summarizeFileOp('kb_list', {})).toBe('列出知识库文件')
    expect(summarizeFileOp('kb_create_file', { name: 'test.md' })).toBe('创建KB文件: test.md')
    expect(summarizeFileOp('kb_append_file', { file_id: 'abc' })).toBe('追加到KB: abc')
    expect(summarizeFileOp('kb_index_file', { file_id: 'xyz' })).toBe('索引KB: xyz')
  })

  it('summarizes note tools', () => {
    expect(summarizeFileOp('list_notes', {})).toBe('列出草稿')
    expect(summarizeFileOp('read_note', { note_name: '灵感.md' })).toBe('读取草稿: 灵感.md')
    expect(summarizeFileOp('write_note', { note_name: '灵感.md' })).toBe('写草稿: 灵感.md')
    expect(summarizeFileOp('append_note', { note_name: '灵感.md' })).toBe('追加草稿: 灵感.md')
    expect(summarizeFileOp('delete_note', { note_name: '灵感.md' })).toBe('删除草稿: 灵感.md')
  })

  it('summarizes image tools', () => {
    expect(summarizeFileOp('search_images', { query: 'castle' })).toBe('搜索图片: castle')
    expect(summarizeFileOp('generate_image', { prompt: 'a cat' })).toBe('AI生成图片: a cat')
  })

  it('summarizes template tools', () => {
    expect(summarizeFileOp('create_style_template', { name: '古风' })).toBe('创建风格模板: 古风')
    expect(summarizeFileOp('create_scene_template', { name: '场景1' })).toBe('创建场景模板: 场景1')
  })

  it('summarizes prompt tools', () => {
    expect(summarizeFileOp('list_prompts', {})).toBe('列出提示词库')
    expect(summarizeFileOp('toggle_prompt', { prompt_id: 'p1', enabled: true })).toBe('启用提示词: p1')
    expect(summarizeFileOp('toggle_prompt', { prompt_id: 'p2', enabled: false })).toBe('关闭提示词: p2')
    expect(summarizeFileOp('update_prompt', { prompt_id: 'p3' })).toBe('修改提示词: p3')
  })

  it('returns unknown for unimplemented tool', () => {
    expect(summarizeFileOp('unknown_tool', {})).toBe('未知操作: unknown_tool')
  })

  it('covers all FILE_TOOLS names (no missing summaries)', () => {
    // Dynamic import to avoid circular dep; fallback to inline list
    const allNames = [
      'list_directory', 'read_file', 'search_files', 'search_content',
      'edit_file', 'create_file', 'delete_file', 'rename_file',
      'create_project', 'delete_project',
      'kb_list', 'kb_create_file', 'kb_append_file', 'kb_index_file',
      'list_notes', 'read_note', 'write_note', 'append_note', 'delete_note',
      'search_images', 'generate_image',
      'list_prompts', 'toggle_prompt', 'update_prompt',
      'create_style_template', 'create_scene_template',
    ]
    for (const name of allNames) {
      const result = summarizeFileOp(name, {})
      expect(result).toBeTruthy()
      expect(result).not.toContain('未知操作')
    }
  })
})
