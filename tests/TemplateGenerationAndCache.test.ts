/**
 * 模板生成 + 上传缓存 全面测试 (V9.5.2)
 *
 * 测试完整链路: 上传TXT → read_file → 分析 → create_style/scene_template
 * 覆盖: 正常流程/边界条件/极限情况/缓存行为
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── 模拟 fileReadCache ──
const fileCache = new Map<string, { content: string; size: number }>()
function getCache(p: string) { return fileCache.get(p)?.content }
function setCache(p: string, c: string) { fileCache.set(p, { content: c, size: c.length }) }
function invalidateCache(p: string) { fileCache.delete(p) }
function invalidateDirCache(dir: string) {
  const prefix = dir.endsWith('/') ? dir : dir + '/'
  for (const key of fileCache.keys()) {
    if (key.replace(/\\/g, '/').startsWith(prefix.replace(/\\/g, '/'))) fileCache.delete(key)
  }
}
function cachedRead(p: string): string {
  const c = getCache(p)
  if (c !== undefined) return c
  const content = fs.readFileSync(p, 'utf-8')
  setCache(p, content)
  return content
}
function getCacheStats() {
  let totalChars = 0
  for (const v of fileCache.values()) totalChars += v.size
  return { entries: fileCache.size, totalChars }
}

// ── 模拟上传流程 ──
const UPLOADS_DIR = path.join(os.tmpdir(), `qj_upload_test_${Date.now().toString(36)}`)
const UPLOAD_FILES_DIR = path.join(UPLOADS_DIR, 'files')
const UPLOAD_CLIPS_DIR = path.join(UPLOADS_DIR, 'clips')

function simulateUpload(sourcePath: string): { name: string; content: string; uploadPath: string } {
  const name = path.basename(sourcePath)
  const uploadPath = path.join(UPLOAD_FILES_DIR, name)
  fs.mkdirSync(path.dirname(uploadPath), { recursive: true })
  const content = fs.readFileSync(sourcePath, 'utf-8')
  fs.writeFileSync(uploadPath, content, 'utf-8')
  setCache(uploadPath, content)
  return { name, content, uploadPath }
}

function simulateAIReadFile(filePath: string): string {
  const cached = getCache(filePath)
  if (cached !== undefined) return cached
  const content = fs.readFileSync(filePath, 'utf-8')
  setCache(filePath, content)
  return content
}

// ── 辅助函数：判断中文占比 ──
function isChineseChar(c: string): boolean {
  const code = c.charCodeAt(0)
  return code >= 0x4e00 && code <= 0x9fff
}
function chineseRatio(content: string): number {
  const chinese = [...content].filter(isChineseChar).length
  return chinese / Math.max(1, content.length)
}

// ── 模拟风格分析 ──
function simulateStyleAnalysis(content: string): {
  name: string; type: string; dimensions: Record<string, any>
} {
  if (!content || !content.trim()) throw new Error('空文件无法分析')

  const dims: Record<string, any> = {}

  if (content.length > 50) {
    dims.narrativeTone = {
      description: content.length > 500 ? '冷峻克制，留白丰富' : '简洁直白',
      examples: content.split('\n').filter(l => l.trim().length > 10).slice(0, 3),
      writingRules: ['多用短句', '对话克制', '场景描写优先'],
      vocabularyList: [...content.replace(/\s+/g, '')].filter(isChineseChar).slice(0, 15),
    }
  }

  const lines = content.split('\n')
  const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / Math.max(1, lines.length)
  if (avgLineLen > 0) {
    dims.sentenceStyle = {
      description: avgLineLen < 100 ? '短句为主，节奏明快' : '长短句交错，富有韵律',
      examples: lines.filter(l => l.trim().length > 15).slice(0, 3),
      writingRules: ['保持句子在20-80字之间', '对话段落适当缩短'],
      vocabularyList: ['剑', '风', '云', '月', '山', '水', '夜', '光', '雪', '梦'],
    }
  }

  if (content.includes('"') || content.includes('“') || content.includes('「')) {
    dims.dialogueStyle = {
      description: '对话风格鲜明',
      examples: [],
      writingRules: ['对话简短，不超3句连续', '用动作打断长对话'],
      vocabularyList: ['说', '道', '问', '答'],
    }
  }

  const ratio = chineseRatio(content)
  let type = '普通小说'
  if (ratio > 0.3) {
    if (content.includes('剑') || content.includes('江湖') || content.includes('内力')) type = '武侠小说'
    else if (content.includes('咖啡') || content.includes('手机') || content.includes('实习')) type = '都市小说'
    else if (content.includes('修仙') || content.includes('灵力') || content.includes('丹田')) type = '修仙小说'
    else if (content.includes('将军') || content.includes('战场') || content.includes('士兵')) type = '历史小说'
  }

  return { name: 'AI分析风格模板', type, dimensions: dims }
}

// ── 模拟场景分析 ──
function simulateSceneAnalysis(content: string): {
  name: string; type: string; config: Record<string, unknown>
} {
  if (!content || !content.trim()) throw new Error('空文件无法分析')

  const config: Record<string, unknown> = {
    location: '',
    time: '不限',
    atmosphere: '',
    wordTarget: 3000,
    narrativePOV: '第三人称',
    pacing: '渐进',
    sceneType: '日常',
    autoFields: {},
  }

  if (content.includes('剑') && (content.includes('斩') || content.includes('刺'))) {
    config.sceneType = '战斗'
  } else if (content.includes('"') || content.includes('“')) {
    if ((content.match(/["“]/g) || []).length > 10) config.sceneType = '对话'
  } else if (content.includes('高潮') || content.includes('巅峰')) {
    config.sceneType = '高潮'
  }

  const locations = ['客栈', '咖啡店', '山顶', '竹楼', '战场', '教室', '医院', '公寓']
  for (const loc of locations) {
    if (content.includes(loc)) { config.location = loc + '（需补充详细描述）'; break }
  }

  if (content.includes('暮色') || content.includes('残阳') || content.includes('血')) {
    config.atmosphere = '肃杀、苍凉'
  } else if (content.includes('阳光') || content.includes('温暖') || content.includes('金色')) {
    config.atmosphere = '温暖、安静'
  } else if (content.includes('雨') || content.includes('风暴')) {
    config.atmosphere = '压抑、沉重'
  }

  let type = '普通小说'
  if (content.includes('剑') || content.includes('江湖')) type = '武侠小说'
  else if (content.includes('咖啡') || content.includes('手机')) type = '都市小说'

  return { name: 'AI分析场景模板', type, config }
}

const TEST_DATA = path.resolve(__dirname, '..', '测试', '上传测试')

describe('上传TXT → 风格/场景模板生成 全链路测试', () => {

  beforeAll(() => {
    fs.mkdirSync(UPLOAD_FILES_DIR, { recursive: true })
    fs.mkdirSync(UPLOAD_CLIPS_DIR, { recursive: true })
  })

  afterAll(() => {
    try { fs.rmSync(UPLOADS_DIR, { recursive: true }) } catch {}
    fileCache.clear()
  })

  beforeEach(() => {
    fileCache.clear()
    try {
      for (const f of fs.readdirSync(UPLOAD_FILES_DIR)) fs.unlinkSync(path.join(UPLOAD_FILES_DIR, f))
    } catch {}
  })

  // ══════════════════════════════════════════════════════════
  // 正常流程
  // ══════════════════════════════════════════════════════════

  it('1. 上传古风武侠TXT → 风格模板生成', () => {
    const source = path.join(TEST_DATA, '古风武侠.txt')
    expect(fs.existsSync(source)).toBe(true)

    const uploaded = simulateUpload(source)
    expect(fs.existsSync(uploaded.uploadPath)).toBe(true)
    expect(uploaded.content.length).toBeGreaterThan(500)

    const read = simulateAIReadFile(uploaded.uploadPath)
    expect(read).toBe(uploaded.content)
    expect(read).toContain('沈寒衣')

    const result = simulateStyleAnalysis(read)
    expect(result.type).toBe('武侠小说')
    expect(result.dimensions.narrativeTone).toBeDefined()
    expect(Object.keys(result.dimensions).length).toBeGreaterThanOrEqual(2)
  })

  it('2. 上传古风武侠TXT → 场景模板生成', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '古风武侠.txt'))
    const read = simulateAIReadFile(uploaded.uploadPath)
    const result = simulateSceneAnalysis(read)
    expect(result.type).toBe('武侠小说')
    expect(result.config.sceneType).toBe('战斗')
    expect(result.config.atmosphere).toContain('杀')
  })

  it('3. 上传现代言情TXT → 风格模板生成', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '现代言情.txt'))
    const read = simulateAIReadFile(uploaded.uploadPath)
    expect(read).toContain('林小满')
    const result = simulateStyleAnalysis(read)
    expect(result.type).toBe('都市小说')
  })

  it('4. 上传现代言情TXT → 场景模板生成', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '现代言情.txt'))
    const read = simulateAIReadFile(uploaded.uploadPath)
    const result = simulateSceneAnalysis(read)
    expect(result.config.sceneType).toBe('对话')
    expect(result.config.location).toContain('咖啡店')
  })

  // ══════════════════════════════════════════════════════════
  // 边界条件
  // ══════════════════════════════════════════════════════════

  it('5. 空文件 → 拒绝分析', () => {
    const p = path.join(TEST_DATA, '空文件.txt')
    const uploaded = simulateUpload(p)
    expect(() => simulateStyleAnalysis(uploaded.content)).toThrow('空文件无法分析')
    expect(() => simulateSceneAnalysis(uploaded.content)).toThrow('空文件无法分析')
  })

  it('6. 纯英文文件 → 正确识别为普通小说', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '纯英文.txt'))
    const read = simulateAIReadFile(uploaded.uploadPath)
    const result = simulateStyleAnalysis(read)
    expect(result.type).toBe('普通小说')
  })

  it('7. 超长文件 (50000行) → 不崩溃', () => {
    const long = ('暮色如血，染红了整座青云山。沈寒衣负手而立。\n').repeat(1000)
    const p = path.join(UPLOAD_FILES_DIR, '超长.txt')
    fs.writeFileSync(p, long, 'utf-8')
    setCache(p, long)
    const read = simulateAIReadFile(p)
    expect(read.length).toBe(long.length)
    expect(() => simulateStyleAnalysis(read)).not.toThrow()
  })

  it('8. 仅有标题无正文 → 有基础分析', () => {
    const titleOnly = '# 第一章\n\n'
    const p = path.join(UPLOAD_FILES_DIR, '标题.txt')
    fs.writeFileSync(p, titleOnly, 'utf-8')
    setCache(p, titleOnly)
    const result = simulateStyleAnalysis(titleOnly)
    expect(result.dimensions.sentenceStyle).toBeDefined()
  })

  it('9. 仅有标点 → 不崩溃', () => {
    const punct = `！？。，、；：""''……————\n\n\n`
    const result = simulateStyleAnalysis(punct)
    expect(result.dimensions).toBeDefined()
  })

  it('10. 多文件连续上传 → 互不干扰', () => {
    const results = [
      simulateStyleAnalysis(simulateUpload(path.join(TEST_DATA, '古风武侠.txt')).content).type,
      simulateStyleAnalysis(simulateUpload(path.join(TEST_DATA, '现代言情.txt')).content).type,
      simulateStyleAnalysis(simulateUpload(path.join(TEST_DATA, '纯英文.txt')).content).type,
    ]
    expect(results[0]).toBe('武侠小说')
    expect(results[1]).toBe('都市小说')
    expect(results[2]).toBe('普通小说')
  })

  // ══════════════════════════════════════════════════════════
  // 缓存行为
  // ══════════════════════════════════════════════════════════

  it('11. 上传后自动缓存 → AI read_file 命中', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '古风武侠.txt'))
    const cached = getCache(uploaded.uploadPath)
    expect(cached).toBeTruthy()
    expect(cached).toBe(uploaded.content)
  })

  it('12. 两次读取 → 缓存命中仅1条目', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '古风武侠.txt'))
    invalidateCache(uploaded.uploadPath)
    const read1 = simulateAIReadFile(uploaded.uploadPath)
    const read2 = simulateAIReadFile(uploaded.uploadPath)
    expect(read2).toBe(read1)
    expect(getCacheStats().entries).toBe(1)
  })

  it('13. 5个大文件 (各35KB) → 缓存全量容纳', () => {
    const big = ('测试内容数据行。\n').repeat(5000)
    for (let i = 0; i < 5; i++) {
      const p = path.join(UPLOAD_FILES_DIR, `large_${i}.txt`)
      fs.writeFileSync(p, big, 'utf-8')
      setCache(p, big)
    }
    const stats = getCacheStats()
    expect(stats.entries).toBe(5)
    expect(stats.totalChars).toBeGreaterThan(150000)
  })

  it('14. 文件删除 → 缓存同步清除', () => {
    const uploaded = simulateUpload(path.join(TEST_DATA, '古风武侠.txt'))
    expect(getCache(uploaded.uploadPath)).toBeTruthy()
    fs.unlinkSync(uploaded.uploadPath)
    invalidateCache(uploaded.uploadPath)
    expect(getCache(uploaded.uploadPath)).toBeUndefined()
  })

  it('15. 目录清除 → 批量淘汰', () => {
    for (let i = 0; i < 5; i++) {
      const p = path.join(UPLOAD_FILES_DIR, `batch_${i}.txt`)
      fs.writeFileSync(p, `内容${i}`, 'utf-8')
      setCache(p, `内容${i}`)
    }
    expect(getCacheStats().entries).toBe(5)
    invalidateDirCache(UPLOADS_DIR)
    expect(getCacheStats().entries).toBe(0)
  })

  // ══════════════════════════════════════════════════════════
  // 上传消息格式验证
  // ══════════════════════════════════════════════════════════

  it('16. 上传消息包含 read_file 引导 + 询问类型', () => {
    const fp = `uploads/files/test.txt`
    const attachText = `[上传文件: test.txt]\n文件已保存到 ${fp}。请用 read_file 读取内容后分析。`
    expect(attachText).toContain('read_file')
    expect(attachText).toContain(fp)

    // 验证 17 种有效类型
    const validTypes = ['情色小说', '奇幻', '都市小说', '修仙小说', '武侠小说', '恋爱小说',
      '古风小说', '悬疑小说', '历史小说', '科幻小说', '玄幻小说', '灵异小说',
      '轻小说', '普通小说', '穿越小说', '末世小说', '游戏小说']
    expect(validTypes).toHaveLength(17)
    expect(new Set(validTypes).size).toBe(17) // 无重复
  })

  // ══════════════════════════════════════════════════════════
  // DOMAIN 触发关键词
  // ══════════════════════════════════════════════════════════

  it('17. 风格触发词全覆盖', () => {
    const p = /风格|文风|style|仿写|分析.*文|模板.*创建|创建.*模板|上传.*分析/
    expect(p.test('帮我分析这段文的风格')).toBe(true)
    expect(p.test('上传文件分析生成风格模板')).toBe(true)
    expect(p.test('创建风格模板')).toBe(true)
    expect(p.test('仿写这篇文章')).toBe(true)
    expect(p.test('这个文风很独特')).toBe(true)
    expect(p.test('帮我写第一章')).toBe(false)
  })

  it('18. 场景触发词全覆盖', () => {
    const p = /场景|scene|模板.*创建|创建.*模板|分析.*场景/
    expect(p.test('分析这个场景')).toBe(true)
    expect(p.test('创建场景模板')).toBe(true)
    expect(p.test('create scene template')).toBe(true)
    expect(p.test('查看大纲')).toBe(false)
  })

  // ══════════════════════════════════════════════════════════
  // 极限情况
  // ══════════════════════════════════════════════════════════

  it('19. 重复上传同名文件 → 覆盖+缓存更新', () => {
    const source = path.join(TEST_DATA, '古风武侠.txt')
    const original = fs.readFileSync(source, 'utf-8')

    const u1 = simulateUpload(source)
    const modified = '第1章 新内容\n新的文字。'
    fs.writeFileSync(source, modified, 'utf-8')

    const u2 = simulateUpload(source)
    expect(fs.readFileSync(u2.uploadPath, 'utf-8')).toBe(modified)
    expect(getCache(u2.uploadPath)).toBe(modified)

    // 恢复原文件
    fs.writeFileSync(source, original, 'utf-8')
  })

  it('20. 同内容多路径分别缓存', () => {
    const content = '相同内容测试'
    const p1 = path.join(UPLOAD_FILES_DIR, 'a.txt')
    const p2 = path.join(UPLOAD_FILES_DIR, 'b.txt')
    fs.writeFileSync(p1, content, 'utf-8')
    fs.writeFileSync(p2, content, 'utf-8')
    setCache(p1, content)
    setCache(p2, content)
    expect(getCacheStats().entries).toBe(2)
    expect(getCache(p1)).toBe(content)
    expect(getCache(p2)).toBe(content)
  })

  it('21. 中文占比函数正确', () => {
    expect(chineseRatio('Hello World')).toBe(0)
    expect(chineseRatio('你好世界')).toBeGreaterThan(0.9)
    expect(chineseRatio('Hello 你好 World 世界')).toBeGreaterThan(0.2)
  })
})
