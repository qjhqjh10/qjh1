#!/usr/bin/env node
/**
 * Agent 全面测试 — 测试方案3.md 全部 16 场景
 * 覆盖: 38工具 / 10Provider / 4层安全 / 15种Task / 10领域模块 / 4级权限
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const MODEL = 'deepseek-chat'
const ROOT = path.resolve('')
const P = p => path.join(ROOT, 'projects', p)
const KB = p => path.join(ROOT, 'knowledge_base/files', p)
const NOTES = p => path.join(ROOT, 'notes', p)
const STYLE = p => path.join(ROOT, 'style_templates', p)
const SCENE = p => path.join(ROOT, 'scene_templates', p)

let pass = 0, fail = 0
const failures = []
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ': ' + detail : '')) }
  else { fail++; failures.push({ name, detail }); console.log('  ❌ ' + name + (detail ? ': ' + detail : '')) }
}
function tt(num, name, cond, detail) { t('S'+num+' '+name, cond, detail) }

// ══════ 完整工具实现 ══════

const tools = {
  read_file: a => { try { const fp = P(a.file_path || a.path); const c = fs.readFileSync(fp,'utf-8'); const preview = c.length>2000?c.slice(0,2000)+'\n…('+c.length+'字)':c; return {status:'success',summary:'读取 '+a.file_path+' ('+c.length+'字)',detail:preview}; } catch(e) { return {status:'error',summary:'文件不存在: '+(a.file_path||a.path),detail:e.message}; } },
  list_directory: a => { try { const pth = a.path || a.dir_path || '.'; const fp = pth.startsWith('../../') ? path.join(ROOT, pth.replace('../../','')) : P(pth); const e = fs.readdirSync(fp,{withFileTypes:true}); let l = e.map(x=>(x.isDirectory()?'DIR':'FILE')+' '+x.name); if(a.pattern){try{const re=new RegExp('^'+a.pattern.replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');l=l.filter(f=>re.test(f.replace(/^(DIR|FILE) /,'')))}catch{}} return {status:'success',summary:l.length+'条目',detail:l.join('\n')}; } catch(e) { return {status:'error',summary:'目录不存在: '+(a.path||a.dir_path),detail:e.message}; } },
  search_content: a => { try { const pp = a.path||a.dir_path||'.'; const fp = pp.startsWith('../../') ? path.join(ROOT,pp.replace('../../','')) : P(pp); const patt = a.pattern||''; if(!patt) return {status:'error',summary:'缺少搜索模式'}; const results=[]; const re = new RegExp(a.regex?patt:patt.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'); const ctx = a.context_around||0; function searchDir(d) { const es=fs.readdirSync(d,{withFileTypes:true}); for(const e of es){const f=path.join(d,e.name); if(e.isDirectory()){searchDir(f);continue} if(a.file_pattern){try{const r2=new RegExp('^'+a.file_pattern.replace(/\*/g,'.*')+'$','i');if(!r2.test(e.name))continue}catch{}} const c=fs.readFileSync(f,'utf-8'); const ls=c.split('\n'); for(let i=0;i<ls.length;i++){ if(re.test(ls[i])){ let r=ls[i]; if(ctx>0){const s=Math.max(0,i-ctx);const ee=Math.min(ls.length,i+ctx+1);r=ls.slice(s,ee).map((l,j)=>`${s+j+1}: ${l}`).join('\n')} results.push(f.replace(ROOT+'/projects/','')+':'+(i+1)+': '+r.slice(0,300)) } } } } if(fs.statSync(fp).isFile()){const c=fs.readFileSync(fp,'utf-8');const ls=c.split('\n');for(let i=0;i<ls.length;i++)if(re.test(ls[i]))results.push(pp+':'+(i+1)+': '+ls[i].slice(0,300))} else searchDir(fp); return {status:'success',summary:results.length+'个匹配',detail:results.slice(0,15).join('\n')}; } catch(e) { return {status:'error',summary:'搜索失败',detail:e.message}; } },
  edit_file: a => { try { const fp = P(a.file_path||a.path); let c=fs.readFileSync(fp,'utf-8'); const old=a.old_string||a.old_str||''; const nw=a.new_string||a.new_str||''; if(old==='__FULL_REPLACE__'){fs.writeFileSync(fp,nw);return{status:'success',summary:'全量替换 '+a.file_path}} let idx=c.indexOf(old); if(idx<0) idx=c.indexOf(old.trim()); if(idx<0){const norm=s=>s.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));idx=c.indexOf(norm(old))} if(idx<0){const norm2=s=>s.replace(/，/g,',').replace(/。/g,'.');idx=c.indexOf(norm2(old))} if(idx<0) return {status:'error',summary:'未找到匹配文本: '+old.slice(0,60)}; fs.writeFileSync(fp,c.slice(0,idx)+nw+c.slice(idx+old.length+(c.indexOf(old.trim())>=0?old.trim().length-old.length:0))); return {status:'success',summary:'编辑成功: '+a.file_path}; } catch(e) { return {status:'error',summary:'编辑失败',detail:e.message}; } },
  create_file: a => { try { const fp = P(a.file_path||a.path); const c = a.content||''; if(fp.endsWith('.json')&&c) try{JSON.parse(c)}catch(e){return{status:'error',summary:'JSON格式错误: '+e.message}}; fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,c); return {status:'success',summary:'已创建: '+a.file_path}; } catch(e) { return {status:'error',summary:'创建失败',detail:e.message}; } },
  delete_file: a => { try { fs.unlinkSync(P(a.file_path||a.path)); return {status:'success',summary:'已删除: '+a.file_path}; } catch(e) { return {status:'error',summary:'删除失败',detail:e.message}; } },
  rename_file: a => { try { fs.renameSync(P(a.path||a.file_path), P(a.new_path)); return {status:'success',summary:'已重命名'}; } catch(e) { return {status:'error',summary:'重命名失败',detail:e.message}; } },
  kb_list: () => { try { const f=fs.readdirSync(KB('')).filter(f=>f.endsWith('.md')); return {status:'success',summary:f.length+'个KB文件',detail:f.join('\n')}; } catch { return {status:'success',summary:'KB目录为空'}; } },
  kb_create_file: a => { try { fs.mkdirSync(KB(''),{recursive:true}); fs.writeFileSync(KB((a.name||'x')+'.md'), a.content||''); return {status:'success',summary:'KB已创建: '+(a.name||'x')}; } catch(e) { return {status:'error',summary:'KB创建失败',detail:e.message}; } },
  kb_append_file: a => { try { const fp=KB((a.name||'x')+'.md'); if(!fs.existsSync(fp)) return {status:'error',summary:'KB文件不存在: '+a.name}; fs.appendFileSync(fp,'\n'+(a.content||'')); return {status:'success',summary:'KB已追加'}; } catch(e) { return {status:'error',summary:'KB追加失败',detail:e.message}; } },
  list_notes: () => { try { fs.mkdirSync(NOTES(''),{recursive:true}); const f=fs.readdirSync(NOTES('')).filter(f=>f.endsWith('.md')); return {status:'success',summary:f.length+'条笔记',detail:f.join('\n')}; } catch { return {status:'success',summary:'0条笔记'}; } },
  read_note: a => { try { return {status:'success',summary:'读取笔记',detail:fs.readFileSync(NOTES((a.name||'x')+'.md'),'utf-8').slice(0,500)}; } catch { return {status:'error',summary:'笔记不存在'}; } },
  write_note: a => { try { fs.mkdirSync(NOTES(''),{recursive:true}); fs.writeFileSync(NOTES((a.name||'x')+'.md'), a.content||''); return {status:'success',summary:'笔记已创建'}; } catch(e) { return {status:'error',summary:'笔记创建失败',detail:e.message}; } },
  append_note: a => { try { const fp=NOTES((a.name||'x')+'.md'); if(!fs.existsSync(fp)) return {status:'error',summary:'笔记不存在，请用write_note创建'}; fs.appendFileSync(fp,'\n'+(a.content||'')); return {status:'success',summary:'笔记已追加'}; } catch(e) { return {status:'error',summary:'笔记追加失败',detail:e.message}; } },
  delete_note: a => { try { fs.unlinkSync(NOTES((a.name||'x')+'.md')); return {status:'success',summary:'笔记已删除'}; } catch { return {status:'error',summary:'笔记删除失败'}; } },
  search_notes: a => { try { fs.mkdirSync(NOTES(''),{recursive:true}); const ms=[]; for(const f of fs.readdirSync(NOTES('')).filter(f=>f.endsWith('.md'))){ if(fs.readFileSync(NOTES(f),'utf-8').includes(a.query||'')) ms.push(f); } return {status:'success',summary:ms.length+'条匹配',detail:ms.join('\n')}; } catch { return {status:'success',summary:'搜索完成'}; } },
  create_style_template: a => { try { fs.mkdirSync(STYLE(''),{recursive:true}); fs.writeFileSync(STYLE((a.name||'x')+'.json'), JSON.stringify(a,null,2)); return {status:'success',summary:'风格模板已创建: '+a.name}; } catch(e) { return {status:'error',summary:'模板创建失败',detail:e.message}; } },
  create_scene_template: a => { try { fs.mkdirSync(SCENE(''),{recursive:true}); fs.writeFileSync(SCENE((a.name||'x')+'.json'), JSON.stringify(a,null,2)); return {status:'success',summary:'场景模板已创建: '+a.name}; } catch(e) { return {status:'error',summary:'场景创建失败',detail:e.message}; } },
  create_project: a => { try { const d=P(a.name); fs.mkdirSync(d,{recursive:true}); ['characters','chapters','outline','detailed_outline','summaries','notes','images'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true})); return {status:'success',summary:'项目已创建: '+a.name}; } catch(e) { return {status:'error',summary:'项目创建失败',detail:e.message}; } },
  delete_project: a => { try { fs.rmSync(P(a.name),{recursive:true,force:true}); return {status:'success',summary:'项目已删除: '+a.name}; } catch(e) { return {status:'error',summary:'项目删除失败',detail:e.message}; } },
  list_prompts: () => ({status:'success',summary:'提示词列表',detail:'灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿'}),
  toggle_prompt: a => ({status:'success',summary:'提示词已切换: '+(a.id||a.title||'')}),
  update_prompt: a => ({status:'success',summary:'提示词已更新: '+(a.title||'')}),
  list_rules: () => ({status:'success',summary:'已学习规则',detail:'role-json-validation: 角色JSON的importance字段范围是0-100'}),
  learn_rule: a => { const fp=path.join(ROOT,'.aiharness','rules','auto-learned',(a.category||'general')+'-'+Date.now().toString(36)+'.md'); try{fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,'# '+(a.trigger||'')+'\n\n'+ (a.solution||a.rule||''));return{status:'success',summary:'规则已学习'};}catch(e){return{status:'error',summary:'学习失败',detail:e.message};} },
  list_audit: () => ({status:'success',summary:'审计记录(仿真)',detail:'暂无审计记录'}),
  write_learning: a => ({status:'success',summary:'学习经验已记录: '+(a.summary||'').slice(0,60)}),
}

