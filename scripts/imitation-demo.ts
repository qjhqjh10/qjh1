/**
 * 仿写演示脚本 — 整合风格工坊 + 场景工坊 + 仿写模块
 * 用法: npx tsx scripts/imitation-demo.ts
 * 环境变量: OPENAI_API_KEY, OPENAI_BASE_URL (可选), OPENAI_MODEL (可选)
 */

import OpenAI from 'openai'
import * as fs from 'fs/promises'

// ============================================================
// 配置 — 可通过环境变量覆盖
// ============================================================
const API_KEY = process.env.OPENAI_API_KEY || ''
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const EMBEDDING_MODEL = 'text-embedding-3-small'

if (!API_KEY) {
  console.error('请设置环境变量 OPENAI_API_KEY')
  process.exit(1)
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL })

// ============================================================
// 待分析的源文本
// ============================================================
const SOURCE_TEXT = `夕阳西下，蛮越王子的车队在一阵车轮滚动的辚辚声中，缓缓驶入了这座位于两国交界处的驿站。驿站的驿丞早已带着一众驿卒在门口恭候，脸上堆满了讨好的笑容。那辆最为豪华宽大的马车在驿站大门前停稳，车帘被一只粗糙厚大的手掌猛地掀开，露出了蛮越王子那张肥硕油腻的脸庞。
他摇晃着那肥硕如肉山的躯体，踩着奴仆的背下了车，然后转过身，对着车厢内发出了一声沉闷厚重的低吼："都给本王子下来！别磨磨蹭蹭的！"
随着他的命令，车厢内陆续走出了一群身姿曼妙的女子。她们个个头戴轻薄的黑色面纱，遮住了大半张脸，只露出一双双或是媚眼如丝、或是麻木顺从的眼睛。然而，最引人注目的却是她们身上的穿着。那根本不能称之为衣服，不过是几片勉强遮住私密部位的艳俗情趣布料，大片雪腻雌焖的肌肤暴露在空气中，那对对肉厚沉甸的淫熟骚奶随着她们的动作剧烈晃动，那浑圆饱满的焖油雌尻更是被勒出了深深的肉痕。
这群女子正是曾经名动大虞的四圣、诗凤雪凰以及林家母女。她们低眉顺眼地跟在王子身后，丝毫不在意周围那些驿卒和路人投来的惊愕、贪婪且充满淫欲的目光，仿佛已经习惯了这种如同货物般被展示的命运。
紧接着，几个身材魁梧的蛮越卫士从后面的马车上搬下了两个造型奇特的大木桶。这两个木桶被设计得极为奇怪，桶身封闭，却在特定的位置开了几个孔洞。
"哎哟，王子殿下，这……这是什么稀罕物件？"驿丞看着那两个大桶，忍不住好奇地问道，那双贼溜溜的眼睛却一直往桶上那些孔洞里瞟。
"嘿嘿嘿，这可是本王子的宝贝！"王子发出了得意的淫笑，他走到其中一个木桶前，伸手拍了拍桶壁，"这是本王子新收的两个美女奴，专门用来当做肉便器的！你看！"
他指着桶的一面，那里露出了一个女子的头部和两只手掌。那女子的嘴里被塞着一个巨大的红色口球，只能发出呜呜的声音，双眼被黑色的眼罩遮住，无法视物。而桶的另一面，则更加不堪入目，两个圆润的孔洞中，赫然露出了两瓣白皙肥嫩的焖油雌尻，以及一双晶莹剔透的柔软玉足。那肥硕的臀肉被卡在孔洞边缘，挤压出一圈诱人的肉棱，中间那紧致的幽深菊穴和粉嫩肉穴更是毫无遮掩地暴露在众人的视线之中。
"这……这也太……"驿丞咽了口唾沫，只觉得下腹一阵燥热。他哪里知道，这两个被当做牲畜般展示的女子，正是前几日在太和殿上意气风发、怒斥蛮夷的大虞宰相苏晚晴和剑妃李沧澜！
此刻的她们，被困在这狭窄黑暗的桶中，身体无法动弹分毫，只能被迫摆出最屈辱的姿势，任由那冷风吹拂着她们最私密的部位，任由周围那些男人用目光肆意强奸着她们的身体。
"行了，别看了！再看把你眼珠子挖出来！"王子骂了一句，随后挥了挥手，"把这两个肉便器抬到马棚里去！今晚就让她们在那里过夜！至于这些美人儿嘛……"他回过头，淫邪的目光扫过身后那一排衣着暴露的女眷，"当然是跟本王子去上房，好好地伺候本王子！"
卫士们哄笑着抬起那两个沉重的大桶，朝着散发着难闻气味的马棚走去。苏晚晴和李沧澜只觉得身体一阵颠簸，随后便被重重地放在了满是干草和马粪的地上。
王子并没有让人给她们松绑，反而让人检查了一下她们身上的束缚。她们的嘴里依旧塞着口球，眼罩依旧遮挡着视线，不过在她们那露在外面的私处上加上了一把冰冷的贞操锁，只留出一个小孔用来排泄。
"呜呜……"苏晚晴在桶里发出微弱的悲鸣，她的身体因为恐惧和屈辱而剧烈颤抖着。她能感觉到马棚里那股刺鼻的马尿味，以及不远处传来的马匹的喷鼻声。曾经权倾朝野的宰相，如今却沦落到与牲畜同眠的地步。
夜色渐深，驿站的喧嚣逐渐平息。然而，马棚这边却并不平静。几个胆大的大虞路人，或是商队的伙计，或是驿站的杂役，借着夜色的掩护，鬼鬼祟祟地摸进了马棚。他们白天就听说了那两个美女奴的传闻，此刻哪里按捺得住心中的好奇与淫欲。
借着微弱的月光，他们看清了那两个横陈在草堆上的大桶，以及那桶外露出的白花花的肉体。
"乖乖……这屁股……真他娘的大啊！"一个伙计压低了声音惊叹道，他伸出粗糙的手，在那露出的雌熟肥腻的焖油雌尻上狠狠捏了一把。
"啪！"
"呜！"桶里传来一声闷哼，那臀肉猛地收缩了一下，却根本无处可逃。
"这脚也是极品！又白又嫩！"另一个杂役抓住了那双露在外面的莹润柔软的玉足，放在手里肆意把玩，甚至还凑上去闻了闻，"真香啊……一股子女人味儿！"
这群男人围着这两个大桶，肆无忌惮地上下其手。他们不敢真的破坏那个贞操锁，但那露在外面的一大片雪白肌肤，已经足够让他们疯狂了。
"不行了……老子受不了了！"一个男人喘着粗气，解开了裤腰带，掏出了自己那根硬邦邦的肉棒，对着苏晚晴那露出的肥硕臀部就开始撸动起来。
其他的男人见状，也纷纷效仿。一时间，马棚里充满了男人粗重的喘息声和手掌套弄肉棒的噗嗤噗嗤声。
"射给她！射给她！"
"噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！噗呲！"
随着几声低吼，几股温热腥臭的雄浆喷射而出，噼里啪啦地打在这两个大虞女人裸露在外的臀部和大腿上。那白浊的液体顺着她们光滑的肌肤缓缓流淌，滴落在肮脏的草堆上。
桶里的两人虽然看不见，但那温热黏腻的触感和那股浓烈的腥膻味，让她们瞬间明白了发生了什么。那种被当做公厕般使用的极致屈辱感，让她们的身体不受控制地痉挛起来。然而，在这无尽的羞耻深处，她们那具早已被开发过的骚淫痴傻的雌畜肉体，竟然产生了一丝诡异的、下贱的兴奋。
"嗯齁……呜……"苏晚晴的喉咙里发出一声压抑的呻吟，她那被贞操锁束缚的肥厚肉屄，竟然开始不受控制地分泌出淫靡雌汁，混合着外面那些男人射上来的精液，让那里变得更加泥泞不堪。`

