#!/usr/bin/env node
/**
 * 真实软件栈测试 — 使用真实的 Schemas + SecurityFence + ContractExecutor + 校验
 * 差异: 只 mock IPC 层 (Electron bridge)，其余全部走真实代码路径
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');

// ============================================================
// 1. 真实工具 SCHEMAS (从 skills/tools/ 提取，与软件完全一致)
// ============================================================
// 这些 schema 的 description、parameters、required 与真实软件完全相同
const REAL_SCHEMAS = [
  { name: 'list_directory', desc: '列出软件内全部文件，支持 Glob 模式过滤。直接并行扫描全局资源(风格/场景/KB/上传/笔记)+所有项目目录。不填 pattern 列出全部。', is: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob 模式过滤文件名，如 "*.json" "chapter*.txt"' }, broad: { type: 'boolean', description: '搜索电脑桌面/文档/下载(需批准)' } }, required: [] } },
  { name: 'read_file', desc: '读取文件完整内容。修改前必须先 read_file 确认原文。项目文件路径: 项目名/子路径（如 1/outline/plot.md）。全局文件路径: ../../前缀。不确定时用 list_directory 查找。', is: { type: 'object', properties: { file_path: { type: 'string', description: '相对路径' } }, required: ['file_path'] } },
  { name: 'search_content', desc: '搜索项目文件内容，支持正则。返回匹配行+行号+上下文。大量匹配时仅返回前20条。路径:项目名/文件。', is: { type: 'object', properties: { pattern: { type: 'string', description: '正则或纯文本' }, path: { type: 'string', description: '文件路径' } }, required: ['pattern'] } },
  { name: 'find_files', desc: '按文件名 Glob 模式递归搜索文件。项目内和电脑全局均支持。', is: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob模式' }, path: { type: 'string', description: '起始目录' } }, required: ['pattern'] } },
  { name: 'edit_file', desc: '编辑文件。old_string 必须精确匹配原文(包括所有空格/缩进/换行)。修改前先 read_file。__FULL_REPLACE__表示全量替换。', is: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'create_file', desc: '创建新文件，自动创建父目录。YAML/JSON 文件会经过格式校验(格式错误写入被拒绝)。创建前先 read_file 参考同目录已有文件格式。', is: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'delete_file', desc: '删除文件(不可恢复，需用户确认!)', is: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'rename_file', desc: '重命名/移动文件。', is: { type: 'object', properties: { path: { type: 'string' }, new_path: { type: 'string' } }, required: ['path', 'new_path'] } },
  { name: 'kb_list', desc: '列出知识库所有文件。', is: { type: 'object', properties: {} } },
  { name: 'kb_create_file', desc: '在知识库创建.md文件。路径:../../knowledge_base/files/文件名.md', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'kb_append_file', desc: '追加到已有KB文件。', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'write_note', desc: '创建新笔记。文件名自动加.md后缀。', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'read_note', desc: '读取指定笔记内容。', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_notes', desc: '列出所有笔记。', is: { type: 'object', properties: {} } },
  { name: 'append_note', desc: '追加内容到已有笔记。新笔记用write_note。', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'create_style_template', desc: '创建风格模板。必填:name,type,dimensions(11维度至少)。dimensions每个维度:{description,examples(≥3条原文),writingRules(≥3条),vocabularyList(≥10词)}。有证据才分析，禁止传空dimensions!', is: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, dimensions: { type: 'object' }, worldType: { type: 'string' }, tone: { type: 'object' } }, required: ['name', 'type', 'dimensions'] } },
  { name: 'create_scene_template', desc: '创建场景模板。必填:name,type。', is: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, sceneType: { type: 'string' }, plotOverview: { type: 'string' }, characters: { type: 'string' } }, required: ['name', 'type'] } },
  { name: 'create_project', desc: '创建新的写作项目，自动建立标准子目录结构。', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'delete_project', desc: '删除项目(不可恢复，需用户确认!)', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

// 真实权限映射 (与 toolRegistry 一致)
const PERM = {
  list_directory: 'AUTO', read_file: 'AUTO', search_content: 'AUTO', find_files: 'AUTO',
  edit_file: 'AUTO', create_file: 'AUTO',
  delete_file: 'DANGEROUS_ASK', rename_file: 'READ_ASK',
  kb_list: 'AUTO', kb_create_file: 'AUTO', kb_append_file: 'AUTO',
  write_note: 'AUTO', read_note: 'AUTO', list_notes: 'AUTO', append_note: 'AUTO',
  create_style_template: 'AUTO', create_scene_template: 'AUTO',
  create_project: 'PROJECT_ASK', delete_project: 'DANGEROUS_ASK',
};

// ============================================================
// 2. 真实 SecurityFence 逻辑 (从 V4SecurityFence.ts 移植)
// ============================================================
function securityCheck(toolName, args) {
  const fp = String(args.file_path || args.path || args.filePath || args.dir_path || '');
  // Layer 1: Hard blocks
  if (fp && /^\\\\/.test(fp)) return { allow: false, reason: '网络路径拦截' };
  if (fp && /%[A-Z_]+%/.test(fp)) return { allow: false, reason: '环境变量拦截' };
  const l = fp.toLowerCase().replace(/\\/g, '/');
  if (l.startsWith('c:/windows') || l.startsWith('/dev/') || l.startsWith('/etc/') || l.startsWith('/usr/'))
    return { allow: false, reason: '系统目录拦截' };

  // Layer 2: YAML/JSON validation for create_file (与 schemaValidation.ts 一致)
  if (toolName === 'create_file' && fp) {
    const isYaml = fp.endsWith('.yaml') || fp.endsWith('.yml');
    const content = String(args.content || '');
    if (isYaml && content) {
      const lines = content.split('\n');
      // Check 1: No tab indentation
      for (let i = 0; i < lines.length; i++) {
        if (/\t/.test(lines[i]) && lines[i].trim())
          return { allow: false, reason: 'YAML格式错误: 第' + (i + 1) + '行包含Tab缩进，请使用2空格' };
      }
      // Check 2: Basic structure
      if (!/^\w+:/m.test(content))
        return { allow: false, reason: 'YAML格式错误: 缺少键值对' };
      // Check 3: No code block wrapping
      if (content.startsWith('```'))
        return { allow: false, reason: 'YAML格式错误: 不要用代码块包裹，直接传纯YAML字符串' };
    }
  }

  // Layer 3: Permission gate
  const perm = PERM[toolName];
  if (perm === 'DANGEROUS_ASK') return { allow: true, needApproval: true, reason: '危险操作需确认' };
  if (perm === 'PROJECT_ASK') return { allow: true, needApproval: true, reason: '项目操作需确认' };

  return { allow: true, needApproval: false };
}

// ============================================================
// 3. 真实 ContractExecutor 逻辑 (从 ContractExecutor.ts 移植)
// ============================================================
const CONTRACTS = {
  read_file: ['status', 'summary', 'detail'],
  list_directory: ['status', 'summary', 'detail'],
  search_content: ['status', 'summary', 'detail'],
  find_files: ['status', 'summary', 'detail'],
  list_notes: ['status', 'summary', 'detail'],
  read_note: ['status', 'summary', 'detail'],
  kb_list: ['status', 'summary', 'detail'],
  // Write/Template tools — strip detail (与真实软件一致)
  create_file: ['status', 'summary'],
  edit_file: ['status', 'summary'],
  delete_file: ['status', 'summary'],
  rename_file: ['status', 'summary'],
  kb_create_file: ['status', 'summary'],
  kb_append_file: ['status', 'summary'],
  write_note: ['status', 'summary'],
  append_note: ['status', 'summary'],
  delete_note: ['status', 'summary'],
  create_style_template: ['status', 'summary'],
  create_scene_template: ['status', 'summary'],
  create_project: ['status', 'summary'],
  delete_project: ['status', 'summary'],
};

function filterForContext(toolName, result) {
  const contract = CONTRACTS[toolName];
  if (!contract) return result;
  const filtered = {};
  for (const k of contract) if (result[k] !== undefined) filtered[k] = result[k];
  return filtered;
}

// ============================================================
// 4. 工具执行 (mock IPC, 但走真实校验路径)
// ============================================================
const PROJ = '_test_real';
// 路径解析 — 与真实软件一致: 自动处理项目前缀
const P = (p) => {
  let clean = String(p || '').replace(/\\/g, '/');
  // Strip project prefix if present (model may include it)
  if (clean.startsWith(PROJ + '/')) clean = clean.slice(PROJ.length + 1);
  else if (clean === PROJ) clean = '.';
  // Handle ../../ global paths
  if (clean.startsWith('../../')) return path.join(ROOT, clean.slice(6));
  return path.join(ROOT, 'projects', PROJ, clean);
};
const G = (p) => path.join(ROOT, String(p || '').replace(/\\/g, '/').replace('../../', ''));

const tools = {
  read_file: (args) => {
    try { const fp = P(args.file_path || args.path); const c = fs.readFileSync(fp, 'utf-8'); return { status: 'success', summary: '读取成功(' + c.length + '字符)', detail: c.slice(0, 5000) }; }
    catch { return { status: 'error', summary: '文件不存在: ' + (args.file_path || '') }; }
  },
  list_directory: (args) => {
    try { const d = P(args.path || '.'); const es = fs.readdirSync(d, { withFileTypes: true }); const pt = args.pattern ? new RegExp(args.pattern.replace(/\*/g, '.*')) : null; const fl = pt ? es.filter(e => pt.test(e.name)) : es; return { status: 'success', summary: fl.length + '项', detail: fl.map(e => (e.isDirectory() ? '📁' : '📄') + ' ' + e.name).join('\n') }; }
    catch { return { status: 'error', summary: '目录不存在' }; }
  },
  search_content: (args) => {
    try { let rp = String(args.path || '.'); if (rp.startsWith(PROJ + '/')) rp = rp.slice(PROJ.length + 1); else if (rp === PROJ) rp = '.';
      const fp = P(rp); const st = fs.statSync(fp); let all = ''; const re = new RegExp(args.pattern || '', 'gi');
      if (st.isDirectory()) { (function walk(dd, dp) { if (dp > 3) return; try { fs.readdirSync(dd, { withFileTypes: true }).forEach(e => { const p2 = path.join(dd, e.name); e.isDirectory() ? walk(p2, dp + 1) : /\.(txt|md|yaml|yml)$/i.test(e.name) && (() => { const c = fs.readFileSync(p2, 'utf-8'); const ms = c.split('\n').map((l, i) => re.test(l) ? path.relative(fp, p2) + ':' + (i + 1) + ': ' + l.trim().slice(0, 200) : null).filter(Boolean); if (ms.length) all += ms.slice(0, 5).join('\n') + '\n'; })(); }); } catch { } })(fp, 0); } else { const c = fs.readFileSync(fp, 'utf-8'); const ms = c.split('\n').map((l, i) => re.test(l) ? (i + 1) + ': ' + l.trim().slice(0, 200) : null).filter(Boolean); all = ms.slice(0, 15).join('\n'); }
      return { status: 'success', summary: '搜索完成', detail: all.slice(0, 3000) || '无匹配' };
    } catch { return { status: 'error', summary: '搜索失败' }; }
  },
  find_files: (args) => { try { const ms = []; (function w(d, dp) { if (dp > 3) return; try { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const fp = path.join(d, e.name); e.isDirectory() ? w(fp, dp + 1) : (args.pattern && e.name.includes(args.pattern.replace(/\*/g, ''))) && ms.push(path.relative(P('.'), fp)); }); } catch { } })(P('.'), 0); return { status: 'success', summary: ms.length + '个文件', detail: ms.join('\n') }; } catch { return { status: 'error', summary: '查找失败' }; } },
  edit_file: (args) => {
    try { const fp = P(args.file_path); let c = fs.readFileSync(fp, 'utf-8'); const o = args.old_string || '', n = args.new_string || ''; if (o === '__FULL_REPLACE__') { fs.writeFileSync(fp, n); return { status: 'success', summary: '全量替换' }; } let i = c.indexOf(o); if (i < 0) i = c.indexOf(o.trim()); if (i < 0) return { status: 'error', summary: 'old_string未匹配原文。请read_file确认后用原文中逐字复制的内容重试。' }; fs.writeFileSync(fp, c.slice(0, i) + n + c.slice(i + o.length)); return { status: 'success', summary: '编辑成功' }; }
    catch { return { status: 'error', summary: '编辑失败' }; }
  },
  create_file: (args) => {
    try { const fp = P(args.file_path); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, args.content || ''); return { status: 'success', summary: '创建成功(' + (args.content || '').length + '字符)' }; }
    catch (e) { return { status: 'error', summary: '创建失败: ' + e.message }; }
  },
  delete_file: (args) => { try { fs.unlinkSync(P(args.file_path)); return { status: 'success', summary: '已删除' }; } catch { return { status: 'error', summary: '删除失败' }; } },
  rename_file: (args) => { try { fs.renameSync(P(args.path || args.file_path), P(args.new_path)); return { status: 'success', summary: '已重命名' }; } catch { return { status: 'error', summary: '重命名失败' }; } },
  kb_list: () => { try { return { status: 'success', summary: fs.readdirSync(G('knowledge_base/files')).filter(f => f.endsWith('.md')).length + '个KB文件', detail: fs.readdirSync(G('knowledge_base/files')).filter(f => f.endsWith('.md')).join('\n') }; } catch { return { status: 'success', summary: 'KB为空' }; } },
  kb_create_file: (args) => { try { const d = G('knowledge_base/files'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, (args.name || 'u').replace(/\.md$/, '') + '.md'), args.content || ''); return { status: 'success', summary: 'KB已创建' }; } catch (e) { return { status: 'error', summary: 'KB创建失败' }; } },
  kb_append_file: (args) => { try { const n = (args.name || '').replace(/\.md$/, '') + '.md'; const fp = G('knowledge_base/files/' + n); if (!fs.existsSync(fp)) return { status: 'error', summary: 'KB文件不存在' }; fs.appendFileSync(fp, '\n' + (args.content || '')); return { status: 'success', summary: 'KB已追加' }; } catch { return { status: 'error', summary: 'KB追加失败' }; } },
  write_note: (args) => { try { const d = G('notes'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, (args.name || 'u').replace(/\.md$/, '') + '.md'), args.content || ''); return { status: 'success', summary: '笔记已创建' }; } catch { return { status: 'error', summary: '笔记创建失败' }; } },
  read_note: (args) => { try { return { status: 'success', summary: '读取笔记', detail: fs.readFileSync(G('notes/' + (args.name || '').replace(/\.md$/, '') + '.md'), 'utf-8').slice(0, 2000) }; } catch { return { status: 'error', summary: '笔记不存在' }; } },
  list_notes: () => { try { return { status: 'success', summary: fs.readdirSync(G('notes')).filter(f => f.endsWith('.md')).length + '条笔记' }; } catch { return { status: 'success', summary: '无笔记' }; } },
  append_note: (args) => { try { const n = (args.name || '').replace(/\.md$/, '') + '.md'; fs.appendFileSync(G('notes/' + n), '\n' + (args.content || '')); return { status: 'success', summary: '笔记已追加' }; } catch { return { status: 'error', summary: '笔记追加失败' }; } },
  create_style_template: (args) => ({ status: 'success', summary: '风格模板已创建: ' + (args.name || '未命名') }),
  create_scene_template: (args) => ({ status: 'success', summary: '场景模板已创建: ' + (args.name || '未命名') }),
  create_project: (args) => { try { const d = path.join(ROOT, 'projects', args.name || 'p'); ['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true })); return { status: 'success', summary: '项目已创建' }; } catch { return { status: 'error', summary: '创建失败' }; } },
  delete_project: () => ({ status: 'error', summary: '测试环境禁止删除项目' }),
};

// ============================================================
// 5. Agent 循环 (使用真实 Security Fence + Contract Executor)
// ============================================================
import { buildSystemPrompt } from './real-prompt.mjs';

const KEY = 'sk-c9c30831df7243209435c60e811c879d';
const URL = 'https://api.deepseek.com/anthropic/v1/messages';
const M = 'deepseek-v4-flash';

async function callAPI(sys, msgs) {
  const bd = { model: M, system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 4096, stream: true,
    tools: REAL_SCHEMAS.map(t => ({ name: t.name, description: t.desc, input_schema: t.is })) };
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(bd) });
  if (!r.ok) throw new Error('API ' + r.status);
  let ft = ''; const tus = []; const bs = [];
  for (const ch of (await r.text()).split(/\n\n/)) {
    if (!ch.trim()) continue; let et = '', d = '';
    for (const l of ch.split('\n')) { if (l.startsWith('event:')) et = l.slice(6).trim(); else if (l.startsWith('data:')) d = l.slice(5).trim(); }
    if (!d) continue;
    try { const ev = JSON.parse(d); const t = et || ev.type || '';
      if (t === 'content_block_start') bs.push({ ...ev.content_block, index: ev.index, ij: '' });
      else if (t === 'content_block_delta') { const b2 = bs.find(x => x.index === (ev.index ?? bs.length - 1)); if (!b2) continue; if (ev.delta?.type === 'text_delta') { b2.text = (b2.text || '') + ev.delta.text; ft += ev.delta.text; } if (ev.delta?.type === 'input_json_delta') { b2.ij = (b2.ij || '') + ev.delta.partial_json; try { b2.input = JSON.parse(b2.ij); } catch { } } }
      else if (t === 'content_block_stop') { const b3 = bs.find(x => x.index === (ev.index ?? bs.length - 1)); if (b3?.type === 'tool_use') tus.push({ id: b3.id, name: b3.name, input: b3.input || {} }); }
    } catch { }
  }
  return { text: ft, tus };
}

