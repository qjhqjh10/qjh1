#!/usr/bin/env node
/**
 * 极限测试 — 测试方案4.md
 * P1: 对话类误调工具 (25例)
 * P2: 复杂任务效率 (15例)
 * P3: 工具触发边界 (15例)
 * 总计 55 用例
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const ROOT = process.cwd()
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)
const ST = p => path.join(ROOT, 'style_templates', p)
const SC = p => path.join(ROOT, 'scene_templates', p)

const tools = {
  read_file: a => { try { const c=fs.readFileSync(P(a.file_path||a.path),'utf-8'); return {status:'success',summary:'读取'+(a.file_path||a.path)+'('+c.length+'字)',detail:c.length>2000?c.slice(0,2000)+'…':c}; } catch(e) { return {status:'error',summary:'文件不存在:'+(a.file_path||a.path)}; } },
  list_directory: a => { try { const pth=(a.path||'.').startsWith('../../')?path.join(ROOT,(a.path||'.').replace('../../','')):P(a.path||'.'); const e=fs.readdirSync(pth,{withFileTypes:true}); let l=e.map(x=>(x.isDirectory()?'📁':'📄')+' '+x.name); if(a.pattern){try{const re=new RegExp('^'+a.pattern.replace(/\*/g,'.*')+'$','i');l=l.filter(f=>re.test(f.replace(/^📁 |📄 /,'')))}catch{}} return {status:'success',summary:l.length+'条目',detail:l.slice(0,30).join('\n')}; } catch(e) { return {status:'error',summary:'目录不存在:'+(a.path||'.')}; } },
  search_content: a => { try { const fp=P(a.path||a.file_path||'.'); if(fs.statSync(fp).isFile()){const c=fs.readFileSync(fp,'utf-8');const ls=c.split('\n');const results=[];const re=new RegExp(a.pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');for(let i=0;i<ls.length;i++)if(re.test(ls[i]))results.push((i+1)+':'+ls[i].slice(0,200));return{status:'success',summary:results.length+'个匹配',detail:results.slice(0,10).join('\n')}} return{status:'success',summary:'搜索完成'}; } catch(e) { return {status:'error',summary:'搜索失败'}; } },
  edit_file: a => { try { const fp=P(a.file_path);let c=fs.readFileSync(fp,'utf-8');const old=a.old_string||'';const nw=a.new_string||'';if(old==='__FULL_REPLACE__'){fs.writeFileSync(fp,nw);return{status:'success',summary:'全量替换'}} let idx=c.indexOf(old);if(idx<0)idx=c.indexOf(old.trim());if(idx<0){const norm=s=>s.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));idx=c.indexOf(norm(old))} if(idx<0)return{status:'error',summary:'未找到匹配文本'};fs.writeFileSync(fp,c.slice(0,idx)+nw+c.slice(idx+old.length));return{status:'success',summary:'编辑成功'};}catch(e){return{status:'error',summary:e.message}} },
  create_file: a => { try { const fp=P(a.file_path);const c=a.content||'';if(fp.endsWith('.json')&&c)try{JSON.parse(c)}catch(e){return{status:'error',summary:'JSON格式错误: '+e.message+'. 请修正：键用双引号、字符串内换行用\\\\n、无尾随逗号。'}};fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,c);return{status:'success',summary:'已创建:'+a.file_path};}catch(e){return{status:'error',summary:e.message}} },
  delete_file: a => { try { fs.unlinkSync(P(a.file_path));return{status:'success',summary:'已删除'}; } catch(e) { return {status:'error',summary:'删除失败'}; } },
  kb_list: () => { try { const f=fs.readdirSync(K('')).filter(f=>f.endsWith('.md'));return{status:'success',summary:f.length+'个KB',detail:f.join('\n')};} catch { return {status:'success',summary:'KB为空'}; } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true});fs.writeFileSync(K((a.name||'x')+'.md'),a.content||'');return{status:'success',summary:'KB已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true});const f=fs.readdirSync(N('')).filter(f=>f.endsWith('.md'));return{status:'success',summary:f.length+'条笔记',detail:f.join('\n')};} catch { return {status:'success',summary:'0条笔记'}; } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true});fs.writeFileSync(N((a.name||'x')+'.md'),a.content||'');return{status:'success',summary:'笔记已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
  read_note: a => { try { return{status:'success',summary:'读取笔记',detail:fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500)}; } catch { return {status:'error',summary:'笔记不存在'}; } },
  append_note: a => { try { const fp=N((a.name||'x')+'.md');if(!fs.existsSync(fp))return{status:'error',summary:'笔记不存在，请用write_note'};fs.appendFileSync(fp,'\n'+(a.content||''));return{status:'success',summary:'已追加'}; } catch(e) { return {status:'error',summary:e.message}; } },
  delete_note: a => { try { fs.unlinkSync(N((a.name||'x')+'.md'));return{status:'success',summary:'已删除'}; } catch { return {status:'error',summary:'删除失败'}; } },
  search_notes: a => { try { fs.mkdirSync(N(''),{recursive:true});const ms=[];for(const f of fs.readdirSync(N('')).filter(f=>f.endsWith('.md'))){if(fs.readFileSync(N(f),'utf-8').includes(a.query||''))ms.push(f)};return{status:'success',summary:ms.length+'条匹配',detail:ms.join('\n')}; } catch { return {status:'success',summary:'0条匹配'}; } },
  create_style_template: a => { try { fs.mkdirSync(ST(''),{recursive:true});fs.writeFileSync(ST((a.name||'x')+'.json'),JSON.stringify(a,null,2));return{status:'success',summary:'模板已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
  create_scene_template: a => { try { fs.mkdirSync(SC(''),{recursive:true});fs.writeFileSync(SC((a.name||'x')+'.json'),JSON.stringify(a,null,2));return{status:'success',summary:'模板已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
  create_project: a => { try { const d=P(a.name);fs.mkdirSync(d,{recursive:true});['characters','chapters','outline','detailed_outline','summaries'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true}));return{status:'success',summary:'项目已创建:'+a.name}; } catch(e) { return {status:'error',summary:e.message}; } },
  delete_project: a => { try { fs.rmSync(P(a.name),{recursive:true,force:true});return{status:'success',summary:'已删除项目'}; } catch(e) { return {status:'error',summary:e.message}; } },
  list_prompts: () => ({status:'success',summary:'提示词列表',detail:'灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿'}),
  list_rules: () => ({status:'success',summary:'已学习规则',detail:'暂无自定义规则'}),
  learn_rule: a => ({status:'success',summary:'规则已学习:'+(a.rule||'').slice(0,50)}),
  list_audit: () => ({status:'success',summary:'审计记录',detail:'暂无'}),
  write_learning: a => ({status:'success',summary:'经验已记录'}),
}

const SCHEMAS = [
  {name:'read_file',description:'读取项目文件内容。已知路径直接读。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'list_directory',description:'列出项目目录。查看KB用kb_list，查看笔记用list_notes。',input_schema:{type:'object',properties:{path:{type:'string'},pattern:{type:'string'}},required:['path']}},
  {name:'search_content',description:'搜索文件内容。',input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']}},
  {name:'edit_file',description:'编辑文件。先read_file。old_string=__FULL_REPLACE__全量替换。',input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}},
  {name:'create_file',description:'创建文件。JSON自动校验——必须合法JSON，键用双引号，字符串内换行用\\\\n转义。',input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}},
  {name:'delete_file',description:'删除文件(不可恢复)。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'kb_list',description:'列出知识库所有文件。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'kb_create_file',description:'在知识库创建.md文件。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'list_notes',description:'列出全局笔记。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'read_note',description:'读取指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'write_note',description:'创建新笔记。新建=write_note，追加=append_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'append_note',description:'追加到已有笔记。新建请用write_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'delete_note',description:'删除笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'search_notes',description:'搜索笔记内容。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'create_style_template',description:'创建风格模板。直接调用。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_scene_template',description:'创建场景模板。直接调用。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_project',description:'创建新项目(含标准子目录)。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'delete_project',description:'删除项目(不可恢复)。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'list_prompts',description:'列出可用提示词。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'list_rules',description:'列出已学习规则。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'learn_rule',description:'学习新规则。',input_schema:{type:'object',properties:{rule:{type:'string'}},required:['rule']}},
  {name:'list_audit',description:'查看审计记录。',input_schema:{type:'object',properties:{},required:[]}},
  {name:'write_learning',description:'记录学习经验。',input_schema:{type:'object',properties:{summary:{type:'string'}},required:['summary']}},
]

const SYS = [
  '你是青剑AI写作助手。',
  '',
  '# 铁律：何时用工具，何时不用',
  '✅ 用工具（用户要求操作文件）:',
  '  触发词→读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)/搞(新文件)',
  '  例: "读林语晴"→read_file  "列角色"→list_directory  "创角色"→create_file',
  '',
  '❌ 不用工具（纯对话）:',
  '  触发词→我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议/怎么样/卡文/瓶颈/能不能(能力询问)/难道',
  '  例: "我喜欢玄幻"→直接聊  "什么是细纲"→直接答  "怎么写好角色"→直接建议',
  '',
  '# 规则',
  '- 一句话能回答的→不用工具',
  '- 对话/自我介绍/偏好/咨询/评价/感谢→不用工具',
  '- 不确定用户意图时→问清楚再操作',
  '- 用户说"不要操作"→绝对不调工具',
  '- 已知道文件什么路径→直接read_file，不list_directory',
  '- 多个独立操作→在同一轮尽可能并行完成',
  '- 读取→分析→修改→必须完整走完',
  '',
  '# 路径',
  '角色: 1/characters/中文名.json  章节: 1/chapters/chapterN.txt',
  '细纲: 1/detailed_outline/chapterN.json  大纲: 1/outline/plot.md',
  '摘要: 1/summaries/chapterN.md',
].join('\n')

async function callAnthropic(msgs) {
  const body = { model: 'deepseek-chat', system: [{ type: 'text', text: SYS }], messages: msgs, max_tokens: 2048, stream: true, tools: SCHEMAS }
  const res = await fetch(ANTHROPIC_URL, { method:'POST', headers:{'Content-Type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify(body) })
  const raw = await res.text()
  let ft=''; const tus=[]; const bs=[]
  for(const c of raw.split(/\n\n/)) {
    if(!c.trim()) continue; let d='', et=''
    for(const l of c.split('\n')) { if(l.startsWith('event:')) et=l.slice(6).trim(); else if(l.startsWith('data:')) d=l.slice(5).trim() }
    if(!d) continue
    try{const e=JSON.parse(d);const tp=et||e.type||'';if(tp==='content_block_start')bs.push({...e.content_block,index:e.index,inputJson:''});else if(tp==='content_block_delta'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(!b)continue;if(e.delta?.type==='text_delta'){b.text=(b.text||'')+e.delta.text;ft+=e.delta.text;}if(e.delta?.type==='input_json_delta'){b.inputJson=(b.inputJson||'')+e.delta.partial_json;try{b.input=JSON.parse(b.inputJson)}catch{}}}else if(tp==='content_block_stop'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(b?.type==='tool_use')tus.push({id:b.id,name:b.name,input:b.input||{}});}}catch{}
  }
  return {text:ft,toolUses:tus}
}

async function run(msg, maxIter=10) {
  const msgs=[{role:'user',content:[{type:'text',text:msg}]}]; let its=0, tts=0
  while(its<maxIter) {
    its++; const r=await callAnthropic(msgs)
    if(!r.toolUses.length) return {...r,iterations:its,toolCalls:tts}
    const ac=[]; if(r.text) ac.push({type:'text',text:r.text})
    for(const tu of r.toolUses) ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input})
    msgs.push({role:'assistant',content:ac})
    const trs=[]
    for(const tu of r.toolUses){const tf=tools[tu.name];const res=tf?await tf(tu.input):{status:'error',summary:'未知工具'};tts++;trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)});process.stdout.write(res.status==='success'?'✓':'✗')}
    msgs.push({role:'user',content:trs})
  }
  return {text:'',iterations:its,toolCalls:tts}
}

let pass=0, fail=0, warn=0
const failures=[], warnings=[]

function tc(num, label, check, detail='') {
  const icon = check===true?'✅':check===false?'❌':'⚠️'
  if(check===true)pass++; else if(check===false){fail++;failures.push({num,label,detail})} else {warn++;warnings.push({num,label,detail})}
  process.stdout.write(' '+icon)
}

function summary() {
  console.log('\n\n═══ 测试汇总 ═══')
  console.log('✅ '+pass+'  ❌ '+fail+'  ⚠️ '+warn+'  通过率:'+((pass/(pass+fail+warn||1))*100).toFixed(1)+'%')
  if(failures.length){console.log('\n❌ 失败:');failures.forEach(f=>console.log('  #'+f.num+' '+f.label+': '+f.detail))}
  if(warnings.length){console.log('\n⚠️ 警告:');warnings.forEach(w=>console.log('  #'+w.num+' '+w.label+': '+w.detail))}
}

// ═══════════════════════════════════════
console.log('═══════════════════════════════════════════')
console.log('  极限测试 — 测试方案4.md (55用例)')
console.log('═══════════════════════════════════════════\n')

// ── P1: 对话类误调工具 (25例) ──
console.log('┌─ P1: 对话类防误调 (25例) ─────────────┐')

console.log('│ 1.1 问候类')
const r1 = await run('你好'); tc(1,'你好',r1.toolCalls===0,r1.toolCalls+'工具')
const r2 = await run('早上好，今天天气不错'); tc(2,'早上好',r2.toolCalls===0,r2.toolCalls+'工具')
const r3 = await run('嗨，在吗'); tc(3,'嗨在吗',r3.toolCalls===0,r3.toolCalls+'工具')
const r4 = await run('好久不见'); tc(4,'好久不见',r4.toolCalls===0,r4.toolCalls+'工具')

console.log('\n│ 1.2 自我介绍/偏好类')
const r5 = await run('我叫张三'); tc(5,'自我介绍',r5.toolCalls===0,r5.toolCalls+'工具')
const r6 = await run('我是写都市小说的'); tc(6,'我是写XX的',r6.toolCalls===0,r6.toolCalls+'工具')
const r7 = await run('我喜欢写悬疑推理'); tc(7,'我喜欢',r7.toolCalls===0,r7.toolCalls+'工具')
const r8 = await run('我不太会用这个软件'); tc(8,'我不太会用',r8.toolCalls===0,r8.toolCalls+'工具')
const r9 = await run('我卡文了，写不下去'); tc(9,'卡文了',r9.toolCalls===0,r9.toolCalls+'工具')

console.log('\n│ 1.3 纯问题类')
const r10 = await run('什么是细纲'); tc(10,'什么是XX',r10.toolCalls===0,r10.toolCalls+'工具')
const r11 = await run('为什么我的大纲写不好'); tc(11,'为什么',r11.toolCalls===0,r11.toolCalls+'工具')
const r12 = await run('怎么写好一个角色'); tc(12,'怎么写',r12.toolCalls===0,r12.toolCalls+'工具')
const r13 = await run('你觉得我的第3章怎么样'); tc(13,'你觉得第3章',r13.toolCalls===0,r13.toolCalls+'工具')
const r14 = await run('写作遇到瓶颈怎么办'); tc(14,'瓶颈怎么办',r14.toolCalls===0,r14.toolCalls+'工具')

console.log('\n│ 1.4 感谢/确认类')
const r15 = await run('谢谢'); tc(15,'谢谢',r15.toolCalls===0,r15.toolCalls+'工具')
const r16 = await run('非常感谢你的帮助'); tc(16,'非常感谢',r16.toolCalls===0,r16.toolCalls+'工具')
const r17 = await run('好的，我知道了'); tc(17,'好的知道了',r17.toolCalls===0,r17.toolCalls+'工具')

console.log('\n│ 1.5 模糊边界（最危险）')
const r18 = await run('看看'); tc(18,'看看(模糊)',r18.toolCalls===0,r18.toolCalls+'工具'+'⚠')
const r19 = await run('帮我看看'); tc(19,'帮我看看(模糊)',r19.toolCalls===0,r19.toolCalls+'工具'+'⚠')
const r20 = await run('有什么建议'); tc(20,'有什么建议',r20.toolCalls===0,r20.toolCalls+'工具')
const r21 = await run('能不能帮我'); tc(21,'能不能帮我(模糊)',r21.toolCalls===0,r21.toolCalls+'工具'+'⚠')
const r22 = await run('怎么样'); tc(22,'怎么样(模糊)',r22.toolCalls===0,r22.toolCalls+'工具'+'⚠')

console.log('\n│ 1.6 中英/反问/否定')
const r23 = await run('你能read文件吗'); tc(23,'你能read文件吗',r23.toolCalls===0,r23.toolCalls+'工具')
const r24 = await run('难道不能直接告诉我吗'); tc(24,'反问',r24.toolCalls===0,r24.toolCalls+'工具')
const r25 = await run('我不需要你操作文件'); tc(25,'明确拒绝操作',r25.toolCalls===0,r25.toolCalls+'工具')

console.log('\n└─────────────────────────────────────────┘')

// ── P2: 复杂任务效率 (15例) ──
console.log('\n┌─ P2: 复杂任务效率 (15例) ──────────────┐')

console.log('│ 2.1 并行独立任务')
const r26 = await run('读 1/characters/林语晴.json，读 1/characters/张明.json，读 1/chapters/chapter1.txt'); tc(26,'并行读取',r26.toolCalls>=3&&r26.iterations<=4,r26.iterations+'轮'+r26.toolCalls+'工具')
const r27 = await run('列出项目1的characters目录，列出chapters目录，列出outline目录'); tc(27,'并行列目录',r27.toolCalls>=3&&r27.iterations<=4,r27.iterations+'轮'+r27.toolCalls+'工具')
const r28 = await run('创建笔记A:极限测试A(内容TestA)，创建笔记B:极限测试B(内容TestB)，创建笔记C:极限测试C(内容TestC)'); tc(28,'并行创建笔记',r28.toolCalls>=3&&r28.iterations<=4,r28.iterations+'轮'+r28.toolCalls+'工具')

console.log('\n│ 2.2 串行依赖链')
const r29 = await run('先读 1/characters/林语晴.json 了解格式，然后参考她的格式创建新角色苏菲：id=sufei, name=苏菲, role=女配, gender=女, age=20, occupation=学生, background=一个神秘的新角色, appearance=齐耳短发干练利落, personality=理性冷静, abilities=数据分析能力, weaknesses=情感表达困难, relationships=与林语晴是室友, relationshipTags=["室友"], arc=从旁观者到参与者, importance=75。保存到 1/characters/苏菲.json。最后再读确认。'); tc(29,'读→创建→确认',r29.toolCalls>=3&&r29.iterations<=6,r29.iterations+'轮'+r29.toolCalls+'工具')
const r30 = await run('读 1/chapters/chapter1.txt 分析文风，然后创建风格模板 name=极限测试风格 type=普通小说'); tc(30,'读→分析→模板',r30.toolCalls>=2&&r30.iterations<=5,r30.iterations+'轮'+r30.toolCalls+'工具')
const r31 = await run('读 1/outline/plot.md → 搜索"静止" → 把搜索结果写成分析笔记"极限测试分析" → 读笔记确认'); tc(31,'读→搜→写→确认',r31.toolCalls>=4&&r31.iterations<=7,r31.iterations+'轮'+r31.toolCalls+'工具')

console.log('\n│ 2.3 失败恢复')
const r32 = await run('读 1/characters/不存在角色.json，如果不存在就读 1/characters/林语晴.json'); tc(32,'读失败→读替代',r32.toolCalls>=2,r32.iterations+'轮'+r32.toolCalls+'工具')
const r33 = await run('创建 1/characters/极限测试.json，content=这不是合法JSON{broken，如果创建失败就修正为合法JSON再创建'); tc(33,'创建失败→修正',r33.toolCalls>=1,r33.iterations+'轮'+r33.toolCalls+'工具')

console.log('\n│ 2.4 批量操作')
const r34 = await run('列出知识库所有文件，列出所有笔记，列出所有提示词'); tc(34,'三类列表',r34.toolCalls>=3&&r34.iterations<=5,r34.iterations+'轮'+r34.toolCalls+'工具')
const r35 = await run('读 1/chapters/chapter1.txt 和 1/chapters/chapter3.txt，分别写摘要笔记'); tc(35,'读2章→写2摘要',r35.toolCalls>=4,r35.iterations+'轮'+r35.toolCalls+'工具')
const r36 = await run('读以下角色并各写一句话总结：1/characters/林语晴.json, 1/characters/张明.json, 1/characters/周婉婷.json, 1/characters/唐果果.json, 1/characters/夏薇.json'); tc(36,'5角色读+总结',r36.toolCalls>=5&&r36.iterations<=7,r36.iterations+'轮'+r36.toolCalls+'工具')

console.log('\n│ 2.5 极限混合')
const r37 = await run('读林语晴角色→创建她的个人细纲→读细纲确认→搜索"张明"→写分析笔记"极限混合测试"'); tc(37,'6步链',r37.toolCalls>=5&&r37.iterations<=9,r37.iterations+'轮'+r37.toolCalls+'工具')
const r38 = await run('列出角色+章节+大纲→选第一个角色读→选第一个章节读→创建总结笔记"极限总结"'); tc(38,'列→选→读→写',r38.toolCalls>=5&&r38.iterations<=7,r38.iterations+'轮'+r38.toolCalls+'工具')
const r39 = await run('读林语晴、张明、周婉婷的角色→分别创建风格模板和场景模板→写分析笔记'); tc(39,'读3角色→2模板→笔记',r39.toolCalls>=6&&r39.iterations<=10,r39.iterations+'轮'+r39.toolCalls+'工具')
const r40 = await run('创建项目test-stress→在项目中创建角色A: id=a, name=A, role=男配, gender=男, age=20, occupation=测试, background=测试, appearance=测试, personality=测试, abilities=测试, weaknesses=测试, relationships=无, relationshipTags=[], arc=测试, importance=50→创建角色B: id=b, name=B, role=女配, gender=女, age=20, occupation=测试, background=测试, appearance=测试, personality=测试, abilities=测试, weaknesses=测试, relationships=无, relationshipTags=[], arc=测试, importance=50→列出est-stress目录→删除项目'); tc(40,'项目全生命周期',r40.toolCalls>=5&&r40.iterations<=8,r40.iterations+'轮'+r40.toolCalls+'工具')

console.log('\n└─────────────────────────────────────────┘')

// ── P3: 工具触发边界 (15例) ──
console.log('\n┌─ P3: 工具触发边界 (15例) ──────────────┐')

console.log('│ 3.1 模糊动词')
const r41 = await run('看林语晴'); tc(41,'看→读',r41.toolCalls>=1,r41.iterations+'轮'+r41.toolCalls+'工具')
const r42 = await run('找一下第3章'); tc(42,'找→读',r42.toolCalls>=1,r42.iterations+'轮'+r42.toolCalls+'工具')
const r43 = await run('搞个新角色(极限临时角色)'); tc(43,'搞→创建',r43.toolCalls>=1,r43.iterations+'轮'+r43.toolCalls+'工具')
const r44 = await run('改一下测试角色，把background改成"这是极限测试修改的背景"'); tc(44,'改→编辑',r44.toolCalls>=2,r44.iterations+'轮'+r44.toolCalls+'工具')

console.log('\n│ 3.2 中英混合')
const r45 = await run('帮我read一下林语晴'); tc(45,'read→读',r45.toolCalls>=1,r45.iterations+'轮'+r45.toolCalls+'工具')
const r46 = await run('list所有的角色文件'); tc(46,'list→列',r46.toolCalls>=1,r46.iterations+'轮'+r46.toolCalls+'工具')
const r47 = await run('search一下张明'); tc(47,'search→搜索',r47.toolCalls>=1,r47.iterations+'轮'+r47.toolCalls+'工具')

console.log('\n│ 3.3 否定/反问')
const r48 = await run('不用列目录，直接读林语晴'); tc(48,'不用列→直接读',r48.toolCalls>=1&&!r48.steps?.some(s=>s.tool==='list_directory'),r48.iterations+'轮'+r48.toolCalls+'工具')
const r49 = await run('能不能帮我列出角色文件（如果你可以的话）'); tc(49,'能不能→列',r49.toolCalls>=1,r49.iterations+'轮'+r49.toolCalls+'工具')
const r50 = await run('我不是让你读文件，就是想问问'); tc(50,'明确说不要操作',r50.toolCalls===0,r50.toolCalls+'工具')

console.log('\n│ 3.4 间接请求')
const r51 = await run('林语晴的角色信息是什么'); tc(51,'间接→读',r51.toolCalls>=1,r51.iterations+'轮'+r51.toolCalls+'工具')
const r52 = await run('第3章讲了什么'); tc(52,'间接→读',r52.toolCalls>=1,r52.iterations+'轮'+r52.toolCalls+'工具')
const r53 = await run('项目里有几个角色'); tc(53,'间接→列',r53.toolCalls>=1,r53.iterations+'轮'+r53.toolCalls+'工具')
const r54 = await run('把第1章前200字给我看看'); tc(54,'间接→读',r54.toolCalls>=1,r54.iterations+'轮'+r54.toolCalls+'工具')
const r55 = await run('想知道大纲里写了什么'); tc(55,'间接→读',r55.toolCalls>=1,r55.iterations+'轮'+r55.toolCalls+'工具')

console.log('\n└─────────────────────────────────────────┘')

summary()

// 清理
try{fs.unlinkSync(N('极限测试A.md'));fs.unlinkSync(N('极限测试B.md'));fs.unlinkSync(N('极限测试C.md'));fs.unlinkSync(N('极限混合测试.md'));fs.unlinkSync(N('极限总结.md'));fs.unlinkSync(P('1/characters/苏菲.json'));}catch{}
try{fs.rmSync(P('test-stress'),{recursive:true,force:true});}catch{}
try{fs.unlinkSync(K('极限测试角色要点.md'));}catch{}
