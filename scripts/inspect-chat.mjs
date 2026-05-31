#!/usr/bin/env node
// ── 对话检查工具 v2 ──
// 终端查看 AI 对话历史、工具调用、反馈、插入建议等。
// Usage:
//   node scripts/inspect-chat.mjs                    默认: 最近对话摘要
//   node scripts/inspect-chat.mjs --stats            统计信息
//   node scripts/inspect-chat.mjs --detail           最后对话完整交互过程
//   node scripts/inspect-chat.mjs --detail --last=3  最后3个对话完整过程
//   node scripts/inspect-chat.mjs --tools            仅显示工具调用摘要
//   node scripts/inspect-chat.mjs --tokens           详细Token消耗分析

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const lastN = parseInt(args.find(a => a.startsWith('--last='))?.split('=')[1] || '3')
const showStats = args.includes('--stats')
const showDetail = args.includes('--detail')
const showTools = args.includes('--tools')
const showTokens = args.includes('--tokens')

const searchPaths = [
  resolve(__dirname, '..', '.appdata', 'chat-conversations.json'),
  resolve(__dirname, '..', '..', '.appdata', 'chat-conversations.json'),
  resolve(__dirname, '..', 'projects', '.appdata', 'chat-conversations.json'),
  resolve(__dirname, '..', 'projects', '..', '.appdata', 'chat-conversations.json'),
]

let data = null
for (const p of searchPaths) {
  if (existsSync(p)) {
    try { data = JSON.parse(readFileSync(p, 'utf-8')); console.log(`📂 ${p}`); break } catch {}
  }
}

if (!data) {
  console.error('❌ 未找到对话文件。重启应用后对话文件会自动生成。')
  process.exit(1)
}

const convs = Array.isArray(data) ? data : [data]

// ── --stats ──
if (showStats) {
  console.log(`\n📊 统计 (${convs.length} 个对话)\n`)
  let totalMsgs = 0, totalTokens = 0, totalTools = 0
  for (const c of convs) {
    const msgs = c.messages || []
    totalMsgs += msgs.length
    totalTokens += c.totalTokens || 0
    const tools = new Set()
    for (const m of msgs) {
      if (m.toolsUsed) m.toolsUsed.forEach(t => tools.add(t))
      if (m.tool_calls) m.tool_calls.forEach(tc => tools.add(tc.function?.name || tc.name || '?'))
    }
    totalTools += tools.size
    const userMsgs = msgs.filter(m => m.role === 'user')
    const asstMsgs = msgs.filter(m => m.role === 'assistant')
    const toolMsgs = msgs.filter(m => m.role === 'tool')
    const totalChars = msgs.reduce((s, m) => s + (m.content || '').length, 0)
    console.log(`  📝 "${c.title}"`)
    console.log(`     消息: ${msgs.length} (👤${userMsgs.length} 🤖${asstMsgs.length} 🔧${toolMsgs.length})`)
    console.log(`     字符: ${totalChars.toLocaleString()} | 工具: ${tools.size}种 | Token: ${(c.totalTokens || 0).toLocaleString()}`)
    console.log('')
  }
  console.log(`  合计: ${totalMsgs}条消息 | ${totalTools}种工具 | ${totalTokens.toLocaleString()} tokens`)
  process.exit(0)
}

// ── --tools ──
if (showTools) {
  console.log(`\n🔧 工具调用摘要\n`)
  const allTools = new Map()
  for (const c of convs.slice(-lastN)) {
    const msgs = c.messages || []
    console.log(`━━━ ${c.title || '未命名'} ━━━`)
    for (const m of msgs) {
      if (m.role === 'assistant' && m.toolsUsed && m.toolsUsed.length > 0) {
        const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN') : ''
        console.log(`  🤖 [${ts}] 调用了 ${m.toolsUsed.length} 个工具: ${m.toolsUsed.join(', ')}`)
        for (const t of m.toolsUsed) {
          allTools.set(t, (allTools.get(t) || 0) + 1)
        }
        if (m.usage) console.log(`     Token: ${m.usage.total_tokens?.toLocaleString() || '?'} | 迭代: ${m.iterationCount || '?'}`)
      }
    }
    console.log('')
  }
  if (allTools.size > 0) {
    console.log('  工具使用频率:')
    ;[...allTools.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
      console.log(`    ${name}: ${count}次`)
    })
  }
  process.exit(0)
}