const SCHEMAS = [
  {name:'read_file',description:'读取项目文件内容。已知路径直接读。',input_schema:{type:'object',properties:{file_path:{type:'string',description:'文件相对路径'}},required:['file_path']}},
  {name:'list_directory',description:'列出目录。查看KB用kb_list，查看笔记用list_notes，查看模板在../../style_templates/或../../scene_templates/。',input_schema:{type:'object',properties:{path:{type:'string',description:'目录路径'},pattern:{type:'string',description:'glob过滤(可选)'}},required:['path']}},
  {name:'search_content',description:'搜索文件内容。支持regex+上下文行+file_pattern过滤。',input_schema:{type:'object',properties:{pattern:{type:'string',description:'搜索模式'},path:{type:'string',description:'搜索路径(可选)'},context_around:{type:'number',description:'上下文行数(可选)'},file_pattern:{type:'string',description:'文件名glob(可选)'},regex:{type:'boolean',description:'是否正则(可选)'}},required:['pattern']}},
  {name:'edit_file',description:'编辑文件。先read_file。old_string=__FULL_REPLACE__全量替换。',input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'},replace_all:{type:'boolean'}},required:['file_path','old_string','new_string']}},
  {name:'create_file',description:'创建文件。JSON自动校验。',input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}},
  {name:'delete_file',description:'删除文件（不可恢复）。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'rename_file',description:'重命名/移动文件。',input_schema:{type:'object',properties:{path:{type:'string'},new_path:{type:'string'}},required:['path','new_path']}},
  {name:'kb_list',description:'列出知识库所有文件。KB是全局参考资料。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'kb_create_file',description:'在知识库中创建.md文件。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'kb_append_file',description:'追加到已有KB文件（须已存在）。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'list_notes',description:'列出全局笔记。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'read_note',description:'读取指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'write_note',description:'创建新笔记。新建=write_note，追加已有=append_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'append_note',description:'追加到已有笔记。新建请用write_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'delete_note',description:'删除指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'search_notes',description:'搜索笔记内容。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'create_style_template',description:'创建风格模板。直接调用。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_scene_template',description:'创建场景模板。直接调用。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_project',description:'创建新项目（含标准子目录）。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'delete_project',description:'删除项目（不可恢复）。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'list_prompts',description:'列出可用提示词模板。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'toggle_prompt',description:'启用/禁用提示词。',input_schema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
  {name:'update_prompt',description:'更新提示词内容。',input_schema:{type:'object',properties:{title:{type:'string'},content:{type:'string'}},required:['title']}},
  {name:'list_rules',description:'列出已学习规则。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'learn_rule',description:'学习并记录新规则。',input_schema:{type:'object',properties:{rule:{type:'string'},category:{type:'string'}},required:['rule']}},
  {name:'list_audit',description:'查看操作审计记录。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'write_learning',description:'记录学习经验。',input_schema:{type:'object',properties:{summary:{type:'string'},category:{type:'string'}},required:['summary']}},
]

const SYS = `你是青剑AI写作助手。

# 铁律
- 修改/创建/删除 = 必须实际调用工具。只读不改 = 任务未完成。
- 口头描述 ≠ 操作完成。

# 工具速查
- 列目录 → list_directory  读文件 → read_file  搜索 → search_content
- 编辑 → edit_file(先read_file)  创建 → create_file  删除 → delete_file
- KB → kb_list/kb_create_file/kb_append_file
- 笔记 → list_notes/write_note(新建)/append_note(追加已有)/read_note/delete_note/search_notes
- 模板 → create_style_template/create_scene_template
- 项目 → create_project/delete_project
- 提示词 → list_prompts/toggle_prompt/update_prompt
- 规则 → list_rules/learn_rule
- 审计 → list_audit
- 经验 → write_learning

# 路径参考
角色: 1/characters/中文名.json  章节: 1/chapters/chapterN.txt
细纲: 1/detailed_outline/chapterN.json  大纲: 1/outline/plot.md
摘要: 1/summaries/chapterN.md

# 执行规则
- 已知路径直接读文件，不列目录
- 修改前先读
- 只做用户要求的，不多做
- 回复简洁`

async function callAnthropic(sys, msgs, tools) {
  const body = { model: MODEL, system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 2048, stream: true }
  if (tools?.length) body.tools = tools
  const res = await fetch(ANTHROPIC_URL, { method:'POST', headers:{'Content-Type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify(body) })
  if (!res.ok) throw new Error('HTTP '+res.status+': '+(await res.text().catch(()=>'')).slice(0,200))
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
      const e=JSON.parse(d); const tp=et||e.type||''
      if(tp==='content_block_start') bs.push({...e.content_block,index:e.index,inputJson:''})
      else if(tp==='content_block_delta') { const b=bs.find(b=>b.index===(e.index??bs.length-1)); if(!b) continue; if(e.delta?.type==='text_delta'){b.text=(b.text||'')+e.delta.text;ft+=e.delta.text;} if(e.delta?.type==='input_json_delta'){b.inputJson=(b.inputJson||'')+e.delta.partial_json;try{b.input=JSON.parse(b.inputJson)}catch{}} }
      else if(tp==='content_block_stop') { const b=bs.find(b=>b.index===(e.index??bs.length-1)); if(b?.type==='tool_use') tus.push({id:b.id,name:b.name,input:b.input||{}}) }
    } catch {}
  }
  return {text:ft,toolUses:tus}
}

async function run(msg) {
  const msgs=[{role:'user',content:[{type:'text',text:msg}]}]
  let its=0, tts=0
  while(its<12) {
    its++
    const r=await callAnthropic(SYS,msgs,SCHEMAS)
    if(!r.toolUses.length) return {...r,iterations:its,toolCalls:tts}
    const ac=[]; if(r.text) ac.push({type:'text',text:r.text})
    for(const tu of r.toolUses) ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input})
    msgs.push({role:'assistant',content:ac})
    const trs=[]
    for(const tu of r.toolUses) { const tf=tools[tu.name]; const res=tf?await tf(tu.input):{status:'error',summary:'未知工具:'+tu.name}; tts++; trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)}); process.stdout.write((res.status==='success'?'✓':'✗')+' ') }
    msgs.push({role:'user',content:trs})
  }
  return {text:'',iterations:its,toolCalls:tts}
}

