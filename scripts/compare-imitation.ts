/**
 * 风格仿写对比分析 — 原文 vs AI仿写
 *
 * 用法:
 *   cd d:/3/novel-writing-app
 *   npx tsx scripts/compare-imitation.ts [原文路径] [仿写路径]
 *
 * 默认路径（与 analyze-and-imitate.ts 输出一致）:
 *   原文: ../风格蒸馏演示/sample-input.txt
 *   仿写: ../风格蒸馏演示/测试-AI模仿生成.txt
 */

import * as fs from 'fs'
import * as path from 'path'

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
const OUT_DIR = 'd:/3/风格蒸馏演示'

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 4096 }),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return ((await res.json()) as any).choices?.[0]?.message?.content || ''
}

async function main() {
  const origPath = process.argv[2] || path.join(OUT_DIR, 'sample-input.txt')
  const imitPath = process.argv[3] || path.join(OUT_DIR, '测试-AI模仿生成.txt')
  const reportPath = path.join(OUT_DIR, '测试-对比分析报告.txt')

  if (!fs.existsSync(origPath)) { console.error('原文不存在:', origPath); process.exit(1) }
  if (!fs.existsSync(imitPath)) { console.error('仿写不存在:', imitPath); process.exit(1) }

  const original = fs.readFileSync(origPath, 'utf-8').slice(0, 4000)
  const imitation = fs.readFileSync(imitPath, 'utf-8').slice(0, 4000)

  console.log('═══════════════════════════════════════════')
  console.log(' 风格仿写对比分析 — 全新会话')
  console.log(` 原文: ${path.basename(origPath)} (${original.length} chars)`)
  console.log(` 仿写: ${path.basename(imitPath)} (${imitation.length} chars)`)
  console.log(` 评审: ${MODEL}`)
  console.log('═══════════════════════════════════════════')

  const prompt = `你是一位专业的情色文学评论家。请对比以下两段情色小说文本：

【原文片段】
${original}

【AI仿写片段】
${imitation}

请从以下维度进行对比分析，找出仿写的不足与亮点：

1. 情色描写密度与直白程度 — 仿写是否达到原文的描写密度、直白程度、体液细节和感官丰富度？
2. 拟声词系统 — 仿写是否复现了原文的拟声词密度、多样性和使用位置？
3. 身体部位称谓与复合词 — 仿写是否创造了同等质量的自造复合词？词汇的粗粝感和冲击力是否匹配？
4. 嘴硬体软/权力动态 — 角色之间的权力关系、羞辱递进、和"嘴上抗拒身体迎合"的动态是否到位？
5. 叙述者站姿 — 仿写的叙述者语气是否与原文匹配（赏玩/冷眼/共情）？是否有不该出现的惋惜或同情？
6. 羞辱递进链 — 羞辱是否有逐级递进到足够高的天花板？是否中途停止或降级？
7. 对话风格 — 辱骂词汇的创造力、对话中的拟声嵌入、权力句式和谄媚回应是否匹配？
8. 场景结构与节奏 — 场景是否具有原文的"长蓄力→短爆发→余韵"节奏？字数分配是否合理？
9. 称谓降格链 — 角色的身份称谓是否随场景推进逐步降格？
10. 总体评价 — 仿写最成功的地方和最需要改进的地方

请输出结构化的对比分析报告，每个维度标注 ✅(达标) / ⚠️(部分达标) / ❌(未达标)，并给出具体的原文vs仿写对比证据。最后给出总体改进建议。`

  console.log('\n[分析中...]')
  const report = await chat([{ role: 'user', content: prompt }])

  fs.writeFileSync(reportPath, report, 'utf-8')

  console.log(`\n完成！报告: ${reportPath}`)
  console.log(`\n${report.slice(0, 500)}...`)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
