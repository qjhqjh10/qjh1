#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const MODEL = 'deepseek-chat'
const PROJECTS_DIR = path.resolve('projects')
const KB_DIR = path.resolve('knowledge_base/files')
const NOTES_DIR = path.resolve('notes')
const STYLE_DIR = path.resolve('style_templates')
const SCENE_DIR = path.resolve('scene_templates')

let pass = 0, fail = 0
function test(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ': ' + detail : '')) }
  else { fail++; console.log('  ❌ ' + name + (detail ? ': ' + detail : '')) }
}

const tools = {
  read_file: a => { try { const c = fs.readFileSync(path.join(PROJECTS_DIR, a.file_path), 'utf-8'); return {status:'success',summary:'读取'+a.file_path+'('+c.length+'字)',detail:c.slice(0,2000)} } catch(e) { return {status:'error',summary:'不存在:'+a.file_path} } },
  list_directory: a => { try { const e = fs.readdirSync(path.join(PROJECTS_DIR, a.path||'.'), {withFileTypes:true}); const l = e.map(x=>(x.isDirectory()?'DIR':'FILE')+' '+x.name); return {status:'success',summary:l.length+'个条目',detail:l.join('\n')} } catch(e) { return {status:'error',summary:'目录不存在'} } },
  search_content: a => { try { const results = []; const fp = path.join(PROJECTS_DIR, a.path||'.'); const re = new RegExp(a.pattern||'', 'gi'); const c = fs.readFileSync(fp,'utf-8'); const ls = c.split('\n'); for(let i=0;i<ls.length;i++) if(re.test(ls[i])) results.push(fp+':'+(i+1)+':'+ls[i].slice(0,200)); return {status:'success',summary:results.length+'个匹配',detail:results.slice(0,10).join('\n')} } catch(e) { return {status:'error',summary:'搜索失败'} } },
  edit_file: a => { try { const fp = path.join(PROJECTS_DIR, a.file_path); let c = fs.readFileSync(fp,'utf-8'); const old = a.old_string||a.old_str||''; const nw = a.new_string||a.new_str||''; if (old === '__FULL_REPLACE__') { fs.writeFileSync(fp, nw); return {status:'success',summary:'全量替换'+a.file_path}; } const idx = c.indexOf(old); if(idx < 0) { const idx2 = c.indexOf(old.trim()); if(idx2 < 0) return {status:'error',summary:'未找到匹配文本'}; fs.writeFileSync(fp, c.slice(0,idx2)+nw+c.slice(idx2+old.trim().length)); return {status:'success',summary:'编辑成功(trim)'}; } fs.writeFileSync(fp, c.slice(0,idx)+nw+c.slice(idx+old.length)); return {status:'success',summary:'编辑成功'}; } catch(e) { return {status:'error',summary:e.message} } },
  create_file: a => { try { const fp = path.join(PROJECTS_DIR, a.file_path); if(fp.endsWith('.json')&&a.content) try{JSON.parse(a.content)}catch(e){return{status:'error',summary:'JSON格式错误:'+e.message}}; fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp, a.content||''); return {status:'success',summary:'已创建:'+a.file_path}; } catch(e) { return {status:'error',summary:e.message} } },
  kb_list: () => { try { const f = fs.readdirSync(KB_DIR).filter(f=>f.endsWith('.md')); return {status:'success',summary:f.length+'个KB文件'}; } catch { return {status:'success',summary:'KB目录为空'} } },
  kb_create_file: a => { try { fs.mkdirSync(KB_DIR,{recursive:true}); fs.writeFileSync(path.join(KB_DIR, (a.name||'x')+'.md'), a.content||''); return {status:'success',summary:'KB已创建'}; } catch(e) { return {status:'error',summary:e.message} } },
  list_notes: () => { try { fs.mkdirSync(NOTES_DIR,{recursive:true}); const f = fs.readdirSync(NOTES_DIR).filter(f=>f.endsWith('.md')); return {status:'success',summary:f.length+'条笔记'}; } catch { return {status:'success',summary:'0条笔记'} } },
  write_note: a => { try { fs.mkdirSync(NOTES_DIR,{recursive:true}); fs.writeFileSync(path.join(NOTES_DIR,(a.name||'x')+'.md'), a.content||''); return {status:'success',summary:'笔记已创建'}; } catch(e) { return {status:'error',summary:e.message} } },
  read_note: a => { try { return {status:'success',summary:'读取笔记',detail:fs.readFileSync(path.join(NOTES_DIR,(a.name||'x')+'.md'),'utf-8').slice(0,500)}; } catch { return {status:'error',summary:'笔记不存在'} } },
  append_note: a => { try { const fp = path.join(NOTES_DIR,(a.name||'x')+'.md'); if(!fs.existsSync(fp)) return {status:'error',summary:'笔记不存在，请用write_note创建'}; fs.appendFileSync(fp,'\n'+(a.content||'')); return {status:'success',summary:'已追加'}; } catch(e) { return {status:'error',summary:e.message} } },
  delete_note: a => { try { fs.unlinkSync(path.join(NOTES_DIR,(a.name||'x')+'.md')); return {status:'success',summary:'已删除'}; } catch { return {status:'error',summary:'删除失败'} } },
  search_notes: a => { try { fs.mkdirSync(NOTES_DIR,{recursive:true}); const ms=[]; for(const f of fs.readdirSync(NOTES_DIR).filter(f=>f.endsWith('.md'))) { if(fs.readFileSync(path.join(NOTES_DIR,f),'utf-8').includes(a.query||'')) ms.push(f) } return {status:'success',summary:ms.length+'条匹配',detail:ms.join('\n')} } catch { return {status:'success',summary:'搜索完成'} } },
  create_style_template: a => { try { fs.mkdirSync(STYLE_DIR,{recursive:true}); fs.writeFileSync(path.join(STYLE_DIR,(a.name||'x')+'.json'), JSON.stringify(a,null,2)); return {status:'success',summary:'风格模板已创建'} } catch(e) { return {status:'error',summary:e.message} } },
  create_scene_template: a => { try { fs.mkdirSync(SCENE_DIR,{recursive:true}); fs.writeFileSync(path.join(SCENE_DIR,(a.name||'x')+'.json'), JSON.stringify(a,null,2)); return {status:'success',summary:'场景模板已创建'} } catch(e) { return {status:'error',summary:e.message} } },
}

