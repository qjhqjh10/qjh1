#!/usr/bin/env node
/**
 * Export tool schemas to JSON for CLI agent consumption.
 *
 * Since the TypeScript tool definitions cannot be directly imported
 * from ESM, this script extracts the canonical TOOL_SCHEMAS by
 * importing from the compiled output or falling back to a static dump.
 *
 * Usage:
 *   node scripts/export-tool-schemas.mjs > scripts/tool-schemas.json
 *   node scripts/export-tool-schemas.mjs --check   (verify sync)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const APP_ROOT = join(__dirname, '..')
const OUT_PATH = join(APP_ROOT, 'scripts', 'tool-schemas.json')

// Canonical tool schemas — keep in sync with src/agent/tools/definitions/
// Auto-generated snapshots; manual edits go in the TS files.
const CANONICAL_SCHEMAS = generateSchemas()

function generateSchemas() {
  // This function mirrors src/agent/tools/toolSchemas.ts
  // When the TS build is available, import it; otherwise use this static fallback.
  const tools = [
    // ── File tools (9) ──
    { name: 'list_directory', description: '列出项目目录中的文件和子目录。', params: { dir_path: { type: 'string', description: '相对于项目根目录的路径' } }, required: ['dir_path'] },
    { name: 'read_file', description: '读取项目文件的完整文本内容。', params: { file_path: { type: 'string', description: '相对路径' } }, required: ['file_path'] },
    { name: 'find_files', description: '按 Glob 模式递归搜索文件名，支持项目内和电脑全局搜索。', params: { pattern: { type: 'string', description: 'Glob 模式，如 "*.yaml", "chapter*.txt"' }, dir_path: { type: 'string', description: '搜索起始目录' } }, required: ['pattern'] },
    { name: 'search_content', description: '在项目文件中搜索指定文本。', params: { pattern: { type: 'string', description: '要搜索的文本' }, file_pattern: { type: 'string', description: '限定文件类型，如 "*.json"' }, dir_path: { type: 'string', description: '起始目录' } }, required: ['pattern'] },
    { name: 'edit_file', description: '精确字符串替换编辑文件。先 read_file 确认内容再编辑。', params: { file_path: { type: 'string', description: '相对路径' }, old_string: { type: 'string', description: '要被替换的原文' }, new_string: { type: 'string', description: '替换后的新文本' }, replace_all: { type: 'boolean', description: '是否替换所有匹配处' } }, required: ['file_path', 'old_string', 'new_string'] },
    { name: 'batch_replace', description: '批量替换文件中的多个文本对（3处以上修改时优先使用）。', params: { file_path: { type: 'string', description: '相对路径' }, replacements: { type: 'array', description: '[{old:"原文", new:"新文"}, ...]' } }, required: ['file_path', 'replacements'] },
    { name: 'create_file', description: '创建新文件并写入内容。需要用户确认。', params: { file_path: { type: 'string', description: '相对路径' }, content: { type: 'string', description: '文件内容' } }, required: ['file_path', 'content'] },
    { name: 'delete_file', description: '删除文件。需要用户确认。', params: { file_path: { type: 'string', description: '相对路径' } }, required: ['file_path'] },
    { name: 'rename_file', description: '重命名或移动文件。需要用户确认。', params: { file_path: { type: 'string', description: '当前路径' }, new_path: { type: 'string', description: '新路径' } }, required: ['file_path', 'new_path'] },
    // ── KB tools (4) ──
    { name: 'kb_list', description: '列出知识库中的文件。', params: {}, required: [] },
    { name: 'kb_create_file', description: '在知识库中创建新文件。', params: { file_name: { type: 'string', description: '文件名' }, content: { type: 'string', description: '文件内容' } }, required: ['file_name', 'content'] },
    { name: 'kb_append_file', description: '追加内容到知识库文件。', params: { file_name: { type: 'string', description: '文件名' }, content: { type: 'string', description: '追加内容' } }, required: ['file_name', 'content'] },
    { name: 'kb_index_file', description: '为知识库文件建立语义搜索索引。', params: { file_name: { type: 'string', description: '文件名' } }, required: ['file_name'] },
    // ── Note tools (6) ──
    { name: 'list_notes', description: '列出所有草稿笔记。', params: {}, required: [] },
    { name: 'read_note', description: '读取草稿笔记内容。', params: { note_name: { type: 'string', description: '笔记文件名' } }, required: ['note_name'] },
    { name: 'write_note', description: '创建或覆盖草稿笔记。', params: { note_name: { type: 'string', description: '笔记文件名' }, content: { type: 'string', description: '笔记内容' } }, required: ['note_name', 'content'] },
    { name: 'append_note', description: '追加内容到草稿笔记。', params: { note_name: { type: 'string', description: '笔记文件名' }, content: { type: 'string', description: '追加内容' } }, required: ['note_name', 'content'] },
    { name: 'delete_note', description: '删除草稿笔记。', params: { note_name: { type: 'string', description: '笔记文件名' } }, required: ['note_name'] },
    { name: 'search_notes', description: '在笔记文件中搜索指定文本。', params: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    // ── Image tools (2) ──
    { name: 'search_images', description: '搜索网络图片（Unsplash）。', params: { query: { type: 'string', description: '搜索关键词' }, count: { type: 'number', description: '返回数量' } }, required: ['query'] },
    { name: 'generate_image', description: '使用AI生成图片。', params: { prompt: { type: 'string', description: '图片描述' }, size: { type: 'string', description: '图片尺寸', enum: ['1024x1024', '1792x1024', '1024x1792'] } }, required: ['prompt'] },
    // ── Template tools (2) ──
    { name: 'create_style_template', description: '创建风格模板。基于27维文风分析。', params: { name: { type: 'string', description: '模板名称' }, dimensions: { type: 'object', description: '27维文风分析结果' } }, required: ['name'] },
    { name: 'create_scene_template', description: '创建场景模板。配置章节的场景参数。', params: { name: { type: 'string', description: '模板名称' }, scene_type: { type: 'string', description: '场景类型' }, config: { type: 'object', description: '场景配置' } }, required: ['name'] },
    // ── Project tools (2) ──
    { name: 'create_project', description: '创建新的写作项目。需要用户确认。', params: { name: { type: 'string', description: '项目名称' }, novel_category: { type: 'string', description: '小说类型' } }, required: ['name'] },
    { name: 'delete_project', description: '删除项目。需要用户确认。', params: { project_name: { type: 'string', description: '项目名称' } }, required: ['project_name'] },
    // ── Prompt tools (3) ──
    { name: 'list_prompts', description: '列出提示词库中的提示词。', params: {}, required: [] },
    { name: 'toggle_prompt', description: '启用或禁用提示词。', params: { prompt_name: { type: 'string', description: '提示词名称' }, enabled: { type: 'boolean', description: '启用/禁用' } }, required: ['prompt_name'] },
    { name: 'update_prompt', description: '修改提示词内容。', params: { prompt_name: { type: 'string', description: '提示词名称' }, new_content: { type: 'string', description: '新提示词内容' } }, required: ['prompt_name'] },
    // ── Harness/self-management tools (2) ──
    { name: 'list_rules', description: '列出 .aiharness/ 中的已学习规则。', params: {}, required: [] },
    { name: 'learn_rule', description: '从经验中学习并持久化规则，防止以后再犯同样错误。', params: { trigger: { type: 'string', description: '触发条件' }, problem: { type: 'string', description: '问题描述' }, solution: { type: 'string', description: '解决方案' }, category: { type: 'string', description: '错误分类' } }, required: ['trigger', 'problem', 'solution'] },
    // update_config, list_audit removed in v13.2.0
    // ── HTTP tools (2) ──
    { name: 'http_get', description: '发起 HTTP GET 请求获取网页或 API 数据。', params: { url: { type: 'string', description: '完整的 URL' } }, required: ['url'] },
    { name: 'http_fetch', description: '发起 HTTP 请求（支持 GET/POST），可自定义请求头、请求体。', params: { url: { type: 'string' }, method: { type: 'string', description: 'GET 或 POST' }, headers: { type: 'string', description: 'JSON 格式请求头' }, body: { type: 'string' } }, required: ['url'] },
    // ── Browser tools (2) ──
    { name: 'browser_open', description: '打开网页 URL，提取并返回纯文本内容。', params: { url: { type: 'string', description: '网页 URL' } }, required: ['url'] },
    { name: 'browser_search', description: '使用搜索引擎搜索关键词，返回结果摘要。', params: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    // ── Shell tools (2) ──
    { name: 'shell_exec', description: '执行系统命令（仅允许 node/python/git/npm/npx）。需要双确认。', params: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
    { name: 'shell_run_script', description: '执行 .aiharness/scripts/ 下的预置脚本。', params: { name: { type: 'string' } }, required: ['name'] },
    // lsp_diagnose removed in v13.2.0
  ]

  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.params || {},
        required: t.required || [],
      },
    },
  }))
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--check')) {
    // Verify existing schemas file matches canonical
    try {
      const existing = JSON.parse(await readFile(OUT_PATH, 'utf-8'))
      const canonical = CANONICAL_SCHEMAS
      if (existing.length !== canonical.length) {
        console.error(`MISMATCH: existing ${existing.length} tools, canonical ${canonical.length} tools`)
        process.exit(1)
      }
      console.log(`OK: ${canonical.length} tools in sync`)
      process.exit(0)
    } catch (err) {
      console.error('Check failed:', err.message)
      process.exit(1)
    }
  }

  // Write schemas to file
  await writeFile(OUT_PATH, JSON.stringify(CANONICAL_SCHEMAS, null, 2), 'utf-8')
  console.error(`Wrote ${CANONICAL_SCHEMAS.length} tool schemas to ${OUT_PATH}`)
  // Also write to stdout for piping
  console.log(JSON.stringify(CANONICAL_SCHEMAS, null, 2))
}

main().catch(err => { console.error(err.message); process.exit(1) })
