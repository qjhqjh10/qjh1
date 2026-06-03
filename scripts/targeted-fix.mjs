#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const ANTHROPIC_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const ROOT = process.cwd()
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const S = p => path.join(ROOT, 'style_templates', p)

const tools = {
  read_file: a => { try { const c=fs.readFileSync(P(a.file_path||a.path),'utf-8'); return {status:'success',summary:'读取',detail:c.slice(0,2000)}; } catch(e) { return {status:'error',summary:'文件不存在'}; } },
  list_directory: a => { try { const e=fs.readdirSync(P(a.path||'.'),{withFileTypes:true}); return {status:'success',summary:e.length+'条目',detail:e.map(x=>x.name).join('\n')}; } catch(e) { return {status:'error',summary:'目录不存在'}; } },
  create_file: a => { try { const fp=P(a.file_path||a.path); const c=a.content||''; if(fp.endsWith('.json')&&c) try{JSON.parse(c)}catch(e){return{status:'error',summary:'JSON格式错误: '+e.message+'. 请检查：所有键用双引号、多行文本用\\\\n转义、禁止JSON内直接换行。'}}; fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,c); return {status:'success',summary:'已创建: '+a.file_path}; } catch(e) { return {status:'error',summary:e.message}; } },
  search_content: a => { try { const fp=P(a.path||'.'); const re=new RegExp(a.pattern,'gi'); const c=fs.readFileSync(fp,'utf-8'); const ls=c.split('\n'); const results=[]; for(let i=0;i<ls.length;i++) if(re.test(ls[i])) results.push((i+1)+': '+ls[i].slice(0,200)); return {status:'success',summary:results.length+'个匹配',detail:results.slice(0,10).join('\n')}; } catch(e) { return {status:'error',summary:'搜索失败'}; } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'), a.content||''); return {status:'success',summary:'笔记已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
  create_style_template: a => { try { fs.mkdirSync(S(''),{recursive:true}); fs.writeFileSync(S((a.name||'x')+'.json'), JSON.stringify(a,null,2)); return {status:'success',summary:'模板已创建'}; } catch(e) { return {status:'error',summary:e.message}; } },
}

const SCHEMAS = [
  {name:'read_file',description:'读取项目文件。先看参考格式再创建。',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}},
  {name:'list_directory',description:'列项目目录。',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
  {name:'create_file',description:'创建文件。JSON文件自动校验——必须合法JSON格式，键用双引号，字符串中的换行用\\\\n转义。',input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}},
  {name:'search_content',description:'搜索文件内容。',input_schema:{type:'object',properties:{pattern:{type:'string'},path:{type:'string'}},required:['pattern']}},
  {name:'write_note',description:'写笔记。',input_schema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}},
  {name:'create_style_template',description:'创建风格模板。',input_schema:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}},
]

const SYS = [
  '你是青剑AI写作助手。',
  '',
  '# 核心规则',
  '- 闲聊/问候/自我介绍/偏好陈述 → 不要调用任何工具，直接文本回复。例如："我是XX" "我喜欢XX" "你好" "谢谢"。',
  '- 仅当用户明确要求操作文件时才调工具。触发词：读取/列出/搜索/创建/编辑/删除/写/保存/修改。',
  '- 不触发工具的词：我是/我喜欢/我觉得/你好/谢谢/推荐/建议/什么是/为什么/告诉我/介绍。',
  '',
  '# 工具',
  '- read_file: 读取指定路径的文件',
  '- list_directory: 列出指定目录',
  '- create_file: 创建文件。JSON文件自动校验格式。',
  '- search_content: 搜索文件内容',
  '- write_note: 创建笔记',
  '- create_style_template: 创建风格模板',
  '',
  '# 文件路径',
  '角色: 1/characters/中文名.json',
  '章节: 1/chapters/chapterN.txt',
  '细纲: 1/detailed_outline/chapterN.json',
  '大纲: 1/outline/plot.md',
].join('\n')

async function callAnthropic(sys, msgs) {
  const body = { model: 'deepseek-chat', system: [{ type: 'text', text: sys }], messages: msgs, max_tokens: 2048, stream: true, tools: SCHEMAS }
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

async function run(msg, maxIter=8) {
  const msgs=[{role:'user',content:[{type:'text',text:msg}]}]; let its=0, tts=0
  while(its<maxIter) {
    its++; const r=await callAnthropic(SYS, msgs)
    if(!r.toolUses.length) return {...r,iterations:its,toolCalls:tts}
    const ac=[]; if(r.text) ac.push({type:'text',text:r.text})
    for(const tu of r.toolUses) ac.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input})
    msgs.push({role:'assistant',content:ac})
    const trs=[]
    for(const tu of r.toolUses){const tf=tools[tu.name];const res=tf?await tf(tu.input):{status:'error',summary:'未知工具'};tts++;trs.push({type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(res)});process.stdout.write((res.status==='success'?'✓':'✗')+' ')}
    msgs.push({role:'user',content:trs})
  }
  return {text:'',iterations:its,toolCalls:tts}
}

console.log('═══ 针对性修复验证 ═══\n')

// 问题1: 对话类应0工具
console.log('▶ Issue1: 对话类应0工具')
const r1 = await run('我喜欢写玄幻小说')
console.log(r1.toolCalls===0?'  ✅ 0工具 ('+r1.iterations+'轮)':'  ❌ 调了'+r1.toolCalls+'工具 ('+r1.iterations+'轮)')
if (r1.text) console.log('  回复: '+r1.text.slice(0,100))

// 问题2: 复杂任务效率(读角色+写细纲)
console.log('\n▶ Issue2: 读角色+写细纲 (应2-4轮2-3工具)')
const r2 = await run(
  '先读取 1/characters/林语晴.json 了解角色格式。然后为第6章创建细纲，保存到 1/detailed_outline/chapter6.json。' +
  '细纲JSON格式：{"id":"chapter6","title":"第6章标题","order":5,"status":"incomplete","plotOverview":"150-300字剧情概述","characters":"角色列表(每行一个)","location":"场景地点","keyEvents":"事件1\\n事件2\\n事件3"}' +
  '内容：title=第6章·初次交锋，plotOverview=张明在静止世界中发现另一个觉醒者，两人试探交锋后发现秘密，characters=张明\\n林语晴\\n神秘人，location=大学图书馆，keyEvents=图书馆异动\\n初次对视\\n跟踪神秘人'
)
const goodEff = r2.toolCalls >= 2 && r2.toolCalls <= 4 && r2.iterations <= 5
console.log(goodEff?'  ✅ 效率合格 ('+r2.iterations+'轮 '+r2.toolCalls+'工具)':'  ⚠️ 效率偏低 ('+r2.iterations+'轮 '+r2.toolCalls+'工具)')

// 问题3: 对话一致性
console.log('\n▶ Issue3: 对话一致性(无历史上下文下，验证单轮记忆)')
const r3a = await run('请记住：我叫张伟，我喜欢玄幻小说', 3)
console.log(r3a.toolCalls===0?'  ✅ 记住信息(0工具)':'  ⚠️ 调了'+r3a.toolCalls+'工具')
if (r3a.text) console.log('  回复: '+r3a.text.slice(0,100))

console.log('\n═══ 完成 ═══')