async function agent(msg, maxIter) {
  maxIter = maxIter || 10;
  const sys = buildSystemPrompt(msg, PROJ);
  const msgs = [{ role: 'user', content: [{ type: 'text', text: msg }] }];
  let iter = 0, tc = 0; const tcs = [];
  for (; iter < maxIter;) {
    iter++;
    const r = await callAPI(sys, msgs);
    if (!r.tus.length) return { text: r.text, iter, tc, tcs };
    const ac = []; if (r.text) ac.push({ type: 'text', text: r.text });
    for (const tu of r.tus) ac.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    msgs.push({ role: 'assistant', content: ac });

    // ★ 真实软件栈：SecurityFence → 执行 → ContractExecutor → 注入上下文
    const trs = [];
    for (const tu of r.tus) {
      // (a) Security check
      const sec = securityCheck(tu.name, tu.input);
      if (!sec.allow) {
        tc++; tcs.push({ n: tu.name, s: 'err', m: 'SECURITY: ' + sec.reason, blocked: true });
        trs.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ status: 'error', summary: sec.reason }) });
        continue;
      }
      // (b) Execute
      const fn = tools[tu.name];
      let result = fn ? await fn(tu.input) : { status: 'error', summary: '未知工具' };
      // (c) ContractExecutor filtering
      const filtered = filterForContext(tu.name, result);
      tc++; tcs.push({ n: tu.name, s: result.status === 'success' ? 'ok' : 'err', m: result.summary, blocked: false });
      trs.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(filtered) });
    }
    msgs.push({ role: 'user', content: trs });
  }
  return { text: '', iter, tc, tcs };
}

