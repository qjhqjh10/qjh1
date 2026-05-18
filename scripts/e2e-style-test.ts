/**
 * E2E 端到端测试：风格模板 → 章节创作的完整链路
 * 用法: OPENAI_API_KEY=xxx npx tsx scripts/e2e-style-test.ts
 */
import OpenAI from 'openai'
import * as fs from 'fs/promises'
import { buildStylePrompt, convertTemplateToProfile } from '../src/utils/styleInjector'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
})
const MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash'

// ============================================================
// 测试用例1: 修女教皇风格 (V6 — 宗教仪式感+微观解剖)
// ============================================================
const TEMPLATE_POPE: any = {
  name: '测试-修女教皇',
  type: '情色小说',
  worldType: '西幻',
  tone: { word: '神圣庄严的性仪式', description: '用宗教仪式般的庄严语气描写极端的肉体服侍', attitude: '神圣庄严' },
  fullDescription: '宗教仪式感+微观解剖式身体描写+多人服侍+权力不对等通过身体尺寸展示',
  dimensions: {
    narrativeTone: { description: '基调: 神圣庄严的性仪式 — 用宗教仪式般的庄严语气描写极端的肉体服侍', vocabularyList: ['教皇大人','修女','服侍','神圣','考验','仪式'], writingRules: ['用宗教术语包装性行为','叙述者保持庄严不评判的语气'] },
    bodyLanguageStyle: { description: '身体描写的扫描顺序为从上到下，对口腔内部(舌下腺/唾液管)、皮肤纹理、阴毛修剪进行极限微观特写，熟女身体美学强调"肥而不垂""熟透却不下垂"。', vocabularyList: ['腻白乳肉','肥厚熟靡','厚靡软舌','舌下腺','包皮缝','豆丁','皮扣项圈','巨乳肥臀','肉厚堆叠','肥硕花白'], writingRules: ['每个身体部位至少3-5个形容词堆叠','口腔内部必须展开200字以上的微观解剖','熟女身体描写强调"肥而不垂"的美学'] },
    sensoryStyle: { description: '触觉>嗅觉>视觉的感官比例，体液描写附带颜色+温度+黏稠度。口腔内部的温度和唾液黏稠度是核心感官描写对象。', vocabularyList: ['粘稠','湿滑','温热','软腻','腥骚','苦涩','甜腥','乳香','汗酸'], writingRules: ['每次体液描写附带颜色+温度+黏稠度+气味','口腔温度和唾液分泌量必须明确'] },
    sentenceStyle: { description: '极长身体描写句(50-100字)与极短动作/拟声句(2-5字)交替。第三人称全知叙述。严格的段落分段，每段100-300字。', writingRules: ['每段100-300字','段间用空行分隔','长句堆叠3-5感官','短句用于动作/拟声/命令'] },
  },
}

// ============================================================
// 测试用例2: 妈妈娼馆风格 (V8 — 日系萌系+第一人称)
// ============================================================
const TEMPLATE_MAMA: any = {
  name: '测试-妈妈娼馆',
  type: '情色小说',
  worldType: '日系',
  tone: { word: '温柔母性的性教学', description: '用温柔母性语气和萌系装饰包装极端的性行为', attitude: '温柔包容' },
  fullDescription: '日系萌系第一人称+妈妈娼馆+身体缩小幻想+温柔母性语气+身体数据化+服装情色化',
  dimensions: {
    narrativeTone: { description: '基调: 温柔母性的性教学 — 用"妈妈疼爱宝宝"的母性叙事框架包装性行为', vocabularyList: ['妈妈','宝贝','宝宝','主人','??','??'], writingRules: ['所有性行为用"妈妈疼爱宝宝"框架包装','对话后缀用??/??/??','禁止粗俗脏话'] },
    bodyLanguageStyle: { description: '身体数据化描写(114cm/Pcup/57cm/92cm/52cm/4mm/4.8cm)，服装逐层精描，身体缩小后的小鸡鸡vs巨乳肥臀的尺寸对比', vocabularyList: ['Pcup','棉乳','安产型','驼趾型','洗面奶','包茎小鸡鸡','豆丁','爆乳','白丝','黑丝','胯帘','丁字裤','女仆装','开档'], writingRules: ['身体部位用具体数字(cm/mm/cup)','服装逐件逐层描写','小鸡鸡vs巨乳的尺寸对比反复强调'] },
    sensoryStyle: { description: '触觉主导(柔软/温热/湿滑)，服装材质触感(白丝的滑腻/黑丝的弹性/蕾丝的花纹)，口腔内部的温度和唾液触感', vocabularyList: ['柔软','温热','湿滑','滑腻','弹性','棉柔','蕾丝','丝滑','冰丝','透肉'], writingRules: ['服装材质触感至少80字','口腔温度/唾液必须描写'] },
    sentenceStyle: { description: '第一人称"我"视角+大量内心独白+萌系对话后缀+每段100-300字+段间空行分隔', writingRules: ['第一人称"我"视角','大量内心独白','每段100-300字','段间空行分隔'] },
  },
}

