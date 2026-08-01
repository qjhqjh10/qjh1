import { describe, it, expect } from 'vitest'
import { isSafePath, mergeConfigKeys } from '../utils'

// ── isSafePath ──

describe('isSafePath', () => {
  const base = '/data/projects/testProject'

  it('allows paths inside base', () => {
    expect(isSafePath('/data/projects/testProject/chapters/ch1.txt', base)).toBe(true)
    expect(isSafePath('/data/projects/testProject/outline/plot.md', base)).toBe(true)
  })

  it('allows the base path itself', () => {
    expect(isSafePath('/data/projects/testProject', base)).toBe(true)
  })

  it('rejects paths outside base (parent traversal)', () => {
    expect(isSafePath('/data/projects/otherProject/file.txt', base)).toBe(false)
    expect(isSafePath('/data/escape/file.txt', base)).toBe(false)
    expect(isSafePath('/etc/passwd', base)).toBe(false)
  })

  it('rejects paths that look like base prefix but are siblings', () => {
    // A sibling directory whose name starts with the project name
    expect(isSafePath('/data/projects/testProject2/chapters/ch1.txt', base)).toBe(false)
  })

  it('rejects relative path starting with dots', () => {
    expect(isSafePath('../escape', base)).toBe(false)
    expect(isSafePath('../../etc/passwd', base)).toBe(false)
  })

  it('is case insensitive on the comparison', () => {
    // Windows paths can be case-insensitive
    expect(isSafePath('/DATA/PROJECTS/TESTPROJECT/file.txt', base)).toBe(true)
  })

  it('normalizes paths before comparison', () => {
    expect(isSafePath('/data/projects/testProject//chapters/../chapters/ch1.txt', base)).toBe(true)
    expect(isSafePath('/data/projects/testProject/chapters/./ch1.txt', base)).toBe(true)
  })

  it('rejects empty or invalid input', () => {
    expect(isSafePath('', base)).toBe(false)
    expect(isSafePath('' as any, base)).toBe(false)
    expect(isSafePath('/data/projects/testProject', '')).toBe(false)
  })

  it('handles Windows-style paths', () => {
    const winBase = 'C:\\Users\\test\\projects\\myProject'
    expect(isSafePath('C:\\Users\\test\\projects\\myProject\\chapters\\ch1.txt', winBase)).toBe(true)
    expect(isSafePath('C:\\Users\\test\\projects\\myProject\\..\\other\\file.txt', winBase)).toBe(false)
  })
})

// ── Masked Key Constant ──

describe('MASKED_KEY', () => {
  it('is the expected placeholder', async () => {
    const { MASKED_KEY } = await import('../utils')
    expect(MASKED_KEY).toBe('••••••••')
  })

  it('is not an empty string', async () => {
    const { MASKED_KEY } = await import('../utils')
    expect(MASKED_KEY.length).toBeGreaterThan(0)
  })

  it('is used for loading configs (明文存储 — MASKED_KEY 是主进程保存时的保护哨兵)', async () => {
    const { MASKED_KEY } = await import('../utils')
    // 审查修正: v13.x 明文存储决策下 loadConfigs 返回真实密钥，MASKED_KEY 仅用于 saveConfigs 的三态合并保护
    expect(typeof MASKED_KEY).toBe('string')
  })
})

// ── readFileWithEncoding Contract ──

describe('readFileWithEncoding', () => {
  it('exports as a function', async () => {
    const { readFileWithEncoding } = await import('../utils')
    expect(typeof readFileWithEncoding).toBe('function')
  })
})

// ── mergeConfigKeys (H5) ──

describe('mergeConfigKeys (H5)', () => {
  const oldConfig = {
    apiKey: 'old-main-key',
    mainApiKey: 'old-legacy-key',
    imageApiKey: 'old-img-key',
    embeddingApiKey: 'old-emb-key',
  }

  it('MASKED_KEY 占位符保留磁盘旧密钥', () => {
    const out = mergeConfigKeys(oldConfig, {
      apiKey: '••••••••', imageApiKey: '••••••••', embeddingApiKey: '••••••••',
      model: 'deepseek-chat',
    })
    expect(out.apiKey).toBe('old-main-key')
    expect(out.imageApiKey).toBe('old-img-key')
    expect(out.embeddingApiKey).toBe('old-emb-key')
    expect(out.model).toBe('deepseek-chat') // 非密钥字段不受影响
  })

  it('带空格的 MASKED_KEY 同样保留旧值（trim）', () => {
    const out = mergeConfigKeys(oldConfig, { apiKey: ' •••••••• ' })
    expect(out.apiKey).toBe('old-main-key')
  })

  it('空串清空密钥（用户主动删除）', () => {
    const out = mergeConfigKeys(oldConfig, { apiKey: '' })
    expect(out.apiKey).toBe('')
  })

  it('真实新值正常写入', () => {
    const out = mergeConfigKeys(oldConfig, { apiKey: 'new-key' })
    expect(out.apiKey).toBe('new-key')
  })

  it('字段缺失（undefined）保留旧值', () => {
    const out = mergeConfigKeys(oldConfig, { model: 'x' })
    expect(out.apiKey).toBe('old-main-key')
  })

  it('无旧 config（新用户）时 MASKED_KEY 存空串而非字面量', () => {
    const out = mergeConfigKeys(undefined, { apiKey: '••••••••' })
    expect(out.apiKey).toBe('')
  })
})
