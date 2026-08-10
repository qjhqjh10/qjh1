// v16.2.0: 副模型视觉分析（VisionAnalyzer）单测
// 覆盖：成功分析、失败回退（不抛错）、副模型未配置判定、base64 提取
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock aiService（visionChat）——analyzeImage 内动态 import
vi.mock('@/services/fileService', () => ({
  aiService: {
    visionChat: vi.fn(),
  },
}))

import { analyzeImage, hasSecondaryModel, extractBase64, DEFAULT_VISION_PROMPT, TOOL_VISION_PROMPT } from '../visionAnalyzer'

const mockVisionChat = vi.mocked((await import('@/services/fileService')).aiService.visionChat)

describe('visionAnalyzer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('成功分析：返回描述文本与费用', async () => {
    mockVisionChat.mockResolvedValueOnce({ text: '画面中是一位穿古装的女子，紫色长裙。', usage: { prompt_tokens: 100, completion_tokens: 50 }, cost: 0.002 })
    const r = await analyzeImage({ configId: 'c1', prompt: DEFAULT_VISION_PROMPT, images: [{ base64: 'aGVsbG8=' }] })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('古装')
    expect(r.cost).toBe(0.002)
    const callArg = mockVisionChat.mock.calls[0][0] as any
    expect(callArg.configId).toBe('c1')
    expect(callArg.images).toEqual([{ base64: 'aGVsbG8=' }])
  })

  it('失败不抛错：返回 ok=false + error', async () => {
    mockVisionChat.mockRejectedValueOnce(new Error('[UNSUPPORTED_OPERATION] 未配置副模型'))
    const r = await analyzeImage({ configId: 'c1', prompt: 'x', images: [{ base64: 'y' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未配置副模型')
    expect(r.text).toBe('')
  })

  it('path 场景：透传 path 而非 base64', async () => {
    mockVisionChat.mockResolvedValueOnce({ text: 'ok', usage: null, cost: 0 })
    await analyzeImage({ configId: 'c1', prompt: TOOL_VISION_PROMPT, images: [{ path: 'images/cover.png' }], template: 'eco' })
    expect(mockVisionChat).toHaveBeenCalledWith(expect.objectContaining({
      images: [{ path: 'images/cover.png' }],
      template: 'eco',
    }))
  })

  it('hasSecondaryModel：仅 secondaryModel 非空为 true', () => {
    expect(hasSecondaryModel(null)).toBe(false)
    expect(hasSecondaryModel(undefined)).toBe(false)
    expect(hasSecondaryModel({ id: 'c', secondaryModel: '' } as any)).toBe(false)
    expect(hasSecondaryModel({ id: 'c', secondaryModel: 'minimax-m3' } as any)).toBe(true)
  })

  it('extractBase64：剥离 data URL 前缀', () => {
    expect(extractBase64('data:image/png;base64,QUJD')).toBe('QUJD')
    expect(extractBase64('QUJD')).toBe('QUJD')
    expect(extractBase64('')).toBe('')
  })
})