// ============================================================
// 步骤1: 情色提取 (仿写模块 - 场景工坊使用)
// ============================================================
async function extractErotic(chapterTitle: string, chapterContent: string) {
  console.log('━━━ 步骤1: 情色提取 ━━━')
  console.log(`  分析: "${chapterTitle}" (${chapterContent.length}字)`)

  const prompt = `你是一位专业的小说分析师。请分析以下小说章节，提取结构化信息。

【章节标题】${chapterTitle}
【章节内容】
${chapterContent}

请严格输出以下 JSON（不要markdown，不要额外说明）：
{
  "characters": [{"name": "角色名", "aliases": ["别名"], "role": "身份/角色", "traits": ["特征"], "appearance": "外貌描写", "action": "本章行动", "newInfo": "本章新增信息"}],
  "worldbuilding": [{"type": "location/rule/history/other", "name": "名称", "description": "描述", "newInfo": "新增信息"}],
  "items": [{"name": "道具名", "type": "类型", "grade": "品级", "owner": "持有者", "ability": "能力", "acquisitionMethod": "获取方式"}],
  "chapterSummary": "150-300字详细摘要，包含起因经过结果和情感转折",
  "events": ["关键事件"],
  "emotionalTone": "本章情绪基调",
  "erotic": {
    "characterRoles": [{"name": "角色名", "domSub": "dom或sub或switch", "bodyState": "正常/发情/改造/退行", "kinks": ["性癖"], "shameLevel": "高/中/低"}],
    "sceneFlow": [{"phase": "前戏/渐进/主戏/高潮/收尾", "actions": ["动作"], "bodyReactions": ["反应"], "duration": "短/中/长"}],
    "techniques": {"bodyFluids": ["体液"], "touchFocus": ["部位"], "soundStyle": "稀疏/适量/密集/极密集", "moanDensity": "稀疏/适量/密集/极密集"},
    "powerDynamics": "权力关系和变化",
    "degradationPatterns": ["羞辱模式"]
  }
}

要求:
1. 只提取文中明确写出或强烈暗示的信息
2. 角色名使用文中原名称
3. chapterSummary必须详细（150-300字）
4. events至少列出5-8个关键事件点
5. erotic部分仔细分析情色要素`

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4000,
  })

  const text = resp.choices[0]?.message?.content || ''
  try {
    // Extract JSON from potential markdown blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const json = JSON.parse(jsonMatch ? jsonMatch[0] : text)
    console.log(`  ✓ 提取到 ${json.characters?.length || 0} 个角色`)
    console.log(`  ✓ ${json.chapterSummary?.slice(0, 80)}...`)
    return json
  } catch (e) {
    console.error('  ✗ JSON 解析失败:', String(e).slice(0, 100))
    return null
  }
}

