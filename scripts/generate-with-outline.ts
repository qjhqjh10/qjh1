/**
 * 风格模板 + 锁定细纲 → 生成章节正文
 *
 * 用法:
 *   cd d:/3/novel-writing-app
 *   npx tsx scripts/generate-with-outline.ts
 *
 * 环境变量:
 *   TEST_RUN      - 测试轮次编号 (默认 '1'，与 analyze-and-imitate.ts 保持一致)
 *   AI_API_KEY    - DeepSeek API key (默认内置)
 *   AI_MODEL      - 模型 (默认 deepseek-v4-flash)
 *   AI_PROTOCOL   - 协议: anthropic(默认) | openai
 *   AI_TEMPERATURE - temperature (默认 1.0)
 */

import * as fs from 'fs'
import * as path from 'path'
import { chat } from './lib/chat'

const TEST_RUN = process.env.TEST_RUN || '1'
const OUT_DIR = 'd:/3/风格蒸馏演示'
const N = (name: string) => path.join(OUT_DIR, `${TEST_RUN}${name}`)

async function main() {
  const stylePromptPath = N('测试-风格注入Prompt.txt')
  const outlinePath = N('测试-细纲.yaml')

  if (!fs.existsSync(stylePromptPath)) {
    console.error('风格注入Prompt不存在:', stylePromptPath)
    console.error('请先运行: npx tsx scripts/analyze-and-imitate.ts')
    process.exit(1)
  }
  if (!fs.existsSync(outlinePath)) {
    console.error('细纲不存在:', outlinePath)
    process.exit(1)
  }

  const stylePrompt = fs.readFileSync(stylePromptPath, 'utf-8')
  const outlineYaml = fs.readFileSync(outlinePath, 'utf-8')

  console.log('═══════════════════════════════════════════')
  console.log(' 锁定细纲 + 风格模板 → 章节生成')
  console.log(` 风格模板: ${stylePrompt.length} chars`)
  console.log(` 细纲: ${outlineYaml.length} chars`)
  console.log(` 协议: ${process.env.AI_PROTOCOL || 'anthropic'} | 模型: ${process.env.AI_MODEL || 'deepseek-v4-flash'} | 温度: ${process.env.AI_TEMPERATURE || '1.0'}`)
  console.log('═══════════════════════════════════════════')

  const genPrompt = `你是一位专业的情色小说作家。请严格按照以下两层约束进行创作。

【第1层：风格模板】（语言层面最高优先级——每个字都必须符合）

${stylePrompt}

【第2层：锁定细纲】（场景/角色/情色内容已锁死——不可更改、不可逃逸、不可替换）

${outlineYaml}

═══════════════════════════════════════════
【执行指令】（极其重要，逐条执行）

1. 按照"剧情锁"的10个Phase（P1到P10）顺序推进，不可跳过、不可合并、不可调换顺序。

2. 角色和装置已锁死。不要发明新角色、不要发明新装置、不要添加"救星"或"反转"。姜曼秋就是秋婊子，姜小晚就是晚婊子，曹猛就是复仇的保安队长。肛塞+尿道棒就是唯一装置。

3. 语言必须100%遵循风格模板中的约束。尤其是：
   - 粗俗直白：鸡巴、肉穴、骚穴、屁眼、奶子、肏、婊子
   - 复合词：至少创造3个新的自造复合词（如丝袜母狗、精液厕所）
   - 拟声词轰炸：每段至少3种（啪啪啪、噗嗤、呲溜、哇哇哇、咕嘟、咯咯、呕呕）
   - 感官密度：每段同时触及视觉+听觉+触觉/嗅觉

4. 篇幅分配：
   - 背景铺垫 ≤15%（P1-P2可适当铺垫，但不要过长）
   - 情色互动 ≥85%（P3-P10必须密集）

5. 叙述者站姿：冷眼赏玩——不要共情、不要同情、不要对母女表示惋惜。
   叙述者眼中的母女就是两头发情的母狗，她们的痛苦就是看点。

6. 直接输出正文，从P1开始，到P10结束。不要额外说明、不要分析、
   不要标注"Phase X"。一气呵成写完整段情色场景。

7. 目标字数：2500-3500字纯正文。`

  console.log('\n[生成中...]')
  const generated = await chat([{ role: 'user', content: genPrompt }], { maxTokens: 8192 })

  const outputPath = N('测试-细纲生成.txt')
  fs.writeFileSync(outputPath, generated, 'utf-8')

  console.log(`\n完成！`)
  console.log(`  输出: ${outputPath}`)
  console.log(`  字数: ${generated.length} chars`)
  console.log(`  预览 (前300字):`)
  console.log(`  ${generated.slice(0, 300)}...`)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
