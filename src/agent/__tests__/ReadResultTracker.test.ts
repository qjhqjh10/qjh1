// ── v15.6: ReadResultTracker 去重层单测 ──
// 覆盖：同范围重复读→dup；读后改→changed；不同范围不 dup；失效；
// 连续 dup≥2→forceReturnFull；历史重建；路径规范化；内容指纹（压缩后 stillInContext=false）

import { describe, it, expect } from 'vitest'
import {
  ReadResultTracker, normalizeReadPath, hashStr, buildDupDetail, buildChangedDetail,
} from '../context/ReadResultTracker'
import type { Message } from '../state/types'

function makeReadToolMsg(callId: string, content: string): Message {
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ status: 'success', summary: '500 字符', detail: content }) }
}

describe('normalizeReadPath', () => {
  it('反斜杠→斜杠、小写、去 ../', () => {
    expect(normalizeReadPath('Chapters\\1.md')).toBe('chapters/1.md')
    expect(normalizeReadPath('../../Chapters/1.md')).toBe('chapters/1.md')
    expect(normalizeReadPath('CHAPTERS/1.MD')).toBe('chapters/1.md')
  })
})

describe('hashStr', () => {
  it('确定性 + 内容不同 hash 不同', () => {
    expect(hashStr('abc')).toBe(hashStr('abc'))
    expect(hashStr('abc')).not.toBe(hashStr('abd'))
  })
})

describe('ReadResultTracker — 基本去重', () => {
  it('同范围重复读 → dup + stillInContext=true', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '全文内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))

    t.recordRead('chapters/1.md', 'full', 1, hash)
    msgs.push(makeReadToolMsg('c1', content))

    const r = t.checkRead('chapters/1.md', 'full', hash, msgs, 2)
    expect(r.status).toBe('dup')
    if (r.status === 'dup') {
      expect(r.stillInContext).toBe(true)
      expect(r.forceReturnFull).toBe(false)
      expect(r.record.turnSeq).toBe(1)
    }
  })

  it('内容指纹不匹配（前文被压缩）→ stillInContext=false', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '原文'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    // 前文已被压缩（内容 hash 不同）
    msgs.push(makeReadToolMsg('c1', '[已压缩]'))

    const r = t.checkRead('chapters/1.md', 'full', hash, msgs, 2)
    expect(r.status).toBe('dup')
    if (r.status === 'dup') expect(r.stillInContext).toBe(false)
  })

  it('不同范围不 dup（full 与 offset 读各自独立）', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const fullHash = hashStr('全文')
    const partHash = hashStr('片段')
    t.recordRead('chapters/1.md', 'full', 1, fullHash)
    const r = t.checkRead('chapters/1.md', 's:100:e:1100', partHash, msgs, 2)
    expect(r.status).toBe('new')
  })

  it('read 后 write → changed（含修改摘要）', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '旧版本内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    msgs.push(makeReadToolMsg('c1', content))
    t.recordWrite('chapters/1.md', 2, '"旧版本内容" → "新版本内容"')

    const r = t.checkRead('chapters/1.md', 'full', hash, msgs, 3)
    expect(r.status).toBe('changed')
    if (r.status === 'changed') {
      expect(r.writes.length).toBe(1)
      expect(r.writes[0].changeSummary).toContain('→')
      expect(r.stillInContext).toBe(true)
    }
  })

  it('连续 dup ≥ 2 次 → forceReturnFull=true', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    msgs.push(makeReadToolMsg('c1', content))

    // 第 1、2 次 dup 不强制
    expect(t.checkRead('chapters/1.md', 'full', hash, msgs, 2).status).toBe('dup')
    expect(t.checkRead('chapters/1.md', 'full', hash, msgs, 3).status).toBe('dup')
    // 第 3 次强制完整回传
    const r3 = t.checkRead('chapters/1.md', 'full', hash, msgs, 4)
    expect(r3.status).toBe('dup')
    if (r3.status === 'dup') expect(r3.forceReturnFull).toBe(true)
  })

  it('recordWrite 后 dup 计数清零（内容变了重读合理）', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    msgs.push(makeReadToolMsg('c1', content))
    t.checkRead('chapters/1.md', 'full', hash, msgs, 2)
    t.checkRead('chapters/1.md', 'full', hash, msgs, 3)
    t.recordWrite('chapters/1.md', 4, '修改')
    const r = t.checkRead('chapters/1.md', 'full', hash, msgs, 5)
    expect(r.status).toBe('changed')
    if (r.status === 'changed') expect(r.forceReturnFull).toBe(false)
  })

  it('invalidateFile 后重读 → new', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    t.invalidateFile('chapters/1.md')
    expect(t.checkRead('chapters/1.md', 'full', hash, msgs, 2).status).toBe('new')
  })

  it('invalidateDir 前缀失效（KB 场景）', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const hash = hashStr('kb 内容')
    t.recordRead('knowledge_base/files/a.md', 'full', 1, hash)
    t.invalidateDir('knowledge_base')
    expect(t.checkRead('knowledge_base/files/a.md', 'full', hash, msgs, 2).status).toBe('new')
  })
})

