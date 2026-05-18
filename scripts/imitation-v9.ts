/**
 * V9 — 测试新增的角色构架+服装功能+动作微观+心理深度
 * 场景: 多人（真理子+由美+新妈妈），验证差异化描写
 */
import OpenAI from 'openai'
import * as fs from 'fs/promises'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
})

const SOURCE = `"唔，就是这里吗？"我拿着粉色的宣传单，站在一条漆黑的走廊里。
"这也太偏僻了吧……"我苦恼地将那张诱惑的传单拿起来放在昏暗的路灯下，上面用粉媚的字体写着——"人妻??妈妈娼馆??"。
"变回小宝宝，在妈妈们丰满的怀抱里撒娇吧????"这种广告词让我无法拒绝。
"欢迎光临??～??"意识清醒过来的时候，我已经处在一个粉色温馨的房间。
一位神秘美熟女出现在我面前，香草色的柔顺秀发梳成很有人妻味道的刘海，下面是翡翠色的柔情桃花媚眼，右眼的下角一颗泪痣。
高挑的身材，丰盈挺翘的超规格乳房，不堪盈握的蛇腰，一扭一扭的淫硕肥臀，穿着魔改的超级暴露Y字开叉情趣泳装，浑身上下除了黑丝没有几片布料。
"今天想要指名哪位妈妈呢??～??"美熟妇弯下腰，两颗爆乳勾勒出雌诱雪腻的深邃乳沟。
"诶……诶？??"我发现我的身体变小了——175cm的成人变成了小孩子，皮肤也变得幼嫩。
"嗯??～？原来第一次来的乖宝宝呀，咯咯咯????"真理子妈妈捂住嘴娇笑着。
"居然还是处男吗？那很抱歉哦，为了让宝宝的第一次能有完美的体验，要更适合新手宝贝的妈妈才行呢??～??"真理子转过身去叫由美妈妈。
…………
"让由美妈妈看看～真的好可爱呀??"一位棕发双马尾的柔情人妻女仆将我抱起。Pcup的爆乳埋住了我的小脑袋。白丝手套托住我的小屁股，白丝吊带长筒袜包裹的丰腴美腿夹住我的小鸡鸡。
"人家是你一个人的妈妈哟??～"由美妈妈媚眼如丝，"胸围114cm Pcup，腰围57cm，臀围92cm安产型，大腿52cm。妈妈的敏感点在很浅的位置，轻松可以插到哦??"`

// ============================================================
// 风格分析（简化版，聚焦多人场景+服装+动作微观）
async function analyze() {
  console.log('━━━ 阶段1: 风格分析 ━━━')
  const prompt = `分析以下日系"妈妈娼馆"成人小说。聚焦三个维度，输出JSON:
1. characterDiff: 真理子和由美两个角色的差异化描写策略(年龄/语调/身材/服装/性技/对宝宝的态度)
2. costumeErotic: 服装作为情色道具的具体技法(泳装Y字开叉/黑丝/女仆装/白丝手套/胯帘/丁字裤/高跟鞋)
3. microMovement: 动作微观分解技法(龟头触碰阴唇的逐帧描写/手指抚摸的精度/口腔内部的微观视角)

输出格式: { "characterDiff": {...}, "costumeErotic": {...}, "microMovement": {...} }`

  const resp = await client.chat.completions.create({
    model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt + '\n\n' + SOURCE }],
    temperature: 0.2, max_tokens: 3000,
  })
  const t = resp.choices[0]?.message?.content || ''
  const m = t.match(/\{[\s\S]*\}/)
  let result: any = {}
  if (m) {
    try { result = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1')) } catch {
      try { const lb = m[0].lastIndexOf('}'); result = JSON.parse(m[0].slice(0, lb + 1).replace(/,(\s*[}\]])/g, '$1')) } catch {}
    }
  }
  console.log(`  ✓ 分析完成`)
  return result
}

async function generate(analysis: any) {
  console.log('\n━━━ 阶段2: 约束生成 ━━━')

  const prompt = `你是精通日系"妈妈娼馆"题材的AI写手。续写场景(4000-6000字)。

【场景】
由美妈妈让我体验完素股后，温柔地帮我擦拭满身汗液。这时真理子敲门进来，说新来了一位"雪柔妈妈"——银发灰瞳的俄罗斯混血巨乳美熟女，想要来见见这位可爱的处男宝宝。于是三位妈妈（真理子/由美/雪柔）围着我，开始竞争谁能让宝宝得到最多的快乐。雪柔妈妈带来了一套新玩具。

【三位妈妈的角色名片 — 每人必须有差异化的身体描写和性格语气】
- 真理子: 香草色长发，翡翠色桃花眼，泪痣，冷艳外表+内在骚浪。Y字开叉黑丝泳装。修长高挑型。语调: "??""咯咯"多，表面高冷实则最易发情
- 由美: 棕色双马尾人妻辫+蓝色蝴蝶结，巧克力色桃花眼，温柔女仆。114cm Pcup棉乳，白丝手套+白丝吊带+白色开档丁字裤。丰满安产型。语调: "??""宝贝"多，温柔耐心
- 雪柔: 银灰色长发+灰色瞳孔，俄罗斯混血，皮肤雪白到近乎透明，浅粉色乳晕，比由美还大一圈的Qcup爆乳，花瓣唇，白虎小穴，身高178cm。穿银色亮片镂空连体衣+透明高跟鞋。语调: "??""小主人"多，神秘优雅

【服装情色功能要求】
- 每位妈妈的服装必须逐件描写（材质/颜色/剪裁/开衩/透明/蕾丝）
- 脱衣必须逐层（第一件→第二件→第三件），每层至少60字
- 服装与身体的互动: 布料如何勒入、蕾丝如何印痕、黑丝如何反光、透明布料下的乳头颜色
- 高跟鞋声、手套触感、项链/铃铛/亮片的装饰音

【动作微观分解要求】
- 禁止"她舔了我""她含住"等概括句
- 每个动作分解为: 姿势→接近→接触触感(温/湿/软硬)→力度→时长→身体反应
- 口交: 嘴唇触感→舌尖探出→舌面纹理→唾液分泌→口腔温度→喉咙深度
- 三人口交/乳交必须同时描写交替进行，不同触感叠加

【萌系装饰符】
- 每段对话至少1次"??""??""??""??""??"
- "～??""～??"波浪线+音符组合至少出现20次
- 长度: 4000-6000字

请直接输出小说正文。不要标题和说明。`

  const resp = await client.chat.completions.create({
    model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }],
    temperature: 0.88, max_tokens: 8000,
  })
  const result = resp.choices[0]?.message?.content || ''
  return result
}

async function main() {
  await fs.mkdir('demo_output', { recursive: true })
  console.log('╔══════════════════════════════════════╗')
  console.log('║ V9 — 角色构架+服装功能+动作微观     ║')
  console.log('╚══════════════════════════════════════╝\n')

  const analysis = await analyze()
  const imitation = await generate(analysis)
  await fs.writeFile('demo_output/v9-imitation.txt', imitation)

  console.log(`\n━━━ 生成结果 (${imitation.length}字) ━━━`)
  console.log(imitation)

  // Stats
  const waveTilde = (imitation.match(/～/g) || []).length
  const hearts = (imitation.match(/[??????]/g) || []).length
  const bodyDetails = (imitation.match(/cm|cup|mm/gi) || []).length
  console.log(`\n装饰符: ～${waveTilde}个 ??${hearts}个 | 身体数据: ${bodyDetails}处`)
}

main().catch(err => { console.error('失败:', err.message); process.exit(1) })
