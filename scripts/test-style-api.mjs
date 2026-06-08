/**
 * 真 API 测试：风格分析引擎 buildStyleAnalyzePrompt + AI 调用
 */
import { buildStyleAnalyzePrompt, parseStyleAnalysisReply } from '../src/services/extractionService/styleAnalysis.js'
import OpenAI from 'openai'

const API_KEY = 'sk-c9c30831df7243209435c60e811c879d'
const BASE_URL = 'https://api.deepseek.com'
const MODEL = 'deepseek-v4-flash'

const SAMPLE = `林雨晴站在画展的入口处，深吸了一口气。展厅里人不多，偶尔有低语声从远处传来。

那是一幅描绘暴风雨中孤舟的作品，笔触凌厉而克制。她站在画前，久久没有移动。

"你喜欢这幅画？"一个温和的声音从身后传来。

她回头，看见一个戴着金丝眼镜的男人正微笑看着她。那笑容很淡，稍纵即逝。

"画得不错。"她说，声音很轻。

"确实。"男人点点头，"每一笔都恰到好处。不多，不少。"

她看着那幅画，忽然觉得有什么东西在心里松动了。像是长久以来紧绷的弦，被谁轻轻拨了一下。`

const dims = ['narrativeTone','sentenceStyle','vocabularyStyle','rhythmStyle','moodStyle',
  'rhetoricStyle','dialogueStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','descriptionPattern']

const prompt = buildStyleAnalyzePrompt(dims, '都市小说')
const fullPrompt = `${prompt}\n\n[原文内容]\n${SAMPLE}`

console.log('=== 风格分析引擎测试 ===')
console.log(`模型: ${MODEL}`)
console.log(`维度: ${dims.length} 个`)
console.log(`分析提示词: ${prompt.length} 字符`)
console.log(`原文: ${SAMPLE.length} 字符`)
console.log(`总输入: ${fullPrompt.length} 字符`)

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL, timeout: 180000 })

console.log('\n正在调用 API...')
const t0 = Date.now()
const completion = await client.chat.completions.create({
  model: MODEL,
  messages: [{ role: 'user', content: fullPrompt }],
  max_tokens: 8192,
})
const dt = ((Date.now() - t0) / 1000).toFixed(1)

const reply = completion.choices[0]?.message?.content || ''
const usage = completion.usage || {}

console.log(`\n=== API 响应 (${dt}s) ===`)
console.log(`输入 tokens: ${usage.prompt_tokens}`)
console.log(`输出 tokens: ${usage.completion_tokens}`)
console.log(`回复长度: ${reply.length} 字符`)
console.log(`回复预览:\n${reply.slice(0, 500)}...`)

// 解析
const analysis = parseStyleAnalysisReply(reply, dims)
const dimKeys = Object.keys(analysis.dimAnalyses || {})
console.log(`\n=== 解析结果 ===`)
console.log(`提取维度: ${dimKeys.length} 个`)
console.log(`维度列表: ${dimKeys.join(', ')}`)

for (const [k, v] of Object.entries(analysis.dimAnalyses || {})) {
  const d = v.description?.length || 0
  const e = v.examples?.length || 0
  const r = v.writingRules?.length || 0
  const w = v.vocabularyList?.length || 0
  console.log(`  ${k}: 描述${d}字, 例句${e}条, 规则${r}条, 词汇${w}个`)
}

const ok = dimKeys.length >= 5
console.log(`\n${ok ? '✅ 分析成功' : '⚠️ 维度不足'} (${dimKeys.length}/${dims.length})`)
process.exit(ok ? 0 : 1)