// ============================================================
// 步骤2: 风格分析 (风格工坊 - 16维度)
// ============================================================
async function analyzeStyle(chapterContent: string) {
  console.log('\n━━━ 步骤2: 风格工坊 16维分析 ━━━')

  const DIMS: Record<string, { label: string; category: string; prompt: string }> = {
    sentenceStyle:    { label: '句式', category: '基础文风', prompt: '"sentenceStyle": "长短句偏好+标点习惯+段落结构"' },
    vocabularyStyle:  { label: '词汇', category: '基础文风', prompt: '"vocabularyStyle": "书面/口语倾向+高频词类+成语频率+自造词特征"' },
    rhetoricStyle:    { label: '修辞暗示', category: '基础文风', prompt: '"rhetoricStyle": "比喻/拟人/排比/通感/留白/间接描写技巧"' },
    rhythmStyle:      { label: '节奏结构', category: '基础文风', prompt: '"rhythmStyle": "快慢段落交替+场景切换频率+是否存在多线平行交叉"' },
    dialogueStyle:    { label: '对话', category: '基础文风', prompt: '"dialogueStyle": "对白占比+语气风格+人物语言差异性+方言/粗话使用"' },
    moodStyle:        { label: '氛围', category: '基础文风', prompt: '"moodStyle": "情绪基调+色调偏好(冷/暖/暗)+感官描写偏向"' },
    perspectiveStyle: { label: '视角', category: '进阶技法', prompt: '"perspectiveStyle": "叙述视角+内心独白频率+自由间接引语使用"' },
    bodyLanguageStyle:{ label: '身体描写', category: '进阶技法', prompt: '"bodyLanguageStyle": "身体部位描写习惯+生理反应追踪+解剖精度+具体修辞偏好"' },
    sensoryStyle:     { label: '感官', category: '进阶技法', prompt: '"sensoryStyle": "五感比例+拟声词使用+体液描写特色+气味描写密度"' },
    tensionStyle:     { label: '心理张力', category: '进阶技法', prompt: '"tensionStyle": "内心矛盾写法+欲望与压抑的拉扯+羞耻-兴奋的循环模式"' },
    descriptionPattern:{ label: '描写结构', category: '进阶技法', prompt: '"descriptionPattern": "描写顺序偏好+身体扫描模式+细节密度的分配"' },
    corruptionArc:    { label: '人物演变', category: '情色专属', prompt: '"corruptionArc": "角色堕落/演变的描写模式+身份消解过程+心理转变的阶梯"' },
    degradationRitual:{ label: '场景机制', category: '情色专属', prompt: '"degradationRitual": "凌辱场景模板+权力确认仪式+固定台词/句式+羞辱词表"' },
    narrativeVoice:   { label: '叙事声音', category: '情色专属', prompt: '"narrativeVoice": "叙事语气+极淫内容的反差写法+内心独白占比"' },
    shameVoyeurLoop:  { label: '心理循环', category: '情色专属', prompt: '"shameVoyeurLoop": "羞耻-窥视-兴奋循环的触发与放大方式"' },
    socialRealism:    { label: '社会现实', category: '类型专属', prompt: '"socialRealism": "阶层标记+身份描写+权力关系的物质化表现"' },
  }

  const fields = Object.entries(DIMS).map(([k, v]) => `  ${v.prompt}`).join(',\n')
  const prompt = `分析以下小说的写作风格特征。输出JSON（不要markdown）：\n{\n${fields},\n  "excerpts": [{"text": "代表性摘录(50字内)", "note": "体现的特征"}, ...共5个]\n}\n\n【待分析文本】\n${chapterContent.slice(0, 8000)}`

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4000,
  })

  const text = resp.choices[0]?.message?.content || ''
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const json = JSON.parse(jsonMatch ? jsonMatch[0] : text)
    console.log('  ✓ 风格分析完成:')
    for (const [k, v] of Object.entries(DIMS)) {
      const val = json[k]
      if (val && typeof val === 'string' && val.length > 0) {
        console.log(`    [${v.category}] ${v.label}: ${val.slice(0, 80)}...`)
      }
    }
    return json
  } catch (e) {
    console.error('  ✗ 风格分析JSON解析失败:', String(e).slice(0, 100))
    return null
  }
}

