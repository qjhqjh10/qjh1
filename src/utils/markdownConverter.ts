/**
 * Minimal HTML ↔ Markdown converter for outline/worldbuilding files.
 * Handles common TipTap-generated HTML patterns.
 */

// ── HTML → Markdown ──────────────────────────────────────────────
//
// Order matters: inline formatting MUST be converted before block elements,
// otherwise stripInnerHtml in paragraph/list/heading processing destroys
// the HTML tags that inline regexes need to match.

export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  if (!/<[a-zA-Z][^>]*>/.test(html)) return html

  let md = html

  // ═══ Phase 1: Inline formatting (before block processing) ═══

  // Inline code (before other inline so backticks don't get formatted)
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, (_, t) => `\`${decodeEntities(t)}\``)

  // Bold, italic, strikethrough
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**')
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '_$2_')
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')

  // Links (before images since <img> doesn't overlap with <a>)
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  // Line breaks → newline
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // ═══ Phase 2: Block-level elements ═══

  // Pre/code blocks (before other block processing)
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, t) => `\`\`\`\n${decodeEntities(t)}\n\`\`\`\n\n`)

  // Headings — inner text may now contain Markdown (** etc.) from phase 1
  md = md.replace(/<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/gi, (_, t) => `# ${stripRemainingHtml(t)}\n\n`)
  md = md.replace(/<h2[^>]*>\s*([\s\S]*?)\s*<\/h2>/gi, (_, t) => `## ${stripRemainingHtml(t)}\n\n`)
  md = md.replace(/<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/gi, (_, t) => `### ${stripRemainingHtml(t)}\n\n`)

  // Blockquote
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => {
    const lines = stripRemainingHtml(t).split('\n').filter(Boolean)
    return lines.map((l: string) => `> ${l}`).join('\n') + '\n\n'
  })

  // Horizontal rule
  md = md.replace(/<hr\s*\/?>/gi, '---\n\n')

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi)
    if (!items) return inner
    return items.map((li: string) => `- ${stripRemainingHtml(li.replace(/<\/?li[^>]*>/gi, ''))}`).join('\n') + '\n\n'
  })

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi)
    if (!items) return inner
    return items.map((li: string, i: number) => `${i + 1}. ${stripRemainingHtml(li.replace(/<\/?li[^>]*>/gi, ''))}`).join('\n') + '\n\n'
  })

  // Paragraphs — inner text now has Markdown from phase 1
  md = md.replace(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/gi, (_, t) => `${stripRemainingHtml(t)}\n\n`)

  // ═══ Phase 3: Cleanup ═══

  // Remove any remaining HTML tags
  md = md.replace(/<[^>]+>/g, '')

  // Decode entities
  md = decodeEntities(md)

  // Collapse excessive blank lines
  md = md.replace(/\n{3,}/g, '\n\n')
  return md.trim()
}

// ── Markdown → HTML ──────────────────────────────────────────────

export function markdownToHtml(md: string): string {
  if (!md) return ''
  // If it already looks like HTML, return as-is (legacy content)
  if (/<[a-zA-Z][^>]*>/.test(md)) return md

  let html = md

  // Escape HTML entities first (before adding tags)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Images (before links)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Inline formatting (before block elements that split by line)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Headings (at line start)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>')

  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // List items — wrap consecutive items in <ul>/<ol> for round-trip fidelity
  html = html.replace(/((?:^- .+\n?)+)/gm, '<ul>\n$1</ul>')
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, '<ol>\n$1</ol>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Double newlines → paragraph breaks
  const paragraphs = html.split(/\n\n+/)
  html = paragraphs.map(p => {
    const trimmed = p.trim()
    if (!trimmed) return ''
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|img|table)/.test(trimmed)) return trimmed
    const withBreaks = trimmed.replace(/\n/g, '<br>')
    return `<p>${withBreaks}</p>`
  }).join('')

  return html
}

// ── Helpers ───────────────────────────────────────────────────────

/** Strip HTML tags that survived phase 1 (e.g. span, div, font). */
function stripRemainingHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
