import RichTextEditor from '@/components/common/RichTextEditor'
import Button from '@/components/common/Button'
import { countChineseWords, formatWordCount } from '@/utils/textUtils'
import type { DetailGenResult } from '@/types/story'
import type { VersionRecord } from '@/components/common/ChapterGenerationModal'
import { SparklesIcon, ClipboardDocumentCheckIcon, DocumentTextIcon, ClockIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline'

interface Props {
  chapterWriteView: string | null
  writeContent: string
  chapterContents: Record<string, string>
  detailGenResults: DetailGenResult[]
  detailsResults: string
  extractionId: string
  activeConfigId: string
  writeVersionHistory: VersionRecord[]
  writeGenOverlay: boolean
  writeGenWordCount: number
  writeGenAbortRef: React.MutableRefObject<(() => void) | null>
  onSetWriteContent: (content: string) => void
  onSetChapterWriteView: (id: string) => void
  onShowAIGen: () => void
  onShowReview: () => void
  onShowReviewResults: () => void
  onShowVersions: () => void
  onShowExport: () => void
  onSave: () => void
  onClear: () => void
  onNavigateChapter: (direction: 'prev' | 'next') => void
}

export default function WriteTab({
  chapterWriteView, writeContent, chapterContents, detailGenResults, detailsResults,
  writeVersionHistory, writeGenOverlay, writeGenWordCount, writeGenAbortRef,
  onSetWriteContent, onSetChapterWriteView, onShowAIGen, onShowReview, onShowReviewResults,
  onShowVersions, onShowExport, onSave, onClear, onNavigateChapter,
}: Props) {
  return (
    <>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left: Chapter list + outline reference */}
        <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            {(detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()).length > 0 ? (
              (detailGenResults.length > 0 ? detailGenResults : (() => { try { return detailsResults ? JSON.parse(detailsResults) : [] } catch { return [] } })()).map((d: any) => (
                <div key={d.chapterNumber} onClick={() => { onSetWriteContent(chapterContents[String(d.chapterNumber)] || ''); onSetChapterWriteView(String(d.chapterNumber)) }} style={{
                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                  background: chapterWriteView === String(d.chapterNumber) ? 'rgba(124,58,237,0.06)' : 'transparent',
                  color: chapterWriteView === String(d.chapterNumber) ? '#7c3aed' : '#4a3f38',
                  fontWeight: chapterWriteView === String(d.chapterNumber) ? 600 : 400,
                }}>
                  第{d.chapterNumber}章 {d.title} {chapterContents[String(d.chapterNumber)] ? ' ✓' : ''}
                </div>
              ))
            ) : <div style={{ textAlign: 'center', padding: 20, fontSize: 11, color: '#9b8e84' }}>暂无细纲<br/>请先在「生成」Tab生成细纲</div>}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
            {chapterWriteView && (() => {
              const d = detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView)) : null
              if (!d) return <div style={{ fontSize: 11, color: '#9b8e84' }}>请选择章节</div>
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                  <div><div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>剧情摘要</div><p style={{ color: '#4a3f38', lineHeight: 1.6, margin: 0 }}>{d.summary}</p></div>
                  {d.charactersAppearing?.length > 0 && <div><div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>出场角色</div>{d.charactersAppearing.map((c: string) => <div key={c} style={{ color: '#6b5e54', padding: '1px 0' }}>{c}</div>)}</div>}
                  {d.levelChange && <div><span style={{ color: '#9b8e84' }}>等级:</span> <span style={{ color: '#16a34a' }}>{d.levelChange}</span></div>}
                  {d.itemsUsed?.length > 0 && <div><span style={{ color: '#9b8e84' }}>道具:</span> {d.itemsUsed.map((i: any) => typeof i === 'string' ? i : (i?.name || i?.title || String(i))).join(', ')}</div>}
                  {d.location && <div><span style={{ color: '#9b8e84' }}>场景:</span> {d.location}</div>}
                  {d.emotionalTone && <div><span style={{ color: '#9b8e84' }}>情绪:</span> {d.emotionalTone}</div>}
                </div>
              )
            })()}
          </div>
        </div>
        {/* Right: Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>第{chapterWriteView || '?'}章</span>
            <span style={{ fontSize: 12, color: '#9b8e84' }}>
              {detailGenResults.length > 0 ? detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0'))?.title || '' : ''}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: '#9b8e84' }}>{formatWordCount(countChineseWords(writeContent))}字</span>
            <Button size="sm" onClick={onShowAIGen} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>AI生成</Button>
            <button onClick={onShowReview} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <ClipboardDocumentCheckIcon style={{ width: 13, height: 13 }} /> 审稿
            </button>
            <button onClick={onShowReviewResults} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(16,163,74,0.2)', background: 'rgba(16,163,74,0.04)', color: '#16a34a', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <DocumentTextIcon style={{ width: 13, height: 13 }} /> 审稿结果
            </button>
            <Button size="sm" variant="ghost" onClick={onShowVersions} icon={<ClockIcon style={{ width: 13, height: 13 }} />}>版本</Button>
            <Button size="sm" variant="secondary" onClick={onClear} disabled={!writeContent.trim()}>清空</Button>
            <Button size="sm" variant="secondary" onClick={onSave} disabled={!writeContent.trim()}>保存</Button>
            <Button size="sm" onClick={onShowExport} icon={<DocumentArrowDownIcon style={{ width: 13, height: 13 }} />}>导出</Button>
            <Button size="sm" variant="ghost" onClick={() => onNavigateChapter('prev')} disabled={!chapterWriteView || parseInt(chapterWriteView) <= 1}>上一章</Button>
            <Button size="sm" variant="ghost" onClick={() => onNavigateChapter('next')} disabled={!chapterWriteView || !detailGenResults.find((d: any) => d.chapterNumber === parseInt(chapterWriteView || '0') + 1)}>下一章</Button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', padding: '12px 24px' }}>
            <div className="custom-scrollbar" style={{ width: '100%', overflowY: 'auto' }}>
              <RichTextEditor
                content={writeContent}
                onContentChange={onSetWriteContent}
                placeholder={chapterWriteView ? '点击「AI生成」或手动输入正文...' : '请从左侧选择章节'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Write generation overlay */}
      {writeGenOverlay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: '24px 40px', textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(124,58,237,0.1)', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 13, color: '#2d2520', marginBottom: 4 }}>AI 正在生成章节</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#7c3aed' }}>{writeGenWordCount.toLocaleString()}</div>
            <button onClick={() => writeGenAbortRef.current?.()} style={{ marginTop: 12, padding: '4px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 11 }}>取消生成</button>
          </div>
        </div>
      )}
    </>
  )
}
