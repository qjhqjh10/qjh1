#!/usr/bin/env node
/**
 * AI写作助手 全功能 E2E 测试 v3
 * 重点: 真实用户语言 + 多意图拆解 + 数据采集
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const KEY = 'sk-c9c30831df7243209435c60e811c879d';
const URL = 'https://api.deepseek.com/anthropic/v1/messages';
const M = 'deepseek-v4-flash';
const PRJ = '_test_v3';

const P = (p) => path.join(ROOT, 'projects', PRJ, p);
const G = (p) => path.join(ROOT, p);

// ==== Tools ====
const T = {
  read_file: (a) => { try { let fp = a.file_path || ''; if (fp.startsWith('../../')) fp = G(fp.replace('../../', '')); else if (fp.startsWith(PRJ + '/')) fp = P(fp.replace(PRJ + '/', '')); else fp = P(fp); const c = fs.readFileSync(fp, 'utf-8'); return { s: 'ok', m: 'Read ' + a.file_path + ' (' + c.length + 'c)', d: c.slice(0, 4000) }; } catch { return { s: 'err', m: 'Not found: ' + (a.file_path || '') }; } },
  list_directory: (a) => { try { let d = a.path || '.'; if (d.startsWith('../../')) d = G(d.replace('../../', '')); else if (d.startsWith(PRJ + '/')) d = P(d.replace(PRJ + '/', '')); else if (d === PRJ) d = P('.'); else d = P(d); const es = fs.readdirSync(d, { withFileTypes: true }); const pt = a.pattern ? new RegExp(a.pattern.replace(/\*/g, '.*')) : null; const fl = pt ? es.filter(e => pt.test(e.name)) : es; return { s: 'ok', m: fl.length + ' items', d: fl.map(e => (e.isDirectory() ? 'D' : 'F') + ' ' + e.name).join('\n') }; } catch { return { s: 'err', m: 'Dir err: ' + (a.path || '') }; } },
  search_content: (a) => { try { let rp = a.path || '.'; if (rp === PRJ) rp = '.'; else if (rp.startsWith(PRJ + '/')) rp = rp.replace(PRJ + '/', ''); const fp = P(rp); const st = fs.statSync(fp); let allMs = ''; const re = new RegExp(a.pattern || '', 'gi'); /* Directory: recursively search all text files */ if (st.isDirectory()) { const walk = (d, depth) => { if (depth > 3) return; try { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p2 = path.join(d, e.name); if (e.isDirectory() && !e.name.startsWith('.')) walk(p2, depth + 1); else if (/\.(txt|md|yaml|yml|json)$/i.test(e.name)) { const c = fs.readFileSync(p2, 'utf-8'); const ms = c.split('\n').map((l, i) => re.test(l) ? path.relative(fp, p2) + ':' + (i + 1) + ': ' + l.trim().slice(0, 200) : null).filter(Boolean); if (ms.length) allMs += ms.slice(0, 5).join('\n') + '\n'; } }); } catch {} }; walk(fp, 0); return { s: 'ok', m: 'Searched dir, found matches', d: allMs.slice(0, 2000) || 'No matches' }; } /* Single file */ const c = fs.readFileSync(fp, 'utf-8'); const ms = c.split('\n').map((l, i) => re.test(l) ? (i + 1) + ': ' + l.trim().slice(0, 200) : null).filter(Boolean); return { s: 'ok', m: ms.length + ' hits', d: ms.slice(0, 15).join('\n') || 'No matches' }; } catch { return { s: 'err', m: 'Search err: ' + (a.path || '.') }; } },
  find_files: (a) => { try { const ms = []; (function w(d, dp) { if (dp > 3) return; try { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const fp = path.join(d, e.name); e.isDirectory() ? w(fp, dp + 1) : (a.pattern && e.name.includes(a.pattern.replace(/\*/g, ''))) && ms.push(path.relative(P('.'), fp)); }); } catch { } })(P('.'), 0); return { s: 'ok', m: ms.length + ' files', d: ms.join('\n') }; } catch { return { s: 'err', m: 'Find err' }; } },
  edit_file: (a) => { try { let fp = a.file_path || ''; if (fp.startsWith(PRJ + '/')) fp = P(fp.replace(PRJ + '/', '')); else fp = P(fp); let c = fs.readFileSync(fp, 'utf-8'); const o = a.old_string || '', n = a.new_string || ''; if (o === '__FULL_REPLACE__') { fs.writeFileSync(fp, n); return { s: 'ok', m: 'Full replace ' + n.length + 'c' }; } let i = c.indexOf(o); if (i < 0) i = c.indexOf(o.trim()); if (i < 0) return { s: 'err', m: 'No match: ' + o.slice(0, 40) }; fs.writeFileSync(fp, c.slice(0, i) + n + c.slice(i + o.length)); return { s: 'ok', m: 'Edited +' + n.length + 'c' }; } catch { return { s: 'err', m: 'Edit err' }; } },
  create_file: (a) => { try { let fp = a.file_path || ''; if (fp.startsWith('../../')) fp = G(fp.replace('../../', '')); else if (fp.startsWith(PRJ + '/')) fp = P(fp.replace(PRJ + '/', '')); else fp = P(fp); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, a.content || ''); return { s: 'ok', m: 'Created ' + a.file_path + ' (' + (a.content || '').length + 'c)' }; } catch (e) { return { s: 'err', m: 'Create err: ' + e.message }; } },
  delete_file: (a) => { try { fs.unlinkSync(P(a.file_path)); return { s: 'ok', m: 'Deleted' }; } catch { return { s: 'err', m: 'Del err' }; } },
  rename_file: (a) => { try { fs.renameSync(P(a.path || a.file_path), P(a.new_path)); return { s: 'ok', m: 'Renamed' }; } catch { return { s: 'err', m: 'Rename err' }; } },
  kb_list: () => { try { return { s: 'ok', m: fs.readdirSync(G('knowledge_base/files')).filter(f => f.endsWith('.md')).length + ' KB files' }; } catch { return { s: 'ok', m: '0 KB' }; } },
  kb_create_file: (a) => { try { const d = G('knowledge_base/files'); fs.mkdirSync(d, { recursive: true }); const n = (a.name || 'u').replace(/\.md$/, '') + '.md'; fs.writeFileSync(path.join(d, n), a.content || ''); return { s: 'ok', m: 'KB: ' + n }; } catch (e) { return { s: 'err', m: 'KB err' }; } },
  kb_append_file: (a) => { try { const n = (a.name || '').replace(/\.md$/, '') + '.md'; const fp = G('knowledge_base/files/' + n); if (!fs.existsSync(fp)) return { s: 'err', m: 'KB not found' }; fs.appendFileSync(fp, '\n' + (a.content || '')); return { s: 'ok', m: 'KB appended' }; } catch { return { s: 'err', m: 'KB append err' }; } },
  kb_index_file: () => ({ s: 'ok', m: 'Indexed' }),
  list_notes: () => { try { const d = G('notes'); fs.mkdirSync(d, { recursive: true }); return { s: 'ok', m: fs.readdirSync(d).filter(f => f.endsWith('.md')).length + ' notes' }; } catch { return { s: 'ok', m: '0 notes' }; } },
  read_note: (a) => { try { const n = (a.name || '').replace(/\.md$/, '') + '.md'; return { s: 'ok', m: 'Note: ' + n, d: fs.readFileSync(G('notes/' + n), 'utf-8').slice(0, 1500) }; } catch { return { s: 'err', m: 'Note not found' }; } },
  write_note: (a) => { try { const d = G('notes'); fs.mkdirSync(d, { recursive: true }); const n = (a.name || 'u').replace(/\.md$/, '') + '.md'; fs.writeFileSync(path.join(d, n), a.content || ''); return { s: 'ok', m: 'Note: ' + n }; } catch { return { s: 'err', m: 'Note err' }; } },
  append_note: (a) => { try { const n = (a.name || '').replace(/\.md$/, '') + '.md'; fs.appendFileSync(G('notes/' + n), '\n' + (a.content || '')); return { s: 'ok', m: 'Note appended' }; } catch { return { s: 'err', m: 'Append err' }; } },
  delete_note: (a) => { try { fs.unlinkSync(G('notes/' + (a.name || '').replace(/\.md$/, '') + '.md')); return { s: 'ok', m: 'Note deleted' }; } catch { return { s: 'err', m: 'Del err' }; } },
  search_notes: (a) => { try { const ms = []; const q = (a.query || '').toLowerCase(); fs.readdirSync(G('notes')).filter(f => f.endsWith('.md')).forEach(f => { if (fs.readFileSync(G('notes/' + f), 'utf-8').toLowerCase().includes(q)) ms.push(f); }); return { s: 'ok', m: ms.length + ' matches', d: ms.join('\n') }; } catch { return { s: 'ok', m: '0 matches' }; } },
  create_style_template: (a) => ({ s: 'ok', m: 'Style tpl: ' + (a.name || '?') }),
  create_scene_template: (a) => ({ s: 'ok', m: 'Scene tpl: ' + (a.name || '?') }),
  create_project: (a) => { try { const d = path.join(ROOT, 'projects', a.name || 'p'); ['characters', 'chapters', 'outline', 'detailed_outline', 'summaries'].forEach(s => fs.mkdirSync(path.join(d, s), { recursive: true })); return { s: 'ok', m: 'Project: ' + a.name }; } catch { return { s: 'err', m: 'Proj err' }; } },
  delete_project: () => ({ s: 'err', m: 'Blocked' }),
  list_prompts: () => ({ s: 'ok', m: 'Prompts' }),
  list_rules: () => ({ s: 'ok', m: 'No rules' }),
  learn_rule: (a) => ({ s: 'ok', m: 'Learned: ' + (a.rule || '').slice(0, 40) }),
  list_audit: () => ({ s: 'ok', m: 'No audit' }),
  write_learning: (a) => ({ s: 'ok', m: 'Rec: ' + (a.summary || '').slice(0, 40) }),
  search_images: () => ({ s: 'ok', m: 'Images(mock)' }),
  generate_image: () => ({ s: 'err', m: 'No gen' }),
  toggle_prompt: () => ({ s: 'ok', m: 'Toggled' }),
  update_prompt: () => ({ s: 'ok', m: 'Updated' }),
};

