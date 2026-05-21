import { useState, useEffect } from 'react'
import { fileService } from '@/services/fileService'

interface Props {
  image?: string
  projectPath: string
  alt: string
  style?: React.CSSProperties
  className?: string
}

export default function CharacterImage({ image, projectPath, alt, style, className }: Props) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!image) { setSrc(''); return }
    if (image.startsWith('data:')) { setSrc(image); return }
    if (!projectPath) return
    const ext = image.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    fileService.readBinary(`${projectPath}/${image}`).then(b64 => {
      if (b64) setSrc(`data:${mime};base64,${b64}`)
    }).catch(() => setSrc(''))
  }, [image, projectPath])
  if (!src) return null
  return <img src={src} alt={alt} style={style} className={className} />
}
