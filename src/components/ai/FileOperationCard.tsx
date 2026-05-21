import React, { useState } from 'react'
import {
  ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon,
  DocumentPlusIcon, DocumentTextIcon, FolderOpenIcon,
  MagnifyingGlassIcon, TrashIcon, ChevronDownIcon,
  ChevronRightIcon, ClipboardIcon, ArrowPathIcon,
  ArrowUturnLeftIcon, PencilIcon,
} from '@heroicons/react/24/outline'
import type { FileOpCard } from '@/types/fileOps'
import { DiffView } from '@/components/common/DiffView'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'

interface Props {
  card: FileOpCard
  onConfirm?: (callId: string) => void
  onDeny?: (callId: string) => void
  onUndo?: (card: FileOpCard) => void
}

function getIcon(toolName: string): React.ReactNode {
  const s = { width: 14, height: 14 }
  switch (toolName) {
    case 'list_directory': return <FolderOpenIcon style={s} />
    case 'read_file': return <DocumentTextIcon style={s} />
    case 'search_files': return <MagnifyingGlassIcon style={s} />
    case 'search_content': return <MagnifyingGlassIcon style={s} />
    case 'create_file': return <DocumentPlusIcon style={s} />
    case 'edit_file': return <PencilIcon style={s} />
    case 'delete_file': return <TrashIcon style={s} />
    case 'list_backups': return <FolderOpenIcon style={s} />
    case 'restore_backup': return <ArrowPathIcon style={s} />
    case 'rename_file': return <ArrowUturnLeftIcon style={s} />
    case 'create_project': return <DocumentPlusIcon style={s} />
    case 'delete_project': return <TrashIcon style={s} />
    case 'kb_index_file': return <MagnifyingGlassIcon style={s} />
    default: return <DocumentTextIcon style={s} />
  }
}

function getTitle(card: FileOpCard): string {
  const { toolName, args } = card
  switch (toolName) {
    case 'list_directory': return `列出目录: ${args.dir_path || '(根目录)'}`
    case 'read_file': return `读取文件: ${args.file_path}`
    case 'search_files': return `搜索文件: "${args.keyword}"`
    case 'search_content': return `搜索内容: "${(args.pattern as string || '').slice(0, 40)}"`
    case 'create_file': return `创建文件: ${args.file_path}`
    case 'edit_file': return `编辑文件: ${args.file_path}`
    case 'delete_file': return `删除文件: ${args.file_path}`
    case 'list_backups': return `列出备份${args.file_path ? ': ' + args.file_path : '(全部文件)'}`
    case 'restore_backup': return `恢复备份: ${args.backup_path}`
    case 'rename_file': return `重命名: ${args.file_path} → ${args.new_path}`
    case 'create_project': return `创建项目: ${args.name}`
    case 'delete_project': return `删除项目: ${args.project_name}`
    case 'kb_index_file': return `知识库索引: ${args.file_path}`
    default: return `文件操作: ${toolName}`
  }
}

function getColors(status: string): { border: string; bg: string; text: string } {
  switch (status) {
    case 'pending_confirm': case 'needs_preview':
      return { border: 'rgba(245,158,11,0.35)', bg: 'rgba(245,158,11,0.03)', text: '#d97706' }
    case 'error': return { border: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.03)', text: '#dc2626' }
    case 'denied': return { border: 'rgba(156,163,175,0.35)', bg: 'rgba(156,163,175,0.02)', text: '#9ca3af' }
    case 'executing': return { border: 'rgba(139,92,246,0.25)', bg: 'rgba(139,92,246,0.03)', text: '#8b5cf6' }
    default: return { border: 'rgba(16,185,129,0.3)', bg: 'rgba(16,185,129,0.03)', text: '#10b981' }
  }
}