import { buildSystemPrompt, selectDomainModules, matchSkill } from './real-prompt.mjs';

// 真实CORE_SYSTEM_PROMPT + 项目上下文
function buildSys(msg) {
  let sys = buildSystemPrompt(msg, PRJ);
  sys += '\n\n# 项目已有文件\n- ' + PRJ + '/outline/plot.md 4章大纲\n- ' + PRJ + '/outline/worldbuilding.md 世界观\n- ' + PRJ + '/characters/叶尘.yaml 男主\n- ' + PRJ + '/characters/林雨晴.yaml 女主\n- ' + PRJ + '/characters/陈远山.yaml 剑皇师父\n- ' + PRJ + '/chapters/chapter1.txt 第1章正文(~900字)\n- ' + PRJ + '/summaries/chapter1.md 第1章摘要';
  return sys;
}

// 使用真实 Domain Modules + Skill 匹配 (shared from real-prompt.mjs)

// ==== Schemas ====
const SCHEMAS = [
  { name: 'read_file', desc: '读取文件', is: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'list_directory', desc: '列出目录', is: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } }, required: ['path'] } },
  { name: 'search_content', desc: '搜索内容', is: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'find_files', desc: '搜索文件名', is: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
  { name: 'edit_file', desc: '编辑文件(old_string精确匹配)', is: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'create_file', desc: '创建文件', is: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'delete_file', desc: '删除文件', is: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'rename_file', desc: '重命名', is: { type: 'object', properties: { path: { type: 'string' }, new_path: { type: 'string' } }, required: ['path', 'new_path'] } },
  { name: 'kb_list', desc: '列出知识库', is: { type: 'object', properties: {} } },
  { name: 'kb_create_file', desc: '创建KB文件', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'kb_append_file', desc: '追加到KB', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'kb_index_file', desc: '建立KB索引', is: { type: 'object', properties: { file_name: { type: 'string' } }, required: ['file_name'] } },
  { name: 'list_notes', desc: '列出笔记', is: { type: 'object', properties: {} } },
  { name: 'read_note', desc: '读取笔记', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'write_note', desc: '创建笔记', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'append_note', desc: '追加笔记', is: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'delete_note', desc: '删除笔记', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'search_notes', desc: '搜索笔记', is: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_style_template', desc: '创建风格模板', is: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, dimensions: { type: 'object' } }, required: ['name', 'type', 'dimensions'] } },
  { name: 'create_scene_template', desc: '创建场景模板', is: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] } },
  { name: 'create_project', desc: '创建项目', is: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'list_prompts', desc: '列出提示词', is: { type: 'object', properties: {} } },
  { name: 'list_rules', desc: '列出规则', is: { type: 'object', properties: {} } },
  { name: 'learn_rule', desc: '学习规则', is: { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] } },
  { name: 'write_learning', desc: '记录经验', is: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
];

