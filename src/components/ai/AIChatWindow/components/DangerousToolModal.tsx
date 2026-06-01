// ── Dangerous Tool Confirmation Modal ──
// Replaces window.confirm() with a proper React UI.
// Shows tool name, truncated args, and Allow/Deny buttons.
// Auto-denies after 180s timeout (same as previous Promise.race timeout).

import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ExclamationTriangleIcon,
  XMarkIcon,
  CheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline'

export interface DangerousTool {
  name: string
  args: Record<string, unknown>
}

interface Props {
  tools: DangerousTool[]
  onResolve: (approved: boolean) => void
}

export const DangerousToolModal: React.FC<Props> = ({ tools, onResolve }) => {
  const [expandedArgs, setExpandedArgs] = useState<Set<number>>(new Set())

  const toggleExpand = useCallback((idx: number) => {
    setExpandedArgs(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  if (tools.length === 0) return null

  const formatArg = (key: string, value: unknown): string => {
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    return str.length > 120 ? str.slice(0, 120) + '…' : str
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={() => onResolve(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)', padding: 24,
            maxWidth: 480, width: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 80px)',
            overflow: 'auto',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(245,158,11,0.12)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldExclamationIcon style={{ width: 20, height: 20, color: '#d97706' }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#2d2520' }}>
                AI 需要执行{ tools.length > 1 ? '危险' : '敏感' }操作
              </div>
              <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>
                以下工具需要你的确认才能执行
              </div>
            </div>
          </div>

          {/* Tool list */}
          <div style={{
            background: 'rgba(0,0,0,0.02)', borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden',
            marginBottom: 20,
          }}>
            {tools.map((tool, idx) => {
              const isExpanded = expandedArgs.has(idx)
              return (
                <div key={idx} style={{
                  padding: '10px 14px',
                  borderBottom: idx < tools.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ExclamationTriangleIcon style={{ width: 16, height: 16, color: '#f59e0b', flexShrink: 0 }} />
                    <code style={{
                      fontSize: 13, fontWeight: 600, color: '#7c3aed',
                      background: 'rgba(124,58,237,0.06)', padding: '1px 6px',
                      borderRadius: 4,
                    }}>
                      {tool.name}
                    </code>
                    <button
                      onClick={() => toggleExpand(idx)}
                      style={{
                        fontSize: 11, color: '#9b8e84', background: 'none',
                        border: 'none', cursor: 'pointer', padding: '2px 6px',
                        borderRadius: 4, marginLeft: 'auto',
                      }}
                    >
                      {isExpanded ? '收起' : '参数 ▸'}
                    </button>
                  </div>
                  {isExpanded && (
                    <div style={{
                      marginTop: 8, padding: '8px 10px', borderRadius: 6,
                      background: 'rgba(0,0,0,0.03)', fontSize: 11,
                      fontFamily: 'monospace', color: '#6b5e58',
                      maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {Object.entries(tool.args).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 2 }}>
                          <span style={{ color: '#7c3aed' }}>{key}</span>
                          <span style={{ color: '#9b8e84' }}>: </span>
                          <span>{formatArg(key, value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onResolve(false)}
              style={{
                padding: '8px 20px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
                background: '#fff', color: '#6b5e58', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <XMarkIcon style={{ width: 16, height: 16 }} />
              拒绝
            </button>
            <button
              onClick={() => onResolve(true)}
              style={{
                padding: '8px 24px', borderRadius: 10, border: 'none',
                background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <CheckIcon style={{ width: 16, height: 16 }} />
              允许
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