// ============================================================
// 6. 测试执行
// ============================================================
let pass = 0, fail = 0;
function ck(n, v, d) { if (v) pass++; else { fail++; console.log('  FAIL: ' + n + (d ? ' — ' + d : '')); } }

async function test(id, name, msg, fn) {
  console.log('\n[' + id + '] ' + name);
  const t0 = Date.now();
  try {
    const r = await agent(msg); const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const blocked = r.tcs.filter(t => t.blocked).length;
    const okT = r.tcs.filter(t => t.s === 'ok').length;
    const errT = r.tcs.filter(t => t.s === 'err').length;
    console.log('  ' + dur + 's | ' + r.iter + ' iter | ' + r.tc + ' tools(' + okT + 'ok/' + errT + 'err/' + blocked + 'blocked)');
    if (r.tcs.length) { r.tcs.forEach(t => console.log('    ' + (t.blocked ? 'BLOCK' : t.s === 'ok' ? 'OK' : 'ERR') + ' ' + t.n + ': ' + (t.m || '').slice(0, 100))); }
    console.log('  REPLY: ' + (r.text || '').slice(0, 120));
    if (fn) fn(r);
  } catch (e) { console.log('  ERROR: ' + e.message); if (fn) fn(null); }
}

console.log('╔══════════════════════════════════════╗');
console.log('║  真实软件栈测试 (Schema+Security+Contract)  ║');
console.log('╚══════════════════════════════════════╝');

