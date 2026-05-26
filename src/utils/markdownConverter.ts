/**
 * HTML ↔ Markdown converter for outline/worldbuilding files.
 *
 * Round-trip: RichTextEditor (HTML) → save → Markdown on disk → load → RichTextEditor (HTML)
 * Supports GFM tables, inline HTML (<br>), and all standard Markdown syntax.
 */

// ── HTML → Markdown ──────────────────────────────────────────────
//
// Order matters: inline formatting MUST be converted before block elements,
// otherwise the tags that inline regexes need to match are destroyed.

export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  if (!/<[a-zA-Z][^>]*>/.test(html)) return html

  let md = html

  // ═══ Phase 1: Inline formatting (before block processing) ═══

  // Inline code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, (_, t) => `\`${decodeEntities(t)}\``)

  // Bold, italic, strikethrough
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**')
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '_$2_')
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')

  // Links (before images)
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  // Line breaks → newline
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // ═══ Phase 2: Block-level elements ═══

  // GFM tables → markdown tables (before other block processing)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const allRows = inner.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)
    if (!allRows || allRows.length === 0) return inner

    const parseRow = (tr: string): string[] => {
      const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)
      if (!cells) return []
      return cells.map(c => stripRemainingHtml(c.replace(/<\/?t[dh][^>]*>/gi, '')).trim())
    }

    const mdRows = allRows.map((tr: string) => {
      const cells = parseRow(tr)
      return '| ' + cells.join(' | ') + ' |'
    })

    if (mdRows.length >= 2) {
      const headerCells = parseRow(allRows[0])
      const sep = '| ' + headerCells.map(() => ':----').join(' | ') + ' |'
      mdRows.splice(1, 0, sep)
    }

    return mdRows.join('\n') + '\n\n'
  })

  // Pre/code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, t) => `\`\`\`\n${decodeEntities(t)}\n\`\`\`\n\n`)

  // Headings
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

  // Paragraphs
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

  // ═══ Step 0: Extract & convert GFM tables first ═══
  // Tables are converted before anything else because:
  // 1. AI-written <br> inside table cells must survive as HTML in <td>
  // 2. Table HTML needs placeholder protection from entity escaping
  // 3. Table cell boundaries (|) are only unambiguous in raw Markdown
  const tablePlaceholders: string[] = []
  let html = md.replace(extractGfmTableBlock, (match) => {
    const tableHtml = convertGfmTable(match)
    tablePlaceholders.push(tableHtml)
    return `\x00TBL${tablePlaceholders.length - 1}\x00`
  })

  // ═══ Step 1: Convert standalone <br> to newlines ═══
  // AI often writes <br> inside Markdown — this is valid inline HTML.
  // Must happen BEFORE the HTML detection check so <br> doesn't trigger
  // the legacy-HTML early-return.
  html = html.replace(/<br\s*\/?>/gi, '\n')

  // ═══ Step 2: Legacy HTML detection ═══
  // Only bail out if content starts with block-level HTML AND contains no
  // Markdown syntax at all (pure HTML legacy file). Markdown with inline
  // HTML is still valid Markdown and must be converted.
  if (/^\s*<(p|div|h[1-6]|ul|ol|table|blockquote)/i.test(html) &&
      !/[#*>|`~\-]/.test(html.replace(/<[^>]+>/g, '').trim())) {
    // Restore table placeholders before returning
    return restoreTablePlaceholders(html, tablePlaceholders)
  }

  // ═══ Step 3: Entity escaping ═══
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // ═══ Step 4: Code & inline elements ═══

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Images (before links so ![ doesn't get caught by [)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Inline formatting (before block elements that split by line)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // ═══ Step 5: Block elements ═══

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>')

  // Blockquote ("> text" → "&gt; text" after entity escaping above)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // List items (table placeholders already protected by \x00 prefix)
  html = html.replace(/((?:^- .+\n?)+)/gm, '<ul>\n$1</ul>')
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, '<ol>\n$1</ol>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // ═══ Step 6: Paragraph wrapping ═══
  const paragraphs = html.split(/\n\n+/)
  html = paragraphs.map(p => {
    const trimmed = p.trim()
    if (!trimmed) return ''
    // Block-level tags: keep structure, don't wrap in <p>
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|img|table)/.test(trimmed)) {
      // Headings and inline block tags: convert leftover \n to <br>
      // so text after heading without blank line still renders with line breaks.
      if (/^<(h[1-6]|hr|img)/.test(trimmed)) return trimmed.replace(/\n/g, '<br>')
      return trimmed
    }
    // Regular paragraphs: \n → <br>
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
  }).join('')

  // ═══ Step 7: Restore table placeholders ═══
  html = restoreTablePlaceholders(html, tablePlaceholders)

  return html
}

// ── GFM Table Converter ──────────────────────────────────────────

/** Regex to find a GFM table block: header row, separator row, body rows. */
const extractGfmTableBlock = /^\|.+\|\n^\|[-: |]+\|\n(?:^\|.+\|\n?)+/gm

/**
 * Convert a single GFM table block (header | sep | body*) to HTML.
 * <br> tags within cells are preserved as valid inline HTML.
 */
function convertGfmTable(mdTable: string): string {
  const lines = mdTable.trim().split('\n')
  if (lines.length < 2) return mdTable

  // Apply inline formatting to cell content before parsing (the table block
  // was extracted before the main inline formatting pass, so we must apply
  // the same conversions here for bold/italic/code/links inside cells).
  const applyInline = (text: string): string => {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
  }

  const parseRow = (line: string, tag: string): string => {
    const cells = line.replace(/^\||\|$/g, '').split('|').map(c => applyInline(c.trim()))
    return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`
  }

  // Header row → <thead>
  const thead = `<thead>${parseRow(lines[0], 'th')}</thead>`
  // Body rows (skip separator line)
  const tbodyRows = lines.slice(2).map(line => parseRow(line, 'td')).join('')
  const tbody = `<tbody>${tbodyRows}</tbody>`

  return `<table>${thead}${tbody}</table>`
}

function restoreTablePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/\x00TBL(\d+)\x00/g, (_, i) => placeholders[parseInt(i)] || '')
}

// ── Helpers ───────────────────────────────────────────────────────

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
