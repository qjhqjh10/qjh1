#!/usr/bin/env node
/**
 * 从 V4SystemPrompt.ts 提取真实系统提示词 + 领域模块
 * 供 CLI agent 使用，确保 CLI 和 GUI 使用相同的提示词
 *
 * Usage: node scripts/build-cli-assets.mjs
 * Output: scripts/cli-system-prompt.json
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const APP_ROOT = join(__dirname, '..')
const SRC = join(APP_ROOT, 'src', 'agent', 'V4SystemPrompt.ts')
const OUT = join(__dirname, 'cli-system-prompt.json')

/**
 * 从 TypeScript 源码中提取模板字面量字符串。
 * 处理转义序列（\\n, \\t, \\` 等）。
 */
function extractTemplateLiteral(source, exportName) {
  // 匹配: export const NAME = `...内容...`
  const pattern = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*\``,
    'm'
  )
  const match = source.match(pattern)
  if (!match) {
    console.error(`未找到: export const ${exportName}`)
    return ''
  }

  const startIdx = match.index + match[0].length
  // 从 startIdx 开始找未转义的闭合反引号
  let i = startIdx
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2 // 跳过转义字符
      continue
    }
    if (source[i] === '`') {
      // 确认这是顶层闭合反引号（不在 ${} 内）
      const raw = source.slice(startIdx, i)
      // 还原转义: \\` → `, \\n → \n, \\t → \t, \\$ → $, \\\\ → \\
      return raw
        .replace(/\\\\/g, '\x00')       // \\ → placeholder
        .replace(/\\`/g, '`')           // \` → `
        .replace(/\\\$/g, '$')          // \$ → $
        .replace(/\\n/g, '\n')          // \n → newline
        .replace(/\\t/g, '\t')          // \t → tab
        .replace(/\x00/g, '\\')         // restore backslash
    }
    i++
  }
  console.error(`未找到 ${exportName} 的闭合反引号`)
  return ''
}

async function main() {
  const source = await readFile(SRC, 'utf-8')

  const core = extractTemplateLiteral(source, 'CORE_SYSTEM_PROMPT')
  const character = extractTemplateLiteral(source, 'CHARACTER_DOMAIN_MODULE')
  const outline = extractTemplateLiteral(source, 'OUTLINE_DOMAIN_MODULE')
  const chapter = extractTemplateLiteral(source, 'CHAPTER_DOMAIN_MODULE')
  const style = extractTemplateLiteral(source, 'STYLE_DOMAIN_MODULE')
  const scene = extractTemplateLiteral(source, 'SCENE_DOMAIN_MODULE')
  const kb = extractTemplateLiteral(source, 'KB_DOMAIN_MODULE')

  const output = {
    extractedAt: new Date().toISOString(),
    source: 'src/agent/V4SystemPrompt.ts',
    core: core.trim(),
    coreLength: core.length,
    modules: {
      character: character.trim(),
      outline: outline.trim(),
      chapter: chapter.trim(),
      style: style.trim(),
      scene: scene.trim(),
      kb: kb.trim(),
    },
    // 组装好的完整提示词（core + 所有模块）
    fullPrompt: [
      core.trim(),
      character.trim(),
      outline.trim(),
      chapter.trim(),
      style.trim(),
      scene.trim(),
      kb.trim(),
    ].filter(Boolean).join('\n\n'),
    fullLength: 0,
  }
  output.fullLength = output.fullPrompt.length

  await writeFile(OUT, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`✅ 已提取系统提示词到: ${OUT}`)
  console.log(`   Core: ${output.coreLength} 字符`)
  console.log(`   模块: ${Object.entries(output.modules).filter(([,v]) => v).length} 个`)
  console.log(`   完整: ${output.fullLength} 字符`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
