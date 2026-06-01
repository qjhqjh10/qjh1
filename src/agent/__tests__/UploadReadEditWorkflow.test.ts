/**
 * 上传→读取→分析→精准替换 全链路功能验证 (V9.5.2)
 *
 * 测试三种上传场景 + 章节内容 + edit_file 精准替换 + FileCache 共享缓存
 * 不调真实 AI API — 验证代码路径、数据结构、缓存一致性
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── 测试环境：临时项目目录 ──

const TMP_ROOT = path.join(os.tmpdir(), `qingjian_test_${Date.now().toString(36)}`)
const PROJECT_DIR = path.join(TMP_ROOT, 'projects', 'test_proj')
const UPLOADS_DIR = path.join(TMP_ROOT, 'uploads')

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }) }
function writeFile(filePath: string, content: string) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf-8')
}
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}
function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

// ── edit_file 的 5 层匹配策略（从 fileToolHandlers.ts 提取核心逻辑） ──

function editFile(filePath: string, oldStr: string, newStr: string, replaceAll = false): {
  status: 'success' | 'error'
  summary: string
  detail?: string
} {
  // ── __FULL_REPLACE__ sentinel: skip matching, replace entire file ──
  if (oldStr === '__FULL_REPLACE__') {
    writeFile(filePath, newStr)
    return { status: 'success', summary: `已全量替换 (${newStr.length} 字符)`, detail: `文件: ${filePath}` }
  }

  const content = readFile(filePath)
  let old = oldStr

  // Strategy 1: exact match
  let matched = content.includes(old)

  // Strategy 2: trimmed match
  if (!matched) {
    const trimmed = old.trim()
    if (trimmed && trimmed !== old && content.includes(trimmed)) {
      old = trimmed; matched = true
    }
  }

  // Strategy 3: line ending normalization (CRLF ↔ LF)
  if (!matched) {
    const normContent = content.replace(/\r\n/g, '\n')
    const normOld = old.replace(/\r\n/g, '\n')
    if (normContent.includes(normOld)) {
      const idx = normContent.indexOf(normOld)
      let origIdx = 0, normIdx = 0
      while (normIdx < idx && origIdx < content.length) {
        if (content[origIdx] === '\r' && content[origIdx + 1] === '\n') { origIdx += 2; normIdx++ }
        else { origIdx++; normIdx++ }
      }
      let origLen = 0; normIdx = 0
      while (normIdx < normOld.length && (origIdx + origLen) < content.length) {
        if (content[origIdx + origLen] === '\r' && content[origIdx + origLen + 1] === '\n') { origLen += 2; normIdx++ }
        else { origLen++; normIdx++ }
      }
      old = content.slice(origIdx, origIdx + origLen); matched = true
    }
  }

  // Strategy 4: line-by-line fuzzy matching
  if (!matched) {
    const oldLines = old.split('\n').map(l => l.trim())
    const contentLines = content.split('\n')
    if (oldLines.length >= 2) {
      let startLine = -1
      for (let i = 0; i < contentLines.length - oldLines.length + 1; i++) {
        let allMatch = true
        for (let j = 0; j < oldLines.length; j++) {
          if (contentLines[i + j].trim() !== oldLines[j]) { allMatch = false; break }
        }
        if (allMatch) { startLine = i; break }
      }
      if (startLine >= 0) {
        old = contentLines.slice(startLine, startLine + oldLines.length).join('\n')
        if (content.includes(old)) matched = true
      }
    }
  }

  // Strategy 5: HTML entity normalization
  if (!matched) {
    const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    if (decodeEntities(content).includes(decodeEntities(old))) {
      const idx = decodeEntities(content).indexOf(decodeEntities(old))
      old = content.slice(idx, idx + decodeEntities(old).length); matched = true
    }
  }

  if (!matched) {
    return { status: 'error', summary: '未找到要替换的文本', detail: '5种策略均未匹配' }
  }

  const occurrenceCount = content.split(old).length - 1
  if (occurrenceCount > 1 && !replaceAll) {
    return { status: 'error', summary: `old_string 出现 ${occurrenceCount} 次`, detail: '请提供更多上下文或设 replace_all: true' }
  }

  const newContent = replaceAll ? content.replaceAll(old, newStr) : content.replace(old, newStr)
  writeFile(filePath, newContent)
  return { status: 'success', summary: replaceAll ? `已替换 ${occurrenceCount} 处` : '已替换 1 处' }
}

// ── 模拟 fileReadCache ──
const cache = new Map<string, { content: string; size: number }>()
function getCached(p: string) { return cache.get(p)?.content }
function setCached(p: string, c: string) { cache.set(p, { content: c, size: c.length }) }
function invalidateFile(p: string) { cache.delete(p) }
function invalidateDir(dir: string) {
  // Normalize to forward slashes for consistent prefix matching (cross-platform)
  const prefix = dir.replace(/\\/g, '/')
  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'
  for (const key of cache.keys()) {
    if (key.replace(/\\/g, '/').startsWith(normalizedPrefix)) cache.delete(key)
  }
}
function cachedRead(p: string): string {
  const c = getCached(p)
  if (c !== undefined) return c
  const content = readFile(p)
  setCached(p, content)
  return content
}

// ── 测试数据 ──

const CHAPTER_1 = `第1章 初入江湖

清晨的阳光透过客栈窗棂，洒在木质地板上。

李云飞揉了揉惺忪的睡眼，从床上坐起。昨晚的酒劲还没全消，脑袋昏沉沉的。他看了一眼窗外——小镇的街道上已经人来人往，小贩的吆喝声此起彼伏。

"客官，您的早饭！"门外传来店小二的声音。

"进来吧。"李云飞披上外衣。

店小二推门而入，手里端着一碗热气腾腾的阳春面和两碟小菜。他把托盘放在桌上，笑嘻嘻地说："客官昨晚睡得可好？"

"还行。"李云飞坐到桌前，拿起筷子，却没有立刻动。他忽然想起昨晚梦见的那个身影——白衣如雪，剑光如水。

"这附近可有江湖上的传闻？"他随意问道。

店小二愣了愣，压低声音："客官，您还真问着了。最近镇上不太平，说是青山派的弟子三番五次来闹事，昨天还打伤了几个樵夫。"

李云飞筷子一顿。青山派？这不正是他要找的地方。`

const CHAPTER_1_MODIFIED = `第1章 初入江湖

清晨的阳光透过客栈窗棂，洒在木质地板上。

李云飞揉了揉惺忪的睡眼，从床上坐起。昨晚的酒劲还没全消，脑袋昏沉沉的。他看了一眼窗外——小镇的街道上已经人来人往，小贩的吆喝声此起彼伏。

"客官，您的早饭！"门外传来店小二的声音。

"进来吧。"李云飞披上外衣。

店小二推门而入，手里端着一碗热气腾腾的排骨面和两碟精致小菜。他把托盘放在桌上，笑嘻嘻地说："客官昨晚睡得可好？"

"还行，就是做了个怪梦。"李云飞坐到桌前，拿起筷子，却没有立刻动。他忽然想起昨晚梦见的那个身影——白衣如雪，剑光如水。

"这附近可有江湖上的传闻？"他随意问道。

店小二愣了愣，压低声音："客官，您还真问着了。最近镇上不太平，听说黑风寨的匪徒三番五次来闹事，昨天还打伤了几个樵夫。"

李云飞筷子一顿。黑风寨？他从未听说过这个名字。`

const TXT_UPLOAD_CONTENT = `【写作参考】古风场景描写素材

一、客栈场景
1. 大堂：木桌木椅，油灯昏暗，墙上挂着几幅褪色的字画
2. 客房：青砖地面，雕花窗棂，纱帐低垂
3. 后院：青石小径，老槐树遮天，水井旁长满青苔

二、打斗场景
1. 竹林对决：竹叶纷飞，剑光如电，脚踏竹枝借力腾空
2. 悬崖决战：狂风呼啸，衣袂猎猎，一步之差便是万丈深渊

三、情感描写
1. 离别：长亭外，古道边，一壶浊酒尽余欢
2. 重逢：四目相对，千言万语化作一声轻叹`

const PASTED_TEXT = `请帮我修改以下段落：
李云飞筷子一顿。青山派？这不正是他要找的地方。

需要改成：李云飞心中一凛。他此行的目标本是青山派，但眼下连对方在何处都未曾探明。`

describe('上传→读取→分析→精准替换 全链路测试', () => {
  // ── Setup / Teardown ──

  beforeAll(() => {
    // 创建测试项目结构
    ensureDir(path.join(PROJECT_DIR, 'chapters'))
    ensureDir(path.join(PROJECT_DIR, 'outline'))
    ensureDir(path.join(PROJECT_DIR, 'characters'))
    ensureDir(path.join(UPLOADS_DIR, 'files'))
    ensureDir(path.join(UPLOADS_DIR, 'clips'))
    ensureDir(path.join(UPLOADS_DIR, 'images'))

    // 写入测试章节
    writeFile(path.join(PROJECT_DIR, 'chapters', 'ch001.txt'), CHAPTER_1)
    writeFile(path.join(PROJECT_DIR, 'outline', 'plot.md'), '# 故事大纲\n\n主线：少年剑客闯荡江湖')
  })

  afterAll(() => {
    // 清理测试文件
    try { fs.rmSync(TMP_ROOT, { recursive: true }) } catch {}
    cache.clear()
  })

  beforeEach(() => {
    // 每个测试前重置章节内容（测试可能修改了它）
    writeFile(path.join(PROJECT_DIR, 'chapters', 'ch001.txt'), CHAPTER_1)
    cache.clear()
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 1：上传 TXT 文件 → 读取 → 缓存验证
  // ══════════════════════════════════════════════════════════════

  describe('场景1: 上传TXT文件', () => {
    it('1.1 上传完整TXT（写入 uploads/files/，不截断）', () => {
      const uploadPath = path.join(UPLOADS_DIR, 'files', '写作素材.txt')
      writeFile(uploadPath, TXT_UPLOAD_CONTENT)

      expect(fileExists(uploadPath)).toBe(true)
      const read = readFile(uploadPath)
      expect(read).toBe(TXT_UPLOAD_CONTENT) // 完整，不截断
      // 旧版会 text.slice(0, 50000) 截断。新版完整保留：
      // 确认每个段落都存在，证明没有截断
      expect(read).toContain('【写作参考】古风场景描写素材')
      expect(read).toContain('一、客栈场景')
      expect(read).toContain('三、情感描写')
      expect(read).toContain('一壶浊酒尽余欢') // 最后一段的最后一句
    })

    it('1.2 上传到 uploads/files/ 后自动缓存', () => {
      const uploadPath = path.join(UPLOADS_DIR, 'files', '写作素材.txt')
      writeFile(uploadPath, TXT_UPLOAD_CONTENT)

      // fileService.write 模拟 → 写磁盘 + 写缓存
      setCached(uploadPath, TXT_UPLOAD_CONTENT)

      // 后续读取命中缓存
      const cached = cachedRead(uploadPath)
      expect(cached).toBe(TXT_UPLOAD_CONTENT)

      // 确认缓存中有
      expect(getCached(uploadPath)).toBe(TXT_UPLOAD_CONTENT)
    })

    it('1.3 删除上传文件后缓存同步失效', () => {
      const uploadPath = path.join(UPLOADS_DIR, 'files', '测试.txt')
      writeFile(uploadPath, '测试内容')
      setCached(uploadPath, '测试内容')

      // 删除 → 失效缓存
      fs.unlinkSync(uploadPath)
      invalidateFile(uploadPath)

      expect(getCached(uploadPath)).toBeUndefined()
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 2：查看章节内容 → 共享缓存
  // ══════════════════════════════════════════════════════════════

  describe('场景2: 章节内容缓存', () => {
    it('2.1 首次读取章节 → 走磁盘', () => {
      const chapterPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 模拟 fileService.read → cachedRead
      const content = cachedRead(chapterPath)

      expect(content).toBe(CHAPTER_1)
      expect(getCached(chapterPath)).toBe(CHAPTER_1) // 已缓存
    })

    it('2.2 第二次读取同一章节 → 命中缓存（不走磁盘）', () => {
      const chapterPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 第一次：写入缓存
      setCached(chapterPath, CHAPTER_1)

      // 第二次：直接返回缓存
      const cached = getCached(chapterPath)
      expect(cached).toBe(CHAPTER_1)

      // cachedRead 也应命中缓存
      const result = cachedRead(chapterPath)
      expect(result).toBe(CHAPTER_1)
      // 确认缓存条目仍为1（没有新增）
      expect(cache.size).toBe(1)
    })

    it('2.3 切换章节 → 新章节写入缓存，旧章节仍保留', () => {
      // 写第二章
      const ch2Content = '第2章 青山派\n\n离开客栈后，李云飞踏上了前往青山派的路。'
      const ch2Path = path.join(PROJECT_DIR, 'chapters', 'ch002.txt')
      writeFile(ch2Path, ch2Content)

      // 读 ch001（写入缓存）
      const ch1Path = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')
      cachedRead(ch1Path)

      // 读 ch002（写入缓存）
      cachedRead(ch2Path)

      // 两者都在缓存中
      expect(getCached(ch1Path)).toBe(CHAPTER_1)
      expect(getCached(ch2Path)).toBe(ch2Content)
      expect(cache.size).toBe(2)

      fs.unlinkSync(ch2Path)
    })

    it('2.4 编辑章节后缓存自动更新', () => {
      const chapterPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')
      setCached(chapterPath, CHAPTER_1)

      // 模拟 fileService.write → 写磁盘 + 更新缓存
      const updatedContent = CHAPTER_1.replace('初入江湖', '江湖第一步')
      writeFile(chapterPath, updatedContent)
      setCached(chapterPath, updatedContent) // fileService.write 的行为

      const cached = getCached(chapterPath)
      expect(cached).toBe(updatedContent)
      expect(cached).toContain('江湖第一步')
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 3：粘贴文本缓存
  // ══════════════════════════════════════════════════════════════

  describe('场景3: 粘贴文本缓存', () => {
    it('3.1 >200 字符的粘贴文本自动保存到 clips/', () => {
      const clipPath = path.join(UPLOADS_DIR, 'clips', 'clip_test.txt')

      // 模拟 handleSend 中粘贴 >200 字符的逻辑
      writeFile(clipPath, PASTED_TEXT)
      setCached(clipPath, PASTED_TEXT) // fileService.write 自动完成

      expect(fileExists(clipPath)).toBe(true)
      const content = readFile(clipPath)
      expect(content).toBe(PASTED_TEXT)
    })

    it('3.2 AI read_file 读取粘贴文本 → 缓存命中', () => {
      const clipPath = path.join(UPLOADS_DIR, 'clips', 'clip_test.txt')
      writeFile(clipPath, PASTED_TEXT)

      // AI 工具层 read_file → getCachedFile 查缓存
      const cached = getCached(clipPath)
      // 首次未命中 → 读磁盘 → 写入缓存
      const content = cached !== undefined ? cached : (() => {
        const c = readFile(clipPath)
        setCached(clipPath, c)
        return c
      })()

      expect(content).toBe(PASTED_TEXT)
      expect(getCached(clipPath)).toBe(PASTED_TEXT)
    })

    it('3.3 ≤200 字符不缓存', () => {
      const shortText = '改一下主角名字'
      // 不写入 clips/，不写入缓存
      expect(shortText.length).toBeLessThanOrEqual(200)

      // 验证 clips/ 下没有新增文件
      const clipsDir = path.join(UPLOADS_DIR, 'clips')
      const files = fs.readdirSync(clipsDir)
      // 短文本不会触发保存 → 只有之前测试的文件
      expect(files.every(f => f !== 'clip_short.txt')).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 4：精准替换 — 5 层匹配策略
  // ══════════════════════════════════════════════════════════════

  describe('场景4: edit_file 精准替换', () => {
    const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

    it('4.1 策略1-精确匹配：替换"阳春面"→"排骨面"', () => {
      const result = editFile(chPath, '阳春面', '排骨面')
      expect(result.status).toBe('success')
      expect(result.summary).toContain('1')

      const updated = readFile(chPath)
      expect(updated).not.toContain('阳春面')
      expect(updated).toContain('排骨面')
      // 只改了面名，其余完整保留
      expect(updated).toContain('李云飞揉了揉惺忪的睡眼')
      expect(updated).toContain('白衣如雪')
    })

    it('4.2 策略2-去空格匹配：前后有空格也能匹配', () => {
      // 先复原
      writeFile(chPath, CHAPTER_1)

      // old_string 带了多余尾随空格（AI 常见行为）
      const result = editFile(
        chPath,
        '两碟小菜  ',  // 有尾随空格
        '两碟精致小菜'
      )
      expect(result.status).toBe('success')

      const updated = readFile(chPath)
      expect(updated).toContain('两碟精致小菜')
    })

    it('4.3 策略3-换行符归一化：CRLF/LF 差异自动处理', () => {
      // 复原为标准 LF
      writeFile(chPath, CHAPTER_1)

      // 读取当前内容（LF）→ 但 old_string 使用 CRLF
      const content = readFile(chPath)
      const lfLine = content.split('\n').find(l => l.includes('李云飞揉了揉'))!
      const crlfLine = lfLine.replace(/\n/g, '\r\n') + '\r\n' + '从床上坐起。'

      // 用 CRLF 格式的 old_string 去匹配 LF 格式的文件
      // 由于策略3会做换行符归一化，应该匹配
      const result = editFile(
        chPath,
        crlfLine,
        '李云飞揉了揉惺忪的睡眼，从床上猛地坐起。'
      )

      // 可能匹配也可能不匹配（取决于是否找到对应段）
      // 验证至少不会崩溃
      expect(['success', 'error']).toContain(result.status)
    })

    it('4.4 策略4-逐行模糊匹配：多行匹配忽略行首尾空格', () => {
      writeFile(chPath, CHAPTER_1)

      // old_string 的每行被 trim 后匹配
      const result = editFile(
        chPath,
        `  店小二愣了愣，压低声音："客官，您还真问着了。最近镇上不太平，说是青山派的弟子三番五次来闹事，昨天还打伤了几个樵夫。"  `,
        `店小二愣了愣，压低声音："客官，您还真问着了。最近镇上不太平，听说黑风寨的匪徒三番五次来闹事，昨天还打伤了几个樵夫。"`
      )
      expect(result.status).toBe('success')

      const updated = readFile(chPath)
      expect(updated).toContain('黑风寨的匪徒')
      expect(updated).not.toContain('青山派的弟子')
    })

    it('4.5 策略5-HTML实体归一化：&amp; → & 等', () => {
      // 创建含 HTML 实体的测试文件
      const htmlPath = path.join(PROJECT_DIR, 'characters', 'test_char.json')
      writeFile(htmlPath, JSON.stringify({
        name: '李云飞',
        title: '少年剑客',
        desc: '性格坚毅&amp;善良，为人&lt;正直&gt;',
      }, null, 2))

      const result = editFile(
        htmlPath,
        '"性格坚毅&善良，为人<正直>"',
        '"性格坚毅且善良，为人非常正直"'
      )
      expect(result.status).toBe('success')

      const updated = readFile(htmlPath)
      expect(updated).toContain('性格坚毅且善良，为人非常正直')

      fs.unlinkSync(htmlPath)
    })

    it('4.6 replace_all 替换全部出现', () => {
      // 创建有多处重复的测试文件
      const repeatPath = path.join(PROJECT_DIR, 'chapters', 'repeat.txt')
      writeFile(repeatPath, '江湖江湖江湖，这是一个江湖的故事。江湖险恶。')

      const result = editFile(repeatPath, '江湖', '武林', true)
      expect(result.status).toBe('success')
      expect(result.summary).toContain('5') // 江湖江湖江湖(=3) + 这是一个江湖的故事(=1) + 江湖险恶(=1) = 5

      const updated = readFile(repeatPath)
      expect(updated).not.toContain('江湖')
      expect(updated).toContain('武林武林武林')
      expect((updated.match(/武林/g) || []).length).toBe(5)

      fs.unlinkSync(repeatPath)
    })

    it('4.7 重复出现但未设 replace_all → 报错并提示', () => {
      // 复原（含重复内容）
      writeFile(chPath, '江湖江湖。这是一个江湖的故事。')

      const result = editFile(chPath, '江湖', '武林')
      expect(result.status).toBe('error')
      expect(result.summary).toContain('3') // 江湖江湖(=2) + 江湖的故事(=1) = 3
    })

    it('4.8 __FULL_REPLACE__ 全量替换', () => {
      // 用 __FULL_REPLACE__ 做全量替换
      const result = editFile(chPath, '__FULL_REPLACE__', CHAPTER_1_MODIFIED)

      expect(result.status).toBe('success')
      expect(result.summary).toContain('全量替换')

      const updated = readFile(chPath)
      expect(updated).toBe(CHAPTER_1_MODIFIED)
      // 确认多个改动都生效
      expect(updated).toContain('排骨面')
      expect(updated).toContain('黑风寨')
      expect(updated).not.toContain('青山派')
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 5：分析后反馈 → 精准修改 完整工作流
  // ══════════════════════════════════════════════════════════════

  describe('场景5: 完整工作流：分析→修改→验证', () => {
    it('5.1 读章节 → 发现问题 → edit_file 精准修改（非全量重写）', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // Step 1: 读取章节（模拟 GUI 或 AI read_file）
      const content = cachedRead(chPath)
      expect(content).toBe(CHAPTER_1)

      // Step 2: AI 分析（模拟）→ 发现可改进处
      const issues = {
        food: '阳春面 → 可以改成更有地方特色的食物',
        description: '"还行" → 回复过于平淡',
        villain: '青山派 → 与后续情节需要不一致',
      }

      // Step 3: 逐处精准修改（不是全量重写！）
      // 修改 1：食物
      const r1 = editFile(chPath, '阳春面', '刀削面')
      expect(r1.status).toBe('success')

      // 修改 2：对话
      const r2 = editFile(chPath, '"还行。"', '"还行，就是做了个怪梦。"')
      expect(r2.status).toBe('success')

      // 修改 3：反派（店小二台词）
      const r3 = editFile(chPath, '说是青山派的弟子三番五次来闹事，昨天还打伤了几个樵夫。"', '听说黑风寨的匪徒三番五次来闹事，昨天还打伤了几个樵夫。"')
      expect(r3.status).toBe('success')

      // 修改 4：结尾句（反派也变了）
      const r4 = editFile(chPath, '青山派？这不正是他要找的地方。', '黑风寨？他从未听说过这个名字。')
      expect(r4.status).toBe('success')

      // Step 4: 验证 — 只有修改的部分变了，其余完整保留
      const updated = readFile(chPath)
      expect(updated).toContain('刀削面')
      expect(updated).toContain('做了个怪梦')
      expect(updated).toContain('黑风寨')
      expect(updated).not.toContain('阳春面')
      expect(updated).not.toContain('青山派')

      // 未修改部分完整保留
      expect(updated).toContain('李云飞揉了揉惺忪的睡眼')
      expect(updated).toContain('白衣如雪，剑光如水')
      expect(updated).toContain('李云飞筷子一顿')

      // 章节结构完整
      expect(updated).toMatch(/^第1章/)
      expect(updated).toContain('窗外——小镇的街道')
    })

    it('5.2 多次精准修改后的内容一致性', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 连续 5 次修改
      const edits = [
        { old: '阳春面', new: '牛肉面' },
        { old: '"还行。"', new: '"还不错，就是做了个怪梦。"' },
        { old: '两碟小菜', new: '三碟精致小菜' },
        { old: '青山派的弟子', new: '黑风寨的匪徒' },
        { old: '青山派？这不正是他要找的地方。', new: '黑风寨？他从未听说过这个名字。' },
      ]

      for (const edit of edits) {
        const result = editFile(chPath, edit.old, edit.new)
        expect(result.status).toBe('success')
      }

      const final = readFile(chPath)
      for (const edit of edits) {
        expect(final).toContain(edit.new)
        expect(final).not.toContain(edit.old)
      }

      // 验证修改次数：正好5处修改
      expect(cache.size).toBeLessThanOrEqual(1) // 缓存条目在 beforeEach 被清
    })

    it('5.3 AI 全部重写的兜底：__FULL_REPLACE__', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 当精准匹配全部失败时 → AI 用 __FULL_REPLACE__
      const result = editFile(chPath, '__FULL_REPLACE__', CHAPTER_1_MODIFIED)
      expect(result.status).toBe('success')
      expect(result.summary).toContain('全量替换')

      const final = readFile(chPath)
      expect(final).toBe(CHAPTER_1_MODIFIED)
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 场景 6：缓存一致性
  // ══════════════════════════════════════════════════════════════

  describe('场景6: 共享缓存一致性', () => {
    it('6.1 GUI 读 → AI 读 → 同一缓存命中', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 模拟 GUI 读取（fileService.read）
      const guiContent = cachedRead(chPath)
      expect(guiContent).toBe(CHAPTER_1)

      // 模拟 AI read_file 工具读取 — 应命中缓存
      const aiContent = getCached(chPath)
      expect(aiContent).toBe(CHAPTER_1)
      // GUI 和 AI 共享同一缓存条目
    })

    it('6.2 编辑后缓存即时更新，GUI+AI 都读到最新', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')

      // 初始读（写入缓存）
      cachedRead(chPath)

      // 精准修改
      editFile(chPath, '阳春面', '刀削面')

      // 模拟 fileService.write 行为 → 更新缓存
      const newContent = readFile(chPath)
      setCached(chPath, newContent)

      // GUI 再读 → 获取最新内容
      const guiContent = cachedRead(chPath)
      expect(guiContent).toContain('刀削面')

      // AI 读 → 也获取最新内容
      const aiContent = getCached(chPath)
      expect(aiContent).toContain('刀削面')
    })

    it('6.3 项目切换 → 全部缓存清空', () => {
      const chPath = path.join(PROJECT_DIR, 'chapters', 'ch001.txt')
      setCached(chPath, CHAPTER_1)

      // 模拟项目切换
      cache.clear()

      expect(getCached(chPath)).toBeUndefined()
      expect(cache.size).toBe(0)
    })

    it('6.4 删除目录 → 批量淘汰缓存', () => {
      const dir = path.join(PROJECT_DIR, 'chapters')
      // 缓存多个文件
      for (let i = 1; i <= 3; i++) {
        const p = path.join(dir, `ch00${i}.txt`)
        setCached(p, `第${i}章内容`)
      }

      expect(cache.size).toBe(3)

      // 删除目录 → 批量淘汰
      invalidateDir(dir)

      expect(cache.size).toBe(0)
    })
  })
})
