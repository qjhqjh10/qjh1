import { formatWordCount, stripHtml } from '@/utils/textUtils'

interface Props {
  /** HTML 或纯文本内容，用于计算字数（去 HTML 后计纯文字） */
  text: string
  /** 可选：原始文件内容，用于计算字符数。未提供时用 text 近似 */
  rawText?: string
  label?: string
  showChars?: boolean
}

/** 纯文字计数：仅统计中文、英文、数字，不含标点符号和空格 */
function countPureText(cleanText: string): number {
  let n = 0
  for (const ch of cleanText) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0x61 && cp <= 0x7A) || (cp >= 0x41 && cp <= 0x5A) ||
        (cp >= 0x30 && cp <= 0x39)) {
      n++
    }
  }
  return n
}

export default function WordCount({ text, rawText, label = '字数', showChars = true }: Props) {
  const wordCount = countPureText(stripHtml(text))
  // 字符 = 原始文件内容总字符数，有 rawText 直接用，否则从 text 近似取
  const charSrc = rawText ?? text
  // 如果可能含 HTML 又没有 rawText，去掉 HTML 标签凑合近似
  const charCount = (rawText === undefined && /<[a-zA-Z][^>]*>/.test(charSrc))
    ? stripHtml(charSrc).length
    : charSrc.length
  return (
    <span style={{ fontSize: 15, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap' }}>
      {label}: {formatWordCount(wordCount)}
      {showChars && <span style={{ color: '#7c3aed', fontSize: 14, marginLeft: 6 }}>字符 {formatWordCount(charCount)}</span>}
    </span>
  )
}
