#!/usr/bin/env node
import * as fs from 'node:fs'; import * as path from 'node:path';
const API_KEY=process.env.AI_API_KEY||'sk-your-key-here';const URL='https://api.deepseek.com/v1/chat/completions';
const P=p=>path.join(process.cwd(),'projects',p);const N=p=>path.join(process.cwd(),'notes',p);
const tools={read_file:a=>{try{return fs.readFileSync(P(a.file_path),'utf-8')}catch{return'[不存在]'}},list_directory:a=>{try{return fs.readdirSync(P(a.path),{withFileTypes:true}).map(x=>(x.isDirectory()?'DIR':'FILE')+' '+x.name).join('\n')}catch{return'[不存在]'}},edit_file:a=>{try{const fp=P(a.file_path);let c=fs.readFileSync(fp,'utf-8');const o=a.old_string||'';const n=a.new_string||'';if(o==='__FULL_REPLACE__'){fs.writeFileSync(fp,n);return'替换成功'}let i=c.indexOf(o);if(i<0)i=c.indexOf(o.trim());if(i<0)return'[未找到]';fs.writeFileSync(fp,c.slice(0,i)+n+c.slice(i+o.length));return'编辑成功'}catch{return'[错误]'}},create_file:a=>{try{const fp=P(a.file_path);fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,a.content||'');return'创建成功'}catch{return'[错误]'}},delete_project:a=>{try{fs.rmSync(P(a.name),{recursive:true,force:true});return'删除成功'}catch{return'[错误]'}},write_note:a=>{try{fs.mkdirSync(N(''),{recursive:true});fs.writeFileSync(N((a.name||'x')+'.md'),a.content||'');return'创建成功'}catch{return'[错误]'}}};
const REAL_TOOLS=[{type:'function',function:{name:'read_file',description:'读取项目文件',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}},{type:'function',function:{name:'list_directory',description:'列出项目目录',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}},{type:'function',function:{name:'edit_file',description:'编辑文件。先read_file。',parameters:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}}},{type:'function',function:{name:'create_file',description:'创建文件',parameters:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}}},{type:'function',function:{name:'delete_project',description:'删除项目',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},{type:'function',function:{name:'write_note',description:'创建笔记',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}}];
const SYS=`你是青剑AI写作助手。

# 铁律
- 操作文件必须调function call，口头描述≠完成
- 禁止文本模拟工具调用

# 不用工具的场景（直接文本回复）
以下情况绝对不要调用任何工具：
- 问候/闲聊/自我介绍/偏好/询问/建议/评价/模糊请求
- "看看""帮我看看""怎么样""能不能帮我"
- 模糊指令时先问清楚再操作

# 工具选择
仅在用户明确要求操作文件时才调工具：
- 已知路径→read_file 不确定→list_directory
- 修改→先read_file再edit_file
- 创建→先read_file参考再create_file`;

async function call(msgs){const body={model:'deepseek-chat',messages:msgs,max_tokens:1024,tools:REAL_TOOLS,tool_choice:'auto'};const r=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},body:JSON.stringify(body)});const j=await r.json();const c=j.choices[0];return{text:c.message?.content||'',toolCalls:c.message?.tool_calls||[]}}
async function run(msg){const ms=[{role:'system',content:SYS},{role:'user',content:msg}];let it=0,tt=0;while(it<8){it++;const r=await call(ms);if(!r.toolCalls.length)return{iterations:it,toolCalls:tt};ms.push({role:'assistant',content:r.text||null,tool_calls:r.toolCalls});for(const tc of r.toolCalls){const fn=tools[tc.function.name];let a={};try{a=JSON.parse(tc.function.arguments)}catch{};const res=fn?await fn(a):'[未知]';tt++;ms.push({role:'tool',tool_call_id:tc.id,content:res});process.stdout.write(res.startsWith&&res.startsWith('[')?'✗':'✓')}}return{iterations:it,toolCalls:tt}}

console.log('═══ 修复后回归测试 ═══\n');
let pass=0,fail=0;
function t(n,c,d){if(c){pass++;console.log('  ✅ '+n+(d?': '+d:''))}else{fail++;console.log('  ❌ '+n+(d?': '+d:''))}}

// FAIL-1: 对话
console.log('▶ FAIL-1: "我是张伟，写玄幻小说的" (之前3工具)');
const f1=await run('我是张伟，写玄幻小说的');
t('FAIL-1 对话0工具',f1.toolCalls===0,f1.iterations+'轮 '+f1.toolCalls+'工具');

// FAIL-2: 模糊
console.log('\n▶ FAIL-2: "帮我看看" (之前13工具)');
const f2=await run('帮我看看');
t('FAIL-2 模糊0工具',f2.toolCalls===0,f2.iterations+'轮 '+f2.toolCalls+'工具');

// FAIL-3: 删除
console.log('\n▶ FAIL-3: 删除项目 (之前0工具)');
const f3=await run('删除项目test-real-demo');
t('FAIL-3 删除项目',f3.toolCalls>=1,f3.iterations+'轮 '+f3.toolCalls+'工具');

// FAIL-4: 读→改
console.log('\n▶ FAIL-4: 读→改细纲 (之前只读不改)');
const f4=await run('读 1/detailed_outline/chapter3.json，把status改成completed。先read_file然后edit_file用__FULL_REPLACE__');
t('FAIL-4 读→改',f4.toolCalls>=2,f4.iterations+'轮 '+f4.toolCalls+'工具');

// 对话防误调系列
console.log('\n▶ 对话防误调系列');
const a1=await run('你好');const a2=await run('谢谢你的帮助');const a3=await run('写作卡文了怎么办');
const cAll=a1.toolCalls===0&&a2.toolCalls===0&&a3.toolCalls===0;
t('对话3例0工具','你好:'+a1.toolCalls+' 谢谢:'+a2.toolCalls+' 卡文:'+a3.toolCalls,cAll);

console.log('\n═══ 结果: ✅'+pass+' ❌'+fail+' ═══');
