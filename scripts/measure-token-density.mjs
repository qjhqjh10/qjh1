// ── ④ token 密度实测（DeepSeek 分词密度 → tokenEstimation 系数依据）──
// 构造已知字符数的文本，从 API 返回的 usage.prompt_tokens 反推 字符/token 密度。
// 用法: AI_API_KEY=sk-xxx npx tsx scripts/measure-token-density.mjs
// 模型可用 DEEPSEEK_MODEL 覆盖（默认 deepseek-v4-flash），API 地址用 DEEPSEEK_BASE_URL 覆盖
import OpenAI from 'openai'

if (!process.env.AI_API_KEY) {
  console.error('缺少 AI_API_KEY 环境变量（DeepSeek API key）')
  process.exit(1)
}

const client = new OpenAI({
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
})
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

// 固定开销：单条空消息的 prompt_tokens（每条消息的 role/格式开销）
async function measure(text) {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: text }],
    max_tokens: 1,
  })
  return res.usage?.prompt_tokens ?? 0
}

const samples = {
  '空消息(固定开销)': '',
  '纯中文(无标点)': '人'.repeat(1000),
  '中文小说段落': ('陆沉修复古剑后修为大涨，与剑灵苏念卿的关系逐渐亲密。他站在山巅，望着远方连绵的剑冢，心中暗下决心：一定要成为最强的剑修，不负师父的期望。') .repeat(8),
  '中文+全角标点': '。，！？；：（）《》'.repeat(90) + '“”‘’'.repeat(90),
  '纯英文': ('The quick brown fox jumps over the lazy dog and continues its journey across the meadow. ').repeat(30),
  '中英混合(代码注释风格)': ('// 初始化配置 config.initialize({ retries: 3, timeout: 5000 }) 然后开始处理任务 ').repeat(40),
  'JSON数据': JSON.stringify({ name: '燕轻尘', age: 17, description: '古剑宗弟子，剑意凌厉性格孤傲，师承剑宗长老，与陆沉是宿敌', tags: ['剑修', '孤傲', '宿敌'], list: Array(50).fill('剑意传承') }),
  'Markdown章节': ('# 第三章 剑意传承\n\n> 剑鸣三日不止，天地变色。\n\n陆沉在传承密室得到剑宗老祖的剑意传承，剑鸣三日不止。\n\n- 第一点：传承内容\n- 第二点：剑意本质\n\n```yaml\nname: 剑意\nlevel: 9\n```\n').repeat(10),
}

console.log('样本 | 字符数 | tokens | 字符/token | token/字符')
console.log('-'.repeat(60))
for (const [name, text] of Object.entries(samples)) {
  try {
    const tokens = await measure(text)
    if (tokens === 0) { console.log(`${name} | ${text.length} | 测量失败（usage 缺失）`); continue }
    const density = text.length > 0 ? (text.length / tokens).toFixed(2) : '-'
    const perChar = text.length > 0 ? (tokens / text.length).toFixed(3) : '-'
    console.log(`${name} | ${text.length} | ${tokens} | ${density} | ${perChar}`)
  } catch (err) {
    console.log(`${name} | 测量失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}
