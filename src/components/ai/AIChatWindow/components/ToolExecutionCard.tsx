import { motion } from 'framer-motion'
import { useAgentStore, type ToolExecutionState } from '@/agent/store/AgentStore'

function ToolIcon({ toolName }: { toolName: string }) {
  const icons: Record<string, string> = {
    read_file: '\u{1F4D6}', list_directory: '\u{1F4C2}',
    search_content: '\u{1F50E}',
    edit_file: '\u{270F}\u{FE0F}', create_file: '\u{1F4DD}',
    delete_file: '\u{1F5D1}', rename_file: '\u{1F4DD}',
    create_project: '\u{1F3D7}', delete_project: '\u{1F5D1}',
    kb_list: '\u{1F4DA}', kb_create_file: '\u{1F4BE}',
    kb_append_file: '\u{2795}', kb_index_file: '\u{1F50D}',
    list_notes: '\u{1F4CB}', read_note: '\u{1F4C4}',
    write_note: '\u{270F}\u{FE0F}', append_note: '\u{2795}',
    delete_note: '\u{1F5D1}',
    search_images: '\u{1F5BC}', generate_image: '\u{1F3A8}',
    list_prompts: '\u{1F4CB}', toggle_prompt: '\u{1F504}',
    update_prompt: '\u{270F}\u{FE0F}',
    create_style_template: '\u{1F3A8}', create_scene_template: '\u{1F3AC}',
  }
  return <span style={{ fontSize: 14 }}>{icons[toolName] || '\u{1F527}'}</span>
}

const STATUS_COLORS = {
  pending:  { dot: '#9b8e84', text: '#9b8e84', bg: 'transparent' },
  running:  { dot: '#2563eb', text: '#2563eb', bg: 'rgba(37,99,235,0.06)' },
  success:  { dot: '#059669', text: '#059669', bg: 'rgba(5,150,105,0.06)' },
  error:    { dot: '#dc2626', text: '#dc2626', bg: 'rgba(220,38,38,0.06)' },
}

export function ToolExecutionCard({ tool }: { tool: ToolExecutionState }) {
  const colors = STATUS_COLORS[tool.status]

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        padding: '8px 12px', borderRadius: 6, marginBottom: 4,
        background: colors.bg, border: `1px solid ${colors.dot}20`,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, fontFamily: 'inherit',
        overflow: 'hidden',
      }}
    >
      <ToolIcon toolName={tool.toolName} />

      <span style={{ fontWeight: 600, color: colors.text, minWidth: 100, fontSize: 11 }}>
        {tool.toolName}
      </span>

      {/* Progress bar */}
      {tool.status === 'running' && (
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${tool.progress * 100}%` }}
            style={{ height: '100%', background: colors.dot, borderRadius: 2 }}
          />
        </div>
      )}

      {/* Status dot */}
      <span style={{
        width: 6, height: 6, borderRadius: 3, background: colors.dot,
        animation: tool.status === 'running' ? 'pulse 1s infinite' : 'none',
        flexShrink: 0,
      }} />

      {/* Summary */}
      <span style={{ color: '#9b8e84', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {tool.summary || tool.status}
      </span>
    </motion.div>
  )
}

export function ToolExecutionPanel() {
  const activeTools = useAgentStore(s => s.run.activeTools)
  const isRunning = useAgentStore(s => s.run.isRunning)
  const tools = Object.values(activeTools)

  if (tools.length === 0) {
    if (!isRunning) return null
    return <div style={{ fontSize: 10, color: '#9b8e84', padding: '4px 14px' }}>⏳ 等待工具执行...</div>
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {tools.map(tool => (
        <ToolExecutionCard key={tool.callId} tool={tool} />
      ))}
    </div>
  )
}
