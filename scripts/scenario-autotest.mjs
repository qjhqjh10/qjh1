#!/usr/bin/env node
/**
 * 全流程自动化场景测试 v2 — 共享会话上下文
 * 纯 JS，零编译，直接跑
 *
 * 用法: node scripts/scenario-autotest.mjs [--mock] [--verbose]
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const USE_MOCK = process.argv.includes('--mock')
const VERBOSE = process.argv.includes('--verbose')

// ── API ──
let API_KEY = process.env.AI_API_KEY || ''
try { if (!API_KEY) API_KEY = fs.readFileSync(path.join(__dirname, '.tmp', 'api-key.txt'), 'utf-8').trim() } catch {}
const API_URL = (process.env.AI_API_URL || 'https://api.deepseek.com').replace(/\/+$/, '') + '/anthropic/v1/messages'
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'
if (!API_KEY && !USE_MOCK) { console.error('请设置 AI_API_KEY'); process.exit(1) }

// ── 提示词 + 工具 ──
const PROMPT = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cli-system-prompt.json'), 'utf-8')).fullPrompt } catch { return '你是青剑AI写作助手。' } })()
const TOOLS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'tool-schemas.json'), 'utf-8')) } catch { return [] } })()

// ── 项目 ──
const PROJ = `_at_${Date.now().toString(36)}`
const PROJ_DIR = path.join(ROOT, 'projects', PROJ)

// ── 文件工具 ──
async function execTool(name, args) {
  const fp = (k) => { let f = String(args[k]||'').replace(/\\/g,'/').replace(/^\/+/,''); while(f.startsWith('../')) f=f.slice(3); return /^[A-Z]:/i.test(f) ? f : path.join(PROJ_DIR, f) }
  switch (name) {
    case 'list_directory': { const d=args.dir_path?fp('dir_path'):PROJ_DIR; try{const e=await fsp.readdir(d,{withFileTypes:true});return{status:'success',summary:`${e.length}项`,detail:e.map(x=>`${x.isDirectory()?'[DIR]':'[FILE]'} ${x.name}`).join('\n')||'(空)'}}catch{return{status:'error',summary:`目录不存在`}} }
    case 'read_file': { const f=fp('file_path'); try{const c=await fsp.readFile(f,'utf-8');return{status:'success',summary:`${c.length}字符`,detail:c.length>4000?c.slice(0,4000)+'\n...(截断)':c}}catch{return{status:'error',summary:`文件不存在:${args.file_path}`}} }
    case 'search_content': { const ptn=String(args.pattern||''); if(!ptn)return{status:'error',summary:'缺pattern'};const d=args.dir_path?fp('dir_path'):PROJ_DIR;const r=[];try{const w=async(x)=>{for(const e of await fsp.readdir(x,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const f=path.join(x,e.name);if(e.isDirectory())await w(f);else try{const c=await fsp.readFile(f,'utf-8');c.split('\n').forEach((l,i)=>{if(l.includes(ptn))r.push(`${path.relative(d,f)}:${i+1}:${l.trim().slice(0,100)}`)})}catch{}}};await w(d);return{status:'success',summary:`${r.length}处`,detail:r.slice(0,20).join('\n')||'未找到'}}catch{return{status:'error',summary:'搜索失败'}} }
    case 'find_files': case 'search_files': { const kw=String(args.keyword||args.pattern||'').toLowerCase();if(!kw)return{status:'error',summary:'缺关键词'};const d=args.dir_path?fp('dir_path'):PROJ_DIR;const r=[];try{const w=async(x)=>{for(const e of await fsp.readdir(x,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const f=path.join(x,e.name);if(e.name.toLowerCase().includes(kw))r.push(path.relative(d,f).replace(/\\/g,'/'));if(e.isDirectory()&&r.length<100)await w(f)}};await w(d);return{status:'success',summary:`${r.length}个`,detail:r.slice(0,30).join('\n')||'未找到'}}catch{return{status:'error',summary:'搜索失败'}} }
    case 'create_file': { const f=fp('file_path');try{await fsp.access(f);return{status:'error',summary:'已存在'}}catch{};await fsp.mkdir(path.dirname(f),{recursive:true});const c=String(args.content||'');await fsp.writeFile(f,c,'utf-8');return{status:'success',summary:`已创建(${c.length}字)`} }
    case 'edit_file': { const f=fp('file_path');try{const c=await fsp.readFile(f,'utf-8');const o=String(args.old_string||'');const n=String(args.new_string||'');if(o==='__FULL_REPLACE__'){await fsp.writeFile(f,n,'utf-8');return{status:'success',summary:'已全量替换'}}if(!c.includes(o))return{status:'error',summary:'未找到原文',detail:c.slice(0,200)};await fsp.writeFile(f,args.replace_all?c.replaceAll(o,n):c.replace(o,n),'utf-8');return{status:'success',summary:'已替换'}}catch{return{status:'error',summary:`不存在:${args.file_path}`}} }
    case 'create_project': { const nm=String(args.name||'').trim();if(!nm||nm.includes('..'))return{status:'error',summary:'无效名称'};const pp=path.join(ROOT,'projects',nm);try{await fsp.access(pp);return{status:'error',summary:'项目已存在'}}catch{};for(const d of['characters','outline','detailed_outline','chapters','summaries','images','covers'])await fsp.mkdir(path.join(pp,d),{recursive:true});await fsp.writeFile(path.join(pp,'project.json'),JSON.stringify({type:'writing',novelCategory:'修仙小说'}),'utf-8');await fsp.writeFile(path.join(pp,'outline','plot.md'),'','utf-8');await fsp.writeFile(path.join(pp,'outline','worldbuilding.md'),'','utf-8');return{status:'success',summary:`已创建:${nm}`} }
    case 'write_note': { const d=path.join(ROOT,'notes');await fsp.mkdir(d,{recursive:true});const n=String(args.note_name||'').replace(/[\\/]/g,'').replace(/\.\./g,'');await fsp.writeFile(path.join(d,n),String(args.content||''),'utf-8');return{status:'success',summary:`笔记:${n}`} }
    case 'create_style_template': case 'create_scene_template': { const d=path.join(ROOT,name==='create_style_template'?'style_templates':'scene_templates');await fsp.mkdir(d,{recursive:true});const fn=`${name}_${Date.now().toString(36)}.json`;await fsp.writeFile(path.join(d,fn),JSON.stringify(args,null,2),'utf-8');return{status:'success',summary:`模板:${args.name||'未命名'}`} }
    case 'kb_create_file': { const d=path.join(ROOT,'knowledge_base','files');await fsp.mkdir(d,{recursive:true});await fsp.writeFile(path.join(d,String(args.file_name||'')),String(args.content||''),'utf-8');return{status:'success',summary:'KB已创建'} }
    case 'delete_file': { try{await fsp.unlink(fp('file_path'));return{status:'success',summary:'已删除'}}catch{return{status:'error',summary:'删除失败'}} }
    case 'rename_file': { const s=fp('file_path'),d=fp('new_path');if(!s||!d)return{status:'error',summary:'缺路径'};await fsp.rename(s,d);return{status:'success',summary:'已重命名'} }
    default: return {status:'error',summary:`不支持:${name}`}
  }
}

// ── API 调用 ──
async function callAPI(messages, scopedTools) {
  if (USE_MOCK) {
    const txt = (() => { const last = messages[messages.length-1]; return Array.isArray(last.content) ? last.content.map(c=>c.text||'').join('') : String(last.content||'') })()
    let tus=[]
    if(/建.*项目|创建.*项目/.test(txt)) tus=[{id:'c1',name:'create_project',input:{name:'剑道长生'}}];else if(/创建.*角色|建.*角色/.test(txt)) tus=[{id:'c1',name:'create_file',input:{file_path:`${PROJ}/characters/林逸.yaml`,content:'id:linyi\nname:林逸'}}];else if(/世界观|设定/.test(txt)) tus=[{id:'c1',name:'edit_file',input:{file_path:'outline/worldbuilding.md',old_string:'',new_string:'世界观已更新'}}];else if(/风格.*模板|文风/.test(txt)) tus=[{id:'c1',name:'create_style_template',input:{name:'参考风格',type:'修仙小说'}}];else if(/润色|摘要/.test(txt)) tus=[{id:'c1',name:'create_file',input:{file_path:'summaries/chapter1.md',content:'润色后内容'}}];else if(/搜.*血煞|口头禅/.test(txt)) tus=[{id:'c1',name:'search_content',input:{pattern:'血煞'}}];else if(/笔记|先做/.test(txt)) tus=[{id:'c1',name:'write_note',input:{note_name:'后续剧情脑洞.md',content:'断剑是陷阱'}}]
    return{text:'[Mock]',toolUses:tus,stopReason:tus.length?'tool_use':'end_turn',usage:{input_tokens:100,output_tokens:50}}
  }
  const body={model:MODEL,max_tokens:4096,stream:false,system:[{type:'text',text:PROMPT}],messages:messages.map(m=>({role:m.role,content:Array.isArray(m.content)?m.content:[{type:'text',text:typeof m.content==='string'?m.content:''}]}))}
  const tools = scopedTools || TOOLS
  if(tools.length)body.tools=tools.map(t=>t.function?{name:t.function.name,description:t.function.description,input_schema:t.function.parameters}:t)
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)})
  if(!res.ok){const e=await res.text().catch(()=>'');throw new Error(`API ${res.status}: ${e.slice(0,200)}`)}
  const data=await res.json();const c=data.content||[]
  return{text:c.filter(x=>x.type==='text').map(x=>x.text).join(''),toolUses:c.filter(x=>x.type==='tool_use').map(t=>({id:t.id,name:t.name,input:t.input})),stopReason:data.stop_reason||'end_turn',usage:data.usage}
}

// ═════════════════════════════════════════
// 默认核心工具集（简单任务）— 对齐 GUI ChatBridge
// ═════════════════════════════════════════
const CORE_READ = new Set(['read_file','list_directory','search_content','find_files','search_files'])
const CORE_WRITE = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file'])
const CORE_KB = new Set(['kb_list','kb_create_file','kb_append_file','kb_index_file'])
const CORE_NOTE = new Set(['write_note','read_note','list_notes','append_note','delete_note','search_notes'])
const CORE_TMPL = new Set(['create_style_template','create_scene_template'])
const CORE_PROJ = new Set(['create_project','delete_project'])
const CORE_ALL = new Set([...CORE_READ,...CORE_WRITE,...CORE_KB,...CORE_NOTE,...CORE_TMPL,...CORE_PROJ])
const DEFAULT_TOOLS = TOOLS.filter(t => CORE_ALL.has(t.function.name))

// ═════════════════════════════════════════
// Skill 系统 — 仅复杂多步骤场景激活（≥0.5 阈值）
// ═════════════════════════════════════════
const SKILLS = [
  // 复杂：需分析26维+读参考+创建模板，不单纯是"读文件"
  { id:'style-template', trig:[/风格.*模板|文风.*(?:分析|特点|创建)|分析.*文风.*创建|创建.*风格.*模板|仿写.*模板/], tools:['read_file','create_style_template','list_directory'], priority:90 },
  // 复杂：多角色批量创建，需读参考格式+16字段YAML+质量检查
  { id:'character-management', trig:[/创建.*(?:几个|这些|以下|所有|全部).*角色|批量.*创建.*角色|一口气.*创建.*角色|建.*几个.*角色|把.*角色.*(?:都|全).*建/], tools:['list_directory','read_file','create_file'], priority:85 },
  // 复杂：长篇设定导入，需分块追加+old_string精度
  { id:'worldbuilding-import', trig:[/导入.*(?:世界观|世界设定)|整理.*设定.*(?:加|写|存)|把这些.*设定.*(?:加|整理|写)/], tools:['read_file','edit_file'], priority:75 },
  // 复杂：章节创作需读4个来源(大纲+角色+细纲+摘要)+3000字生成
  { id:'chapter-writing', trig:[/写.*第.{1,3}章.*正文|创作.*第.{1,3}章|生成.*第.{1,3}章|续写.*第.{1,3}章/], tools:['read_file','create_file','edit_file','search_content'], priority:85 },
  // 复杂：润色章节需读原文+保留old_string+修改特定段落
  { id:'chapter-polish', trig:[/润色.*第.{1,3}章|修改.*第.{1,3}章|改写.*第.{1,3}章重写.*第.{1,3}章/], tools:['read_file','edit_file'], priority:80 },
  // 中等：审稿需4维评分
  { id:'chapter-review', trig:[/审稿|对.*第.{1,3}章.*打分|从.*维度.*评价|review.*第.{1,3}章/], tools:['read_file','search_content','create_file'], priority:70 },
]

function matchSkill(msg) {
  let best = null, bestScore = 0
  for (const s of SKILLS) {
    let score = 0
    for (const re of s.trig) {
      const m = msg.match(re)
      if (m) score = Math.max(score, (m[0].length / Math.min(msg.length, 200)) * (s.priority/100))
    }
    if (score > 0.5 && score > bestScore) { bestScore = score; best = s }
  }
  return best  // null → 用 DEFAULT_TOOLS
}

// 默认核心工具数
const DEFAULT_COUNT = DEFAULT_TOOLS.length

// ── 场景 ──
const S=[
  {id:'T1',label:'闲聊+建项目',check:o=>o.tools.includes('create_project'),msg:'你好呀！我最近想开一本新的修仙小说叫《剑道长生》，帮我建个写作项目吧，就叫"剑道长生"。'},
  {id:'T2',label:'批量创建角色',check:o=>o.tools.includes('create_file'),msg:'帮我建几个角色。主角林逸，男19岁剑修，青云宗外门弟子，外表冷漠内心热血，剑术天赋能感知剑气，体能差容易钻牛角尖。女主苏婉儿，18岁内门天才，表面温柔内心坚强，擅长炼丹阵法。反派血煞老祖，血煞教教主残忍狡诈，能力血煞功，弱点是过度自信。三个都创建，先建林逸。'},
  {id:'T3',label:'世界观导入',check:o=>o.tools.includes('edit_file')||o.tools.includes('create_file'),msg:'帮我把天元大陆的设定加到项目里。三大势力：青云宗正道、魔渊殿魔道、散修联盟中立。修炼体系九境：炼气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫。上古剑神飞升失败修为散为剑灵碎片。天道石碑每百年显现飞升资质者。'},
  {id:'T4',label:'风格分析+模板',check:o=>o.tools.includes('create_style_template'),msg:'summaries/ref_style.txt 是我上传的风格参考文，帮我读一下分析文风特点，然后创建个"参考风格"模板，类型修仙小说。'},
  {id:'T5',label:'润色+保存摘要',check:o=>o.tools.includes('create_file')||o.tools.includes('edit_file'),msg:'帮我润色第一章概要存到 summaries/chapter1.md：林逸在青云宗后山捡到断剑剑灵苏醒。血煞老祖感应到残雪剑开始追踪。苏婉儿来找他参加宗门大比。写得流水账了，润色得更有画面感。'},
  {id:'T6',label:'搜索+知识库+建议',check:o=>o.tools.length>=2,msg:'帮我搜一下项目里所有提到"血煞"的文件确认反派设定。把 summaries/ref_style.txt 加到知识库里。哦对了你觉得给林逸加个"剑在手命在天"的口头禅怎么样？'},
  {id:'T7',label:'多任务排序',check:o=>o.tools.includes('write_note'),msg:'最后帮我做几件事：①列一下项目有哪些文件 ②搜"剑"字出现了多少次 ③写个笔记"后续剧情脑洞"记：林逸的断剑其实是剑神故意留下的陷阱，剑神没死而是在布局。先做第三件事。'},
]

// ── Main ──
async function main(){
  console.log('╔══════════════════════════════════╗')
  console.log(`║  全流程测试 v2 · ${USE_MOCK?'MOCK':'LIVE'} · ${PROJ.slice(0,12)} ║`)
  console.log('╚══════════════════════════════════╝\n')

  for(const d of['characters','outline','detailed_outline','chapters','summaries','images','covers'])await fsp.mkdir(path.join(PROJ_DIR,d),{recursive:true})
  await fsp.writeFile(path.join(PROJ_DIR,'project.json'),JSON.stringify({type:'writing',novelCategory:'修仙小说'}),'utf-8')
  await fsp.writeFile(path.join(PROJ_DIR,'outline','plot.md'),'','utf-8')
  await fsp.writeFile(path.join(PROJ_DIR,'outline','worldbuilding.md'),'','utf-8')
  await fsp.writeFile(path.join(PROJ_DIR,'summaries','ref_style.txt'),'天元历九千七百二十三年，秋。\n\n青云宗后山，一道青色剑光冲天而起。\n\n林逸握着那把断剑，感受着剑身传来的震颤。那是剑的心跳。断剑缺口处金色光芒如丝线般缠绕编织成完整的剑尖。\n\n"剑名残雪。曾斩三千魔头。"剑灵的声音低沉而古老。\n\n山风骤起卷起满地落叶。林逸握剑的手微微发颤——这把剑里的力量正在与他体内的灵力共鸣。\n\n"这是我的上一任主人。他叫林玄，三百年前被天下人称为剑神。"','utf-8')
  console.log(`📁 项目就绪\n`)

  const msgs=[]  // 共享会话历史
  let totalTok=0,totalCalls=0,totalIter=0,passed=0
  const start=Date.now()

  for(const sc of S){
    // Skill 匹配 + 工具裁剪
    const skill=matchSkill(sc.msg)
    // 只有高置信度 Skill 才裁剪，否则用默认核心工具集
    let st, skillLabel
    if (skill) {
      const needed = new Set([...skill.tools, 'read_file', 'list_directory', 'search_content'])
      st = TOOLS.filter(t => needed.has(t.function.name))
      skillLabel = `Skill:${skill.id}(${st.length}工具)`
    } else {
      st = DEFAULT_TOOLS
      skillLabel = `默认核心(${DEFAULT_COUNT}工具)`
    }
    console.log(`\x1b[36m[${sc.id}] ${sc.label}\x1b[0m \x1b[90m${skillLabel}\x1b[0m`)
    msgs.push({role:'user',content:[{type:'text',text:sc.msg}]})
    let tok=0,calls=0,tools=[],iter=0,text=''

    for(let i=0;i<12;i++){iter++
      const resp=await callAPI(msgs,st);tok+=resp.usage?.input_tokens||0;tok+=resp.usage?.output_tokens||0;text=resp.text||text
      if(!resp.toolUses.length){msgs.push({role:'assistant',content:[{type:'text',text:resp.text}]});break}

      const results=[]
      for(const tu of resp.toolUses){calls++;tools.push(tu.name);const r=await execTool(tu.name,tu.input);if(VERBOSE)process.stdout.write(` ⚡${tu.name}`);results.push({id:tu.id,result:r})}

      const asst=[];if(resp.text)asst.push({type:'text',text:resp.text});for(const tu of resp.toolUses)asst.push({type:'tool_use',id:tu.id,name:tu.name,input:tu.input})
      msgs.push({role:'assistant',content:asst});msgs.push({role:'user',content:results.map(r=>({type:'tool_result',tool_use_id:r.id,content:JSON.stringify(r.result)}))})
    }

    const ok=sc.check({tools,toolCalls:calls,iterations:iter})
    if(ok)passed++;totalTok+=tok;totalCalls+=calls;totalIter+=iter
    console.log(`  ${ok?'✅':'❌'} ${(tok/1000).toFixed(1)}K · ${calls}工具 · ${iter}轮 · ${tools.slice(0,5).join(',')}${tools.length>5?'...':''}`)
    // T1 后复制 ref 文件到模型创建的剑道长生项目
    if(sc.id==='T1'&&ok){try{const d=path.join(ROOT,'projects','剑道长生','summaries');await fsp.mkdir(d,{recursive:true});await fsp.copyFile(path.join(PROJ_DIR,'summaries','ref_style.txt'),path.join(d,'ref_style.txt'))}catch{}}
    if(!ok)console.log('     \x1b[33m→ '+text.slice(0,120)+'\x1b[0m')
  }

  const dur=((Date.now()-start)/1000).toFixed(0)
  console.log(`\n${'═'.repeat(35)}`)
  console.log(`\x1b[1m📊 ${passed}/${S.length}通过 · ${(totalTok/1000).toFixed(1)}K tokens · ${totalCalls}工具 · ${totalIter}轮 · ${dur}s\x1b[0m`)

  await fsp.rm(PROJ_DIR,{recursive:true,force:true})
  console.log('🧹 清理完成')
}
main().catch(e=>{console.error('\x1b[31m',e.message,'\x1b[0m');process.exit(1)})
