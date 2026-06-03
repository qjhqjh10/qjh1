#!/usr/bin/env node
import * as path from 'node:path'
import * as fs from 'node:fs'
const K=process.env.AI_API_KEY||'sk-your-key-here',P=path.join(path.resolve('.'),'projects','1')
function exec(n,a){try{switch(n){case'read_file':{const f=path.join(P,a.file_path||'');if(!fs.existsSync(f))return{status:'error',summary:'ENOENT'};return{status:'success',summary:'ok',detail:fs.readFileSync(f,'utf-8').slice(0,3000)}}case'list_directory':{return{status:'success',summary:'ok',detail:fs.readdirSync(path.join(P,a.dir_path||'.')).join('\n')}}default:return{status:'error'}}}catch(e){return{status:'error',summary:e.message}}}
const T=[{type:'function',function:{name:'read_file',description:'读取文件'}},{type:'function',function:{name:'list_directory',description:'列出目录'}}]
const chars=fs.readdirSync(path.join(P,'characters')).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''))
const S='你是"青剑"。项目角色:'+chars.join(',')+'。上下文已有=不重读。首次查看可读。讨论用上下文。新话题可读新文件。'

async function chat(msgs){const r=await fetch('https://api.deepseek.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+K},body:JSON.stringify({model:'deepseek-v4-flash',messages:msgs,tools:T,temperature:0.7,max_tokens:1024})});const d=await r.json();if(d.error)throw new Error(d.error.message);const c=d.choices[0];return{text:c.message?.content||'',tc:c.message?.tool_calls||null,rc:c.message?.reasoning_content||null,usage:d.usage}}

async function turn(msgs,label,msg,expectTools){
  msgs.push({role:'user',content:msg})
  let tools=[],tokens=0
  for(let i=0;i<10;i++){const r=await chat(msgs);tokens+=r.usage?.total_tokens||0;if(!r.tc||!r.tc.length){msgs.push({role:'assistant',content:r.text});const ok=expectTools?(tools.length>0):(tools.length===0);console.log(label+': '+(ok?'✅':'❌')+' '+tools.length+'工具['+tools.join(',')+'] '+tokens+'t → '+(r.text||'').slice(0,120));return}
    for(const tc of r.tc){const n=tc.function?.name||tc.name||'unknown';tools.push(n);const am={role:'assistant',content:r.text||'',tool_calls:[tc]};if(r.rc)am.reasoning_content=r.rc;msgs.push(am);const args=typeof tc.function?.arguments==='string'?tc.function.arguments:'{}';msgs.push({role:'tool',tool_call_id:tc.id,content:JSON.stringify(exec(n,JSON.parse(args)))})}}
  console.log(label+': timeout')
}

async function test(){
  const m=[{role:'system',content:S}]
  console.log('验证规则: 首次查看可读→讨论0工具→新话题可读→讨论0工具\n')
  await turn(m,'1.首次查看(需工具)','读一下outline/plot.md，然后用一句话概括故事',true)
  await turn(m,'2.讨论(应0工具)','你觉得这个世界观设定怎么样，有什么改进建议',false)
  await turn(m,'3.讨论(应0工具)','角色之间的关系可以怎么加强',false)
  await turn(m,'4.新话题(需工具)','第1章具体写了什么内容',true)
  await turn(m,'5.讨论(应0工具)','第1章的节奏和叙事手法怎么样',false)
  console.log('\n消息总数:'+m.length)
}
test().catch(e=>console.error(e.message))
