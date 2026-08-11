import { describe, it, expect } from 'vitest'
import { FILE_TOOLS, FileOpCard, ToolCallResult } from '../toolDefs'

describe('FILE_TOOLS', () => {
  it('has all tools defined', () => {
    expect(FILE_TOOLS.length).toBeGreaterThanOrEqual(14)
  })

  it('all tools have type "function"', () => {
    for (const t of FILE_TOOLS) {
      expect(t.type).toBe('function')
    }
  })

  it('all tools have name and description', () => {
    for (const t of FILE_TOOLS) {
      expect(t.function.name).toBeTruthy()
      expect(t.function.description).toBeTruthy()
    }
  })

  it('all tools have parameters object', () => {
    for (const t of FILE_TOOLS) {
      expect(t.function.parameters.type).toBe('object')
      expect(t.function.parameters.properties).toBeDefined()
    }
  })

  it('all tool names are unique', () => {
    const names = FILE_TOOLS.map(t => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('required params match defined properties', () => {
    for (const t of FILE_TOOLS) {
      const required = t.function.parameters.required || []
      const propKeys = Object.keys(t.function.parameters.properties || {})
      for (const r of required) {
        expect(propKeys).toContain(r)
      }
    }
  })
})

describe('tool name categories', () => {
  const names = FILE_TOOLS.map(t => t.function.name)

  it('includes file tools', () => {
    expect(names).toContain('list_directory')
    expect(names).toContain('read_file')
    expect(names).toContain('search_content')
    expect(names).toContain('edit_file')
    expect(names).toContain('create_file')
    expect(names).toContain('delete_file')
    expect(names).toContain('rename_file')
  })

  it('includes project tools', () => {
    expect(names).toContain('create_project')
    expect(names).toContain('delete_project')
  })

  it('includes kb tools', () => {
    expect(names).toContain('kb_append_file')
    expect(names).toContain('kb_index_file')
  })

  it('includes image tools (v16.3.0: generate_image 已移除)', () => {
    expect(names).toContain('search_images')
  })

  it('includes prompt tools', () => {
    expect(names).toContain('list_prompts')
    expect(names).toContain('toggle_prompt')
    expect(names).toContain('update_prompt')
  })
})

describe('tool required parameters', () => {
  function getRequired(toolName: string): string[] {
    const tool = FILE_TOOLS.find(t => t.function.name === toolName)
    return tool?.function.parameters.required || []
  }

  it('read_file requires file_path', () => {
    expect(getRequired('read_file')).toEqual(['file_path'])
  })

  it('edit_file requires file_path, old_string, new_string', () => {
    expect(getRequired('edit_file')).toEqual(['file_path', 'old_string', 'new_string'])
  })

  it('create_file requires file_path, content', () => {
    expect(getRequired('create_file')).toEqual(['file_path', 'content'])
  })

  it('delete_file requires file_path', () => {
    expect(getRequired('delete_file')).toEqual(['file_path'])
  })

  it('rename_file requires file_path, new_path', () => {
    expect(getRequired('rename_file')).toEqual(['file_path', 'new_path'])
  })

  it('kb_append_file requires file_id, content', () => {
    expect(getRequired('kb_append_file')).toEqual(['file_id', 'content'])
  })
})

describe('FileOpCard type', () => {
  it('supports all status values', () => {
    const statuses: FileOpCard['status'][] = [
      'executing', 'success', 'error', 'pending_confirm',
      'confirmed', 'denied', 'needs_preview', 'undone',
    ]
    expect(statuses).toHaveLength(8)
  })
})

describe('ToolCallResult type', () => {
  it('has correct status union', () => {
    const statuses: ToolCallResult['status'][] = ['success', 'error', 'pending_confirm']
    expect(statuses).toHaveLength(3)
  })
})
