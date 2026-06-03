import { useState } from 'react'
import { DocumentTextIcon, MagnifyingGlassIcon, FolderOpenIcon, PencilSquareIcon, PlusIcon, TrashIcon, TagIcon, SparklesIcon, PhotoIcon, GlobeAltIcon, CommandLineIcon, WrenchScrewdriverIcon, XMarkIcon, CheckCircleIcon, ClockIcon, FireIcon } from '@heroicons/react/24/outline'

const ICONS: Record<string,any>={read_file:DocumentTextIcon,search_content:MagnifyingGlassIcon,list_directory:FolderOpenIcon,edit_file:PencilSquareIcon,create_file:PlusIcon,delete_file:TrashIcon,rename_file:TagIcon,create_style_template:SparklesIcon,create_scene_template:SparklesIcon,search_images:PhotoIcon,generate_image:PhotoIcon,kb_list:FolderOpenIcon,kb_search:MagnifyingGlassIcon,http_get:GlobeAltIcon,browser_search:GlobeAltIcon,shell_exec:CommandLineIcon,list_rules:WrenchScrewdriverIcon,learn_rule:WrenchScrewdriverIcon}
const LABELS: Record<string,string>={read_file:'读取文件',search_content:'搜索内容',list_directory:'列出目录',edit_file:'编辑文件',create_file:'创建文件',delete_file:'删除文件',rename_file:'重命名',create_style_template:'创建风格模板',create_scene_template:'创建场景模板',search_images:'搜索图片',generate_image:'生成图片',kb_list:'知识库列表',kb_create_file:'知识库创建',kb_index_file:'知识库索引',kb_append_file:'知识库追加',list_notes:'列出笔记',read_note:'读取笔记',write_note:'写笔记',append_note:'追加笔记',delete_note:'删除笔记',list_prompts:'提示词列表',toggle_prompt:'切换提示词',update_prompt:'更新提示词',list_rules:'列出规则',learn_rule:'学习规则',update_config:'更新配置',list_audit:'审计列表',write_learning:'记录经验',http_get:'HTTP请求',http_fetch:'HTTP获取',browser_open:'打开浏览器',browser_search:'浏览器搜索',shell_exec:'执行命令',shell_run_script:'运行脚本',lsp_diagnose:'LSP诊断',create_project:'创建项目',delete_project:'删除项目'}

type Step = { tool: string; status: string; summary: string; durationMs: number; iteration: number }
interface Props { toolsUsed: string[]; toolCallSteps?: Step[]; breakdown?: { label: string; chars: number }[]; outputBreakdown?: { label: string; tokens: number }[]; iterationCount?: number; totalIterations?: number; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; onClose: () => void }

function groupByIter(steps: Step[]) {
  const m = new Map<number, Step[]>()
  for (const s of steps) { const k = s.iteration||1; if(!m.has(k)) m.set(k,[]); m.get(k)!.push(s) }
  return m
}