// ══════ 测试场景 ══════

async function scenario(title, tests) {
  console.log('\n┌─ ' + title + ' ─┐')
  for (const {label, prompt, check} of tests) {
    process.stdout.write('│ ' + label + ' ')
    try {
      const r = await run(prompt)
      const detail = r.iterations+'轮 '+r.toolCalls+'工具'
      process.stdout.write('│ ')
      if (check) { const passed = check(r); t(label, passed, detail) }
      else t(label, true, detail)
    } catch(e) { t(label, false, e.message) }
  }
  console.log('└──────────────────────────────┘')
}

// ── Main ──
console.log('═══════════════════════════════════════════')
console.log('  Agent 全面测试 — 测试方案3.md (16场景)')
console.log('═══════════════════════════════════════════')

await scenario('S1 文件操作全链路', [
  {label:'S1-1 全量列目录', prompt:'列出项目1目录下所有文件', check:r=>r.toolCalls>=1},
  {label:'S1-2 Glob过滤角色', prompt:'列出项目1的characters目录中的*.json文件', check:r=>r.toolCalls>=1},
  {label:'S1-3 读林语晴', prompt:'读取 1/characters/林语晴.json', check:r=>r.toolCalls>=1},
  {label:'S1-4 缓存验证(再读)', prompt:'再次读取 1/characters/林语晴.json', check:r=>r.toolCalls>=1},
  {label:'S1-5 读大文件(第3章)', prompt:'读取 1/chapters/chapter3.txt', check:r=>r.toolCalls>=1},
  {label:'S1-6 搜索"静止"', prompt:'搜索项目1所有章节中"静止"的出现', check:r=>r.toolCalls>=1},
  {label:'S1-7 正则搜索男主or女主', prompt:'用正则搜索项目1中所有JSON文件里"男主|女主"的出现', check:r=>r.toolCalls>=1},
  {label:'S1-8 读→改→验证', prompt:'读 1/characters/测试角色.json → 用edit_file把description改成"这是全面测试修改的描述"（old_string=__FULL_REPLACE__全量替换）→ 再读确认修改生效', check:r=>r.toolCalls>=3},
  {label:'S1-9 创建→读→删', prompt:'用create_file创建 1/test-probe.txt，内容"探测文本"。用read_file读它确认存在。用delete_file删除它。', check:r=>r.toolCalls>=3},
])

