import { describe, it, expect } from 'vitest'
import { buildToolInvokePrompt } from '../toolInvokePrompt'

describe('buildToolInvokePrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('contains mandatory tool invocation header', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('[强制工具调用]')
  })

  it('lists all major tool categories', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('文件操作')
    expect(prompt).toContain('知识库')
    expect(prompt).toContain('草稿笔记')
    expect(prompt).toContain('图片')
    expect(prompt).toContain('模板')
    expect(prompt).toContain('项目管理')
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
    expect(prompt).toContain('list_notes')
    expect(prompt).toContain('read_note')
    expect(prompt).toContain('write_note')
    expect(prompt).toContain('append_note')
    expect(prompt).toContain('delete_note')
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
    expect(prompt).toContain('delete_project')
  })

  it('contains the iron law rules', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('铁律')
    expect(prompt).toContain('tool_calls')
    expect(prompt).toContain('success')
  })

  it('states that describing an action is not equivalent to doing it', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('描述操作不等于操作')
  })

  it('mentions batch approval requirement', () => {
    const prompt = buildToolInvokePrompt()
    // The prompt should instruct AI to explain its plan before executing
    expect(prompt.length).toBeGreaterThan(500)
  })
})
