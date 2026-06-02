/**
 * 工具详情面板 — 右键消息时显示该消息使用了哪些工具及详情
 */
import { useState } from 'react'
import {
  DocumentTextIcon, MagnifyingGlassIcon, FolderOpenIcon,
  PencilSquareIcon, PlusIcon, TrashIcon, TagIcon,
  SparklesIcon, PhotoIcon, GlobeAltIcon, CommandLineIcon,
  WrenchScrewdriverIcon, ArrowPathRoundedSquareIcon,
  XMarkIcon, CheckCircleIcon, ClockIcon, FireIcon,
} from '@heroicons/react/24/outline'

const TOOL_ICONS: Record<string, any> = {
  read_file: DocumentTextIcon,
  search_files: MagnifyingGlassIcon,
  search_content: MagnifyingGlassIcon,
  list_directory: FolderOpenIcon,
  edit_file: PencilSquareIcon,
  create_file: PlusIcon,
  delete_file: TrashIcon,
  rename_file: TagIcon,
  create_style_template: SparklesIcon,
  create_scene_template: SparklesIcon,
  search_images: PhotoIcon,
  generate_image: PhotoIcon,
  kb_list: FolderOpenIcon,
  kb_search: MagnifyingGlassIcon,
  http_get: GlobeAltIcon,
  browser_search: GlobeAltIcon,
  shell_exec: CommandLineIcon,
  list_rules: WrenchScrewdriverIcon,
  learn_rule: WrenchScrewdriverIcon,
}

const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  search_files: '搜索文件',
  search_content: '搜索内容',
  list_directory: '列出目录',
  edit_file: '编辑文件',
  create_file: '创建文件',
  delete_file: '删除文件',
  rename_file: '重命名',
  create_style_template: '创建风格模板',
  create_scene_template: '创建场景模板',
  search_images: '搜索图片',
  generate_image: '生成图片',
  kb_list: '知识库列表',
  kb_create_file: '知识库创建',
  kb_index_file: '知识库索引',
  kb_append_file: '知识库追加',
  list_notes: '列出笔记',
  read_note: '读取笔记',
  write_note: '写笔记',
  append_note: '追加笔记',
  delete_note: '删除笔记',
  list_prompts: '提示词列表',
  toggle_prompt: '切换提示词',
  update_prompt: '更新提示词',
  list_rules: '列出规则',
  learn_rule: '学习规则',
  update_config: '更新配置',
  list_audit: '审计列表',
  write_learning: '记录经验',
  http_get: 'HTTP请求',
  http_fetch: 'HTTP获取',
  browser_open: '打开浏览器',
  browser_search: '浏览器搜索',
  shell_exec: '执行命令',
  shell_run_script: '运行脚本',
  lsp_diagnose: 'LSP诊断',
  create_project: '创建项目',
  delete_project: '删除项目',
}

interface ToolDetailPanelProps {
  toolsUsed: string[]
  breakdown?: { label: string; chars: number }[]
  outputBreakdown?: { label: string; tokens: number }[]
  iterationCount?: number
  totalIterations?: number
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  onClose: () => void
}

export function ToolDetailPanel({
  toolsUsed, breakdown, outputBreakdown, iterationCount, totalIterations, usage, onClose,
}: ToolDetailPanelProps) {
  const [tab, setTab] = useState<'tools' | 'tokens'>('tools')

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.15)' }} />
      <div style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
      zIndex: 300, background: '#fff', borderRadius: 16,
      boxShadow: '0 16px 64px rgba(0,0,0,0.2)', border: '1px solid rgba(0,0,0,0.08)',
      width: 420, maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>消息工具详情</div>
          <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>
            {toolsUsed.length} 个工具 · {iterationCount || 1} 轮迭代
            {usage ? ` · ${(usage.total_tokens / 1000).toFixed(1)}K token` : ''}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#9b8e84' }}>
          <XMarkIcon style={{ width: 18, height: 18 }} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '0 20px' }}>
        {(['tools', 'tokens'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 16px', border: 'none', background: 'none',
            borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
            color: tab === t ? '#7c3aed' : '#9b8e84', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {t === 'tools' ? '🛠 工具列表' : '📊 Token分解'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
        {tab === 'tools' && (
          <div>
            {toolsUsed.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9b8e84', padding: 20 }}>
                <CheckCircleIcon style={{ width: 32, height: 32, color: '#16a34a', margin: '0 auto 8px' }} />
                <div style={{ fontSize: 13 }}>无工具调用</div>
                <div style={{ fontSize: 11, marginTop: 2 }}>纯文本回复，未使用任何工具</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {toolsUsed.map((tool, i) => {
                  const Icon = TOOL_ICONS[tool] || WrenchScrewdriverIcon
                  const label = TOOL_LABELS[tool] || tool
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: i === 0 ? 'rgba(124,58,237,0.04)' : 'transparent',
                      border: i === 0 ? '1px solid rgba(124,58,237,0.08)' : '1px solid transparent',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'rgba(124,58,237,0.08)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon style={{ width: 16, height: 16, color: '#7c3aed' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#4a3f38' }}>{label}</div>
                        <div style={{ fontSize: 10, color: '#9b8e84', fontFamily: 'monospace' }}>{tool}</div>
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>
                        #{i + 1}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {iterationCount && (
                <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.04)', fontSize: 11, color: '#6b5e54' }}>
                  <ClockIcon style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
                  {iterationCount} 轮迭代
                </div>
              )}
              {usage && (
                <>
                  <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(37,99,235,0.04)', fontSize: 11, color: '#6b5e54' }}>
                    ↑ {usage.prompt_tokens.toLocaleString()} 输入
                  </div>
                  <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(22,163,74,0.04)', fontSize: 11, color: '#6b5e54' }}>
                    ↓ {usage.completion_tokens.toLocaleString()} 输出
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'tokens' && (
          <div>
            {breakdown && breakdown.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {breakdown.map((b, i) => {
                  const pct = usage?.prompt_tokens
                    ? ((Math.round(b.chars / 2)) / usage.prompt_tokens * 100).toFixed(1)
                    : '0'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8,
                      background: i % 2 === 0 ? 'rgba(0,0,0,0.02)' : 'transparent',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#4a3f38' }}>{b.label}</div>
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84', textAlign: 'right' }}>
                        {b.chars.toLocaleString()} 字
                      </div>
                      <div style={{ width: 60, textAlign: 'right', fontSize: 10, color: '#7c3aed' }}>
                        ~{Math.round(b.chars / 2).toLocaleString()} t
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84', width: 40, textAlign: 'right' }}>
                        {pct}%
                      </div>
                    </div>
                  )
                })}
                {outputBreakdown && outputBreakdown.map((b, i) => (
                  <div key={`out-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(22,163,74,0.03)',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#16a34a' }}>{b.label}</div>
                    </div>
                    <div style={{ fontSize: 10, color: '#16a34a', textAlign: 'right' }}>
                      {b.tokens.toLocaleString()} t
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#9b8e84', padding: 20 }}>
                无 Token 分解数据
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