// ==== API ====
async function api(sys, msgs) {
  const hdrs = { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' };
  const bd = { model: M, system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 4096, stream: true,
    tools: SCHEMAS.map(t => ({ name: t.name, description: t.desc, input_schema: t.is })) };
  const r = await fetch(URL, { method: 'POST', headers: hdrs, body: JSON.stringify(bd) });
  if (!r.ok) throw new Error('API ' + r.status);
  let ft = ''; const tus = []; const bs = [];
  for (const ch of (await r.text()).split(/\n\n/)) {
    if (!ch.trim()) continue; let et = '', d = '';
    for (const l of ch.split('\n')) { if (l.startsWith('event:')) et = l.slice(6).trim(); else if (l.startsWith('data:')) d = l.slice(5).trim(); }
    if (!d) continue;
    try { const ev = JSON.parse(d); const t = et || ev.type || '';
      if (t === 'content_block_start') bs.push(Object.assign({}, ev.content_block, { index: ev.index, ij: '' }));
      else if (t === 'content_block_delta') { const b2 = bs.find(x => x.index === (ev.index ?? bs.length - 1)); if (!b2) continue; if (ev.delta?.type === 'text_delta') { b2.text = (b2.text || '') + ev.delta.text; ft += ev.delta.text; } if (ev.delta?.type === 'input_json_delta') { b2.ij = (b2.ij || '') + ev.delta.partial_json; try { b2.input = JSON.parse(b2.ij); } catch { } } }
      else if (t === 'content_block_stop') { const b3 = bs.find(x => x.index === (ev.index ?? bs.length - 1)); if (b3?.type === 'tool_use') tus.push({ id: b3.id, name: b3.name, input: b3.input || {} }); }
    } catch { }
  }
  return { text: ft, tus };
}

// ==== Agent ====
async function agent(msg, maxIter) {
  maxIter = maxIter || 12;
  const sys = buildSys(msg);
  const sk = matchSkill(msg);
  const modCount = selectDomainModules(msg).length;
  const msgs = [{ role: 'user', content: [{ type: 'text', text: msg }] }];
  let iter = 0, tc = 0; const tcs = [];
  for (; iter < maxIter;) {
    iter++;
    const r = await api(sys, msgs);
    if (!r.tus.length) return { text: r.text, iter, tc, tcs, hasSkill: !!sk?.id, modCount };
    const ac = []; if (r.text) ac.push({ type: 'text', text: r.text });
    for (const tu of r.tus) ac.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    msgs.push({ role: 'assistant', content: ac });
    const trs = [];
    for (const tu of r.tus) { const fn = T[tu.name]; const res = fn ? await fn(tu.input) : { s: 'err', m: 'Unknown: ' + tu.name }; tc++; tcs.push({ n: tu.name, s: res.s, m: res.m }); trs.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(res) }); }
    msgs.push({ role: 'user', content: trs });
  }
  return { text: '', iter, tc, tcs, hasSkill: !!sk?.id, modCount };
}

