#!/usr/bin/env node
/**
 * 测试方案5 — Anthropic 协议全面测试
 * 使用修复后的系统提示词 + 完整25工具 + 流式 content blocks
 */
import * as fs from 'node:fs'; import * as path from 'node:path';
const API_KEY=process.env.AI_API_KEY||'sk-your-key-here';const ANTHROPIC_URL='https://api.deepseek.com/anthropic/v1/messages';
const ROOT=process.cwd();const P=p=>path.join(ROOT,'projects',p);const N=p=>path.join(ROOT,'notes',p);
const K=p=>path.join(ROOT,'knowledge_base/files',p);const ST=p=>path.join(ROOT,'style_templates',p);const SC=p=>path.join(ROOT,'scene_templates',p);

const tools={
  read_file:a=>{try{return{status:'success',summary:'读取'+(a.file_path||a.path),detail:fs.readFileSync(P(a.file_path||a.path),'utf-8').slice(0,2000)}}catch{return{status:'error',summary:'文件不存在'}}},
  list_directory:a=>{try{return{status:'success',summary:'列出'+(a.path||'.'),detail:fs.readdirSync(P(a.path||'.'),{withFileTypes:true}).map(x=>(x.isDirectory()?'DIR':'FILE')+' '+x.name).join('\n')}}catch{return{status:'error',summary:'目录不存在'}}},
  search_content:a=>{try{const re=new RegExp((a.pattern||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');const fp=P(a.path||'.');const c=fs.readFileSync(fp,'utf-8');const r=c.split('\n').map((l,i)=>re.test(l)?(i+1)+':'+l.slice(0,200):null).filter(Boolean);return{status:'success',summary:r.length+'个匹配',detail:r.slice(0,10).join('\n')}}catch{return{status:'error',summary:'搜索失败'}}},
  edit_file:a=>{try{const fp=P(a.file_path);let c=fs.readFileSync(fp,'utf-8');const o=a.old_string||'';const n=a.new_string||'';if(o==='__FULL_REPLACE__'){fs.writeFileSync(fp,n);return{status:'success',summary:'全量替换'}}let i=c.indexOf(o);if(i<0)i=c.indexOf(o.trim());if(i<0)return{status:'error',summary:'未找到匹配'};fs.writeFileSync(fp,c.slice(0,i)+n+c.slice(i+o.length));return{status:'success',summary:'编辑成功'}}catch{return{status:'error',summary:'编辑失败'}}},
  create_file:a=>{try{const fp=P(a.file_path);const c=a.content||'';if(fp.endsWith('.json')&&c)try{JSON.parse(c)}catch(e){return{status:'error',summary:'JSON格式错误: '+e.message}};fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,c);return{status:'success',summary:'创建成功'}}catch{return{status:'error',summary:'创建失败'}}},
  delete_file:a=>{try{fs.unlinkSync(P(a.file_path));return{status:'success',summary:'删除成功'}}catch{return{status:'error',summary:'删除失败'}}},
  rename_file:a=>{try{fs.renameSync(P(a.path||a.file_path),P(a.new_path));return{status:'success',summary:'重命名成功'}}catch{return{status:'error',summary:'重命名失败'}}},
  kb_list:()=>{try{return{status:'success',summary:'KB列表',detail:fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无'}}catch{return{status:'success',summary:'KB为空'}}},
  kb_create_file:a=>{try{fs.mkdirSync(K(''),{recursive:true});fs.writeFileSync(K((a.name||'x')+'.md'),a.content||'');return{status:'success',summary:'KB创建成功'}}catch{return{status:'error',summary:'KB创建失败'}}},
  kb_append_file:a=>{try{const fp=K((a.name||'x')+'.md');if(!fs.existsSync(fp))return{status:'error',summary:'KB文件不存在'};fs.appendFileSync(fp,'\n'+(a.content||''));return{status:'success',summary:'KB追加成功'}}catch{return{status:'error',summary:'KB追加失败'}}},
  list_notes:()=>{try{fs.mkdirSync(N(''),{recursive:true});return{status:'success',summary:'笔记列表',detail:fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无'}}catch{return{status:'success',summary:'无笔记'}}},
  read_note:a=>{try{return{status:'success',summary:'读取笔记',detail:fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500)}}catch{return{status:'error',summary:'笔记不存在'}}},
  write_note:a=>{try{fs.mkdirSync(N(''),{recursive:true});fs.writeFileSync(N((a.name||'x')+'.md'),a.content||'');return{status:'success',summary:'笔记创建成功'}}catch{return{status:'error',summary:'笔记创建失败'}}},
  append_note:a=>{try{const fp=N((a.name||'x')+'.md');if(!fs.existsSync(fp))return{status:'error',summary:'笔记不存在'};fs.appendFileSync(fp,'\n'+(a.content||''));return{status:'success',summary:'笔记追加成功'}}catch{return{status:'error',summary:'笔记追加失败'}}},
  delete_note:a=>{try{fs.unlinkSync(N((a.name||'x')+'.md'));return{status:'success',summary:'笔记删除成功'}}catch{return{status:'error',summary:'笔记删除失败'}}},
  search_notes:a=>{try{fs.mkdirSync(N(''),{recursive:true});const ms=[];for(const f of fs.readdirSync(N('')).filter(f=>f.endsWith('.md'))){if(fs.readFileSync(N(f),'utf-8').includes(a.query||''))ms.push(f)};return{status:'success',summary:ms.length+'条匹配',detail:ms.join('\n')}}catch{return{status:'success',summary:'搜索完成'}}},
  create_style_template:a=>{try{fs.mkdirSync(ST(''),{recursive:true});fs.writeFileSync(ST((a.name||'x')+'.json'),JSON.stringify(a,null,2));return{status:'success',summary:'风格模板创建成功'}}catch{return{status:'error',summary:'模板创建失败'}}},
  create_scene_template:a=>{try{fs.mkdirSync(SC(''),{recursive:true});fs.writeFileSync(SC((a.name||'x')+'.json'),JSON.stringify(a,null,2));return{status:'success',summary:'场景模板创建成功'}}catch{return{status:'error',summary:'场景创建失败'}}},
  create_project:a=>{try{const d=P(a.name);['characters','chapters','outline','detailed_outline','summaries'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true}));return{status:'success',summary:'项目创建成功'}}catch{return{status:'error',summary:'项目创建失败'}}},
  delete_project:a=>{try{fs.rmSync(P(a.name),{recursive:true,force:true});return{status:'success',summary:'项目删除成功'}}catch{return{status:'error',summary:'项目删除失败'}}},
  list_prompts:()=>({status:'success',summary:'提示词列表',detail:'灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿'}),
  list_rules:()=>({status:'success',summary:'已学习规则',detail:'暂无'}),
  learn_rule:a=>({status:'success',summary:'规则已学习: '+(a.rule||'').slice(0,50)}),
  list_audit:()=>({status:'success',summary:'审计记录',detail:'暂无'}),
  write_learning:a=>({status:'success',summary:'经验已记录'}),
};

const SCHEMAS=[
  {name:'read_file',description:'读取项目文件内容。已知路径直接读。修改文件前必须先read_file确认原文。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'list_directory',description:'列出项目目录。查看KB用kb_list，查看笔记用list_notes。',input_schema:{type:'object',properties:{path:{type:'string'},pattern:{type:'string'}},required:['path']}},
  {name:'search_content',description:'搜索文件内容。支持正则+上下文行。',input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']}},
  {name:'edit_file',description:'编辑文件。old_string必须精确匹配原文。__FULL_REPLACE__全量替换。',input_schema:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}},
  {name:'create_file',description:'创建文件。JSON自动校验。先read_file参考已有格式。',input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}},
  {name:'delete_file',description:'删除文件(不可恢复)。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'rename_file',description:'重命名/移动文件。',input_schema:{type:'object',properties:{path:{type:'string'},new_path:{type:'string'}},required:['path','new_path']}},
  {name:'kb_list',description:'列出知识库所有文件。',input_schema:{type:'object',properties:{}}},
  {name:'kb_create_file',description:'在知识库创建.md文件。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'kb_append_file',description:'追加到已有KB文件。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'list_notes',description:'列出全局笔记。',input_schema:{type:'object',properties:{}}},
  {name:'read_note',description:'读取指定笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'write_note',description:'创建新笔记。新笔记用write_note，追加用append_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'append_note',description:'追加到已有笔记。新笔记请用write_note。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'delete_note',description:'删除笔记。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'search_notes',description:'搜索笔记内容。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'create_style_template',description:'创建风格模板。调用前确认小说类型。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_scene_template',description:'创建场景模板。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
  {name:'create_project',description:'创建新项目(含标准子目录)。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'delete_project',description:'删除项目(不可恢复)。',input_schema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
  {name:'list_prompts',description:'列出可用提示词模板。',input_schema:{type:'object',properties:{}}},
  {name:'list_rules',description:'列出已学习规则。',input_schema:{type:'object',properties:{}}},
  {name:'learn_rule',description:'学习新规则。',input_schema:{type:'object',properties:{rule:{type:'string'}},required:['rule']}},
  {name:'list_audit',description:'查看操作审计记录。',input_schema:{type:'object',properties:{}}},
  {name:'write_learning',description:'记录学习经验。',input_schema:{type:'object',properties:{summary:{type:'string'}},required:['summary']}},
];

const SYS=`你是"青剑"，AI小说创作助手。

# 铁律
- 操作文件必须调function call，口头描述≠完成。禁止文本模拟工具调用。

# 不用工具的场景（直接文本回复）
以下情况不要调任何工具：
- 问候/闲聊/自我介绍/偏好/询问/建议/评价/模糊请求
- "看看""帮我看看""怎么样""能不能帮我"
- 模糊指令时先问清楚再操作

# 工具选择（仅在用户明确要求操作文件时）
- 已知路径→read_file  不确定→list_directory
- 修改→先read_file再edit_file  创建→先read_file参考再create_file
- 搜索→search_content  KB→kb_list/kb_create_file/kb_append_file
- 笔记→list_notes/write_note(新建)/append_note(追加)/read_note/delete_note/search_notes
- 模板→create_style_template/create_scene_template
- 项目→create_project/delete_project
- 规则→list_rules/learn_rule/list_audit/write_learning

# 文件路径
角色:1/characters/中文名.yaml 章节:1/chapters/chapterN.txt
细纲:1/detailed_outline/chapterN.yaml 大纲:1/outline/plot.md`;

async function callAnthropic(sys,msgs,tds){
  const body={model:'deepseek-chat',system:[{type:'text',text:sys}],messages:msgs,max_tokens:2048,stream:true};
  if(tds?.length)body.tools=tds.map(t=>({name:t.name,description:t.description,input_schema:t.input_schema}));
  const r=await fetch(ANTHROPIC_URL,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
  return parseSSE(await r.text());
}
function parseSSE(text){let ft='';const tus=[];const bs=[];for(const c of text.split(/\n\n/)){if(!c.trim())continue;let d='',et='';for(const l of c.split('\n')){if(l.startsWith('event:'))et=l.slice(6).trim();else if(l.startsWith('data:'))d=l.slice(5).trim()}if(!d)continue;try{const e=JSON.parse(d);const t=et||e.type||'';if(t==='content_block_start')bs.push({...e.content_block,index:e.index,inputJson:''});else if(t==='content_block_delta'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(!b)continue;if(e.delta?.type==='text_delta'){b.text=(b.text||'')+e.delta.text;ft+=e.delta.text}if(e.delta?.type==='input_json_delta'){b.inputJson=(b.inputJson||'')+e.delta.partial_json;try{b.input=JSON.parse(b.inputJson)}catch{}}}else if(t==='content_block_stop'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(b?.type==='tool_use')tus.push({id:b.id,name:b.name,input:b.input||{}})}}catch{}}return{text:ft,toolUses:tus}}
async function run(msg){const ms=[{role:'user',content:[{type:'text',text:msg}]}];let it=0,tt=0;while(it<12){it++;const r=await callAnthropic(SYS,ms,SCHEMAS);if(!r.toolUses.length)return{...r,iterations:it,toolCalls:tt};const ac=[];if(r.text)ac.push({type:'text',text:r.text});for(const tu of r.toolUses)ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input});ms.push({role:'assistant',content:ac});const trs=[];for(const tu of r.toolUses){const tf=tools[tu.name];const res=tf?await tf(tu.input):{status:'error',summary:'未知工具'};tt++;trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)});process.stdout.write(res.status==='success'?'✓':'✗')}ms.push({role:'user',content:trs})}return{text:'',iterations:it,toolCalls:tt}}

let pass=0,fail=0;function t(n,c,d){if(c){pass++;console.log('  ✅ '+n+(d?': '+d:''))}else{fail++;console.log('  ❌ '+n+(d?': '+d:''))}}

console.log('═══════════════════════════════════════════');
console.log('  测试方案5 — Anthropic协议全面测试');
console.log('═══════════════════════════════════════════\n');

// ═══ 文件操作 ═══
console.log('┌─ 文件操作 ──────────────────────────────┐');
const f1=await run('读 1/characters/林语晴.yaml'); t('S1-1 读角色',f1.toolCalls>=1,f1.iterations+'轮');
const f2=await run('列出项目1的characters目录'); t('S1-2 列目录',f2.toolCalls>=1,f2.iterations+'轮');
const f3=await run('搜索项目1中"静止"的出现'); t('S1-3 搜索',f3.toolCalls>=1,f3.iterations+'轮');
const f4=await run('读 1/characters/测试角色.yaml，把description改成"Anthropic全面测试"（用edit_file, old_string=__FULL_REPLACE__）'); t('S1-4 读→改',f4.toolCalls>=2,f4.iterations+'轮 '+f4.toolCalls+'工具');
const f5=await run('创建文件 1/test-anth-probe.txt，内容"Anthropic测试探针"。用read_file验证内容。用delete_file删除它。'); t('S1-5 创→读→删',f5.toolCalls>=3,f5.iterations+'轮 '+f5.toolCalls+'工具');
console.log('└─────────────────────────────────────────┘');

// ═══ 知识库 ═══
console.log('\n┌─ 知识库 ────────────────────────────────┐');
const kb1=await run('列出知识库所有文件'); t('S2-1 KB列表',kb1.toolCalls>=1,kb1.iterations+'轮');
const kb2=await run('创建KB文件"Anthropic综合测试"，内容"综合测试-林语晴性格温柔坚强"'); t('S2-2 KB创建',kb2.toolCalls>=1,kb2.iterations+'轮');
const kb3=await run('追加内容到KB文件"Anthropic综合测试"：补充信息-年龄19岁'); t('S2-3 KB追加',kb3.toolCalls>=1,kb3.iterations+'轮 '+kb3.toolCalls+'工具');
console.log('└─────────────────────────────────────────┘');

// ═══ 笔记 ═══
console.log('\n┌─ 笔记全流程 ────────────────────────────┐');
const n1=await run('列所有笔记'),n2=await run('写笔记"综合测试笔记"内容"Anthropic测试"'),n3=await run('读笔记"综合测试笔记"'),
      n4=await run('追加到笔记"综合测试笔记"：补充内容'),n5=await run('搜索笔记"测试"'),n6=await run('删除笔记"综合测试笔记"');
t('S3 笔记6步',n1.toolCalls>=1&&n2.toolCalls>=1&&n3.toolCalls>=1&&n4.toolCalls>=1&&n5.toolCalls>=1&&n6.toolCalls>=1,
  '列:'+n1.toolCalls+'写:'+n2.toolCalls+'读:'+n3.toolCalls+'追:'+n4.toolCalls+'搜:'+n5.toolCalls+'删:'+n6.toolCalls);
console.log('└─────────────────────────────────────────┘');

// ═══ 模板+项目+Harness ═══
console.log('\n┌─ 模板/项目/Harness ─────────────────────┐');
const tm1=await run('创建风格模板 name=Anthropic综合测试 type=普通小说'); t('S4-1 风格模板',tm1.toolCalls>=1,tm1.iterations+'轮');
const tm2=await run('创建场景模板 name=Anthropic综合场景 type=武侠小说'); t('S4-2 场景模板',tm2.toolCalls>=1,tm2.iterations+'轮');
const pj1=await run('创建项目test-anth-comprehensive'); t('S4-3 创建项目',pj1.toolCalls>=1,pj1.iterations+'轮');
const pj2=await run('删除项目test-anth-comprehensive'); t('S4-4 删除项目',pj2.toolCalls>=1,pj2.iterations+'轮 '+pj2.toolCalls+'工具');
const hr1=await run('列出已学习规则'),hr2=await run('学习规则：角色importance范围0到100'),hr3=await run('查看审计记录'),hr4=await run('列出可用提示词');
t('S4-5 Harness4步',hr1.toolCalls>=1&&hr2.toolCalls>=1&&hr3.toolCalls>=1&&hr4.toolCalls>=1,
  '规则:'+hr1.toolCalls+'学习:'+hr2.toolCalls+'审计:'+hr3.toolCalls+'提示词:'+hr4.toolCalls);
console.log('└─────────────────────────────────────────┘');

// ═══ 对话防误调（关键） ═══
console.log('\n┌─ 对话防误调 ────────────────────────────┐');
const c1=await run('你好'),c2=await run('我是张伟，写玄幻的'),c3=await run('谢谢'),c4=await run('怎么写好角色'),c5=await run('帮我看看'),c6=await run('卡文了怎么办');
const chatAll=c1.toolCalls===0&&c2.toolCalls===0&&c3.toolCalls===0&&c4.toolCalls===0&&c5.toolCalls===0&&c6.toolCalls===0;
t('S5 对话6例0工具',chatAll,'好:'+c1.toolCalls+'介:'+c2.toolCalls+'谢:'+c3.toolCalls+'怎:'+c4.toolCalls+'看:'+c5.toolCalls+'卡:'+c6.toolCalls);
console.log('└─────────────────────────────────────────┘');

// ═══ 复杂编排 ═══
console.log('\n┌─ 复杂编排 ──────────────────────────────┐');
const cx1=await run('先列项目1的characters目录，然后读第一个角色，最后写分析笔记"Anthropic编排测试"'); t('S6-1 列→读→写',cx1.toolCalls>=3,cx1.iterations+'轮 '+cx1.toolCalls+'工具');
const cx2=await run('读 1/characters/林语晴.yaml 参考格式，创建角色"Anthropic测试角色"：id=anth_test, name=Anthropic测试角色, role=男配, gender=男, age=25, occupation=测试, background=这是Anthropic协议综合测试角色, appearance=测试, personality=测试, abilities=测试, weaknesses=测试, relationships=无, relationshipTags=["测试"], arc=测试, importance=50。保存到 1/characters/Anthropic测试角色.yaml'); t('S6-2 读→创角色',cx2.toolCalls>=2,cx2.iterations+'轮 '+cx2.toolCalls+'工具');
const cx3=await run('读 1/outline/plot.md 了解剧情→搜索"静止"→写分析笔记"Anthropic剧情分析"'); t('S6-3 读→搜→写',cx3.toolCalls>=3,cx3.iterations+'轮 '+cx3.toolCalls+'工具');
console.log('└─────────────────────────────────────────┘');

// ═══ 错误恢复 ═══
console.log('\n┌─ 错误恢复 ──────────────────────────────┐');
const er1=await run('读 1/characters/不存在角色.yaml，如果不存在就读 1/characters/林语晴.yaml'); t('S7-1 读失败→替代',er1.toolCalls>=2,er1.iterations+'轮 '+er1.toolCalls+'工具');
const er2=await run('创建 1/characters/无效测试.yaml，content=这不是合法JSON{broken'); t('S7-2 JSON校验失败',er2.toolCalls>=1,er2.iterations+'轮 '+er2.toolCalls+'工具');
console.log('└─────────────────────────────────────────┘');

// ═══ 边界 ═══
console.log('\n┌─ 边界情况 ──────────────────────────────┐');
const b1=await run('看林语晴角色'); t('S8-1 看→读',b1.toolCalls>=1,b1.iterations+'轮 '+b1.toolCalls+'工具');
const b2=await run('不用列目录直接读 1/characters/林语晴.yaml'); t('S8-2 否定语义',b2.toolCalls>=1,b2.iterations+'轮 '+b2.toolCalls+'工具');
const b3=await run('林语晴角色信息是什么'); t('S8-3 间接→读',b3.toolCalls>=1,b3.iterations+'轮 '+b3.toolCalls+'工具');
const b4=await run('项目里有几个角色'); t('S8-4 间接→列',b4.toolCalls>=1,b4.iterations+'轮 '+b4.toolCalls+'工具');
console.log('└─────────────────────────────────────────┘');

const tt=pass+fail;
console.log('\n═══════════════════════════════════════════');
console.log('  Anthropic协议 测试结果');
console.log('═══════════════════════════════════════════');
console.log('  ✅ '+pass+'  ❌ '+fail+'  通过率: '+((pass/tt)*100).toFixed(1)+'%');

// 清理
try{fs.unlinkSync(P('1/characters/Anthropic测试角色.yaml'))}catch{}
try{fs.unlinkSync(N('Anthropic编排测试.md'))}catch{}
try{fs.unlinkSync(N('Anthropic剧情分析.md'))}catch{}
