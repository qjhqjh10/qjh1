import { useState, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { XMarkIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline'

interface Props {
  editor: Editor | null
  onClose: () => void
}

export default function FindReplace({ editor, onClose }: Props) {
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(0)
  const [matches, setMatches] = useState<{ from: number; to: number }[]>([])

  const doFind = useCallback(() => {
    if (!editor || !findText) {
      setMatches([])
      setMatchCount(0)
      return
    }
    // Extract full text once to avoid O(n^2) textBetween calls
    const doc = editor.state.doc
    const fullText = doc.textBetween(0, doc.content.size)
    const results: { from: number; to: number }[] = []
    let searchFrom = 0
    while (searchFrom < fullText.length) {
      const idx = fullText.indexOf(findText, searchFrom)
      if (idx === -1) break
      results.push({ from: idx, to: idx + findText.length })
      searchFrom = idx + findText.length
    }
    setMatches(results)
    setMatchCount(results.length)
    if (results.length > 0) {
      setCurrentMatch(1)
      editor.chain().focus().setTextSelection(results[0]).run()
    }
  }, [editor, findText])

  useEffect(() => {
    doFind()
  }, [findText])

  const goToMatch = (index: number) => {
    if (!editor || matches.length === 0) return
    const i = Math.max(0, Math.min(matches.length - 1, index))
    setCurrentMatch(i + 1)
    editor.chain().focus().setTextSelection(matches[i]).run()
  }

  const replaceOne = () => {
    if (!editor || matches.length === 0 || !replaceText) return
    const match = matches[currentMatch - 1]
    editor.chain().focus().setTextSelection(match).insertContent(replaceText).run()
    doFind()
  }

  const replaceAll = () => {
    if (!editor || matches.length === 0) return
    // Replace from end to start to preserve positions
    const sorted = [...matches].sort((a, b) => b.from - a.from)
    for (const m of sorted) {
      editor.chain().focus().setTextSelection(m).insertContent(replaceText || '').run()
    }
    setMatches([])
    setMatchCount(0)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 20px', background: '#faf9f8',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      fontSize: 13,
    }}>
      <input
        aria-label="查找"
        value={findText}
        onChange={e => setFindText(e.target.value)}
        placeholder="查找..."
        autoFocus
        style={{
          width: 200, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
          outline: 'none', fontSize: 13, background: '#fff',
        }}
      />
      <input
        aria-label="替换为"
        value={replaceText}
        onChange={e => setReplaceText(e.target.value)}
        placeholder="替换为..."
        style={{
          width: 180, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
          outline: 'none', fontSize: 13, background: '#fff',
        }}
      />
      <button onClick={() => goToMatch(currentMatch - 2)} disabled={matches.length < 2} style={srBtn}>
        <ChevronUpIcon style={{ width: 12, height: 12 }} />
      </button>
      <button onClick={() => goToMatch(currentMatch)} disabled={matches.length < 2} style={srBtn}>
        <ChevronDownIcon style={{ width: 12, height: 12 }} />
      </button>
      <button onClick={replaceOne} disabled={matches.length === 0} style={srBtn}>替换</button>
      <button onClick={replaceAll} disabled={matches.length === 0} style={srBtn}>全部替换</button>
      <span style={{ color: '#9b8e84', fontSize: 12, minWidth: 50 }}>
        {matchCount > 0 ? `${currentMatch}/${matchCount}` : findText ? '无匹配' : ''}
      </span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', marginLeft: 8, display: 'flex' }}>
        <XMarkIcon style={{ width: 16, height: 16 }} />
      </button>
    </div>
  )
}

const srBtn: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff', cursor: 'pointer', fontSize: 12, color: '#4a3f38',
  display: 'flex', alignItems: 'center', fontWeight: 500,
}
