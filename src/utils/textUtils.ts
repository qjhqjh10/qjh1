const stripHtmlRegex = /<[^>]*>/g

export function stripHtml(html: string): string {
  if (!html) return ''
  return html.replace(stripHtmlRegex, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

export function countChineseWords(text: string): number {
  if (!text) return 0
  // Strip HTML tags before counting to avoid counting markup
  const clean = text.replace(stripHtmlRegex, '').replace(/\s/g, '')
  return clean.length
}

export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`
  }
  return count.toLocaleString()
}