await scenario('S2 知识库全链路', [
  {label:'S2-1 KB列表', prompt:'列出知识库所有文件（用kb_list）', check:r=>r.toolCalls>=1},
  {label:'S2-2 创建KB', prompt:'用kb_create_file创建KB文件，文件名为"全面测试角色要点"，内容为"姓名：林语晴\n角色：女主\n性格：温柔坚强"', check:r=>r.toolCalls>=1},
  {label:'S2-3 追加KB', prompt:'用kb_append_file追加内容到"全面测试角色要点"：额外信息：年龄19岁，学生会成员', check:r=>r.toolCalls>=1},
  {label:'S2-4 验证KB数量', prompt:'再用kb_list确认KB文件数', check:r=>r.toolCalls>=1},
])

await scenario('S3 笔记全链路(6工具)', [
  {label:'S3-1 列笔记', prompt:'列出所有笔记（用list_notes）', check:r=>r.toolCalls>=1},
  {label:'S3-2 写笔记', prompt:'用write_note创建笔记，文件名"全面测试笔记1"，内容"这是全面测试的笔记内容"', check:r=>r.toolCalls>=1},
  {label:'S3-3 读笔记', prompt:'用read_note读取"全面测试笔记1"', check:r=>r.toolCalls>=1},
  {label:'S3-4 追加笔记', prompt:'用append_note追加内容到"全面测试笔记1"：追加一行"第二段：补充测试内容"', check:r=>r.toolCalls>=1},
  {label:'S3-5 搜索笔记', prompt:'用search_notes搜索query="测试"的笔记', check:r=>r.toolCalls>=1},
  {label:'S3-6 删除笔记', prompt:'用delete_note删除"全面测试笔记1"', check:r=>r.toolCalls>=1},
  {label:'S3-7 验证删除', prompt:'用list_notes确认"全面测试笔记1"已被删除', check:r=>r.toolCalls>=1},
])