// ==== Runner ====
let pass = 0, fail = 0;
const stats = [];

function ck(n, v, d) { d = d || ''; if (v) { pass++; } else { fail++; console.log('  [FAIL] ' + n + (d ? ': ' + d : '')); } }

async function run(id, name, msg, fn) {
  console.log('\n' + '─'.repeat(55) + '\n[' + id + '] ' + name + '\n' + '─'.repeat(55));
  const t0 = Date.now();
  try {
    const r = await agent(msg); const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const toolNames = [...new Set(r.tcs.map(t => t.n))];
    const okTools = r.tcs.filter(t => t.s === 'ok').length;
    const failTools = r.tcs.filter(t => t.s === 'err').length;
    const st = {
      id, name, dur, iter: r.iter, tc: r.tc, okTools, failTools, toolNames,
      hasSkill: r.hasSkill, modCount: r.modCount,
      replyLen: (r.text || '').length, replyPreview: (r.text || '').slice(0, 100),
    };
    stats.push(st);

    console.log('  Time:' + dur + 's | Iter:' + r.iter + ' | Tools:' + r.tc + '(' + okTools + 'ok/' + failTools + 'fail) | Skill:' + (r.hasSkill ? 'yes' : 'no') + ' | DM:' + r.modCount);
    console.log('  Tools used: ' + toolNames.join(', '));
    console.log('  Reply: ' + (r.text || '').slice(0, 150) + ((r.text || '').length > 150 ? '...' : ''));
    if (failTools > 0) { console.log('  Tool failures:'); r.tcs.filter(t => t.s === 'err').forEach(t => console.log('    FAIL ' + t.n + ': ' + t.m)); }

    if (fn) { console.log('  ---'); fn(r); }
  } catch (e) { console.log('  [ERROR] ' + e.message); stats.push({ id, name, dur: ((Date.now() - t0) / 1000).toFixed(1), error: e.message }); if (fn) fn(null); }
}