describe('rebuildFromHistory — 跨 run 重建', () => {
  function makeHistory(): Message[] {
    return [
      { role: 'user', content: '读一下第3章' },
      {
        role: 'assistant', content: '',
        tool_calls: [{ type: 'function', id: 'c1', function: { name: 'read_file', arguments: JSON.stringify({ file_path: 'chapters/chapter3.txt' }) } }],
      },
      makeReadToolMsg('c1', '第三章全文内容'),
      { role: 'user', content: '把第二段改掉' },
      {
        role: 'assistant', content: '',
        tool_calls: [{ type: 'function', id: 'c2', function: { name: 'edit_file', arguments: JSON.stringify({ file_path: 'chapters/chapter3.txt', old_string: '第二段', new_string: '新第二段' }) } }],
      },
      { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ status: 'success', summary: '已修改' }) },
      { role: 'user', content: '再读一下' },
      {
        role: 'assistant', content: '',
        tool_calls: [{ type: 'function', id: 'c3', function: { name: 'read_file', arguments: JSON.stringify({ file_path: 'chapters/chapter3.txt' }) } }],
      },
      makeReadToolMsg('c3', '第三章新内容'),
    ]
  }

  it('从历史重建：read 记录 + write 记录都恢复', () => {
    const history = makeHistory()
    const t = ReadResultTracker.rebuildFromHistory(history)

    // 直接查内部状态：对同文件同范围再次 read → changed（历史里既有 read 又有 write）
    const content = '第三章新内容'
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    const r = t.checkRead('chapters/chapter3.txt', 'full', hash, history, 5)
    expect(r.status).toBe('changed')
    if (r.status === 'changed') {
      expect(r.writes.some(w => w.changeSummary.includes('第二段'))).toBe(true)
      expect(r.stillInContext).toBe(true)  // 历史里 c3 的 read 结果仍在
    }
  })

  it('路径大小写差异视为同文件', () => {
    const history = makeHistory()
    const t = ReadResultTracker.rebuildFromHistory(history)
    const content = '第三章新内容'
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    // 大写路径 → 归一化后命中
    const r = t.checkRead('Chapters/Chapter3.txt', 'full', hash, history, 5)
    expect(r.status).toBe('changed')
  })

  it('v16.0.1(M11): _toolResults 型历史（无 tool_calls）→ 重建 read/write 记录', () => {
    // 生产 UI 数据流：assistant 消息不带 tool_calls，改带 _toolResults；
    // buildHistoryMessages 还原为 hist_ 前缀 tool_call_id 的 tool 消息
    const history: Message[] = [
      { role: 'user', content: '读一下第3章' },
      {
        role: 'assistant', content: '',
        _toolResults: [
          { tool: 'read_file', args: { file_path: 'chapters/chapter3.txt' }, content: JSON.stringify({ status: 'success', summary: '500 字符', detail: '第三章全文内容' }) },
        ],
      },
      { role: 'tool', tool_call_id: 'hist_0_read_file', content: JSON.stringify({ status: 'success', summary: '500 字符', detail: '第三章全文内容' }) },
      { role: 'user', content: '改一下' },
      {
        role: 'assistant', content: '',
        _toolResults: [
          { tool: 'edit_file', args: { file_path: 'chapters/chapter3.txt', old_string: '第二段', new_string: '新第二段' }, content: JSON.stringify({ status: 'success', summary: '已修改' }) },
        ],
      },
      { role: 'tool', tool_call_id: 'hist_1_edit_file', content: JSON.stringify({ status: 'success', summary: '已修改' }) },
    ]
    const t = ReadResultTracker.rebuildFromHistory(history)

    // 读后改 → 重读判 changed（writeRecords 已重建）
    const content = '第三章新内容'
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    const r = t.checkRead('chapters/chapter3.txt', 'full', hash, history, 5)
    expect(r.status).toBe('changed')
    if (r.status === 'changed') {
      expect(r.writes.some(w => w.changeSummary.includes('第二段'))).toBe(true)
    }
  })

  it('v16.0.1(M11): _toolResults 无写入时跨 run 重建 → dup（内容在上下文中）', () => {
    const history: Message[] = [
      { role: 'user', content: '读一下' },
      {
        role: 'assistant', content: '',
        _toolResults: [
          { tool: 'read_file', args: { file_path: 'a.txt' }, content: JSON.stringify({ status: 'success', summary: '500 字符', detail: 'AAA' }) },
        ],
      },
      { role: 'tool', tool_call_id: 'hist_0_read_file', content: JSON.stringify({ status: 'success', summary: '500 字符', detail: 'AAA' }) },
    ]
    const t = ReadResultTracker.rebuildFromHistory(history)

    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: 'AAA' }))
    const r = t.checkRead('a.txt', 'full', hash, history, 2)
    expect(r.status).toBe('dup')
    if (r.status === 'dup') {
      expect(r.stillInContext).toBe(true)  // 还原的 tool 消息内容指纹匹配 → 去重生效
      expect(r.forceReturnFull).toBe(false)
    }
  })

  it('v16.0.1(N2): edit_file_task 写后重读 → changed（子代理写工具 recordWrite 生效）', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '旧内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    msgs.push(makeReadToolMsg('c1', content))
    // 子代理写工具（原 ToolExecutor WRITE_TOOLS 不含 → 从不记录 → 重读判 dup）
    t.recordWrite('chapters/1.md', 2, '"旧" → "新"')

    const r = t.checkRead('chapters/1.md', 'full', hash, msgs, 3)
    expect(r.status).toBe('changed')
  })

  it('v16.0.1(轻微项): changed 随重读重置——写后重读一次，后续读判 dup 而非持续 changed', () => {
    const t = new ReadResultTracker()
    const msgs: Message[] = []
    const content = '新内容'.repeat(100)
    const hash = hashStr(JSON.stringify({ status: 'success', summary: '500 字符', detail: content }))
    t.recordRead('chapters/1.md', 'full', 1, hash)
    t.recordWrite('chapters/1.md', 2, '修改')
    msgs.push(makeReadToolMsg('c1', content))

    // 第一次重读 → changed（带着修改提示）
    const r1 = t.checkRead('chapters/1.md', 'full', hash, msgs, 3)
    expect(r1.status).toBe('changed')
    // 第二次重读（已拿到新版本）→ dup（writeRecords 已清）
    const r2 = t.checkRead('chapters/1.md', 'full', hash, msgs, 4)
    expect(r2.status).toBe('dup')
  })
})

describe('文案构建', () => {
  it('buildDupDetail 含轮次与摘要', () => {
    const d = buildDupDetail({ filePath: 'a', rangeKey: 'full', turnSeq: 3, contentHash: 'x' }, '500 字符')
    expect(d).toContain('第 3 轮')
    expect(d).toContain('500 字符')
    expect(d).toContain('已读取过')
  })

  it('buildChangedDetail 含修改列表', () => {
    const d = buildChangedDetail([{ filePath: 'a', turnSeq: 2, changeSummary: '"旧" → "新"' }], '500 字符')
    expect(d).toContain('第 2 轮')
    expect(d).toContain('旧" → "新')
    expect(d).toContain('已修改')
  })
})
