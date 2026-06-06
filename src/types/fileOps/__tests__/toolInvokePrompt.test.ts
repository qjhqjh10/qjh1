import { describe, it, expect } from 'vitest'
import { buildToolInvokePrompt } from '../toolInvokePrompt'

describe('buildToolInvokePrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('contains invoke_skill and core tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('invoke_skill')
    expect(prompt).toContain('read_file')
  })

  it('lists all major tool categories', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('核心工具')
    expect(prompt).toContain('知识库')
    expect(prompt).toContain('笔记')
    expect(prompt).toContain('模板')
    expect(prompt).toContain('模板')
  })

  it('includes read_file tool', () => {
    expect(buildToolInvokePrompt()).toContain('read_file')
  })

  it('includes list_directory tool', () => {
    expect(buildToolInvokePrompt()).toContain('list_directory')
  })

  it('includes edit_file tool', () => {
    expect(buildToolInvokePrompt()).toContain('edit_file')
  })

  it('includes create_file tool', () => {
    expect(buildToolInvokePrompt()).toContain('create_file')
  })

  it('includes KB tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('kb_list')
    expect(prompt).toContain('kb_create_file')
    expect(prompt).toContain('kb_append_file')
    expect(prompt).toContain('kb_index_file')
  })

  it('includes note tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('write_note')
    expect(prompt).toContain('read_note')
    expect(prompt).toContain('list_notes')
    expect(prompt).toContain('append_note')
  })

  it('includes image tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('search_images')
    expect(prompt).toContain('generate_image')
  })

  it('includes template tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('create_style_template')
    expect(prompt).toContain('create_scene_template')
  })

  it('includes project tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('create_project')
    expect(prompt).toContain('shell_run_script')
  })

  it('contains tool and skill guidance', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('invoke_skill')
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('create_file')
  })

  it('emphasizes invoke_skill before complex operations', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('必须先调用 invoke_skill')
  })

  it('has sufficient length for tool descriptions', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt.length).toBeGreaterThan(300)
  })
})
