// ── v16.2.0: 副模型视觉分析（VisionAnalyzer）──
// 上传图片自动分析：渲染层轻量调用器 → aiService.visionChat（主进程读图/缩放/组装）→ 副模型
// 看图 → 结构化描述文本。描述由调用方注入主模型上下文（主链路 Message 结构零改动）。
// 与 analyze_image 工具共用同一 IPC 通道（analyze_image 走 path，上传走 base64）。

import type { ModelConfig } from '@/types/settings'

/** 视觉分析提示词（自动分析，供小说创作参考） */
export const DEFAULT_VISION_PROMPT =
  '请仔细观察这张图片，为小说创作提供参考：' +
  '描述主体人物/事物的外貌、服装、表情、姿态，场景环境、光线氛围，画面中的文字信息，' +
  '以及可提炼的细节（如时代/地域特征、道具、色彩基调）。用中文结构化输出，条理清晰。'

/** 工具调用的视觉分析提示词（analyze_image 默认） */
export const TOOL_VISION_PROMPT =
  '请仔细观察图片内容并输出结构化描述：主体、场景、细节、氛围。若与分析问题相关请重点回答。用中文，简洁有条理。'

export interface VisionAnalyzeResult {
  text: string
  cost: number
  /** 分析失败（未配置副模型/网络/接口）时为 false，调用方应回退占位符 */
  ok: boolean
  error?: string
}

export interface VisionAnalyzeOptions {
  configId: string
  projectId?: string
  prompt?: string
  /** 图片数据：base64（上传场景，无 data: 前缀）或 path（analyze_image 场景） */
  images: Array<{ base64?: string; path?: string }>
  /** 图片处理策略：standard/detail/eco（默认 standard） */
  template?: 'standard' | 'detail' | 'eco'
}

/**
 * 调副模型分析图片。失败不抛错——返回 { ok:false, error }，调用方回退占位符不阻塞。
 */
export async function analyzeImage(opts: VisionAnalyzeOptions): Promise<VisionAnalyzeResult> {
  try {
    const { aiService } = await import('@/services/fileService')
    const result = await aiService.visionChat({
      configId: opts.configId,
      projectId: opts.projectId,
      prompt: opts.prompt || DEFAULT_VISION_PROMPT,
      images: opts.images,
      template: opts.template,
    })
    return { text: result.text || '', cost: result.cost || 0, ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { text: '', cost: 0, ok: false, error: msg }
  }
}

/** 副模型是否已配置（secondaryModel 非空） */
export function hasSecondaryModel(config?: ModelConfig | null): boolean {
  return !!config && !!config.secondaryModel
}

/** 提取 base64（data URL → 纯 base64），失败返回空 */
export function extractBase64(dataUrl: string): string {
  if (!dataUrl) return ''
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}
