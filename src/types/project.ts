export interface Project {
  id: string
  name: string
  path: string
  chapterCount: number
  wordCount: number
  type: 'writing' | 'imitation'
}