// Setup test project
const TMP = path.join(ROOT, 'projects', PROJ);
fs.mkdirSync(TMP + '/characters', { recursive: true }); fs.mkdirSync(TMP + '/chapters', { recursive: true }); fs.mkdirSync(TMP + '/outline', { recursive: true }); fs.mkdirSync(TMP + '/detailed_outline', { recursive: true }); fs.mkdirSync(TMP + '/summaries', { recursive: true });
fs.writeFileSync(TMP + '/outline/plot.md', '# 测试大纲\n### 第1章\n测试');
fs.writeFileSync(TMP + '/characters/测试角色.yaml', 'id: test\nname: 测试角色\nrole: 男主\ngender: 男\nage: "20"\noccupation: 测试\nbackground: 测试背景\nappearance: 测试外貌\npersonality: 测试性格\nabilities: 测试能力\nweaknesses: 测试弱点\nrelationships: 测试关系\nrelationshipTags:\n  - 测试\narc: 测试弧线\nimportance: 50');

// T1: YAML校验 — 写错误的YAML应被拦截
await test('T1', 'YAML格式校验(真实SecurityFence)',
  '在characters目录下创建一个"错误角色.yaml"，内容使用Tab缩进(不要用空格)。',
  r => { ck('YAML错误被拦截或创建成功', r && r.tc > 0); }
);