// ============================================================
async function runTest(name: string, template: any, scenePrompt: string) {
  console.log(`\n━━━ ${name} ━━━`)

  // Step 1: Build style prompt from template
  const profileWrapper = convertTemplateToProfile(template)
  const stylePrompt = buildStylePrompt(profileWrapper)
  console.log(`  ✓ 风格prompt: ${stylePrompt.length}字`)

  // Step 2: Build full generation prompt (simulating ChapterGenerationModal)
  const fullPrompt = [
    stylePrompt ? `---\n${stylePrompt}\n---` : '',
    `【章节信息】`,
    `章节标题: 测试章节`,
    scenePrompt,
    `【创作要求】`,
    `写出一章完整的小说正文。注意人物性格一致性，对话符合角色身份。`,
    `正文用空行分隔自然段，每段100-300字。字数目标: 3000字以上。`,
  ].filter(Boolean).join('\n\n')

  // Step 3: Call AI
  console.log(`  ⏳ 生成中...`)
  const resp = await client.chat.completions.create({
    model: MODEL, messages: [{ role: 'user', content: fullPrompt }],
    temperature: 0.85, max_tokens: 6000,
  })
  const result = resp.choices[0]?.message?.content || ''

  // Step 4: Validate
  const paragraphs = result.split(/\n\n+/).filter(p => p.trim().length > 30)
  const wordCount = result.length
  const hasVocab = template.dimensions?.bodyLanguageStyle?.vocabularyList?.some((w: string) => result.includes(w))

  console.log(`  字数: ${wordCount}`)
  console.log(`  段落数: ${paragraphs.length} (≥5? ${paragraphs.length >= 5 ? '✅' : '❌'})`)
  console.log(`  字数达标: ${wordCount >= 3000 ? '✅' : '❌'}`)
  console.log(`  词汇匹配: ${hasVocab ? '✅' : '⚠'}`)

  return { result, paragraphs, wordCount, hasVocab }
}

async function main() {
  await fs.mkdir('demo_output', { recursive: true })

  console.log('╔══════════════════════════════════════╗')
  console.log('║  E2E 风格模板→章节创作 链路测试     ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  模型: ${MODEL}\n`)

  // Test 1: Pope style
  const popeScene = `【场景设定】
辛西娅修女总管跪在特鲁教皇面前，汇报新一轮服侍的安排。三位新修女（伊莎贝尔/卡特琳娜/朱莉安娜）鱼贯而入。特鲁坐在床上，身体仍然是男孩形态。辛西娅宣布比赛——哪位修女能用身体让教皇再次勃起，就能获得今晚陪侍的荣耀。`
  const pope = await runTest('测试1: 修女教皇风格', TEMPLATE_POPE, popeScene)

  // Test 2: Mama style
  const mamaScene = `【场景设定】
由美妈妈用柔软的毛巾擦干我身上的汗珠后，温柔地把我放在她Pcup的巨乳之间。我像小宝宝一样埋在她柔软乳沟里。由美妈妈轻声说接下来要教我更舒服的事情，她的手慢慢滑向我那只包茎小鸡鸡。`
  const mama = await runTest('测试2: 妈妈娼馆风格', TEMPLATE_MAMA, mamaScene)

  // Summary
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║           测试总结                   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  教皇风格: ${pope.wordCount}字 ${pope.paragraphs.length}段 ${pope.paragraphs.length >= 5 && pope.wordCount >= 3000 ? '✅' : '❌'}`)
  console.log(`  妈妈风格: ${mama.wordCount}字 ${mama.paragraphs.length}段 ${mama.paragraphs.length >= 5 && mama.wordCount >= 3000 ? '✅' : '❌'}`)

  await fs.writeFile('demo_output/e2e-pope.txt', pope.result)
  await fs.writeFile('demo_output/e2e-mama.txt', mama.result)
  console.log('\n输出: demo_output/e2e-pope.txt + e2e-mama.txt')
}

main().catch(err => { console.error('E2E失败:', err.message); process.exit(1) })