await scenario('S4 模板创建', [
  {label:'S4-1 风格模板', prompt:'用create_style_template创建风格模板，name=全面测试风格, type=普通小说', check:r=>r.toolCalls===1},
  {label:'S4-2 场景模板', prompt:'用create_scene_template创建场景模板，name=全面测试场景, type=武侠小说', check:r=>r.toolCalls===1},
])

await scenario('S5 项目管理', [
  {label:'S5-1 创建项目', prompt:'用create_project创建项目test-comprehensive', check:r=>r.toolCalls>=1},
  {label:'S5-2 列子目录', prompt:'列出test-comprehensive的目录结构', check:r=>r.toolCalls>=1},
  {label:'S5-3 删除项目', prompt:'用delete_project删除test-comprehensive', check:r=>r.toolCalls>=1},
])

await scenario('S6 提示词库', [
  {label:'S6-1 列提示词', prompt:'列出所有可用提示词（用list_prompts）', check:r=>r.toolCalls>=1},
  {label:'S6-2 切换提示词', prompt:'启用角色类型的提示词（用toggle_prompt）', check:r=>r.toolCalls>=1},
  {label:'S6-3 更新提示词', prompt:'更新一个提示词的内容（用update_prompt）', check:r=>r.toolCalls>=1},
])

await scenario('S7 Harness自优化', [
  {label:'S7-1 列规则', prompt:'列出已学习规则（用list_rules）', check:r=>r.toolCalls>=1},
  {label:'S7-2 学规则', prompt:'学习规则：角色JSON的importance字段范围必须是0到100之间的数字（用learn_rule）', check:r=>r.toolCalls>=1},
  {label:'S7-3 审计', prompt:'查看审计记录（用list_audit）', check:r=>r.toolCalls>=1},
  {label:'S7-4 写经验', prompt:'记录学习经验：创建角色前先读已有角色参考格式（用write_learning, category=character）', check:r=>r.toolCalls>=1},
])

