import { useEffect, useRef, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'

export function useFileSync(
  filePath: string | null,
  storeContent: string,
  setStoreContent: (content: string) => void,
) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWrittenRef = useRef<string>(storeContent)
  const contentRef = useRef(storeContent)
  const pathRef = useRef(filePath)
  const generationRef = useRef(0)
  contentRef.current = storeContent
  pathRef.current = filePath

  // Debounced save: store -> file. Flush on unmount with correct path.
  useEffect(() => {
    if (!filePath) return
    if (storeContent === lastWrittenRef.current) return

    const pathForCleanup = filePath
    const contentForCleanup = storeContent
    const gen = ++generationRef.current

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (gen !== generationRef.current) return // newer effect has taken over
      try {
        await fileService.write(pathForCleanup, contentForCleanup)
        lastWrittenRef.current = contentForCleanup
      } catch (err) {
        logError('Failed to save file', err)
      }
    }, 500)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        // Only flush if this is still the latest generation and content differs
        if (gen === generationRef.current && pathForCleanup && lastWrittenRef.current !== contentForCleanup) {
          fileService.write(pathForCleanup, contentForCleanup).catch(() => {})
        }
        saveTimerRef.current = null
      }
    }
  }, [filePath, storeContent])

  // External file change -> store
  useEffect(() => {
    if (!filePath) return

    const curPath = filePath
    const unsub = fileService.onExternalChange((event) => {
      const evtPath = event.path.replace(/\\/g, '/')
      const normalizedPath = curPath.replace(/\\/g, '/')
      if (evtPath === normalizedPath && event.content !== contentRef.current) {
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
      logError('Failed to save file', err)
    }
  }, [filePath, storeContent])

  return { save }
}
