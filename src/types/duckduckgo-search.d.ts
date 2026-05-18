declare module 'duckduckgo-search' {
  interface SearchOptions {
    maxResults?: number
    safeSearch?: 'strict' | 'moderate' | 'off'
  }

  interface SearchResult {
    title: string
    description?: string
    snippet?: string
    url: string
  }

  function search(
    query: string,
    options?: SearchOptions
  ): AsyncIterable<SearchResult>

  export { search, SearchResult, SearchOptions }
}
