declare module 'unzipper' {
  import { Stream } from 'stream'
  interface ExtractOptions { path: string }
  function Extract(opts: ExtractOptions): Stream
  export { Extract, ExtractOptions }
}
