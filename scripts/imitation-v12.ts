/**
 * V12 — 继母复仇+冷虐支配+身份揭露，V3可靠格式
 */
import OpenAI from 'openai'
import * as fs from 'fs/promises'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
})

const SOURCE = `到达别墅，冷雪晴开门进入，房间明显已经被庄薇薇给清洁过了，还特意地在一楼的大厅里布置了一张大床......`

async function analyze() {
  console.log('━━━ V12 阶段1: V3格式分析 ━━━')
  const dims = ['narrativeTone','sentenceStyle','vocabularyStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','degradationRitual','humiliationTemplate','bodyMindBetrayal','compoundWordPattern']
  const dimLines = dims.map(k => {
    const labels: Record<string,string> = {narrativeTone:'叙事基调',sentenceStyle:'句式',vocabularyStyle:'词汇',bodyLanguageStyle:'身体描写',sensoryStyle:'感官',tensionStyle:'心理张力',degradationRitual:'场景机制',humiliationTemplate:'羞辱公式',bodyMindBetrayal:'身心背离',compoundWordPattern:'造词模式'}
    return `  ${k}: ${labels[k]||k}`
  }).join('\n')

  const prompt = `你是专业的文学风格分析师。请对以下章节进行深度写作风格分析。

【启用的分析维度】
${dimLines}

【输出格式】严格按以下格式（不要markdown代码块）：

=== [维度key]: [中文标签] ===
（200-400字深度分析，引用原文具体词句作为证据）

（每个维度重复以上格式）

---VOCABULARY---
["词1","词2","词3",...]

---RULES---
["规则1","规则2","规则3",...]

---TONE---
{"word":"基调词","description":"100字基调描述","attitude":"叙述者态度"}

【硬性要求】
1. VOCABULARY 必须是原文实际出现的词
2. RULES 必须可直接执行的写作指令
3. 不要用代码块
4. 数组/对象必须合法JSON

【待分析文本】
${SOURCE.slice(0, 10000)}`

  const resp = await client.chat.completions.create({
    model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }],
    temperature: 0.2, max_tokens: 6000,
  })
  const t = resp.choices[0]?.message?.content || ''
  await fs.writeFile('demo_output/v12-raw-reply.txt', t)

  // Parse V3 blocks
  const parseBlock = (marker: string): string[] => {
    const idx = t.indexOf(marker)
    if (idx < 0) return []
    const after = t.slice(idx + marker.length)
    const nextMarkers = ['---VOCABULARY---','---RULES---','---TONE---']
    const nextIdx = Math.min(...nextMarkers.map(m => { const i = after.indexOf(m); return i >= 0 ? i : Infinity }))
    const block = (nextIdx < Infinity ? after.slice(0, nextIdx) : after).trim()
    for (const c of [block, block.replace(/,(\s*[\]])/g,'$1')]) {
      try { const m = c.match(/\[[\s\S]*\]/); if (m) { const arr = JSON.parse(m[0]); if (Array.isArray(arr)) return arr.filter((x: unknown): x is string => typeof x === 'string') } } catch {}
    }
    return []
  }
  const vocab = parseBlock('---VOCABULARY---')
  const rules = parseBlock('---RULES---')
  let toneWord = '', toneDesc = '', toneAttitude = ''
  const tIdx = t.indexOf('---TONE---')
  if (tIdx >= 0) {
    try {
      const after = t.slice(tIdx + 11)
      const endIdx = Math.min(...['---VOCABULARY---','---RULES---'].map(m => { const i = after.indexOf(m); return i >= 0 ? i : Infinity }))
      const block = (endIdx < Infinity ? after.slice(0, endIdx) : after).trim()
      const om = block.match(/\{[\s\S]*?\}/)
      if (om) { const obj = JSON.parse(om[0].replace(/,(\s*[}\]])/g,'$1')); toneWord = obj.word||''; toneDesc = obj.description||''; toneAttitude = obj.attitude||'' }
    } catch {}
  }

  // Count dimension sections
  const dimMatches = t.match(/=== .*? ===/g) || []
  console.log(`  ✓ 维度: ${dimMatches.length}/${dims.length} | 词汇: ${vocab.length} | 规则: ${rules.length} | 基调: "${toneWord}"`)
  return { vocab, rules, toneWord, toneDesc, toneAttitude, dimCount: dimMatches.length }
}

