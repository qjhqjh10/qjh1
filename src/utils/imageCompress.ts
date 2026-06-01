/**
 * Compress and save an avatar image to disk (NOT localStorage).
 * Returns the file path for storing in settings.
 */
export async function compressAndSaveImage(file: File, fileName: string): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB')

  // 1. Resize to max 256px and compress to JPEG
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 256
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })

  // 2. Save base64 to disk via existing fileService.writeBinary (handles base64 natively)
  const { fileService } = await import('@/services/fileService')
  const base64 = dataUrl.split(',')[1]
  const filePath = `user_data/avatars/${fileName}.jpg`

  await fileService.ensureDir('user_data/avatars')
  await fileService.writeBinary(filePath, base64)
  return filePath
}

/**
 * Load an avatar image for display.
 * File path → read from disk → data URL. Data URL → use directly.
 */
export async function loadAvatar(src: string): Promise<string> {
  if (!src || src.startsWith('data:')) return src
  try {
    const { fileService } = await import('@/services/fileService')
    const base64 = await fileService.readBinary(src)
    return base64 ? 'data:image/jpeg;base64,' + base64 : src
  } catch {
    return src
  }
}