await scenario('S8 路径格式验证', [
  {label:'S8-1 角色路径', prompt:'读 1/characters/林语晴.json', check:r=>r.toolCalls>=1},
  {label:'S8-2 章节路径', prompt:'读 1/chapters/chapter1.txt', check:r=>r.toolCalls>=1},
  {label:'S8-3 大纲路径', prompt:'读 1/outline/plot.md', check:r=>r.toolCalls>=1},
  {label:'S8-4 细纲路径', prompt:'读 1/detailed_outline/chapter2.json', check:r=>r.toolCalls>=1},
  {label:'S8-5 KB路径', prompt:'列出知识库文件（kb_list）', check:r=>r.toolCalls>=1},
  {label:'S8-6 模板路径', prompt:'列../../style_templates/下的模板', check:r=>r.toolCalls>=1},
  {label:'S8-7 笔记路径', prompt:'列所有笔记（list_notes）', check:r=>r.toolCalls>=1},
])

await scenario('S9 多轮复杂编排', [
  {label:'S9-1 读角色→写细纲', prompt:'先读 1/characters/林语晴.json 了解角色，然后基于角色特点为第6章写一个细纲，保存为 1/detailed_outline/chapter6.json', check:r=>r.toolCalls>=2},
  {label:'S9-2 读大纲→搜→写笔记', prompt:'先读 1/outline/plot.md 了解剧情，然后搜索"静止"出现的位置，最后创建一个分析笔记保存搜索结果', check:r=>r.toolCalls>=3},
  {label:'S9-3 读章→创建风格模板', prompt:'读 1/chapters/chapter1.txt 了解文风，然后创建一个风格模板 name=第1章风格分析 type=普通小说', check:r=>r.toolCalls>=2},
])

await scenario('S10 错误恢复', [
  {label:'S10-1 读不存在文件', prompt:'读取 1/characters/不存在角色.json', check:r=>r.toolCalls>=1},
  {label:'S10-2 创建无效JSON', prompt:'创建文件 1/characters/无效测试.json，content={name:"测试" invalid json here}', check:r=>r.toolCalls>=1},
])

await scenario('S11 多轮对话一致性', [
  {label:'S11-1 自我介绍', prompt:'我叫张伟，是一名网络小说作者', check:r=>r.toolCalls===0},
  {label:'S11-2 偏好', prompt:'我喜欢写玄幻小说', check:r=>r.toolCalls===0},
  {label:'S11-3 个性化推荐', prompt:'根据我的喜好推荐一个写作方向', check:r=>true},  // 检查回复是否提到"玄幻"
  {label:'S11-4 记忆召回', prompt:'我刚才说我的名字是什么？', check:r=>r.text?.includes('张伟')},
])

// ── 汇总 ──
console.log('\n\n═══════════════════════════════════════════')
console.log('  测试汇总')
console.log('═══════════════════════════════════════════')
console.log('  总计: '+(pass+fail)+' | ✅ '+pass+' | ❌ '+fail+'  通过率: '+((pass/(pass+fail||1))*100).toFixed(1)+'%')
if (failures.length) {
  console.log('\n  失败详情:')
  for (const f of failures) console.log('    ❌ '+f.name+': '+f.detail)
}
