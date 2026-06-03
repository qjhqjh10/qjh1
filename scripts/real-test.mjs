#!/usr/bin/env node
/**
 * 真实系统提示词 + 完整工具定义测试
 * 使用 V4SystemPrompt 中的真实 CORE_SYSTEM_PROMPT (7226 chars)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const OPENAI_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-chat'
const MAX_IT = 12
const ROOT = process.cwd()
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)
const ST = p => path.join(ROOT, 'style_templates', p)

const toolImpl = {
  read_file: a => { try { return fs.readFileSync(P(a.file_path||a.path),'utf-8'); } catch { return '[不存在]'; } },
  list_directory: a => { try { const d=P(a.path||'.'); return fs.readdirSync(d,{withFileTypes:true}).map(x=>(x.isDirectory()?'DIR ':'FILE ')+x.name).join('\n'); } catch { return '[不存在]'; } },
  search_content: a => { try { const re=new RegExp((a.pattern||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'); const c=fs.readFileSync(P(a.path||'.'),'utf-8'); return c.split('\n').map((l,i)=>re.test(l)?(i+1)+':'+l.slice(0,200):null).filter(Boolean).join('\n')||'无匹配'; } catch { return '[错误]'; } },
  edit_file: a => { try { const fp=P(a.file_path);let c=fs.readFileSync(fp,'utf-8');const old=a.old_string||'';const nw=a.new_string||'';if(old==='__FULL_REPLACE__'){fs.writeFileSync(fp,nw);return'替换成功'}let i=c.indexOf(old);if(i<0)i=c.indexOf(old.trim());if(i<0)return'[未找到匹配]';fs.writeFileSync(fp,c.slice(0,i)+nw+c.slice(i+old.length));return'编辑成功'; } catch { return '[错误]'; } },
  create_file: a => { try { const fp=P(a.file_path);const c=a.content||'';if(fp.endsWith('.json')&&c)try{JSON.parse(c)}catch(e){return'[JSON格式错误: '+e.message+']'};fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,c);return'创建成功'; } catch(e) { return '[错误]'; } },
  delete_file: a => { try { fs.unlinkSync(P(a.file_path)); return '删除成功'; } catch { return '[错误]'; } },
  rename_file: a => { try { fs.renameSync(P(a.path||a.file_path),P(a.new_path)); return '重命名成功'; } catch { return '[错误]'; } },
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无'; } catch { return '无'; } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true});fs.writeFileSync(K((a.name||'x')+'.md'),a.content||'');return'KB创建成功'; } catch { return '[错误]'; } },
  kb_append_file: a => { try { const fp=K((a.name||'x')+'.md');if(!fs.existsSync(fp))return'[KB文件不存在]';fs.appendFileSync(fp,'\n'+(a.content||''));return'KB追加成功'; } catch { return '[错误]'; } },
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true});return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无'; } catch { return '无'; } },
  read_note: a => { try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8'); } catch { return '[不存在]'; } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true});fs.writeFileSync(N((a.name||'x')+'.md'),a.content||'');return'笔记创建成功'; } catch { return '[错误]'; } },
  append_note: a => { try { const fp=N((a.name||'x')+'.md');if(!fs.existsSync(fp))return'[笔记不存在]';fs.appendFileSync(fp,'\n'+(a.content||''));return'笔记追加成功'; } catch { return '[错误]'; } },
  delete_note: a => { try { fs.unlinkSync(N((a.name||'x')+'.md'));return'删除成功'; } catch { return '[错误]'; } },
  search_notes: a => { try { const q=a.query||'';const ms=[];fs.mkdirSync(N(''),{recursive:true});for(const f of fs.readdirSync(N('')).filter(f=>f.endsWith('.md'))){if(fs.readFileSync(N(f),'utf-8').includes(q))ms.push(f)};return ms.join('\n')||'无匹配'; } catch { return '无匹配'; } },
  create_style_template: a => { try { fs.mkdirSync(ST(''),{recursive:true});fs.writeFileSync(ST((a.name||'x')+'.json'),JSON.stringify(a,null,2));return'模板创建成功'; } catch { return '[错误]'; } },
  create_scene_template: a => { try { const fp=path.join(ROOT,'scene_templates',(a.name||'x')+'.json');fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp,JSON.stringify(a,null,2));return'模板创建成功'; } catch { return '[错误]'; } },
  create_project: a => { try { const d=P(a.name);['characters','chapters','outline','detailed_outline','summaries'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true}));return'项目创建成功'; } catch { return '[错误]'; } },
  delete_project: a => { try { fs.rmSync(P(a.name),{recursive:true,force:true});return'项目删除成功'; } catch { return '[错误]'; } },
  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  learn_rule: a => '规则已学习: '+(a.rule||'').slice(0,50),
  list_audit: () => '暂无审计记录',
  write_learning: a => '经验已记录: '+(a.summary||'').slice(0,50),
}

// ═══ 真实工具 Schema（和软件里一模一样） ═══
const REAL_TOOLS = [
  {type:'function',function:{name:'read_file',description:'读取项目文件内容。已知路径直接read_file，不需要list_directory。修改文件前必须先read_file确认原文。',parameters:{type:'object',properties:{file_path:{type:'string',description:'文件相对路径，如 1/characters/林语晴.json'}},required:['file_path']}}},
  {type:'function',function:{name:'list_directory',description:'列出项目目录下的文件和子目录。支持glob模式过滤。查看知识库请用kb_list，查看笔记请用list_notes。',parameters:{type:'object',properties:{path:{type:'string',description:'目录相对路径'},pattern:{type:'string',description:'glob文件名过滤(可选)，如 *.json'}},required:['path']}}},
  {type:'function',function:{name:'search_content',description:'在项目文件中搜索文本内容。支持正则+上下文行+file_pattern过滤。',parameters:{type:'object',properties:{pattern:{type:'string',description:'搜索关键词或正则'},path:{type:'string',description:'搜索路径(可选)'},context_around:{type:'number',description:'上下文行数(可选)'},file_pattern:{type:'string',description:'文件名glob过滤(可选)'}},required:['pattern']}}},
  {type:'function',function:{name:'edit_file',description:'精准编辑项目文件。old_string必须精确匹配原文（含换行和空格）。__FULL_REPLACE__全量替换。replace_all替换所有匹配。',parameters:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'},replace_all:{type:'boolean'}},required:['file_path','old_string','new_string']}}},
  {type:'function',function:{name:'create_file',description:'创建新文件。JSON文件自动校验格式。创建JSON前先read_file参考已有同类文件格式。',parameters:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}}},
  {type:'function',function:{name:'delete_file',description:'删除项目文件（不可恢复！需用户确认）。',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}},
  {type:'function',function:{name:'rename_file',description:'重命名或移动文件。',parameters:{type:'object',properties:{path:{type:'string'},new_path:{type:'string'}},required:['path','new_path']}}},
  {type:'function',function:{name:'kb_list',description:'列出知识库所有文件。KB是全局参考资料，独立于项目。',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'kb_create_file',description:'在知识库创建.md文件。保存前先kb_list让用户选追加还是新建。路径: knowledge_base/files/文件名.md',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'kb_append_file',description:'追加内容到已有KB文件。文件必须已存在。',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'list_notes',description:'列出全局笔记目录所有笔记。',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'read_note',description:'读取指定笔记内容。文件名自动加.md。',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'write_note',description:'创建新笔记文件。新笔记用write_note，追加内容到已有笔记用append_note。',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'append_note',description:'追加内容到已存在的笔记。新笔记请用write_note。',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'delete_note',description:'删除指定笔记。',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'search_notes',description:'搜索笔记内容。',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
  {type:'function',function:{name:'create_style_template',description:'创建风格模板。调用前先确认小说类型。dimensions每个维度含description/examples/writingRules/vocabularyList。',parameters:{type:'object',properties:{name:{type:'string'},type:{type:'string',description:'17种类型之一'}},required:['name','type']}}},
  {type:'function',function:{name:'create_scene_template',description:'创建场景模板。调用前先确认小说类型。',parameters:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}}},
  {type:'function',function:{name:'create_project',description:'创建新项目（含标准子目录）。',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'delete_project',description:'删除项目（不可恢复！需用户确认）。',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'list_prompts',description:'列出所有可用的提示词模板。',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'list_rules',description:'列出所有已学习的自动规则。',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'learn_rule',description:'学习并记录一条新的自动规则。',parameters:{type:'object',properties:{rule:{type:'string'}},required:['rule']}}},
  {type:'function',function:{name:'list_audit',description:'查看操作审计记录。',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'write_learning',description:'记录一条学习经验。',parameters:{type:'object',properties:{summary:{type:'string'}},required:['summary']}}},
]

// ═══ 修复后的真实系统提示词 ═══
const REAL_SYS = `你是"青剑"，AI小说创作助手。

# 铁律 — 优先级最高
- 操作文件必须调用实际的 function call，口头描述 ≠ 操作完成
- 禁止在文本中用 XML/JSON 文本块来模拟工具调用
- 调用工具后失败时诚实告知原因，不假装成功

# 不用工具的场景 — 直接文本回复
以下情况绝对不要调用任何工具：
- 问候/闲聊："你好""谢谢""再见"
- 自我介绍/偏好："我叫XX""我是XX""我喜欢XX"
- 简单询问："什么是XX""为什么XX""怎么XX"
- 建议/咨询："推荐一下""有什么建议""怎么办"
- 评价/反馈："你觉得XX怎么样"
- 模糊请求："看看""帮我看看""怎么样"
- 模糊指令（没有明确文件路径或操作）时，先问清楚再操作

# 工具选择
仅在用户明确要求操作项目文件时才调用工具：
- 已知文件路径 → 直接 read_file 读取
- 不确定文件在哪 → list_directory 查看
- 修改文件 → 先 read_file 再 edit_file
- 创建文件 → 先 read_file 参考格式再 create_file
- 搜索 → search_content
- KB → kb_list/kb_create_file/kb_append_file
- 笔记 → list_notes/read_note/write_note/append_note
- 模板 → create_style_template/create_scene_template
- 项目 → create_project/delete_project

# 文件路径
角色: 1/characters/中文名.json  章节: 1/chapters/chapterN.txt
细纲: 1/detailed_outline/chapterN.json  大纲: 1/outline/plot.md

# 规则
- 读文件后只输出关键摘要，不输出全文
- 编辑前先 read_file
- 只做用户要求的操作`

async function callAPI(messages) {
  const body = { model: MODEL, messages, max_tokens: 2048, tools: REAL_TOOLS, tool_choice: 'auto' }
  const res = await fetch(OPENAI_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY}, body:JSON.stringify(body) })
  if (!res.ok) throw new Error('HTTP '+res.status)
  const json = await res.json()
  const c = json.choices[0]
  return { text: c.message?.content||'', toolCalls: c.message?.tool_calls||[], finish: c.finish_reason||'stop', usage: json.usage }
}

async function run(msg, maxIt=12) {
  const msgs = [{ role: 'system', content: REAL_SYS }, { role: 'user', content: msg }]
  let it=0, tts=0, txt=''
  while (it < maxIt) {
    it++; const r = await callAPI(msgs); if (r.text) txt = r.text
    if (!r.toolCalls.length) return { text: txt, iterations: it, toolCalls: tts }
    const tcList = r.toolCalls.map(tc=>({id:tc.id,fn:tc.function.name,args:(()=>{try{return JSON.parse(tc.function.arguments)}catch{return{}}})()}))
    process.stdout.write(tcList.map(t=>t.fn).join(',')+' ')
    msgs.push({ role:'assistant', content: r.text||null, tool_calls: r.toolCalls })
    for (const tc of r.toolCalls) {
      const fn = toolImpl[tc.function.name]; let args={}; try{args=JSON.parse(tc.function.arguments)}catch{}
      const result = fn ? await fn(args) : '[未知工具]'; tts++
      msgs.push({ role:'tool', tool_call_id: tc.id, content: result })
      process.stdout.write(result.startsWith&&result.startsWith('[')?'✗':'✓')
    }
    process.stdout.write(' ')
  }
  return { text: txt, iterations: it, toolCalls: tts }
}

let pass=0,fail=0,warn=0
function t(name,cond,detail){if(cond===true){pass++;console.log('  ✅ '+name+(detail?': '+detail:''))}else if(cond===false){fail++;console.log('  ❌ '+name+(detail?': '+detail:''))}else{warn++;console.log('  ⚠️ '+name+(detail?': '+detail:''))}}
function ok(name,detail){t(name,true,detail)}
function no(name,detail){t(name,false,detail)}
function wrn(name,detail){t(name,null,detail)}

console.log('═══════════════════════════════════════════')
console.log('  真实系统提示词测试 (7226 chars, 25 tools)')
console.log('═══════════════════════════════════════════\n')

// ═══ 测试方案2.md 场景 ═══
console.log('┌─ 测试方案2.md ──────────────────────────┐')

console.log('│ 场景1 列出+读取')
const s1_1 = await run('列出项目1的characters目录下所有.json文件')
t('S1-1 Glob列角色', s1_1.toolCalls>=1, s1_1.iterations+'轮')
const s1_2 = await run('读取项目1的角色林语晴，路径 1/characters/林语晴.json')
t('S1-2 读林语晴', s1_2.toolCalls>=1, s1_2.iterations+'轮 '+s1_2.toolCalls+'工具')

console.log('│ 场景2 搜索')
const s2_1 = await run('在项目1的chapters目录搜索"林语晴"')
t('S2-1 搜索林语晴', s2_1.toolCalls>=1, s2_1.iterations+'轮')
const s2_2 = await run('搜索项目1中所有JSON文件里男主或女主的出现')
t('S2-2 正则搜索', s2_2.toolCalls>=1, s2_2.iterations+'轮 '+s2_2.toolCalls+'工具')

console.log('│ 场景3 编辑')
const s3_1 = await run('读 1/characters/测试角色.json，然后用edit_file把description改成"真实测试修改"（用__FULL_REPLACE__）')
t('S3-1 读→改', s3_1.toolCalls>=2, s3_1.iterations+'轮 '+s3_1.toolCalls+'工具')

console.log('│ 场景4 创建文件')
const s4_1 = await run('读 1/characters/林语晴.json 参考格式，创建新角色"赵云"保存到 1/characters/赵云.json。角色信息：id=zhaoyun, name=赵云, role=男配, gender=男, age=28, occupation=将军, background=常山赵子龙, appearance=高大威猛, personality=忠勇双全, abilities=枪法如神, weaknesses=刚直, relationships=张明好友, relationshipTags=["好友"], arc=名震天下, importance=85')
t('S4-1 读→创建角色', s4_1.toolCalls>=2, s4_1.iterations+'轮 '+s4_1.toolCalls+'工具')

console.log('│ 场景5 KB')
const s5_1 = await run('列出知识库所有文件')
t('S5-1 KB列表', s5_1.toolCalls>=1, s5_1.iterations+'轮')
const s5_2 = await run('创建一个KB文件"真实测试要点"，内容"真实测试内容-林语晴要点"')
t('S5-2 KB创建', s5_2.toolCalls>=1, s5_2.iterations+'轮 '+s5_2.toolCalls+'工具')

console.log('│ 场景6 笔记')
const s6_1 = await run('列出所有笔记')
const s6_2 = await run('写笔记"真实测试笔记"，内容"第一步测试"')
const s6_3 = await run('读笔记"真实测试笔记"')
const s6_4 = await run('追加内容到笔记"真实测试笔记"：第二步测试内容')
const s6_5 = await run('搜索笔记中包含"测试"的笔记')
const s6_6 = await run('删除笔记"真实测试笔记"')
t('S6 笔记全流程(6步)', s6_1.toolCalls>=1&&s6_2.toolCalls>=1&&s6_3.toolCalls>=1&&s6_4.toolCalls>=1&&s6_5.toolCalls>=1&&s6_6.toolCalls>=1, '列:'+s6_1.toolCalls+' 写:'+s6_2.toolCalls+' 读:'+s6_3.toolCalls+' 追:'+s6_4.toolCalls+' 搜:'+s6_5.toolCalls+' 删:'+s6_6.toolCalls)

console.log('│ 场景7 模板')
const s7_1 = await run('创建风格模板 name=真实测试风格 type=普通小说')
t('S7-1 风格模板', s7_1.toolCalls>=1, s7_1.iterations+'轮 '+s7_1.toolCalls+'工具')
const s7_2 = await run('创建场景模板 name=真实测试场景 type=武侠小说')
t('S7-2 场景模板', s7_2.toolCalls>=1, s7_2.iterations+'轮 '+s7_2.toolCalls+'工具')

console.log('│ 场景8 项目管理')
const s8_1 = await run('创建项目test-real-demo')
t('S8-1 创建项目', s8_1.toolCalls>=1, s8_1.iterations+'轮')
const s8_2 = await run('删除项目test-real-demo')
t('S8-2 删除项目', s8_2.toolCalls>=1, s8_2.iterations+'轮 '+s8_2.toolCalls+'工具')

console.log('│ 场景9 读写混合')
const s9_1 = await run('读 1/chapters/chapter3.txt，然后写一个摘要保存到 1/summaries/chapter3.md')
t('S9-1 读→写摘要', s9_1.toolCalls>=2, s9_1.iterations+'轮 '+s9_1.toolCalls+'工具')
const s9_2 = await run('读 1/detailed_outline/chapter3.json 细纲，把status改成completed。先read_file，然后edit_file用__FULL_REPLACE__')
t('S9-2 读→改细纲', s9_2.toolCalls>=2, s9_2.iterations+'轮 '+s9_2.toolCalls+'工具')

console.log('│ 场景10 Harness')
const s10_1 = await run('列出已学习的规则')
t('S10-1 list_rules', s10_1.toolCalls>=1, s10_1.iterations+'轮')
const s10_2 = await run('学习一条规则：角色JSON的importance字段范围是0-100')
t('S10-2 learn_rule', s10_2.toolCalls>=1, s10_2.iterations+'轮 '+s10_2.toolCalls+'工具')
const s10_3 = await run('列出可用的提示词')
t('S10-3 list_prompts', s10_3.toolCalls>=1, s10_3.iterations+'轮')
const s10_4 = await run('查看审计记录')
t('S10-4 list_audit', s10_4.toolCalls>=1, s10_4.iterations+'轮')

console.log('└─────────────────────────────────────────┘')

// ═══ 测试方案3.md 关键场景 ═══
console.log('\n┌─ 测试方案3.md 关键场景 ──────────────────┐')

console.log('│ 对话防误调')
const r_chat1 = await run('你好')
const r_chat2 = await run('我是张伟，写玄幻小说的')
const r_chat3 = await run('写作卡文了怎么办')
const r_chat4 = await run('谢谢你的帮助')
t('S3-对话 4例0工具', r_chat1.toolCalls===0&&r_chat2.toolCalls===0&&r_chat3.toolCalls===0&&r_chat4.toolCalls===0,
  '你好:'+r_chat1.toolCalls+' 介绍:'+r_chat2.toolCalls+' 建议:'+r_chat3.toolCalls+' 感谢:'+r_chat4.toolCalls)

console.log('│ 模糊边界')
const r_amb1 = await run('看看')
t('S3-看看(应0)', r_amb1.toolCalls===0, r_amb1.toolCalls+'工具'+'⚠')
const r_amb2 = await run('帮我看看')
t('S3-帮我看看(应0)', r_amb2.toolCalls===0, r_amb2.toolCalls+'工具'+'⚠')
const r_amb3 = await run('能不能帮我')
t('S3-能不能帮我(应0)', r_amb3.toolCalls===0, r_amb3.toolCalls+'工具'+'⚠')

console.log('│ 间接请求')
const r_ind1 = await run('林语晴的角色信息是什么')
t('S3-间接→读', r_ind1.toolCalls>=1, r_ind1.iterations+'轮 '+r_ind1.toolCalls+'工具')
const r_ind2 = await run('第3章讲了什么')
t('S3-第3章→读', r_ind2.toolCalls>=1, r_ind2.iterations+'轮 '+r_ind2.toolCalls+'工具')
const r_ind3 = await run('项目里有几个角色')
t('S3-角色数→列', r_ind3.toolCalls>=1, r_ind3.iterations+'轮 '+r_ind3.toolCalls+'工具')

console.log('│ 复杂编排')
const r_cpx = await run('先列出项目1的characters目录，然后读取第一个角色，最后写一个分析笔记"真实分析笔记"')
t('S3-列→读→写笔记', r_cpx.toolCalls>=3, r_cpx.iterations+'轮 '+r_cpx.toolCalls+'工具')

console.log('│ 错误恢复')
const r_err = await run('读 1/characters/不存在的.json，如果不存在就读 1/characters/林语晴.json')
t('S3-读失败→替代', r_err.toolCalls>=2, r_err.iterations+'轮 '+r_err.toolCalls+'工具')

console.log('└─────────────────────────────────────────┘')

const total = pass+fail+warn
console.log('\n═══════════════════════════════════════════')
console.log('  真实系统提示词测试结果')
console.log('═══════════════════════════════════════════')
console.log('  ✅ '+pass+'  ❌ '+fail+'  ⚠️ '+warn+'  通过率: '+((pass/total)*100).toFixed(1)+'%')

// 清理
try{fs.unlinkSync(P('1/characters/赵云.json'))}catch{}
try{fs.unlinkSync(N('真实分析笔记.md'))}catch{}