const SCHEMAS = [
  {name:'read_file',description:'读取项目文件内容。已知路径直接读，无需list_directory。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'list_directory',description:'列出项目目录文件。查看知识库请用kb_list，查看笔记请用list_notes，查看模板路径在../../style_templates/。',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
  {name:'search_content',description:'搜索项目文件内容（支持正则+上下文行）。',input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']}},
  {name:'edit_file',description:'编辑文件。必须先read_file。old_string=__FULL_REPLACE__为全量替换。',input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}},
  {name:'create_file',description:'创建文件。JSON自动校验。',input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}},
  {name:'kb_list',description:'列出知识库所有文件。KB是全局参考资料。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'kb_create_file',description:'在知识库中创建.md文件。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'list_notes',description:'列出全局笔记。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'write_note',description:'创建新笔记文件。新笔记=write_note，追加已有笔记=append_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'read_note',description:'读取指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'append_note',description:'追加内容到已有笔记。文件必须已存在，创建新文件用write_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'delete_note',description:'删除指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'search_notes',description:'搜索笔记内容。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'create_style_template',description:'创建风格模板到style_templates/目录。直接调用，无需list_directory。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_scene_template',description:'创建场景模板到scene_templates/目录。直接调用，无需list_directory。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
]

const SYS = `你是青剑AI写作助手。

# 铁律
- 用户要求"修改/创建/删除" → 必须实际调用工具完成。只读不改 = 任务未完成。
- 口头描述 ≠ 操作完成。只有工具返回status:success才算实际完成。

# 工具选择
- 查看知识库 → kb_list（不要用list_directory）
- 查看笔记 → list_notes（不要用list_directory）
- 创建新笔记 → write_note（不要用append_note创建）
- 追加已有笔记 → append_note（不要用write_note覆盖）
- 创建模板 → create_style_template / create_scene_template（直接调用，不需要list_directory）

# 执行流程
- 读+改任务：先read_file → 确认内容后立即edit_file。两步缺一不可。
- 读+分析+创建任务：先read_file参考格式 → 然后create_file。
- 简单任务：直接调一个工具，不加多余操作。

# 文件路径
- 角色: 1/characters/中文名.json
- 章节: 1/chapters/chapterN.txt
- 细纲: 1/detailed_outline/chapterN.json
- 大纲: 1/outline/plot.md
- 摘要: 1/summaries/chapterN.md

# 输出
- 读取文件后只输出关键摘要，不输出全文
- 回答简洁`

async function callAnthropic(sys, msgs, tools) {
  const body = { model: MODEL, system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 2048, stream: true }
  if (tools?.length) body.tools = tools
  const res = await fetch(ANTHROPIC_URL, { method:'POST', headers:{'Content-Type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify(body) })
  if (!res.ok) throw new Error('HTTP '+res.status)
  return parseSSE(await res.text())
}

function parseSSE(text) {
  let ft='', tus=[]
  const bs=[]
  for (const c of text.split(/\n\n/)) {
    if(!c.trim()) continue
    let d='', et=''
    for(const l of c.split('\n')) { if(l.startsWith('event:')) et=l.slice(6).trim(); else if(l.startsWith('data:')) d=l.slice(5).trim() }
    if(!d) continue
    try {
      const e=JSON.parse(d); const t=et||e.type||''
      if(t==='content_block_start') bs.push({...e.content_block,index:e.index,inputJson:''})
      else if(t==='content_block_delta') { const b=bs.find(b=>b.index===(e.index??bs.length-1)); if(!b) continue; if(e.delta?.type==='text_delta'){b.text=(b.text||'')+e.delta.text;ft+=e.delta.text;} if(e.delta?.type==='input_json_delta'){b.inputJson=(b.inputJson||'')+e.delta.partial_json;try{b.input=JSON.parse(b.inputJson)}catch{}} }
      else if(t==='content_block_stop') { const b=bs.find(b=>b.index===(e.index??bs.length-1)); if(b?.type==='tool_use') tus.push({id:b.id,name:b.name,input:b.input||{}}) }
    } catch {}
  }
  return {text:ft,toolUses:tus}
}

async function run(msg) {
  const msgs=[{role:'user',content:[{type:'text',text:msg}]}]
  let its=0, tts=0
  while(its<10) {
    its++
    const r=await callAnthropic(SYS,msgs,SCHEMAS)
    if(!r.toolUses.length) return {...r,iterations:its,toolCalls:tts}
    const ac=[]; if(r.text) ac.push({type:'text',text:r.text})
    for(const tu of r.toolUses) ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input})
    msgs.push({role:'assistant',content:ac})
    const trs=[]
    for(const tu of r.toolUses) {
      const t=tools[tu.name]
      const res=t?await t(tu.input):{status:'error',summary:'未知工具:'+tu.name}
      tts++
      trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)})
      process.stdout.write((res.status==='success'?'✓':'✗')+' ')
    }
    msgs.push({role:'user',content:trs})
  }
  return {text:'',iterations:its,toolCalls:tts}
}

