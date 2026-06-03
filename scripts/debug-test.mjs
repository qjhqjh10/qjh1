#!/usr/bin/env node
import * as fs from 'node:fs'; import * as path from 'node:path';
const K=process.env.AI_API_KEY||'sk-your-key-here';const AU='https://api.deepseek.com/anthropic/v1/messages';

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

async function debug(msg){
  const body={model:'deepseek-chat',system:[{type:'text',text:SYS}],messages:[{role:'user',content:[{type:'text',text:msg}]}],max_tokens:1024,stream:true,tools:SCHEMAS};
  const r=await fetch(AU,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':K,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
  const raw=await r.text();let ft='';const tus=[];
  for(const c of raw.split(/\n\n/)){if(!c.trim())continue;let d='',et='';for(const l of c.split('\n')){if(l.startsWith('event:'))et=l.slice(6).trim();else if(l.startsWith('data:'))d=l.slice(5).trim()}if(!d)continue;try{const e=JSON.parse(d);const t=et||e.type||'';if(t==='content_block_delta'){if(e.delta?.type==='text_delta')ft+=e.delta.text}if(t==='content_block_start'){if(e.content_block?.type==='tool_use')tus.push({name:e.content_block.name})}}catch{}}
  console.log('工具:',tus.map(t=>t.name).join(',')||'无');
  console.log('文本:',ft.slice(0,200));
}

console.log('═══ 调试 Anthropic 模型行为 ═══\n');
await debug('读 1/characters/林语晴.json');
console.log('---');
await debug('读取项目1的林语晴角色');
console.log('---');
await debug('read_file 1/characters/林语晴.json');