export function ToolDetailPanel(p: Props) {
  const { toolsUsed, toolCallSteps, breakdown, outputBreakdown, iterationCount, totalIterations, usage, onClose } = p
  const [tab, setTab] = useState<'tools'|'tokens'>('tools')
  const steps = toolCallSteps || []
  const groups = steps.length > 0 ? groupByIter(steps) : null
  const freq: Record<string,number> = {}
  for (const s of steps) freq[s.tool] = (freq[s.tool]||0) + 1
  if (steps.length === 0) for (const t of toolsUsed) freq[t] = (freq[t]||0) + 1

  const head = (t:string) => <span style={{fontSize:12,fontWeight:700,color:'#2d2520'}}>{t}</span>
  const sub = (t:string) => <span style={{fontSize:11,color:'#9b8e84'}}>{t}</span>

  return (<>
    <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:299,background:'rgba(0,0,0,0.15)'}}/>
    <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:300,background:'#fff',borderRadius:16,boxShadow:'0 16px 64px rgba(0,0,0,0.2)',border:'1px solid rgba(0,0,0,0.08)',width:420,maxHeight:'70vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(0,0,0,0.06)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>{head('消息工具详情')}<div style={{marginTop:2}}>{sub(`${steps.length||toolsUsed.length} 次调用 · ${iterationCount||1} 轮迭代${(usage&&usage.totalTokens>0)?` · ${(usage.totalTokens/1000).toFixed(1)}K token`:''}`)}</div></div>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',padding:4,borderRadius:6,color:'#9b8e84'}}><XMarkIcon style={{width:18,height:18}}/></button>
      </div>
      <div style={{display:'flex',borderBottom:'1px solid rgba(0,0,0,0.06)',padding:'0 20px'}}>
        {(['tools','tokens'] as const).map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:'8px 16px',border:'none',background:'none',borderBottom:tab===t?'2px solid #7c3aed':'2px solid transparent',color:tab===t?'#7c3aed':'#9b8e84',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>{t==='tools'?'🛠 工具详情':'📊 Token分解'}</button>)}
      </div>
      <div style={{padding:16,overflow:'auto',flex:1}}>
        {tab==='tools'&&<div>
          {toolsUsed.length===0?<div style={{textAlign:'center',color:'#9b8e84',padding:20}}><CheckCircleIcon style={{width:32,height:32,color:'#16a34a',margin:'0 auto 8px'}}/><div style={{fontSize:13}}>无工具调用</div></div>
          :<div>
            {/* tool frequency summary */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
              {Object.entries(freq).map(([tool,n])=>{
                const I=ICONS[tool]||WrenchScrewdriverIcon; const L=LABELS[tool]||tool
                return <div key={tool} style={{padding:'4px 8px',borderRadius:6,background:'rgba(124,58,237,0.04)',border:'1px solid rgba(124,58,237,0.08)',fontSize:10,display:'flex',alignItems:'center',gap:4}}><I style={{width:12,height:12,color:'#7c3aed'}}/><span style={{color:'#4a3f38',fontWeight:600}}>{L}</span><span style={{color:'#7c3aed',fontWeight:700}}>×{n}</span></div>
              })}
            </div>
            {/* detail: grouped by iteration */}
            {groups&&<div style={{display:'flex',flexDirection:'column',gap:1,fontSize:10}}>
              <div style={{fontWeight:600,color:'#9b8e84',marginBottom:2}}>逐步记录</div>
              {Array.from(groups.entries()).map(([iter,ss])=><div key={iter}>
                <div style={{fontWeight:700,color:'#9b8e84',padding:'2px 0 1px 0'}}>第{iter}轮</div>
                {ss.map((s,j)=>{const I=ICONS[s.tool]||WrenchScrewdriverIcon;const L=LABELS[s.tool]||s.tool;const e=s.status==='error'
                  return <div key={j} style={{display:'flex',alignItems:'flex-start',gap:6,padding:'2px 4px',borderRadius:4,opacity:e?.7:1}}>
                    <div style={{width:16,height:16,borderRadius:4,flexShrink:0,background:e?'rgba(220,38,38,0.1)':'rgba(124,58,237,0.08)',display:'flex',alignItems:'center',justifyContent:'center',marginTop:1}}>{e?<FireIcon style={{width:9,height:9,color:'#dc2626'}}/>:<I style={{width:9,height:9,color:'#7c3aed'}}/>}</div>
                    <div style={{flex:1,minWidth:0}}><span style={{fontWeight:600,color:e?'#dc2626':'#4a3f38'}}>{L}</span><span style={{color:'#9b8e84',marginLeft:4}}>{s.durationMs}ms</span><div style={{color:e?'#dc2626':'#16a34a'}}>{e?'❌':'✅'} {s.summary.slice(0,60)}</div></div>
                  </div>
                })}
              </div>)}
            </div>}
            {!groups&&<div style={{display:'flex',flexDirection:'column',gap:6}}>{toolsUsed.map((tool,i)=>{const I=ICONS[tool]||WrenchScrewdriverIcon;const L=LABELS[tool]||tool
              return <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:10,background:i===0?'rgba(124,58,237,0.04)':'transparent',border:i===0?'1px solid rgba(124,58,237,0.08)':'1px solid transparent'}}><div style={{width:32,height:32,borderRadius:8,background:'rgba(124,58,237,0.08)',display:'flex',alignItems:'center',justifyContent:'center'}}><I style={{width:16,height:16,color:'#7c3aed'}}/></div><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:'#4a3f38'}}>{L}</div><div style={{fontSize:10,color:'#9b8e84',fontFamily:'monospace'}}>{tool}</div></div><div style={{fontSize:10,color:'#9b8e84'}}>#{i+1}</div></div>
            })}</div>}
            <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
              {iterationCount&&<div style={{padding:'6px 10px',borderRadius:8,background:'rgba(124,58,237,0.04)',fontSize:11,color:'#6b5e54'}}><ClockIcon style={{width:12,height:12,display:'inline',marginRight:4}}/>{iterationCount}轮迭代</div>}
              {usage&&<><div style={{padding:'6px 10px',borderRadius:8,background:'rgba(37,99,235,0.04)',fontSize:11,color:'#6b5e54'}}>↑{usage.prompt_tokens.toLocaleString()}输入</div><div style={{padding:'6px 10px',borderRadius:8,background:'rgba(22,163,74,0.04)',fontSize:11,color:'#6b5e54'}}>↓{usage.completion_tokens.toLocaleString()}输出</div></>}
            </div>
          </div>}
        </div>}
        {tab==='tokens'&&<div>
          {breakdown&&breakdown.length>0?<div style={{display:'flex',flexDirection:'column',gap:4}}>
            {breakdown.map((b,i)=>{const pct=usage?.prompt_tokens?((Math.round(b.chars/2))/usage.prompt_tokens*100).toFixed(1):'0'
              return <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,background:i%2===0?'rgba(0,0,0,0.02)':'transparent'}}><div style={{flex:1}}><div style={{fontSize:11,color:'#4a3f38'}}>{b.label}</div></div><div style={{fontSize:10,color:'#9b8e84',textAlign:'right'}}>{b.chars.toLocaleString()}字</div><div style={{width:60,textAlign:'right',fontSize:10,color:'#7c3aed'}}>~{Math.round(b.chars/2).toLocaleString()}t</div><div style={{fontSize:10,color:'#9b8e84',width:40,textAlign:'right'}}>{pct}%</div></div>
            })}
            {outputBreakdown&&outputBreakdown.map((b,i)=><div key={'o'+i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,background:'rgba(22,163,74,0.03)'}}><div style={{flex:1}}><div style={{fontSize:11,color:'#16a34a'}}>{b.label}</div></div><div style={{fontSize:10,color:'#16a34a',textAlign:'right'}}>{b.tokens.toLocaleString()}t</div></div>)}
          </div>:<div style={{textAlign:'center',color:'#9b8e84',padding:20}}>无Token分解数据</div>}
        </div>}
      </div>
    </div>
  </>)
}
