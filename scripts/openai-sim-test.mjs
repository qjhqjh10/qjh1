#!/usr/bin/env node
/**
 * OpenAI 协议 CLI 仿真测试
 * 直接调用 DeepSeek /v1/chat/completions，模拟 V4AgentRuntime 完整循环。
 * 对比 Anthropic 协议，验证 OpenAI tool_calls 模式下的 agent 表现。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const API_KEY = process.env.AI_API_KEY || 'sk-your-key-here'
const OPENAI_URL = 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-chat'
const MAX_ITERATIONS = 10
const ROOT = process.cwd()
const P = p => path.join(ROOT, 'projects', p)
const N = p => path.join(ROOT, 'notes', p)
const K = p => path.join(ROOT, 'knowledge_base/files', p)

const tools = {
  read_file: a => { try { const c=fs.readFileSync(P(a.file_path||a.path),'utf-8'); return c.length>2000?c.slice(0,2000)+'\n…('+c.length+'字)':c; } catch(e) { return `[错误: 文件不存在]`; } },
  list_directory: a => { try { const e=fs.readdirSync(P(a.path||'.'),{withFileTypes:true}); return e.map(x=>(x.isDirectory()?'DIR ':'FILE ')+x.name).join('\n'); } catch(e) { return `[错误: 目录不存在]`; } },
  search_content: a => { try { const fp=P(a.path||'.'); const re=new RegExp((a.pattern||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'); const results=[]; function searchDir(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory()){searchDir(f);continue}const c=fs.readFileSync(f,'utf-8');const ls=c.split('\n');for(let i=0;i<ls.length;i++)if(re.test(ls[i]))results.push(f.replace(ROOT+'/projects/','')+':'+(i+1)+':'+ls[i].slice(0,200))}} if(fs.statSync(fp).isFile()){const c=fs.readFileSync(fp,'utf-8');const ls=c.split('\n');for(let i=0;i<ls.length;i++)if(re.test(ls[i]))results.push((a.path||'')+':'+(i+1)+':'+ls[i].slice(0,200))}else searchDir(fp);return results.slice(0,15).join('\n')||'无匹配'; } catch(e) { return '[错误]'; } },
  create_file: a => { try { const fp=P(a.file_path||a.path); const c=a.content||''; if(fp.endsWith('.yaml')&&c) try{JSON.parse(c)}catch(e){return `[JSON格式错误: ${e.message}]`}; fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,c); return `创建成功: ${a.file_path}`; } catch(e) { return `[错误: ${e.message}]`; } },
  edit_file: a => { try { const fp=P(a.file_path);let c=fs.readFileSync(fp,'utf-8');const old=a.old_string||'';const nw=a.new_string||'';if(old==='__FULL_REPLACE__'){fs.writeFileSync(fp,nw);return '全量替换成功'} let idx=c.indexOf(old);if(idx<0)idx=c.indexOf(old.trim());if(idx<0)return `[未找到匹配文本]`;fs.writeFileSync(fp,c.slice(0,idx)+nw+c.slice(idx+old.length));return '编辑成功'; } catch(e) { return `[错误: ${e.message}]`; } },
  delete_file: a => { try { fs.unlinkSync(P(a.file_path)); return '删除成功'; } catch(e) { return `[错误]`; } },
  kb_list: () => { try { return fs.readdirSync(K('')).filter(f=>f.endsWith('.md')).join('\n')||'无KB文件'; } catch { return '无KB文件'; } },
  kb_create_file: a => { try { fs.mkdirSync(K(''),{recursive:true}); fs.writeFileSync(K((a.name||'x')+'.md'),a.content||''); return 'KB创建成功'; } catch(e) { return `[错误]`; } },
  list_notes: () => { try { fs.mkdirSync(N(''),{recursive:true}); return fs.readdirSync(N('')).filter(f=>f.endsWith('.md')).join('\n')||'无笔记'; } catch { return '无笔记'; } },
  write_note: a => { try { fs.mkdirSync(N(''),{recursive:true}); fs.writeFileSync(N((a.name||'x')+'.md'),a.content||''); return '笔记创建成功'; } catch(e) { return `[错误]`; } },
  read_note: a => { try { return fs.readFileSync(N((a.name||'x')+'.md'),'utf-8').slice(0,500); } catch { return '[笔记不存在]'; } },
  delete_note: a => { try { fs.unlinkSync(N((a.name||'x')+'.md')); return '笔记删除成功'; } catch { return '[错误]'; } },
  create_style_template: a => { try { const fp=path.join(ROOT,'style_templates',(a.name||'x')+'.yaml'); fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,yaml.dump(a,null,2)); return '模板创建成功'; } catch(e) { return `[错误]`; } },
  create_project: a => { try { const d=P(a.name);['characters','chapters','outline','detailed_outline','summaries'].forEach(s=>fs.mkdirSync(path.join(d,s),{recursive:true})); return `项目${a.name}创建成功`; } catch(e) { return `[错误]`; } },
  delete_project: a => { try { fs.rmSync(P(a.name),{recursive:true,force:true}); return '项目删除成功'; } catch(e) { return `[错误]`; } },
  list_prompts: () => '灵感/世界观/角色/大纲/细纲/章节/润色/续写/改写/摘要/审稿',
  list_rules: () => '暂无自定义规则',
  learn_rule: () => '规则已学习',
  list_audit: () => '暂无审计记录',
  write_learning: () => '经验已记录',
}

const TOOLS = [
  {type:'function',function:{name:'read_file',description:'读取项目文件',parameters:{type:'object',properties:{file_path:{type:'string',description:'文件相对路径'}},required:['file_path']}}},
  {type:'function',function:{name:'list_directory',description:'列出目录内容',parameters:{type:'object',properties:{path:{type:'string',description:'目录路径'}},required:['path']}}},
  {type:'function',function:{name:'search_content',description:'搜索文件内容',parameters:{type:'object',properties:{pattern:{type:'string',description:'搜索关键词'},path:{type:'string',description:'搜索路径'}},required:['pattern']}}},
  {type:'function',function:{name:'create_file',description:'创建新文件。JSON自动校验。',parameters:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}},required:['file_path','content']}}},
  {type:'function',function:{name:'edit_file',description:'编辑文件。先read_file。',parameters:{type:'object',properties:{file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}}},
  {type:'function',function:{name:'delete_file',description:'删除文件',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}},
  {type:'function',function:{name:'kb_list',description:'列出知识库文件',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'kb_create_file',description:'创建KB文件',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'list_notes',description:'列出所有笔记',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'write_note',description:'创建笔记',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}},
  {type:'function',function:{name:'read_note',description:'读取笔记',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'delete_note',description:'删除笔记',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'create_style_template',description:'创建风格模板',parameters:{type:'object',properties:{name:{type:'string'},type:{type:'string'}},required:['name','type']}}},
  {type:'function',function:{name:'create_project',description:'创建项目',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'delete_project',description:'删除项目',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}},
  {type:'function',function:{name:'list_prompts',description:'列出提示词',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'list_rules',description:'列出已学习规则',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'learn_rule',description:'学习新规则',parameters:{type:'object',properties:{rule:{type:'string'}},required:['rule']}}},
  {type:'function',function:{name:'list_audit',description:'查看审计记录',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'write_learning',description:'记录学习经验',parameters:{type:'object',properties:{summary:{type:'string'}},required:['summary']}}},
]

const SYS = [
  '你是青剑AI写作助手。',
  '# 铁律：何时用工具，何时不用',
  '✅ 调工具（用户要求操作文件）: 读取/列出/搜索/创建/编辑/删除/写/保存/修改/改/看(文件)/找(文件)',
  '❌ 不调工具（纯对话）: 我是/我叫/我喜欢/我觉得/你好/嗨/谢谢/什么是/为什么/怎么/推荐/建议',
  '',
  '# 执行规则',
  '- 已知路径直接读文件，不列目录。修改前先读。只做用户要求的，不多做。回复简洁。',
  '- 多个独立操作可在同一轮并行完成。有依赖的操作分轮执行。',
  '',
  '# 路径',
  '角色: 1/characters/中文名.yaml  章节: 1/chapters/chapterN.txt',
  '细纲: 1/detailed_outline/chapterN.yaml  大纲: 1/outline/plot.md',
].join('\n')

async function callOpenAI(messages) {
  const body = { model: MODEL, messages, max_tokens: 2048, tools: TOOLS, tool_choice: 'auto' }
  const res = await fetch(OPENAI_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY}, body:yaml.dump(body) })
  if (!res.ok) throw new Error('HTTP '+res.status+': '+(await res.text()).slice(0,200))
  const json = await res.yaml()
  const choice = json.choices[0]
  return {
    text: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage,
  }
}

async function agentRun(userMsg) {
  const messages = [
    { role: 'system', content: SYS },
    { role: 'user', content: userMsg },
  ]
  let iterations = 0, totalTools = 0, fullText = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++
    process.stdout.write(`[iter${iterations}] `)
    const r = await callOpenAI(messages)
    if (r.text) fullText = r.text

    if (!r.toolCalls.length) return { text: fullText, iterations, toolCalls: totalTools }

    // 构建 assistant 消息
    const asstMsg = { role: 'assistant', content: r.text || null, tool_calls: r.toolCalls }
    messages.push(asstMsg)

    // 执行工具
    for (const tc of r.toolCalls) {
      const fn = tc.function
      const toolFn = tools[fn.name]
      let args = {}
      try { args = JSON.parse(fn.arguments) } catch {}
      const result = toolFn ? await toolFn(args) : '[未知工具]'
      totalTools++
      process.stdout.write(fn.name+(result.startsWith&&result.startsWith('[')?'✗':'✓')+' ')
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
    process.stdout.write('\n')
  }
  return { text: fullText, iterations, toolCalls: totalTools }
}

let pass=0, fail=0
function t(name, cond, detail) { if(cond){pass++;console.log('  ✅ '+name+(detail?': '+detail:''))}else{fail++;console.log('  ❌ '+name+(detail?': '+detail:''))} }

console.log('═══════════════════════════════════════════')
console.log('  OpenAI 协议 CLI 仿真测试')
console.log('  端点: '+OPENAI_URL+'  模型: '+MODEL)
console.log('═══════════════════════════════════════════\n')

async function main() {
  // S1: 纯对话
  console.log('▶ S1 纯文本对话(0工具)')
  const r1 = await agentRun('你好，请用一句话介绍你自己')
  t('S1 纯文本0工具', r1.toolCalls===0, r1.iterations+'轮')

  // S2: 读文件
  console.log('\n▶ S2 读取文件')
  const r2 = await agentRun('读取 1/characters/林语晴.yaml')
  t('S2 读角色文件', r2.toolCalls>=1, r2.iterations+'轮 '+r2.toolCalls+'工具')

  // S3: 列目录
  console.log('\n▶ S3 列出目录')
  const r3 = await agentRun('列出项目1的characters目录')
  t('S3 列目录', r3.toolCalls>=1, r3.iterations+'轮 '+r3.toolCalls+'工具')

  // S4: 读+搜索混合
  console.log('\n▶ S4 读+搜索')
  const r4 = await agentRun('读 1/chapters/chapter1.txt，搜索其中"静止"出现次数')
  t('S4 读+搜索', r4.toolCalls>=2, r4.iterations+'轮 '+r4.toolCalls+'工具')

  // S5: 复杂编排(读→创建)
  console.log('\n▶ S5 读→创建')
  const r5 = await agentRun('读 1/characters/林语晴.yaml 了解格式，然后创建新角色"测试-OpenAI-probe": id=test_probe, name=测试-OpenAI-probe, role=男配, gender=男, age=25, occupation=测试员, background=这是OpenAI协议测试角色, appearance=测试外观, personality=测试性格, abilities=测试能力, weaknesses=测试弱点, relationships=无, relationshipTags=["测试"], arc=测试弧线, importance=10。保存到 1/characters/测试-OpenAI-probe.yaml')
  t('S5 读→创建角色', r5.toolCalls>=2&&r5.iterations<=6, r5.iterations+'轮 '+r5.toolCalls+'工具')

  // S6: KB操作
  console.log('\n▶ S6 KB操作')
  const r6 = await agentRun('列出知识库文件，然后创建一个KB文件"OpenAI测试要点"，内容"这是OpenAI协议测试"')
  t('S6 KB列+创建', r6.toolCalls>=2, r6.iterations+'轮 '+r6.toolCalls+'工具')

  // S7: 笔记全流程
  console.log('\n▶ S7 笔记全流程')
  const r7a = await agentRun('创建笔记"OpenAI测试笔记"，内容"OpenAI协议测试笔记内容"')
  const r7b = await agentRun('读取笔记"OpenAI测试笔记"')
  const r7c = await agentRun('删除笔记"OpenAI测试笔记"')
  t('S7 笔记创建+读+删', r7a.toolCalls>=1&&r7b.toolCalls>=1&&r7c.toolCalls>=1, '3步')

  // S8: 模板创建
  console.log('\n▶ S8 模板创建')
  const r8 = await agentRun('创建风格模板 name=OpenAI测试风格 type=普通小说')
  t('S8 风格模板', r8.toolCalls>=1, r8.iterations+'轮 '+r8.toolCalls+'工具')

  // S9: 项目管理
  console.log('\n▶ S9 项目管理')
  const r9a = await agentRun('创建项目test-openai-probe')
  const r9b = await agentRun('删除项目test-openai-probe')
  t('S9 项目创建+删除', r9a.toolCalls>=1&&r9b.toolCalls>=1, '2步')

  // S10: 多轮工具循环
  console.log('\n▶ S10 多轮工具循环')
  const r10 = await agentRun('先列出项目1的characters目录，然后读取第一个角色文件，最后告诉我这个角色的基本信息摘要')
  t('S10 列→读→总结', r10.toolCalls>=2&&r10.iterations>=2, r10.iterations+'轮 '+r10.toolCalls+'工具')

  // S11: 错误恢复
  console.log('\n▶ S11 错误恢复')
  const r11 = await agentRun('读取 1/characters/不存在角色.yaml，如果不存在就读取 1/characters/林语晴.yaml')
  t('S11 读失败→读替代', r11.toolCalls>=2, r11.iterations+'轮 '+r11.toolCalls+'工具')

  // S12: 对话类不应调工具
  console.log('\n▶ S12 对话类防误调')
  const r12a = await agentRun('你好，我叫张伟')
  const r12b = await agentRun('我喜欢写玄幻小说')
  const r12c = await agentRun('写作遇到瓶颈怎么办')
  t('S12 3个对话类0工具', r12a.toolCalls===0&&r12b.toolCalls===0&&r12c.toolCalls===0,
    '你好:'+r12a.toolCalls+' 偏好:'+r12b.toolCalls+' 建议:'+r12c.toolCalls)

  // 汇总
  const total = pass+fail
  console.log('\n\n═══════════════════════════════════════════')
  console.log('  OpenAI 协议测试结果')
  console.log('═══════════════════════════════════════════')
  console.log('  ✅ '+pass+'  ❌ '+fail+'  通过率: '+((pass/total)*100).toFixed(1)+'%')
}

main().catch(e => { console.error('\n💥 测试异常:', e.message); process.exit(1) })
