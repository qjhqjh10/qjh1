#!/usr/bin/env node
import * as fs from 'node:fs'; import * as path from 'node:path';
const K=process.env.AI_API_KEY||'sk-your-key-here';const AU='https://api.deepseek.com/anthropic/v1/messages';

// Test: stronger "don't use tools" language for Anthropic protocol
const SYS=`你是青剑AI写作助手。

# 什么时候用工具
以下操作必须调用对应的function：
- 读/看/查看文件 → read_file（已知路径直接用，不列目录）
- 列出/查看目录 → list_directory
- 搜索/找内容 → search_content
- 编辑/修改 → edit_file（先read_file再改）
- 创建/新建 → create_file
- 删除 → delete_file

# 什么时候不用工具
以下情况直接文本回复，不要调任何工具：
- 问候、闲聊、自我介绍、偏好表达（如"你好""我是XX""我喜欢XX"）
- 提问咨询（如"什么是XX""怎么写XX""怎么办"）
- 模糊请求无明确文件路径（如"看看""帮我看看""怎么样"）

# 文件路径
角色:1/characters/中文名.json 章节:1/chapters/chapterN.txt 大纲:1/outline/plot.md`;

const SCHEMAS=[{name:'read_file',description:'读取文件',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},{name:'list_directory',description:'列目录',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}},{name:'search_content',description:'搜索',input_schema:{type:'object',properties:{pattern:{type:'string'}},required:['pattern']}}];
const P=p=>path.join(process.cwd(),'projects',p);
const tools={read_file:a=>{try{return{status:'success',summary:'读取'}}catch{return{status:'error'}}},list_directory:a=>{try{return{status:'success',summary:'列出'}}catch{return{status:'error'}}},search_content:a=>({status:'success',summary:'搜索完成'})};

async function callA(sys,msg){
  const body={model:'deepseek-chat',system:[{type:'text',text:sys}],messages:[{role:'user',content:[{type:'text',text:msg}]}],max_tokens:1024,stream:true,tools:SCHEMAS};
  const r=await fetch(AU,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':K,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
  const raw=await r.text();let ft='';const tus=[];const bs=[];
  for(const c of raw.split(/\n\n/)){if(!c.trim())continue;let d='',et='';for(const l of c.split('\n')){if(l.startsWith('event:'))et=l.slice(6).trim();else if(l.startsWith('data:'))d=l.slice(5).trim()}if(!d)continue;try{const e=JSON.parse(d);const t=et||e.type||'';if(t==='content_block_start')bs.push({...e.content_block,index:e.index,inputJson:''});else if(t==='content_block_delta'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(!b)continue;if(e.delta?.type==='text_delta'){b.text=(b.text||'')+e.delta.text;ft+=e.delta.text}if(e.delta?.type==='input_json_delta'){b.inputJson=(b.inputJson||'')+e.delta.partial_json;try{b.input=JSON.parse(b.inputJson)}catch{}}}else if(t==='content_block_stop'){const b=bs.find(b=>b.index===(e.index??bs.length-1));if(b?.type==='tool_use')tus.push({id:b.id,name:b.name,input:b.input||{}})}}catch{}}return{text:ft,toolUses:tus}}
async function run(msg){let it=0,tt=0;const ms=[{role:'user',content:[{type:'text',text:msg}]}];while(it<8){it++;const r=await callA(SYS,ms);if(!r.toolUses.length)return{iterations:it,toolCalls:tt};const ac=[];if(r.text)ac.push({type:'text',text:r.text});for(const tu of r.toolUses)ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input});ms.push({role:'assistant',content:ac});const trs=[];for(const tu of r.toolUses){const tf=tools[tu.name];const res=tf?await tf(tu.input):{status:'error'};tt++;trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)})}ms.push({role:'user',content:trs})}return{iterations:it,toolCalls:tt}}

console.log('═══ 强化"不用工具"规则测试(Anthropic) ═══\n');

const t1=await run('我是张伟，写玄幻的');
console.log('"我是张伟"-> '+t1.toolCalls+'工具 '+(t1.toolCalls===0?'✅':'❌'));

const t2=await run('怎么写好角色');
console.log('"怎么写好角色"-> '+t2.toolCalls+'工具 '+(t2.toolCalls===0?'✅':'❌'));

const t3=await run('帮我看看');
console.log('"帮我看看"-> '+t3.toolCalls+'工具 '+(t3.toolCalls===0?'✅':'❌'));

const t4=await run('读 1/characters/林语晴.json');
console.log('"读林语晴"-> '+t4.toolCalls+'工具 '+(t4.toolCalls>=1?'✅':'❌'));