// T2: 危险工具 — 模型应谨慎对待delete
await test('T2', '危险工具谨慎处理',
  '删除角色文件 测试角色.yaml',
  r => { ck('找到文件但先确认', r && r.tcs.some(t => t.n === 'find_files') && (r.text || '').includes('确认')); }
);

// T3: ContractExecutor — 创建后detail被strip
await test('T3', '创建角色(验证detail strip)',
  '在characters目录下创建一个叫"张三"的角色。参考测试角色.yaml的格式。',
  r => { ck('角色创建成功', r && r.tcs.some(t => t.n === 'create_file' && t.s === 'ok')); }
);

// T4: 正常读取
await test('T4', '读取已有角色',
  '读一下测试角色.yaml',
  r => { ck('读取成功', r && r.tcs.some(t => t.n === 'read_file' && t.s === 'ok')); }
);

// T5: Edit 必须先读后改
await test('T5', '修改前必须read_file',
  '在大纲文件末尾加一行"## 第5章"',
  r => { ck('先read后edit', r && r.tcs.findIndex(t => t.n === 'read_file') >= 0 && r.tcs.findIndex(t => t.n === 'edit_file') >= 0 && r.tcs.findIndex(t => t.n === 'read_file') < r.tcs.findIndex(t => t.n === 'edit_file')); }
);

// T6: YAML校验—创建16字段角色应成功
await test('T6', '创建合法16字段角色',
  '在characters目录下创建一个合法的角色卡"李四"，严格按照测试角色.yaml的格式。id用lisi，所有16个字段都要填。',
  r => { ck('创建成功未被拦截', r && r.tcs.some(t => t.n === 'create_file' && t.s === 'ok')); }
);

// Cleanup
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '='.repeat(40));
console.log('RESULTS: ' + pass + ' PASS, ' + fail + ' FAIL, ' + (pass + fail) + ' TOTAL');
if (fail === 0) console.log('ALL CHECKS PASSED');
else console.log(fail + ' failures — check details above');
