import { useEffect, useRef, useCallback } from 'react'
import { fileService } from '@/services/fileService'

export function useFileSync(
  filePath: string | null,
  storeContent: string,
  setStoreContent: (content: string) => void,
) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWrittenRef = useRef<string>(storeContent)
  const contentRef = useRef(storeContent)
  contentRef.current = storeContent

  // Debounced save: store -> file. Flush on unmount with correct path.
  useEffect(() => {
    if (!filePath) return
    if (storeContent === lastWrittenRef.current) return

    const pathForCleanup = filePath

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fileService.write(pathForCleanup, storeContent)
        lastWrittenRef.current = storeContent
      } catch (err) {
        console.error('Failed to save file:', err)
      }
    }, 500)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        // Use closure-captured path, not ref (ref has already changed to new path)
        const currentContent = contentRef.current
        if (pathForCleanup && lastWrittenRef.current !== currentContent) {
          fileService.write(pathForCleanup, currentContent).catch(() => {})
        }
        saveTimerRef.current = null
      }
    }
  }, [filePath, storeContent])

  // External file change -> store
  useEffect(() => {
    if (!filePath) return

    const path = filePath
    const unsub = fileService.onExternalChange((event) => {
      const evtPath = event.path.replace(/\\\\/g, '/')
      const curPath = path.replace(/\\\\/g, '/')
      if (evtPath === curPath && event.content !== contentRef.current) {
        lastWrittenRef.current = event.content
        setStoreContent(event.content)
      }
    })

    return unsub
  }, [filePath, setStoreContent])

  // Manual save
  const save = useCallback(async () => {
    if (!filePath) return
    try {
      await fileService.write(filePath, storeContent)
      lastWrittenRef.current = storeContent
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }, [filePath, storeContent])

  return { save }
}
