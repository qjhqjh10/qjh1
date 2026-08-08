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