// ============================================================
// 步骤3: 基于风格画像生成仿写
// ============================================================
async function generateImitation(
  extraction: any,
  styleProfile: any,
) {
  console.log('\n━━━ 步骤3: 生成仿写 (综合风格工坊+场景工坊) ━━━')
  console.log('  使用提取的角色/世界观/场景 + 风格画像生成新章节')

  const chars = extraction?.characters?.map((c: any) => `${c.name}(${c.role}): ${c.traits?.join(',') || ''}`).join('; ') || ''
  const summary = extraction?.chapterSummary || ''
  const tone = extraction?.emotionalTone || ''

  // 提取风格关键特征
  const styleTraits: string[] = []
  if (styleProfile) {
    const keys = ['sentenceStyle', 'vocabularyStyle', 'rhetoricStyle', 'rhythmStyle',
                   'moodStyle', 'bodyLanguageStyle', 'sensoryStyle', 'tensionStyle',
                   'degradationRitual', 'shameVoyeurLoop']
    for (const k of keys) {
      if (styleProfile[k] && typeof styleProfile[k] === 'string') {
        styleTraits.push(`${k}: ${styleProfile[k]}`)
      }
    }
  }

  const prompt = `你是一位精通特定作家风格的AI写手。请根据以下信息，模仿原文风格，续写/模仿一个新的场景（约800-1200字）。

【原文剧情概要】
${summary}

【原文情绪基调】${tone}

【角色设定】
${chars}

【需严格模仿的风格特征】
${styleTraits.join('\n')}

【场景工坊约束】
- 场景: 蛮越王子在驿站休息后，第二天继续赶路。苏晚晴和李沧澜在桶中醒来，身上满是干涸的污渍。车队途经一个小镇，路人的目光让她们再次经历公开羞耻。
- 叙事结构: 先描写环境(清晨/小镇/路人的好奇)，再切换至桶中两人的身体感受(黏腻/僵硬/羞耻/身体不自觉的兴奋)，然后描写王子故意展示她们以羞辱大虞使团，最后以两人的心理活动收尾。
- 情色要素: 公开羞耻+身体不自觉的兴奋+权力展示+内心独白
- 关键风格特征:
  1. 必须使用大量情色化感官描写(气味/触感/温度)
  2. 必须使用"焖油雌尻""肥硕""淫熟""黏腻""淫靡雌汁"等特定词汇
  3. 对抗叙事: 屈辱场景中穿插身体的不自觉兴奋反应
  4. 权力展示: 通过空间关系和视觉效果展示权力不对等
  5. 拟声词+重复句式营造节奏

请直接输出小说正文，不要任何说明文字。`

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 3000,
  })

  const result = resp.choices[0]?.message?.content || ''
  console.log(`  ✓ 生成完成 (${result.length}字)`)
  console.log(`  Token: 输入${resp.usage?.prompt_tokens} 输出${resp.usage?.completion_tokens}`)
  return result
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   风格工坊 + 场景工坊 + 仿写 演示   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  模型: ${MODEL}\n`)

  // Step 1: 提取
  const extraction = await extractErotic('驿站之夜', SOURCE_TEXT)
  if (extraction) {
    await fs.mkdir('demo_output', { recursive: true })
    await fs.writeFile('demo_output/1-extraction.json', JSON.stringify(extraction, null, 2), 'utf-8')
  }

  // Step 2: 风格分析
  const styleProfile = await analyzeStyle(SOURCE_TEXT)
  if (styleProfile) {
    await fs.writeFile('demo_output/2-style-profile.json', JSON.stringify(styleProfile, null, 2), 'utf-8')
  }

  // Step 3: 生成仿写
  const imitation = await generateImitation(extraction, styleProfile)
  if (imitation) {
    await fs.writeFile('demo_output/3-imitation.txt', imitation, 'utf-8')
    console.log('\n━━━ 生成结果 ━━━')
    console.log(imitation)
    console.log('\n━━━ 全部结果已保存至 demo_output/ ━━━')
  }

  // 汇总
  const totalTokens = '—'
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║          演示完成                   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log('输出文件:')
  console.log('  demo_output/1-extraction.json  — 情节提取结果')
  console.log('  demo_output/2-style-profile.json — 16维风格画像')
  console.log('  demo_output/3-imitation.txt    — 仿写生成结果')
}

main().catch(err => {
  console.error('运行失败:', err.message)
  process.exit(1)
})
