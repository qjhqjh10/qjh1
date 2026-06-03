#!/usr/bin/env node
/**
 * 🎯 全覆盖工具测试 — 38 个工具逐项验证
 * AI写作助手的所有工具都会被调用和验证。
 *
 * 测试策略:
 *   将 38 个工具分为 8 组，每组对应一个用户场景，
 *   在一次对话中通过多轮交互依次触发所有工具。
 *
 * 运行: node scripts/full-sim/all-38-tools.mjs
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const API_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_ITERATIONS = 25
const ROOT = path.resolve(import.meta.dirname || '.', '..', '..')
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base', 'files', p)
const ST = p => path.join(ROOT, 'style_templates', p)
const SC = p => path.join(ROOT, 'scene_templates', p)

console.log(`══════════════════════════════════════════════════════`)
console.log(`  🎯 全覆盖工具测试 — 38 个工具逐项验证`)
console.log(`  端点: ${API_URL}  模型: ${MODEL}`)
console.log(`══════════════════════════════════════════════════════`)

// ═══════════════════════════════════════════════════
//  ALL 38 TOOLS (完整实现)
// ═══════════════════════════════════════════════════
const tools = {
  // ── 文件 (7) ──
  list_directory: a => {
    const dir = a.path || a.dir_path || '.'
    try { return fs.readdirSync(P(dir), {withFileTypes:true}).map(e=>(e.isDirectory()?'DIR ':'FILE ')+e.name).join('\n')||'空目录' } catch { return `[错误:目录不存在]` }
  },
  read_file: a => {
    const fp = a.file_path || a.path || ''
    try { const c = fs.readFileSync(P(fp),'utf-8'); return c.length>3000?c.slice(0,3000)+'\n…('+c.length+'字)':c } catch { return `[错误:文件不存在]` }
  },
  search_content: a => {
    try { return `搜索 "${a.pattern}" → 在项目中找到多处匹配(测试环境)` } catch { return '[错误]' }
  },
  create_file: a => {
    try { const fp=P(a.file_path||a.path); const c=a.content||''; if(fp.endsWith('.json')&&c)try{JSON.parse(c)}catch(e){return`[JSON格式错误:${e.message}]`}; fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,c); return `创建成功` } catch(e) { return`[错误:${e.message}]` }
  },
  edit_file: a => {
    try { const fp=P(a.file_path); let c=fs.readFileSync(fp,'utf-8'); const o=a.old_string||''; const n=a.new_string||''; if(o==='__FULL_REPLACE__'){fs.writeFileSync(fp,n);return'全量替换成功'} let i=c.indexOf(o); if(i<0)i=c.indexOf(o.trim()); if(i<0)return`[未找到匹配]`; fs.writeFileSync(fp,c.slice(0,i)+n+c.slice(i+o.length)); return'编辑成功' } catch(e) { return`[错误:${e.message}]` }
  },
  delete_file: a => {
    try { const fp=P(a.file_path); if(!fs.existsSync(fp))return'[错误:文件不存在]'; fs.unlinkSync(fp); return'删除成功' } catch { return'[错误]' }
  },
  rename_file: a => {
    try { const o=P(a.file_path||a.path); const n=P(a.new_path); if(!fs.existsSync(o))return'[错误:源文件不存在]'; fs.mkdirSync(path.dirname(n),{recursive:true}); fs.renameSync(o,n); return'重命名成功' } catch(e) { return`[错误:${e.message}]` }
  },
  // ── 知识库 (4) ──
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无KB文件' } catch { return'无KB文件' } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true}); fs.writeFileSync(K((a.name||'x')+'.md'),a.content||''); return'KB创建成功' } catch { return'[错误]' } },
  kb_append_file: a => { try { const fp=K((a.name||'x')+'.md'); if(!fs.existsSync(fp))return'[错误:KB文件不存在]'; fs.appendFileSync(fp,'\n'+(a.content||'')); return'KB追加成功' } catch { return'[错误]' } },
  kb_index_file: a => { return 'KB索引已建立' },
  // ── 笔记 (6) ──
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无笔记' } catch { return'无笔记' } },
  read_note: a => { try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500) } catch { return'[笔记不存在]' } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'),a.content||''); return'笔记创建成功' } catch { return'[错误]' } },
  append_note: a => { try { const fp=N((a.name||'x')+'.md'); if(!fs.existsSync(fp))return'[笔记不存在]'; fs.appendFileSync(fp,'\n'+(a.content||'')); return'笔记追加成功' } catch { return'[错误]' } },
  delete_note: a => { try { fs.unlinkSync(N((a.name||'x')+'.md')); return'笔记删除成功' } catch { return'[错误]' } },
  search_notes: a => { return `搜索笔记: "${a.query}" → 找到相关笔记(测试环境)` },
  // ── 图片 (2) ──
  search_images: a => { return `搜索图片: "${a.query}" → 找到3张相关图片(测试环境)` },
  generate_image: a => { return `生成图片: "${a.prompt}" → 图片已生成(测试环境)` },
  // ── 模板 (2) ──
  create_style_template: a => { try { fs.mkdirSync(ST(''),{recursive:true}); fs.writeFileSync(ST((a.name||'x')+'.json'),JSON.stringify(a,null,2)); return'风格模板创建成功' } catch { return'[错误]' } },
  create_scene_template: a => { try { fs.mkdirSync(SC(''),{recursive:true}); fs.writeFileSync(SC((a.name||'x')+'.json'),JSON.stringify(a,null,2)); return'场景模板创建成功' } catch { return'[错误]' } },
  // ── 项目 (2) ──
  create_project: a => { try { const d=P(a.name||'x'); ['characters','chapters','outline','detailed_outline','summaries'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true})); return`项目创建成功` } catch(e) { return`[错误:${e.message}]` } },
  delete_project: a => { try { fs.rmSync(P(a.name||'x'),{recursive:true,force:true}); return'项目删除成功' } catch { return'[错误]' } },
  // ── 提示词 (3) ──
  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  toggle_prompt: a => { return `提示词 ${a.prompt_id} 已${a.enabled?'启用':'关闭'}` },
  update_prompt: a => { return `提示词 ${a.prompt_id} 已更新` },
  // ── 自管理 (5) ──
  list_rules: () => '暂无自定义规则',
  learn_rule: a => { const r=(a.rule||'').slice(0,60); return `规则已学习: ${r}` },
  update_config: a => { return `配置已更新: ${JSON.stringify(a)}` },
  list_audit: () => '暂无审计记录',
  write_learning: a => { return `经验已记录: ${(a.summary||'').slice(0,60)}` },
  // ── HTTP (2) ──
  http_get: () => '[此工具需用户批准后执行]',
  http_fetch: () => '[此工具需用户批准后执行]',
  // ── 浏览器 (2) ──
  browser_open: () => '[此工具需用户批准后执行]',
  browser_search: () => '[此工具需用户批准后执行]',
  // ── Shell (2) ──
  shell_exec: () => '[此工具需用户批准后执行]',
  shell_run_script: () => '[此工具需用户批准后执行]',
  // ── LSP (1) ──
  lsp_diagnose: () => 'LSP诊断完成: 无类型错误',
}

// ── 所有工具名 ──
const ALL_TOOL_NAMES = Object.keys(tools)

// ── OpenAI Tool Schema ──
const TOOLS = [
  {type:'function',function:{name:'list_directory',description:'列出目录内容',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}},
  {type:'function',function:{name:'read_file',description:'读取文件内容',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}},
  {type:'function',function:{name:'search_content',description:'搜索文件内容',parameters:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']}}},
  {type:'function',function:{name:'create_file',description:'创建文件',parameters:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}}},
  {type:'function',function:{name:'edit_file',description:'编辑文件',parameters:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}}},
  {type:'function',function:{name:'delete_file',description:'删除文件',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}},
  {type:'function',function:{name:'rename_file',description:'重命名文件',parameters:{type:'object',properties:{file_path:{type:'string'},new_path:{type:'string'}},required:['file_path','new_path']}}},
  {type:'function',function:{name:'kb_list',description:'列出知识库文件',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'kb_create_file',description:'创建KB文件',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'kb_append_file',description:'追加到KB文件',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'kb_index_file',description:'建立KB索引',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'list_notes',description:'列出笔记',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'read_note',description:'读取笔记',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'write_note',description:'创建笔记',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'append_note',description:'追加到笔记',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'delete_note',description:'删除笔记',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'search_notes',description:'搜索笔记',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
  {type:'function',function:{name:'search_images',description:'搜索在线图片',parameters:{type:'object',properties:{query:{type:'string'},count:{type:'number'}},required:['query']}}},
  {type:'function',function:{name:'generate_image',description:'生成图片',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}}},
  {type:'function',function:{name:'create_style_template',description:'创建风格模板',parameters:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}}},
  {type:'function',function:{name:'create_scene_template',description:'创建场景模板',parameters:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}}},
  {type:'function',function:{name:'create_project',description:'创建项目',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'delete_project',description:'删除项目',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'list_prompts',description:'列出提示词',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'toggle_prompt',description:'启用/关闭提示词',parameters:{type:'object',properties:{prompt_id:{type:'string'},enabled:{type:'boolean'}},required:['prompt_id','enabled']}}},
  {type:'function',function:{name:'update_prompt',description:'更新提示词',parameters:{type:'object',properties:{prompt_id:{type:'string'}},required:['prompt_id']}}},
  {type:'function',function:{name:'list_rules',description:'列出规则',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'learn_rule',description:'学习规则',parameters:{type:'object',properties:{rule:{type:'string'}},required:['rule']}}},
  {type:'function',function:{name:'update_config',description:'更新配置',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'list_audit',description:'查看审计记录',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'write_learning',description:'记录学习经验',parameters:{type:'object',properties:{summary:{type:'string'}},required:['summary']}}},
  {type:'function',function:{name:'http_get',description:'HTTP GET请求',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}},
  {type:'function',function:{name:'http_fetch',description:'HTTP请求',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}},
  {type:'function',function:{name:'browser_open',description:'打开浏览器',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}},
  {type:'function',function:{name:'browser_search',description:'浏览器搜索',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
  {type:'function',function:{name:'shell_exec',description:'执行Shell命令',parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}}},
  {type:'function',function:{name:'shell_run_script',description:'运行脚本',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}},
  {type:'function',function:{name:'lsp_diagnose',description:'TypeScript类型诊断',parameters:{type:'object',properties:{file_path:{type:'string'}}}}},
]

// ── 系统提示词 ──
const SYS = `你是"青剑"AI写作助手。你有38个工具可用。

# 任务要求
用户会要求你依次调用多个工具来完成任务。请严格按照用户指令，依次调用相应工具。

# 可用工具速查
文件: list_directory read_file search_content create_file edit_file delete_file rename_file
知识库: kb_list kb_create_file kb_append_file kb_index_file
笔记: list_notes read_note write_note append_note delete_note search_notes
图片: search_images generate_image
模板: create_style_template create_scene_template
项目: create_project delete_project
提示词: list_prompts toggle_prompt update_prompt
自管理: list_rules learn_rule update_config list_audit write_learning
HTTP: http_get http_fetch
浏览器: browser_open browser_search
Shell: shell_exec shell_run_script
LSP: lsp_diagnose

# 执行规则
- 每个用户请求中提到的工具都要调用
- 工具调用完后再生成文本总结
- 文件操作使用projects/1/路径，笔记使用全局notes/，知识库使用全局knowledge_base/files/`

// ── API 调用 ──
async function callOpenAI(messages) {
  const res = await fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
    body:JSON.stringify({model:MODEL,messages,max_tokens:2048,tools:TOOLS,tool_choice:'auto'}),
  })
  if(!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`)
  const j = await res.json()
  const c = j.choices[0]
  return {text:c.message?.content||'', toolCalls:c.message?.tool_calls||[], finishReason:c.finish_reason||'stop'}
}

// ── Agent 循环 ──
async function agentRun(userMsg) {
  const msgs = [{role:'system',content:SYS},{role:'user',content:userMsg}]
  let it=0, tc=0, txt=''
  const called = new Set()
  while(it<MAX_ITERATIONS) {
    it++
    const r=await callOpenAI(msgs)
    if(r.text) txt=r.text
    if(!r.toolCalls||!r.toolCalls.length) return {text:txt,iterations:it,toolCalls:tc,called:[...called]}
    const ac=[{role:'assistant',content:r.text||null,tool_calls:r.toolCalls}]
    for(const t of r.toolCalls) {
      const fn=t.function
      let a={}
      try{a=JSON.parse(fn.arguments)}catch{}
      const tool=tools[fn.name]
      const result=tool?await tool(a):'[未知工具]'
      tc++
      called.add(fn.name)
      process.stdout.write(`${fn.name}✓ `)
      ac.push({role:'tool',tool_call_id:t.id,content:result})
    }
    msgs.push(...ac)
    process.stdout.write(`(${it}/${MAX_ITERATIONS})\n`)
  }
  return {text:txt,iterations:it,toolCalls:tc,called:[...called]}
}

// ── 测试框架 ──
let pass=0, fail=0
function t(name,cond,detail) { if(cond){pass++;console.log(`  ✅ ${name}${detail?': '+detail:''}`)} else{fail++;console.log(`  ❌ ${name}${detail?': '+detail:''}`)} }
function hr(t){ console.log('\n'+'─'.repeat(60)+'\n  '+t+'\n'+'─'.repeat(60))}

// ═══════════════════════════════════════════════════
//  8 组场景，覆盖全部 38 个工具
// ═══════════════════════════════════════════════════
async function main() {
  const allCalled = new Set()
  console.log('\n📋 目标: 调用全部 38 个工具\n')

  // ── Group 1: 文件操作 (7) ──
  hr('第1组: 文件操作 (7个工具)')
  const r1 = await agentRun(
    '请依次完成以下文件操作(都在projects/1/目录下): '+
    '1. 列出 projects/1/characters/ 目录的内容 (list_directory) '+
    '2. 读取 projects/1/outline/plot.md (read_file) '+
    '3. 搜索项目中提到"修仙"的地方 (search_content) '+
    '4. 创建一个测试文件 projects/1/test_tool.txt 内容为"测试" (create_file) '+
    '5. 编辑 projects/1/test_tool.txt 把"测试"改成"工具测试通过" (edit_file) '+
    '6. 把 projects/1/test_tool.txt 重命名为 projects/1/test_tool_renamed.txt (rename_file) '+
    '7. 删除 projects/1/test_tool_renamed.txt (delete_file)'
  )
  for(const tn of r1.called) allCalled.add(tn)
  t('list_directory', r1.called.includes('list_directory'))
  t('read_file', r1.called.includes('read_file'))
  t('search_content', r1.called.includes('search_content'))
  t('create_file', r1.called.includes('create_file'))
  t('edit_file', r1.called.includes('edit_file'))
  t('rename_file', r1.called.includes('rename_file'))
  t('delete_file', r1.called.includes('delete_file'))

  // ── Group 2: 知识库 (4) ──
  hr('第2组: 知识库 (4个工具)')
  const r2 = await agentRun(
    '请操作知识库: '+
    '1. 列出所有KB文件 (kb_list) '+
    '2. 创建一个KB文件"测试知识"内容为"这是测试内容" (kb_create_file) '+
    '3. 追加内容"追加的内容"到"测试知识" (kb_append_file) '+
    '4. 为"测试知识"建立索引 (kb_index_file)'
  )
  for(const tn of r2.called) allCalled.add(tn)
  t('kb_list', r2.called.includes('kb_list'))
  t('kb_create_file', r2.called.includes('kb_create_file'))
  t('kb_append_file', r2.called.includes('kb_append_file'))
  t('kb_index_file', r2.called.includes('kb_index_file'))

  // ── Group 3: 笔记 (6) ──
  hr('第3组: 笔记 (6个工具)')
  const r3 = await agentRun(
    '请操作笔记: '+
    '1. 列出所有笔记 (list_notes) '+
    '2. 创建一条笔记"测试笔记"内容为"笔记内容" (write_note) '+
    '3. 读取"测试笔记" (read_note) '+
    '4. 追加"追加笔记内容"到"测试笔记" (append_note) '+
    '5. 搜索笔记中包含"测试"的内容 (search_notes) '+
    '6. 删除"测试笔记" (delete_note)'
  )
  for(const tn of r3.called) allCalled.add(tn)
  t('list_notes', r3.called.includes('list_notes'))
  t('write_note', r3.called.includes('write_note'))
  t('read_note', r3.called.includes('read_note'))
  t('append_note', r3.called.includes('append_note'))
  t('search_notes', r3.called.includes('search_notes'))
  t('delete_note', r3.called.includes('delete_note'))

  // ── Group 4: 图片 (2) ──
  hr('第4组: 图片 (2个工具)')
  const r4 = await agentRun(
    '1. 搜索"古风女侠"的图片 (search_images) '+
    '2. 生成一张"修仙山门"的图片 (generate_image)'
  )
  for(const tn of r4.called) allCalled.add(tn)
  t('search_images', r4.called.includes('search_images'))
  t('generate_image', r4.called.includes('generate_image'))

  // ── Group 5: 模板 (2) ──
  hr('第5组: 模板 (2个工具)')
  const r5 = await agentRun(
    '1. 创建一个风格模板叫"测试风格"类型为"修仙小说" (create_style_template) '+
    '2. 创建一个场景模板叫"测试场景"类型为"修仙小说" (create_scene_template)'
  )
  for(const tn of r5.called) allCalled.add(tn)
  t('create_style_template', r5.called.includes('create_style_template'))
  t('create_scene_template', r5.called.includes('create_scene_template'))

  // ── Group 6: 项目 (2) ──
  hr('第6组: 项目 (2个工具)')
  const r6 = await agentRun(
    '1. 创建一个新项目叫"工具测试项目" (create_project) '+
    '2. 删除"工具测试项目" (delete_project)'
  )
  for(const tn of r6.called) allCalled.add(tn)
  t('create_project', r6.called.includes('create_project'))
  t('delete_project', r6.called.includes('delete_project'))

  // ── Group 7: 提示词+自管理 (3+5=8) ──
  hr('第7组: 提示词+自管理 (8个工具)')
  const r7 = await agentRun(
    '请依次: '+
    '1. 列出所有提示词模板 (list_prompts) '+
    '2. 启用润色提示词 (toggle_prompt) '+
    '3. 更新润色提示词内容 (update_prompt) '+
    '4. 列出已学习规则 (list_rules) '+
    '5. 学习规则"编辑前先读文件" (learn_rule) '+
    '6. 查看审计记录 (list_audit) '+
    '7. 记录学习经验"创建JSON前先读参考文件" (write_learning) '+
    '8. 更新配置 (update_config)'
  )
  for(const tn of r7.called) allCalled.add(tn)
  t('list_prompts', r7.called.includes('list_prompts'))
  t('toggle_prompt', r7.called.includes('toggle_prompt'))
  t('update_prompt', r7.called.includes('update_prompt'))
  t('list_rules', r7.called.includes('list_rules'))
  t('learn_rule', r7.called.includes('learn_rule'))
  t('list_audit', r7.called.includes('list_audit'))
  t('write_learning', r7.called.includes('write_learning'))
  t('update_config', r7.called.includes('update_config'))

  // ── Group 8: HTTP+浏览器+Shell+LSP (2+2+2+1=7) ──
  hr('第8组: HTTP+浏览器+Shell+LSP (7个工具)')
  const r8 = await agentRun(
    '请依次: '+
    '1. HTTP GET https://httpbin.org/get (http_get) '+
    '2. HTTP请求 https://httpbin.org/post (http_fetch) '+
    '3. 用浏览器打开 https://example.com (browser_open) '+
    '4. 浏览器搜索"小说创作技巧" (browser_search) '+
    '5. 执行shell命令 echo test (shell_exec) '+
    '6. 运行脚本 test.sh (shell_run_script) '+
    '7. LSP诊断当前文件 (lsp_diagnose)'
  )
  for(const tn of r8.called) allCalled.add(tn)
  t('http_get', r8.called.includes('http_get'))
  t('http_fetch', r8.called.includes('http_fetch'))
  t('browser_open', r8.called.includes('browser_open'))
  t('browser_search', r8.called.includes('browser_search'))
  t('shell_exec', r8.called.includes('shell_exec'))
  t('shell_run_script', r8.called.includes('shell_run_script'))
  t('lsp_diagnose', r8.called.includes('lsp_diagnose'))

  // ── 汇总 ──
  console.log('\n')
  console.log('══════════════════════════════════════════════════════')
  console.log('  🎯 38 工具全覆盖测试 — 结果')
  console.log('══════════════════════════════════════════════════════')

  const uncovered = ALL_TOOL_NAMES.filter(n => !allCalled.has(n))
  const covered = ALL_TOOL_NAMES.filter(n => allCalled.has(n))
  const coverage = ((covered.length / ALL_TOOL_NAMES.length) * 100).toFixed(1)

  console.log(`  已调用: ${covered.length}/${ALL_TOOL_NAMES.length} (${coverage}%)`)
  if (uncovered.length > 0) console.log(`  未调用: ${uncovered.join(', ')}`)

  console.log(`\n  断言: ✅ ${pass}  ❌ ${fail}`)

  // Per-tool status
  console.log(`\n  逐工具状态:`)
  for (const cat of [
    ['文件', ['list_directory','read_file','search_content','create_file','edit_file','delete_file','rename_file']],
    ['知识库', ['kb_list','kb_create_file','kb_append_file','kb_index_file']],
    ['笔记', ['list_notes','read_note','write_note','append_note','delete_note','search_notes']],
    ['图片', ['search_images','generate_image']],
    ['模板', ['create_style_template','create_scene_template']],
    ['项目', ['create_project','delete_project']],
    ['提示词', ['list_prompts','toggle_prompt','update_prompt']],
    ['自管理', ['list_rules','learn_rule','update_config','list_audit','write_learning']],
    ['HTTP', ['http_get','http_fetch']],
    ['浏览器', ['browser_open','browser_search']],
    ['Shell', ['shell_exec','shell_run_script']],
    ['LSP', ['lsp_diagnose']],
  ]) {
    const [catName, names] = cat
    const icons = names.map(n => allCalled.has(n) ? '✅' : '❌').join('')
    console.log(`  ${catName.padEnd(6)} ${icons}  ${names.join(', ')}`)
  }

  // 清理
  try { fs.unlinkSync(K('测试知识.md')); fs.unlinkSync(ST('测试风格.json')); fs.unlinkSync(SC('测试场景.json')) } catch {}

  console.log('══════════════════════════════════════════════════════')
  if (fail > 0 || uncovered.length > 0) process.exit(1)
}

main().catch(e => { console.error('\n💥', e.message); process.exit(1) })
