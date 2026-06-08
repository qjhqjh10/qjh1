import { describe, it, expect } from 'vitest'
import { buildToolInvokePrompt } from '../toolInvokePrompt'

describe('buildToolInvokePrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('contains core tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).not.toContain('invoke_skill')
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('create_file')
    expect(prompt).toContain('list_directory')
    expect(prompt).toContain('search_content')
    expect(prompt).toContain('find_files')
  })

  it('lists major tool categories', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('核心工具')
    expect(prompt).toContain('知识库')
    expect(prompt).toContain('笔记')
    expect(prompt).toContain('图片')
    expect(prompt).toContain('项目')
  })

  it('includes KB tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('kb_append_file')
    expect(prompt).toContain('kb_index_file')
  })

  it('includes image tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('search_images')
    expect(prompt).toContain('generate_image')
  })

  it('includes project tools', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).toContain('create_project')
    expect(prompt).toContain('delete_project')
  })

  it('emphasizes direct tool use without invoke_skill', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt).not.toContain('invoke_skill')
    expect(prompt).toContain('直接使用工具')
  })

  it('has sufficient length for tool descriptions', () => {
    const prompt = buildToolInvokePrompt()
    expect(prompt.length).toBeGreaterThan(200)
  })
})
