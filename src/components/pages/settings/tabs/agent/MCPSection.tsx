import { useState, useEffect, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import Button from '@/components/common/Button'
import { PlusIcon, TrashIcon, PlayIcon, StopIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { inputStyle, textareaStyle, captionText } from '@/components/common/styles'
import { SkeletonList } from '@/components/common/Skeleton'
import EmptyState from '@/components/common/EmptyState'

interface MCPServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled?: boolean
}

interface MCPServerStatus {
  name: string
  connected: boolean
  tools: number
}

import { mcpService } from '@/services/electronBridge'

const ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3']

export function MCPSection() {
  const [configs, setConfigs] = useState<MCPServerConfig[]>([])
  const [statuses, setStatuses] = useState<MCPServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [expandedTools, setExpandedTools] = useState<string | null>(null)
  const [serverTools, setServerTools] = useState<Record<string, Array<{ name: string; description: string }>>>({})

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const saved = await mcpService.loadConfig()
      setConfigs(saved)
    } catch { /* first time */ }
    setLoading(false)
  }, [])

  const refreshStatuses = useCallback(async () => {
    try {
      const result = await mcpService.listServers()
      setStatuses(result.servers || [])
    } catch { setStatuses([]) }
  }, [])

  useEffect(() => { loadConfigs(); refreshStatuses() }, [loadConfigs, refreshStatuses])

  const saveConfigs = async (next: MCPServerConfig[]) => {
    setConfigs(next)
    try { await mcpService.saveConfig(next) } catch { /* */ }
  }

  const addServer = () => {
    const next = [...configs, { name: `server-${configs.length + 1}`, command: 'npx', args: [], enabled: true }]
    saveConfigs(next)
    setEditingIdx(next.length - 1)
  }

  const removeServer = (idx: number) => {
    const name = configs[idx].name
    const next = configs.filter((_, i) => i !== idx)
    saveConfigs(next)
    if (editingIdx === idx) setEditingIdx(null)
    mcpService.disconnectServer(name).then(() => refreshStatuses()).catch(() => {})
  }

  const updateConfig = (idx: number, patch: Partial<MCPServerConfig>) => {
    const next = configs.map((c, i) => i === idx ? { ...c, ...patch } : c)
    saveConfigs(next)
  }

  const connectServer = async (config: MCPServerConfig) => {
    try {
      await mcpService.connectServer(config.name, config)
      refreshStatuses()
    } catch { /* handled by backend */ }
  }

  const disconnectServer = async (name: string) => {
    await mcpService.disconnectServer(name)
    refreshStatuses()
  }

  const loadTools = async (serverName: string) => {
    if (serverTools[serverName]) {
      setExpandedTools(expandedTools === serverName ? null : serverName)
      return
    }
    try {
      const result = await mcpService.listTools(serverName)
      const tools = JSON.parse(result.detail || '[]')
      setServerTools(prev => ({ ...prev, [serverName]: tools }))
      setExpandedTools(serverName)
    } catch { /* */ }
  }

  const getStatus = (name: string) => statuses.find(s => s.name === name)

  if (loading) return <SkeletonList count={3} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>MCP 工具服务器</div>
          <div style={captionText}>通过 Model Context Protocol 连接外部工具扩展 Agent 能力</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={refreshStatuses} icon={<ArrowPathIcon style={{ width: 14, height: 14 }} />}>刷新</Button>
          <Button size="sm" onClick={addServer} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加服务器</Button>
        </div>
      </div>

      {/* Allowed commands hint */}
      <div style={{ fontSize: 10, color: '#9b8e84', padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.02)' }}>
        安全限制：仅允许命令 {ALLOWED_COMMANDS.join(', ')}
      </div>

      {/* Server list */}
      {configs.length === 0 ? (
        <EmptyState
          icon="🔌"
          title="暂无 MCP 服务器"
          description="添加 MCP 服务器可以为 Agent 扩展更多工具能力，如数据库查询、API 调用等"
          action={{ label: '添加服务器', onClick: addServer }}
        />
      ) : (
        configs.map((config, idx) => {
          const status = getStatus(config.name)
          const isEditing = editingIdx === idx
          const isConnected = status?.connected ?? false

          return (
            <div key={idx} className="stagger-item" style={{
              padding: 14, borderRadius: 14,
              background: isConnected ? 'rgba(22,163,74,0.03)' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${isConnected ? 'rgba(22,163,74,0.15)' : 'rgba(0,0,0,0.06)'}`,
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isConnected ? '#16a34a' : '#d4ccc4',
                    boxShadow: isConnected ? '0 0 6px rgba(22,163,74,0.3)' : 'none',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{config.name}</span>
                  <span style={{ fontSize: 10, color: '#9b8e84' }}>{config.command} {(config.args || []).join(' ')}</span>
                  {isConnected && status && (
                    <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>{status.tools} 个工具</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isConnected && (
                    <button onClick={() => loadTools(config.name)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#7c3aed' }} title="查看工具">
                      <PlayIcon style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                  {isConnected ? (
                    <button onClick={() => disconnectServer(config.name)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#dc2626' }} title="断开">
                      <StopIcon style={{ width: 14, height: 14 }} />
                    </button>
                  ) : (
                    <button onClick={() => connectServer(config)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#16a34a' }} title="连接">
                      <PlayIcon style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                  <button onClick={() => setEditingIdx(isEditing ? null : idx)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#6b5e54', fontSize: 11 }}>
                    {isEditing ? '收起' : '编辑'}
                  </button>
                  <button onClick={() => removeServer(idx)} className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#d4ccc4' }} title="删除">
                    <TrashIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 2, display: 'block' }}>名称</label>
                      <input value={config.name} onChange={e => updateConfig(idx, { name: e.target.value })} className="focus-ring" style={inputStyle} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 2, display: 'block' }}>命令</label>
                      <select value={config.command} onChange={e => updateConfig(idx, { command: e.target.value })} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                        {ALLOWED_COMMANDS.map(cmd => <option key={cmd} value={cmd}>{cmd}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 2, display: 'block' }}>参数（每行一个）</label>
                    <textarea
                      value={(config.args || []).join('\n')}
                      onChange={e => updateConfig(idx, { args: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                      className="focus-ring"
                      style={{ ...textareaStyle, minHeight: 50, fontSize: 11 }}
                      placeholder={"@modelcontextprotocol/server-filesystem\n/path/to/allowed/dir"}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 2, display: 'block' }}>环境变量（JSON，可选）</label>
                    <input
                      value={config.env ? JSON.stringify(config.env) : ''}
                      onChange={e => {
                        try { updateConfig(idx, { env: JSON.parse(e.target.value) }) }
                        catch { /* invalid json, ignore */ }
                      }}
                      className="focus-ring"
                      style={{ ...inputStyle, fontSize: 11 }}
                      placeholder='{"KEY": "value"}'
                    />
                  </div>
                </div>
              )}

              {/* Tools list */}
              {expandedTools === config.name && serverTools[config.name] && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>
                    可用工具 ({serverTools[config.name].length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }} className="custom-scrollbar">
                    {serverTools[config.name].map((tool, i) => (
                      <div key={i} style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', fontSize: 11 }}>
                        <span style={{ fontWeight: 600, color: '#7c3aed' }}>{tool.name}</span>
                        <span style={{ color: '#9b8e84', marginLeft: 6 }}>{tool.description?.slice(0, 80)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