function getStatusIcon(status: string): React.ReactNode {
  const s = { width: 14, height: 14 }
  switch (status) {
    case 'pending_confirm': case 'needs_preview':
      return <ExclamationTriangleIcon style={{ ...s, color: '#d97706' }} />
    case 'error': return <XCircleIcon style={{ ...s, color: '#dc2626' }} />
    case 'denied': return <XCircleIcon style={{ ...s, color: '#9ca3af' }} />
    case 'executing': return <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    default: return <CheckCircleIcon style={{ ...s, color: '#10b981' }} />
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending_confirm': return '待确认'
    case 'needs_preview': return '待确认'
    case 'error': return '失败'
    case 'denied': return '已取消'
    case 'executing': return '执行中...'
    case 'undone': return '已撤销'
    default: return '已完成'
  }
}

export default function FileOperationCard({ card, onConfirm, onDeny, onUndo }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isPending = card.status === 'pending_confirm'
  const isPreview = card.status === 'needs_preview'
  const isDone = card.status === 'success' || card.status === 'confirmed'
  const hasDetail = typeof card.detail === 'string' && card.detail.length > 0
  const colors = getColors(card.status)
  const icon = getStatusIcon(card.status)
  const label = getStatusLabel(card.status)
  const toolIcon = getIcon(card.toolName)
  const title = getTitle(card)

  const showActions = (isPending || isPreview) && onConfirm && onDeny
  const showUndo = isDone && onUndo && (card.toolName === 'edit_file' || card.toolName === 'delete_file')
  const contentPreview = card.args.content as string | undefined

  // ── 功能五：备份版本对比 ──
  const [compareA, setCompareA] = useState<{ timestamp: string; content: string } | null>(null)
  const [compareB, setCompareB] = useState<{ timestamp: string; content: string } | null>(null)

  // Parse backup entries from detail for list_backups cards
  const isBackupList = card.toolName === 'list_backups' && !isPending && card.status !== 'error' && card.detail
  const backupEntries: Array<{ label: string; path: string }> = []
  if (isBackupList) {
    const lines = card.detail!.split('\n')
    for (const line of lines) {
      const m = line.match(/\[(\d+)\]\s+(\d{8}_\d{6})\s+—\s+备份路径:\s+(.+)/)
      if (m) {
        backupEntries.push({ label: `[${m[1]}] ${m[2]}`, path: m[3] })
      }
    }
  }

  const handleSelectCompare = async (side: 'A' | 'B', entry: { label: string; path: string }) => {
    try {
      const result = await fileService.read(entry.path)
      const content = typeof result === 'string' ? result : ''
      const item = { timestamp: entry.label, content }
      if (side === 'A') setCompareA(item); else setCompareB(item)
    } catch (err) { logError('读取备份内容失败', err) }
  }

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${colors.border}`,
      background: colors.bg,
      padding: '10px 12px',
      fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: '#6b5e54', display: 'flex' }}>{toolIcon}</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#2d2520' }}>{title}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, color: colors.text,
        }}>
          {icon} {label}
        </span>
      </div>

      {/* Summary for non-pending */}
      {!isPending && !isPreview && card.summary ? (
        <div style={{ color: '#6b5e54', fontSize: 11, marginBottom: hasDetail ? 4 : 0 }}>
          {card.summary}
        </div>
      ) : null}

      {/* Reason for pending */}
      {isPending && card.args.reason ? (
        <div style={{
          color: '#92400e', fontSize: 11, padding: '6px 8px',
          borderRadius: 8, background: 'rgba(245,158,11,0.06)',
          marginBottom: 8,
        }}>
          <strong>原因：</strong>{card.args.reason as string}
        </div>
      ) : null}

      {/* Preview diff (功能一: needs_preview) */}
      {isPreview && card.preview ? (
        <div style={{ marginBottom: 8 }}>
          <DiffView
            oldText={card.preview.old}
            newText={card.preview.new}
            oldLabel="修改前"
            newLabel="修改后"
          />
        </div>
      ) : null}

      {/* Content preview for create_file */}
      {isPending && card.toolName === 'create_file' && contentPreview ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>内容预览：</div>
          <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.05)',
            fontSize: 11, color: '#2d2520', lineHeight: 1.6,
            maxHeight: expanded ? undefined : 160,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}>
            {contentPreview.slice(0, 500)}
            {contentPreview.length > 500 && !expanded ? (
              <span style={{ color: '#9b8e84' }}>... (共 {contentPreview.length} 字符)</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Detail (collapsible) */}
      {hasDetail && !isPending && !isPreview ? (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 10, color: '#9b8e84', padding: 0, fontFamily: 'inherit',
            }}
          >
            {expanded
              ? <ChevronDownIcon style={{ width: 12, height: 12 }} />
              : <ChevronRightIcon style={{ width: 12, height: 12 }} />
            }
            {expanded ? '收起详情' : '展开详情'}
          </button>
          {expanded ? (
            <div style={{ position: 'relative' }}>
              <div style={{
                marginTop: 6, padding: '8px 10px',
                borderRadius: 8, background: 'rgba(0,0,0,0.03)',
                border: '1px solid rgba(0,0,0,0.05)',
                fontSize: 11, color: '#2d2520', lineHeight: 1.6,
                maxHeight: 300, overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
              }}>
                {card.detail}
              </div>
              <button
                onClick={async () => { await navigator.clipboard.writeText(card.detail || '') }}
                style={{
                  position: 'absolute', top: 10, right: 14,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                  background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                  fontSize: 10, color: '#6b5e54', fontFamily: 'inherit',
                }}
              >
                <ClipboardIcon style={{ width: 11, height: 11 }} /> 复制
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 功能五：备份对比选择器 (for list_backups) */}
      {isBackupList && expanded && backupEntries.length > 0 ? (
        <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>对比模式：选择两个版本查看差异</div>
          {backupEntries.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ flex: 1, fontSize: 10, color: '#6b5e54' }}>{e.label}</span>
              <button
                onClick={() => handleSelectCompare('A', e)}
                style={{ ...cmpBtn, background: compareA?.timestamp === e.label ? 'rgba(139,92,246,0.1)' : 'transparent', color: compareA?.timestamp === e.label ? '#7c3aed' : '#9b8e84' }}
              >选为A</button>
              <button
                onClick={() => handleSelectCompare('B', e)}
                style={{ ...cmpBtn, background: compareB?.timestamp === e.label ? 'rgba(245,158,11,0.1)' : 'transparent', color: compareB?.timestamp === e.label ? '#d97706' : '#9b8e84' }}
              >选为B</button>
            </div>
          ))}
          {compareA && compareB ? (
            <div style={{ marginTop: 8 }}>
              <DiffView
                oldText={compareA.content}
                newText={compareB.content}
                oldLabel={`备份A: ${compareA.timestamp}`}
                newLabel={`备份B: ${compareB.timestamp}`}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Action buttons (confirm/deny for pending or preview) */}
      {showActions ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => onDeny!(card.callId)} style={cancelBtn}>
            取消
          </button>
          <button onClick={() => onConfirm!(card.callId)} style={{
            padding: '5px 14px', borderRadius: 8, border: 'none',
            background: isPreview ? '#7c3aed' : card.toolName === 'delete_file' ? '#dc2626' : '#16a34a',
            color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {isPreview ? '确认应用' : card.toolName === 'delete_file' ? '确认删除' : card.toolName === 'restore_backup' ? '确认恢复' : '确认创建'}
          </button>
        </div>
      ) : null}

      {/* Undo button (功能二) */}
      {showUndo ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={() => onUndo!(card)} style={undoBtn}>
            <ArrowUturnLeftIcon style={{ width: 11, height: 11 }} /> 撤销
          </button>
        </div>
      ) : null}
    </div>
  )
}

const cancelBtn: React.CSSProperties = {
  padding: '5px 14px', borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.08)',
  background: '#fff', color: '#6b5e54',
  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

const undoBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', borderRadius: 8,
  border: '1px solid rgba(139,92,246,0.2)',
  background: 'rgba(139,92,246,0.04)', color: '#7c3aed',
  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

const cmpBtn: React.CSSProperties = {
  padding: '1px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.06)',
  fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