console.log('╔══════════════════════════════════════╗');
console.log('║  青剑 AI写作助手 E2E 测试 v3        ║');
console.log('║  Model: ' + M + ' | Project: ' + PRJ + '     ║');
console.log('╚══════════════════════════════════════╝');

// ====== 场景 ======

// S1: 闲聊 — 验证0工具
await run('S1', '闲聊问候', '你好！我是新用户。',
  r => { ck('0 tools', r && r.tc === 0, r ? r.tc + '' : 'N/A'); ck('有意义回复', r && r.text.length > 20); }
);

// S2: 模糊请求
await run('S2', '模糊请求 — 应反问',
  '帮我看看',
  r => { ck('0或极少tool', r && r.tc <= 1, r ? r.tc + '' : 'N/A'); ck('反问用户', r && /[?？]|具体|什么|哪个|怎么/.test(r.text)); }
);

// S3: 多意图混合 — 查看 + 分析 + 修改
await run('S3', '查看+分析+修改混合',
  '帮我看看项目里有什么内容，大纲写得怎么样，角色信息也翻出来给我看看。世界观感觉太单薄了，帮我在修炼体系里补充每个境界的详细特征描述。',
  r => {
    ck('读取了多个文件', r && r.tcs.filter(t => t.n === 'read_file').length >= 3, r ? r.tcs.filter(t => t.n === 'read_file').length + '个read' : 'N/A');
    ck('使用了edit_file', r && r.tcs.some(t => t.n === 'edit_file'));
    ck('先读后改', r && r.tcs.findIndex(t => t.n === 'read_file') < r.tcs.findIndex(t => t.n === 'edit_file'));
  }
);

// S4: 创作+灵感+模板 混合
await run('S4', '创作+笔记+模板 4个意图混合',
  '该写第2章了。大纲里第2章是剑魂觉醒——叶尘第一次感受剑魂力量，差点失控伤了林雨晴，陈远山出现帮他稳定剑意。写的时候注意：叶尘的内心挣扎要写出来；林雨晴表面冷但内心的担忧通过细节暗示；陈远山的出场要有分量。写之前我有个灵感要记——"剑魂其实是上古剑神的执念，不是纯粹的力量"——存到笔记。写完之后分析一下这章的写作风格，建个风格模板以后复用。',
  r => {
    ck('创建了章节', r && r.tcs.some(t => t.n === 'create_file' && (t.m || '').includes('chapter')));
    ck('创建了笔记', r && r.tcs.some(t => t.n === 'write_note'));
    ck('创建了风格模板', r && r.tcs.some(t => t.n === 'create_style_template'));
    ck('先读参考再写', r && r.tcs.findIndex(t => t.n === 'read_file') < r.tcs.findIndex(t => t.n === 'create_file'));
  }
);

