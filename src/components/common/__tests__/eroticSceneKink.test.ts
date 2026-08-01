// H9: setKinkField 验证（原 \w 不匹配中文 → 追加重复值/读不到旧值）
import { describe, it, expect } from 'vitest'
import { setKinkField } from '../EroticSceneModal'

describe('setKinkField (H9)', () => {
  it('追加新字段', () => {
    expect(setKinkField('', '风格', '沉浸式长镜')).toBe('风格:沉浸式长镜')
  })

  it('替换已有中文值（原实现会追加重复条目）', () => {
    const kink = '风格:沉浸式长镜,锚点:烛光'
    const out = setKinkField(kink, '风格', '旁观式扫射')
    expect(out).toBe('锚点:烛光,风格:旁观式扫射')
    expect(out.match(/风格:/g)?.length).toBe(1) // 无重复
  })

  it('替换后清理中间项产生的双逗号', () => {
    const kink = '风格:沉浸式长镜,时间:实时,内省:中'
    const out = setKinkField(kink, '时间', '压缩')
    expect(out).toBe('风格:沉浸式长镜,内省:中,时间:压缩')
    expect(out).not.toContain(',,')
  })

  it('空值只删不添（-- 占位）', () => {
    const kink = '风格:沉浸式长镜,时间:实时'
    expect(setKinkField(kink, '风格', '')).toBe('时间:实时')
  })

  it('删除唯一字段后不留首尾逗号', () => {
    expect(setKinkField('风格:沉浸式长镜', '风格', '')).toBe('')
    expect(setKinkField('风格:沉浸式长镜,', '风格', '')).toBe('')
  })

  it('短中文值（无/低/中/高）正常替换', () => {
    const kink = '内省:中,锚点:烛光'
    expect(setKinkField(kink, '内省', '高')).toBe('锚点:烛光,内省:高')
  })
})
