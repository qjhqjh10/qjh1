// Mock localStorage for Zustand persist middleware
const storageMap = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => { storageMap.set(key, value) },
    removeItem: (key: string) => { storageMap.delete(key) },
    clear: () => { storageMap.clear() },
    get length() { return storageMap.size },
    key: (i: number) => [...storageMap.keys()][i] ?? null,
  },
  writable: true,
  configurable: true,
})
