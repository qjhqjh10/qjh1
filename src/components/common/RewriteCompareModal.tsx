import { useMemo } from 'react'
import { formatWordCount } from '@/utils/textUtils'
import { computeParagraphDiff } from '@/utils/diffUtils'
import ScrollArea from '@/components/common/ScrollArea'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  originalContent: string
  rewrittenContent: string
  chapterTitle: string
  originalWordCount: number
  rewrittenWordCount: number
  rewriteMeta?: { mode: 'scene-segment' | 'full-chapter'; sceneNames: string[] } | null
}

export default function RewriteCompareModal({
  isOpen,
  onClose,
  originalContent,
  rewrittenContent,
  chapterTitle,
  originalWordCount,
  rewrittenWordCount,
  rewriteMeta,
}: Props) {
  const diff = useMemo(() => {
    if (!originalContent || !rewrittenContent) return null
    return computeParagraphDiff(originalContent, rewrittenContent)
  }, [originalContent, rewrittenContent])

  if (!isOpen) return null

  const isSceneSegment = rewriteMeta?.mode === 'scene-segment'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        width: '92vw', height: '88vh', maxWidth: 1400,
        background: '#fff', borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', display: 'flex', alignItems: 'center', gap: 10 }}>
              改写对比 — {chapterTitle}
              {rewriteMeta && (
                <span style={{
                  fontSize: 11, padding: '2px 10px', borderRadius: 4,
                  background: isSceneSegment ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)',
                  color: isSceneSegment ? '#6366f1' : '#d97706',
                  fontWeight: 600,
                }}>
                  {isSceneSegment ? '🎯 精密定位改写' : '📝 全章改写'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#3a3530', marginTop: 4, display: 'flex', gap: 16 }}>
              <span>📄 原文 {formatWordCount(originalWordCount)}字</span>
              <span>✨ 改写 {formatWordCount(rewrittenWordCount)}字</span>
              <span style={{ fontWeight: 600 }}>
                差异: {rewrittenWordCount >= originalWordCount ? '+' : ''}{formatWordCount(Math.abs(rewrittenWordCount - originalWordCount))}字
              </span>
            </div>
            {isSceneSegment && rewriteMeta && rewriteMeta.sceneNames.length > 0 && (
              <div style={{ fontSize: 12, color: '#6366f1', marginTop: 4, lineHeight: 1.6 }}>
                🎯 已改写场景：{rewriteMeta.sceneNames.join('、')}
              </div>
            )}
            {!isSceneSegment && rewriteMeta && rewriteMeta.sceneNames.length > 0 && (
              <div style={{ fontSize: 12, color: '#d97706', marginTop: 4, lineHeight: 1.6 }}>
                ⚠️ 未使用精密定位（无 startText/endText 标记），已全章改写。建议重新运行「内容总结」以启用精密定位。
              </div>
            )}
            <div style={{ fontSize: 11, color: '#2d2520', marginTop: 4, display: 'flex', gap: 16 }}>
              {isSceneSegment
                ? <span>🟥 <span style={{ color: '#dc2626' }}>红色</span> = 原文被替换的场景段落 &nbsp;|&nbsp; 🟩 <span style={{ color: '#16a34a' }}>绿色</span> = 改写后的场景段落</span>
                : <span>🟥 <span style={{ color: '#dc2626' }}>红色</span> = 原文被修改处 &nbsp;|&nbsp; 🟩 <span style={{ color: '#16a34a' }}>绿色</span> = 改写/新增内容</span>
              }
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#2d2520', padding: 8, borderRadius: 8,
          }}>
            <XMarkIcon style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Side-by-side panels */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Original (left) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{
              padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)',
              fontSize: 14, fontWeight: 600, color: '#3a3530',
              background: 'rgba(220,38,38,0.04)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>📄 原文</span>
              <span style={{ fontSize: 12, fontWeight: 400, color: '#2d2520' }}>{formatWordCount(originalWordCount)}字</span>
            </div>
            <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
              {diff ? diff.originalPars.map((p, i) => (
                <p key={i} style={{
                  margin: '0 0 8px', fontSize: 15, lineHeight: 2,
                  color: '#2d2520', textIndent: '2em',
                  background: p.changed ? 'rgba(220,38,38,0.12)' : 'transparent',
                  padding: p.changed ? '4px 8px' : undefined,
                  borderRadius: p.changed ? 6 : undefined,
                  borderLeft: p.changed ? '3px solid #dc2626' : undefined,
                }}>
                  {p.text}
                </p>
              )) : (
                <div style={{
                  fontSize: 15, lineHeight: 2, color: '#2d2520',
                  whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
                }}>
                  {originalContent}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Rewritten (right) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '8px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)',
              fontSize: 14, fontWeight: 600, color: '#3a3530',
              background: 'rgba(22,163,74,0.04)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>✨ 改写</span>
              <span style={{ fontSize: 12, fontWeight: 400, color: '#2d2520' }}>{formatWordCount(rewrittenWordCount)}字</span>
            </div>
            <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
              {diff ? diff.rewrittenPars.map((p, i) => (
                <p key={i} style={{
                  margin: '0 0 8px', fontSize: 15, lineHeight: 2,
                  color: '#2d2520', textIndent: '2em',
                  background: p.changed ? 'rgba(22,163,74,0.12)' : 'transparent',
                  padding: p.changed ? '4px 8px' : undefined,
                  borderRadius: p.changed ? 6 : undefined,
                  borderLeft: p.changed ? '3px solid #16a34a' : undefined,
                }}>
                  {p.text}
                </p>
              )) : (
                <div style={{
                  fontSize: 15, lineHeight: 2, color: '#2d2520',
                  whiteSpace: 'pre-wrap', fontFamily: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
                }}>
                  {rewrittenContent}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}
