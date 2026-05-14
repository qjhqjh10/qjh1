declare module 'duckduckgo-search' {
  export function search(query: string, options?: { maxResults?: number }): AsyncIterable<{ title: string; description: string; snippet: string; url: string; href?: string }>
}
