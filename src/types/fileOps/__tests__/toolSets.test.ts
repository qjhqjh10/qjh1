import { describe, it, expect } from 'vitest'
import {
  DANGEROUS_TOOLS,
  READ_ONLY_TOOLS,
  summarizeFileOp,
} from '../toolSets'

describe('DANGEROUS_TOOLS', () => {
  it('contains tools that need user confirmation', () => {
    expect(DANGEROUS_TOOLS.size).toBe(6)
  })

  it('includes file-modifying tools', () => {
    expect(DANGEROUS_TOOLS.has('create_file')).toBe(true)
    expect(DANGEROUS_TOOLS.has('delete_file')).toBe(true)
    expect(DANGEROUS_TOOLS.has('rename_file')).toBe(true)
    expect(DANGEROUS_TOOLS.has('batch_replace')).toBe(true)
  })

  it('includes project tools', () => {
    expect(DANGEROUS_TOOLS.has('create_project')).toBe(true)
    expect(DANGEROUS_TOOLS.has('delete_project')).toBe(true)
  })
})

describe('READ_ONLY_TOOLS', () => {
  it('contains 10 tools (v16.3.1: -toggle_prompt/-update_prompt 写操作移出只读集合)', () => {
    expect(READ_ONLY_TOOLS.size).toBe(10)
  })

  it('contains read-only file tools', () => {
    expect(READ_ONLY_TOOLS.has('list_directory')).toBe(true)
    expect(READ_ONLY_TOOLS.has('read_file')).toBe(true)
    expect(READ_ONLY_TOOLS.has('search_content')).toBe(true)
    expect(READ_ONLY_TOOLS.has('find_files')).toBe(true)
  })

  it('contains image tools (v16.3.0: generate_image 已移除)', () => {
    expect(READ_ONLY_TOOLS.has('search_images')).toBe(true)
  })

  it('contains prompt tools (v16.3.1 审计 D16: toggle/update 实为写提示词库，不再归入只读)', () => {
    expect(READ_ONLY_TOOLS.has('list_prompts')).toBe(true)
    expect(READ_ONLY_TOOLS.has('toggle_prompt')).toBe(false)
    expect(READ_ONLY_TOOLS.has('update_prompt')).toBe(false)
  })

  it('contains kb/notes tools', () => {
    expect(READ_ONLY_TOOLS.has('kb_index_file')).toBe(true)
    expect(READ_ONLY_TOOLS.has('search_notes')).toBe(true)
  })

  it('does NOT contain dangerous tools', () => {
    expect(READ_ONLY_TOOLS.has('create_file')).toBe(false)
    expect(READ_ONLY_TOOLS.has('delete_file')).toBe(false)
    expect(READ_ONLY_TOOLS.has('edit_file')).toBe(false)
  })
})

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

describe('summarizeFileOp', () => {
  it('summarizes list_directory', () => {
    expect(summarizeFileOp('list_directory', { dir_path: 'chapters' })).toBe('列出目录: chapters')
    expect(summarizeFileOp('list_directory', {})).toBe('列出目录: (根目录)')
  })

  it('summarizes read_file', () => {
    expect(summarizeFileOp('read_file', { file_path: 'outline/plot.md' })).toBe('读取: outline/plot.md')
  })

  it('summarizes search_content', () => {
    const result = summarizeFileOp('search_content', { pattern: 'a'.repeat(100) })
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

  it('summarizes project tools', () => {
    expect(summarizeFileOp('create_project', { name: '新项目' })).toBe('创建项目: 新项目')
    expect(summarizeFileOp('delete_project', { project_name: '旧项目' })).toBe('删除项目: 旧项目')
  })

  it('summarizes KB tools', () => {
    expect(summarizeFileOp('kb_append_file', { file_id: 'abc' })).toBe('追加到KB: abc')
    expect(summarizeFileOp('kb_index_file', { file_id: 'xyz' })).toBe('索引KB: xyz')
  })

  it('summarizes template tools', () => {
    expect(summarizeFileOp('create_style_template', { name: '古风' })).toBe('创建风格模板: 古风')
    expect(summarizeFileOp('create_scene_template', { name: '场景1' })).toBe('创建场景模板: 场景1')
  })

  it('returns unknown for unimplemented tool', () => {
    expect(summarizeFileOp('unknown_tool', {})).toBe('未知操作: unknown_tool')
  })

  it('covers all current tools (no missing summaries)', () => {
    const allNames = [
      'list_directory', 'read_file', 'search_content', 'find_files',
      'edit_file', 'create_file', 'delete_file', 'rename_file', 'batch_replace',
      'create_project', 'delete_project',
      'kb_append_file', 'kb_index_file', 'search_notes',
      'search_images',
      'list_prompts', 'toggle_prompt', 'update_prompt',
      'create_style_template', 'create_scene_template',
      'analyze_text_style', 'tool_search', 'list_rules',
    ]
    for (const name of allNames) {
      const result = summarizeFileOp(name, {})
      expect(result, `summarizeFileOp(${name}) returned falsy: "${result}"`).toBeTruthy()
      expect(result, `summarizeFileOp(${name}) contains "未知操作": "${result}"`).not.toContain('未知操作')
    }
  })
})