async function generate(a: any) {
  console.log('\n━━━ V12 阶段2: 约束生成 ━━━')
  const vocab = a.vocab?.length > 0 ? a.vocab.slice(0, 60).join('、') : '大鸡巴、菊穴、淫穴、马蹄铁骚穴、肏、母狗、母猪、贱婊子、废物、蜜桃美臀、冷艳熟妇、正太炮友、深喉、虐腹、精液浴、翻白眼、潮吹'
  const rules = a.rules?.length > 0 ? a.rules.slice(0, 10).map((r: string, i: number) => `${i+1}. ${r}`).join('\n') : '1. 每段羞辱后紧跟身体反应（翻白眼/喷水/鼻血/痉挛）\n2. 保持冷漠残酷的叙述语气\n3. 权力反转通过具体动作展示（踩/扇/踹/骑）'

  const prompt = `你是精通复仇支配题材的AI写手。请严格模仿原文风格续写（4500-7000字）。

【叙事基调硬约束 — 最高优先级】
基调词: ${a.toneWord || '冷酷复仇的性支配'}
${a.toneDesc || ''}
叙事情感: ${a.toneAttitude || '叙述者以冷漠、欣赏、掌控的眼光看待施虐场景'}
- 全文维持"冷静残酷地描写极端暴力性行为"的叙事距离
- 情色程度只增不减，结尾不可降调

【必须使用的词汇库】
${vocab}

【写作规则】
${rules}

【场景】
冷雪晴看到二楼走下来的是庄薇薇——她的亲生女儿。庄薇薇穿着和庄玉配套的情侣睡衣，手里拿着手机正在拍摄。冷雪晴这才明白，这对姐弟早已联手策划了这一切。庄薇薇走到母亲面前，轻蔑地说她早就受不了母亲的恶毒，她现在的主人只有庄玉一个。庄玉命令母女二人同时跪在他面前，轮流舔他的鸡巴和卵蛋。冷雪晴从震惊转为屈服，和女儿一起服侍这个曾经被她虐待的少年。庄玉坐在床上享受母女双人的口交侍奉，一边辱骂一边指导。最后他选择在冷雪晴的子宫里射精——让她怀上仇人的孩子。

【额外铁律】
1. 权力反转: 通过空间位置（跪/踩/骑）+语言（辱骂/命令）+身体反应展示
2. 暴力+快感同框: 每个暴力动作后面紧跟被虐者的反常快感（翻白眼/喷水/鼻血/淫叫）
3. 身份反差: 反复强调"曾经虐待继子的冷艳继母"→"现在跪着舔鸡巴的母狗"
4. 母女双人: 冷雪晴和庄薇薇同时服侍，但待遇不同——薇薇受宠、雪晴受虐
5. 字数: 4500-7000字，禁止降调结尾

请直接输出小说正文。`

  const resp = await client.chat.completions.create({
    model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }],
    temperature: 0.88, max_tokens: 8000,
  })
  return resp.choices[0]?.message?.content || ''
}

async function main() {
  await fs.mkdir('demo_output', { recursive: true })
  console.log('╔══════════════════════════════════════╗')
  console.log('║  V12 — 继母复仇+冷虐支配+身份揭露  ║')
  console.log('╚══════════════════════════════════════╝\n')

  const analysis = await analyze()
  const imitation = await generate(analysis)
  await fs.writeFile('demo_output/v12-imitation.txt', imitation)

  console.log('\n' + imitation.slice(0, 400))
  console.log('…[MID]…')
  console.log(imitation.slice(-400))
  console.log(`\n字数: ${imitation.length} | 分析: ${analysis.dimCount}维/${analysis.vocab.length}词/${analysis.rules.length}则/基调"${analysis.toneWord}"`)
}

main().catch(err => { console.error('失败:', err.message); process.exit(1) })