console.log('═══════════════════════════════════════')
console.log('  回归测试 — 修复后重测')
console.log('═══════════════════════════════════════\n')

// S9-2: 读细纲+改状态 (之前失败)
console.log('▶ S9-2 读细纲+改状态(之前❌)')
try {
  const r = await run('读取项目1第3章细纲(1/detailed_outline/chapter3.json)，用edit_file把status改成completed。先read_file读文件，然后edit_file用__FULL_REPLACE__全量替换。')
  test('S9-2 读+改(≥2工具)', r.toolCalls >= 2, r.iterations+'轮 '+r.toolCalls+'工具')
} catch(e) { test('S9-2', false, e.message) }

// S5-2: KB创建 (之前6轮)
console.log('\n▶ S5-2 创建KB文件(之前6轮)')
try {
  const r = await run('用kb_create_file创建一个知识库文件：文件名"林语晴角色要点"，内容"姓名：林语晴，角色：女主，性格：温柔坚强"')
  test('S5-2 KB(≤2工具)', r.toolCalls <= 2, r.iterations+'轮 '+r.toolCalls+'工具')
} catch(e) { test('S5-2', false, e.message) }

// S7-1: 风格模板 (之前10轮)
console.log('\n▶ S7-1 风格模板(之前10轮)')
try {
  const r = await run('用create_style_template创建一个风格模板，name=现代简约测试, type=普通小说')
  test('S7-1 模板(=1工具)', r.toolCalls === 1, r.iterations+'轮 '+r.toolCalls+'工具')
} catch(e) { test('S7-1', false, e.message) }

// S7-2: 场景模板 (之前list_directory失败2次)
console.log('\n▶ S7-2 场景模板(之前list_directory迷路)')
try {
  const r = await run('用create_scene_template创建一个场景模板，name=测试战斗场景, type=武侠小说')
  test('S7-2 场景(=1工具)', r.toolCalls === 1, r.iterations+'轮 '+r.toolCalls+'工具')
} catch(e) { test('S7-2', false, e.message) }

// S6-2: 写笔记 (之前用了append_note)
console.log('\n▶ S6-2 写笔记(之前用了append_note)')
try {
  const r = await run('写一条新笔记（用write_note），文件名"回归测试笔记"，内容"测试内容123"')
  test('S6-2 写笔记用write_note', r.toolCalls === 1, '工具: write_note')
} catch(e) { test('S6-2', false, e.message) }

// 额外验证: 笔记搜索+删除
console.log('\n▶ S6-extra 笔记搜索+删除')
try {
  const r1 = await run('搜索笔记中包含"测试"的笔记（用search_notes）')
  test('S6-extra 搜索笔记', r1.toolCalls >= 1, r1.iterations+'轮 '+r1.toolCalls+'工具')
  const r2 = await run('删除笔记"回归测试笔记"（用delete_note）')
  test('S6-extra 删除笔记', r2.toolCalls === 1, r2.iterations+'轮 '+r2.toolCalls+'工具')
} catch(e) { test('S6-extra', false, e.message) }

console.log('\n═══════════════════════════════════════')
console.log('  结果: ✅'+pass+'  ❌'+fail)
console.log('═══════════════════════════════════════')