// ── --tokens ──
if (showTokens) {
  let grandInput = 0, grandOutput = 0, grandTotal = 0
  for (const c of convs.slice(-lastN)) {
    const msgs = c.messages || []
    let convInput = 0, convOutput = 0
    const domainTokens = new Map()

    console.log(`\n💰 "${c.title}"`)
    console.log(`  累计Token: ${(c.totalTokens || 0).toLocaleString()} | 峰值Prompt: ${(c.peakPromptTokens || 0).toLocaleString()}`)
    console.log('')

    for (const m of msgs) {
      if (m.role !== 'assistant' || !m.usage) continue
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN') : ''
      const input = m.usage.prompt_tokens || 0
      const output = m.usage.completion_tokens || 0
      const total = m.usage.total_tokens || (input + output)
      convInput += input; convOutput += output

      // User message (find preceding user msg for context)
      const msgIdx = msgs.indexOf(m)
      const userMsg = msgIdx > 0 ? msgs.slice(0, msgIdx).findLast(u => u.role === 'user') : null
      const userPreview = userMsg ? (userMsg.content || '').slice(0, 40).replace(/\n/g, ' ') : '?'

      const tools = m.toolsUsed?.join(', ') || '无'
      console.log(`  🤖 [${ts}] "${userPreview}${(userMsg?.content?.length || 0) > 40 ? '...' : ''}"`)
      console.log(`     输入: ${input.toLocaleString()} | 输出: ${output.toLocaleString()} | 合计: ${total.toLocaleString()}`)
      console.log(`     工具: ${tools} | 迭代: ${m.iterationCount || 1}${m.totalIterations && m.totalIterations > 1 ? `/${m.totalIterations}` : ''}`)

      // Input context breakdown
      if (m.breakdown && m.breakdown.length > 0) {
        console.log(`     上下文构成:`)
        for (const b of m.breakdown) {
          const estTokens = b.tokens || Math.round((b.chars || 0) / 2.2)
          domainTokens.set(b.label, (domainTokens.get(b.label) || 0) + estTokens)
          const bar = '█'.repeat(Math.min(Math.round(estTokens / 200), 20))
          console.log(`       ${b.label.padEnd(28)} ~${String(estTokens).padStart(5)} tokens  ${bar}`)
        }
      }

      // Output breakdown
      if (m.outputBreakdown && m.outputBreakdown.length > 0) {
        for (const o of m.outputBreakdown) {
          console.log(`      输出: ${o.label}: ${o.tokens?.toLocaleString() || '?'} tokens`)
        }
      }

      // Cost estimate (DeepSeek: $0.14/1M input, $0.28/1M output)
      const costInput = (input / 1_000_000) * 0.14
      const costOutput = (output / 1_000_000) * 0.28
      const costTotal = costInput + costOutput
      console.log(`      💵 估算费用: $${costTotal.toFixed(4)} (入:$${costInput.toFixed(3)} + 出:$${costOutput.toFixed(3)})`)
      console.log('')
    }

    // Conversation summary
    grandInput += convInput; grandOutput += convOutput
    console.log(`  ──────────────────────────────────────────`)
    const costI = (convInput / 1_000_000) * 0.14
    const costO = (convOutput / 1_000_000) * 0.28
    console.log(`  本对话 输入: ${convInput.toLocaleString()} | 输出: ${convOutput.toLocaleString()} | 💵 ~$${(costI + costO).toFixed(3)}`)
    if (domainTokens.size > 0) {
      console.log(`  上下文累计:`)
      ;[...domainTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, t]) => {
        console.log(`    ${d}: ~${t.toLocaleString()} tokens`)
      })
    }
    console.log('')
  }

  const totalCost = (grandInput / 1_000_000) * 0.14 + (grandOutput / 1_000_000) * 0.28
  console.log(`💰 合计 (${convs.slice(-lastN).length}个对话): 输入 ${grandInput.toLocaleString()} | 输出 ${grandOutput.toLocaleString()} | 总费用 ~$${totalCost.toFixed(3)}`)
  process.exit(0)
}

