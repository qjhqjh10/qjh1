import ScrollArea from '@/components/common/ScrollArea'
import type { NovelExtraction } from '@/types/story'

interface Props {
  extraction: NovelExtraction
  selectedChapterId: string | null
}

export default function ChapterTab({ extraction, selectedChapterId }: Props) {
  const selectedChapter = extraction.chapters.find(c => c.chapterId === selectedChapterId)

  return (
    <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
      <div style={{ padding: 10 }}>
        {!selectedChapter
          ? <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>请从左侧选择章节</div>
          : <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>{selectedChapter.chapterTitle}</h3>
            {selectedChapter.chapterSummary && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)', marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>AI 摘要</div>
                <p style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, margin: 0 }}>{selectedChapter.chapterSummary}</p>
              </div>
            )}
            <div style={{ fontSize: 15, lineHeight: 2.2, color: '#2d2520', whiteSpace: 'pre-wrap', padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>{selectedChapter.chapterContent}</div>
          </div>
        }
      </div>
    </ScrollArea>
  )
}
