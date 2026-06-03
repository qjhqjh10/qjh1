declare module 'minimatch' {
  function minimatch(target: string, pattern: string, options?: Record<string, unknown>): boolean
  export = minimatch
}