// S5: 批量创建角色
await run('S5', '批量创建3个配角',
  '我要加三个配角：一个反派血煞教少主墨渊，外表邪魅但心机深沉，吞噬剑魂修炼，目标是夺取叶尘的剑魂；一个大师兄楚天阔，剑师境，正直但有些迂腐，叶尘的早期竞争者后来成为朋友；还有一个天机阁接头人苏小蛮，表面活泼少女实则深藏不露。都按标准格式建好角色卡。',
  r => {
    ck('Skill命中', r && r.hasSkill);
    ck('创建了3个角色', r && r.tcs.filter(t => t.n === 'create_file' && (t.m || '').includes('characters/')).length >= 3);
    ck('先读参考格式', r && r.tcs.some(t => t.n === 'read_file' && (t.m || '').includes('character')));
  }
);

// S6: 诊断+决策
await run('S6', '诊断——用户不确定是否继续',
  '我不知道该不该继续往下写。已经写了一章，但读者反馈说节奏太快——上来就觉醒剑魂了，读者还没和叶尘建立感情。你能帮我看看问题出在哪吗？把所有相关文件读一下，给我一个诚实的评价。如果问题确实严重，帮我列个修改方案但先别改。如果只是小问题，直接改就行。',
  r => {
    ck('读取足够文件分析', r && r.tcs.filter(t => t.n === 'read_file').length >= 3, r ? r.tcs.filter(t => t.n === 'read_file').length + ' reads' : 'N/A');
    ck('给出了具体分析', r && r.text.length > 100);
    ck('有明确判断', r && /严重|小问题|方案|建议|节奏|感情/.test(r.text));
  }
);

// S7: 情绪化+模糊 — 卡文求助
await run('S7', '情绪化卡文 — 需要"翻译"成任务',
  '唉烦死了卡了好几天。就是卡在叶尘第一次见到血煞教少主那段，怎么写都不对。写太强后面不好圆，太弱又没压迫感。林雨晴在旁边该怎么反应也想不好——出手帮忙暴露实力，不出手叶尘打不过。你帮我想想，随便写点什么打破僵局。',
  r => {
    ck('先读参考', r && r.tcs.some(t => t.n === 'read_file'));
    ck('提供了多个选项或方案', r && (r.text.includes('方案') || r.text.includes('选择') || r.text.includes('可以') || /\d[\.\、]/.test(r.text)));
    ck('没有盲目创建文件', r && !r.tcs.some(t => t.n === 'create_file' && (t.m || '').includes('chapter')));
  }
);

// S8: 搜索+聚合+笔记
await run('S8', '搜索+分析+记录笔记',
  '我想梳理一下目前故事里埋的线索。帮我搜一下所有文件里提到"剑魂"和"血煞教"的地方，分析一下这些伏笔哪些已经回收哪些还没。然后写一个"伏笔追踪"笔记，列出所有伏笔和状态。',
  r => {
    ck('使用了搜索', r && r.tcs.some(t => t.n === 'search_content' || t.n === 'find_files'));
    ck('创建了笔记', r && r.tcs.some(t => t.n === 'write_note'));
    ck('笔记有具体内容', r && r.tcs.some(t => t.n === 'write_note' && (t.m || '').includes('伏笔')));
  }
);

// S9: 纠错 — AI应指出用户设定矛盾
await run('S9', '纠错——AI应指出设定冲突',
  '我想把叶尘的境界直接改成剑王境，他才16岁，这样比较厉害。还要给他加一个"一剑斩断时空"的能力。同时林雨晴改成21岁剑皇境，陈远山降到剑师境。',
  r => {
    ck('读了角色和世界观', r && r.tcs.some(t => t.n === 'read_file' && (t.m || '').includes('character')) && r.tcs.some(t => t.n === 'read_file' && (t.m || '').includes('worldbuilding')));
    ck('指出了设定冲突或给建议', r && /冲突|矛盾|不合理|体系|建议|考虑|超/.test(r.text));
  }
);