// ── --detail ──
if (showDetail) {
  for (const c of convs.slice(-lastN)) {
    const msgs = c.messages || []
    console.log(`\n━━━ ${c.title || '未命名'} (${msgs.length}条) ━━━`)
    let roundNum = 0
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN') : ''

      if (m.role === 'user') {
        roundNum++
        console.log(`\n┌─ 第${roundNum}轮 ─────────────────────────────`)
        console.log(`│ 👤 用户 [${ts}]`)
        const lines = (m.content || '').split('\n')
        for (const l of lines) console.log(`│   ${l}`)
      } else if (m.role === 'assistant') {
        console.log(`│`)
        console.log(`│ 🤖 AI [${ts}]`)
        // Tools used
        if (m.toolsUsed && m.toolsUsed.length > 0) {
          console.log(`│ 🔧 工具: ${m.toolsUsed.join(', ')}`)
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          for (const tc of m.tool_calls) {
            const fn = tc.function || tc
            let argsStr = ''
            try { const a = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || {}); argsStr = Object.entries(a).map(([k,v]) => `${k}=${String(v).slice(0,40)}`).join(', ') } catch {}
            console.log(`│   → ${fn.name}(${argsStr})`)
          }
        }
        // Response text
        const text = m.content || ''
        const lines = text.split('\n')
        for (const l of lines.slice(0, 20)) console.log(`│   ${l}`)
        if (lines.length > 20) console.log(`│   ... 还有 ${lines.length - 20} 行`)
        // Feedback
        if (m.hallucinationWarning) {
          console.log(`│ ⚠️  幻觉警告: ${m.hallucinationWarning}`)
        }
        if (m.insertion) {
          console.log(`│ 📌 插入建议: 定位"${m.insertion.keyword.slice(0, 50)}..." ${m.insertion.position === 'after' ? '之后' : '之前'}`)
        }
        if (m.thinkingPlan) {
          console.log(`│ 📋 执行计划: ${m.thinkingPlan.intent?.slice(0, 80) || ''} (${m.thinkingPlan.steps?.length || 0}步)`)
        }
        // Token info
        if (m.usage) {
          console.log(`│ 📊 Token: ${m.usage.total_tokens?.toLocaleString() || '?'} | 迭代: ${m.iterationCount || '?'}`)
          if (m.totalIterations && m.totalIterations > 1) console.log(`│    总迭代: ${m.totalIterations}`)
        }
        if (m.breakdown && m.breakdown.length > 0) {
          const totalChars = m.breakdown.reduce((s, b) => s + (b.chars || 0), 0)
          console.log(`│   上下文: ~${Math.round(totalChars / 2.2).toLocaleString()} tokens`)
          for (const b of m.breakdown) {
            console.log(`│     - ${b.label}: ~${b.tokens || Math.round((b.chars || 0) / 2.2)} tokens`)
          }
        }
      } else if (m.role === 'tool') {
        const label = m.toolName || ''
        try {
          const p = JSON.parse(m.content || '{}')
          const icon = p.status === 'error' ? '✗' : '✓'
          console.log(`│   ${icon} [${label}] ${(p.summary || '').slice(0, 100)}`)
        } catch {
          console.log(`│   🔧 [${label}] ${(m.content || '').slice(0, 100)}`)
        }
      } else if (m.role === 'system' && m.compressedSummary) {
        console.log(`│ 📦 压缩: 合并了 ${m.compressedCount || '?'} 条消息 (~${(m.compressedTokens || 0).toLocaleString()} tokens)`)
      }
    }
    console.log(`└──────────────────────────────────────────\n`)
  }
  process.exit(0)
}

// ── Default: brief summary ──
console.log(`\n💬 最近 ${Math.min(lastN, convs.length)} 个对话 (用 --detail 查看完整过程, --stats 统计, --tools 工具):\n`)
for (const c of convs.slice(-lastN)) {
  const msgs = c.messages || []
  const userMsgs = msgs.filter(m => m.role === 'user')
  const tools = new Set()
  const warnings = []
  for (const m of msgs) {
    if (m.toolsUsed) m.toolsUsed.forEach(t => tools.add(t))
    if (m.hallucinationWarning) warnings.push(m.hallucinationWarning)
    if (m.insertion) warnings.push(`插入建议: ${m.insertion.keyword.slice(0, 30)}`)
  }
  console.log(`📝 "${c.title}"`)
  console.log(`   消息: ${msgs.length} (用户${userMsgs.length}轮) | 工具: ${[...tools].join(', ') || '无'} | Token: ${(c.totalTokens || 0).toLocaleString()}`)
  if (warnings.length > 0) console.log(`   ⚠️  ${warnings.length} 个反馈: ${warnings.join('; ')}`)
  console.log('')
}