// S10: 压力测试 — 500字超长混乱输入
await run('S10', '压力测试——超长混乱多意图输入',
  '我仔细想了一晚上决定大改。首先世界观加一套"剑道感悟"体系——不是简单的境界突破，是对剑的哲学理解，每个境界对应一种人生感悟。叶尘之所以能觉醒上古剑魂不是天赋好，而是十年坚持暗合"剑道即人道"——这个设定写进世界观。其次林雨晴的人设调一下，太被动了，改成她其实早就突破到剑灵境了但伪装成剑士境保护叶尘。角色卡要更新。陈远山的旧伤也要展开——三十年前同门惨案其实是血煞教策划的，他知道真相但为保护叶尘选择隐忍。角色卡更新。大纲也要改，加一句"核心主题：坚持本身即是天赋"到末尾。然后帮我记一个"改动日志"笔记列出今天所有改动。',
  r => {
    ck('处理了多个意图(≥3种tool)', r && new Set(r.tcs.map(t => t.n)).size >= 3, r ? new Set(r.tcs.map(t => t.n)).size + ' tool types' : 'N/A');
    ck('修改了世界观', r && r.tcs.some(t => t.n === 'edit_file' && (t.m || '').includes('worldbuilding')));
    ck('创建了笔记', r && r.tcs.some(t => t.n === 'write_note'));
    ck('任务完成率≥50%', r && r.tcs.filter(t => t.s === 'ok').length >= r.tc * 0.5);
  }
);

// ==== 数据报告 ====
console.log('\n\n' + '='.repeat(60));
console.log('                    测试数据汇总');
console.log('='.repeat(60));

const totalIter = stats.reduce((s, x) => s + (x.iter || 0), 0);
const totalTools = stats.reduce((s, x) => s + (x.tc || 0), 0);
const totalOkTools = stats.reduce((s, x) => s + (x.okTools || 0), 0);
const totalFailTools = stats.reduce((s, x) => s + (x.failTools || 0), 0);
const avgDur = stats.length ? (stats.reduce((s, x) => s + parseFloat(x.dur || 0), 0) / stats.length).toFixed(1) : 0;
const skillHits = stats.filter(x => x.hasSkill).length;
const totalReplyLen = stats.reduce((s, x) => s + (x.replyLen || 0), 0);
const errors = stats.filter(x => x.error).length;

console.log('Scenarios:      ' + stats.length);
console.log('Errors:         ' + errors);
console.log('Total iter:     ' + totalIter + ' (avg ' + (totalIter / stats.length).toFixed(1) + '/scenario)');
console.log('Total tools:    ' + totalTools + ' (avg ' + (totalTools / stats.length).toFixed(1) + '/scenario)');
console.log('  Successful:   ' + totalOkTools + ' (' + (totalTools ? (totalOkTools / totalTools * 100).toFixed(0) : 0) + '%)');
console.log('  Failed:       ' + totalFailTools);
console.log('Skill hits:     ' + skillHits + '/' + stats.length + ' (' + (skillHits / stats.length * 100).toFixed(0) + '%)');
console.log('Avg duration:   ' + avgDur + 's');
console.log('Total reply:    ' + totalReplyLen + ' chars (avg ' + (totalReplyLen / stats.length).toFixed(0) + '/scenario)');
console.log('PASS/FAIL:      ' + pass + '/' + fail + ' (' + (pass + fail) + ' checks)');
console.log('Pass rate:      ' + (pass + fail > 0 ? (pass / (pass + fail) * 100).toFixed(0) : 0) + '%');

console.log('\nPer-scenario breakdown:');
console.log('| ID | Name | Time | Iter | Tools(ok/fail) | Skill | ReplyLen |');
console.log('|----|------|------|------|---------------|-------|----------|');
for (const s of stats) {
  console.log('| ' + s.id + ' | ' + (s.name || '').slice(0, 18) + ' | ' + s.dur + 's | ' + (s.iter || '-') + ' | ' + (s.tc || 0) + '(' + (s.okTools || 0) + '/' + (s.failTools || 0) + ') | ' + (s.hasSkill || 'no') + ' | ' + (s.replyLen || '-') + ' |');
}
