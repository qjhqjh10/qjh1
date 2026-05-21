import { useState, useRef, useEffect } from 'react'
import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'
import { CameraIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

interface Props {
  projectPath: string
  coverImage?: string
  onCoverChange: (coverImage: string | undefined) => void
}

export default function CoverUpload({ projectPath, coverImage, onCoverChange }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load existing cover on mount
  useEffect(() => {
    if (!coverImage || !projectPath) return
    const coverPath = `${projectPath}/${coverImage}`.replace(/\\/g, '/')
    fileService.readBinary(coverPath).then(base64 => {
      if (base64) {
        const ext = coverImage.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        setPreview(`data:${mime};base64,${base64}`)
      }
    }).catch(() => setPreview(null))
  }, [coverImage, projectPath])

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setPreview(dataUrl)
      const base64 = dataUrl.split(',')[1]
      const ext = file.type === 'image/jpeg' ? 'jpg' : 'png'
      const fileName = `covers/cover.${ext}`
      const coverPath = `${projectPath}/${fileName}`.replace(/\\/g, '/')
      try {
        await fileService.writeBinary(coverPath, base64)
        onCoverChange(fileName)
      } catch (err) { logError('保存封面失败', err) }
    }
    reader.readAsDataURL(file)
  }

  const handleRemove = async () => {
    if (coverImage && projectPath) {
      const filePath = `${projectPath}/${coverImage}`.replace(/\\/g, '/')
      try { await fileService.deleteFile(filePath) } catch (err) { logError('删除封面文件失败', err) }
    }
    setPreview(null)
    onCoverChange(undefined)
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => !preview && fileInputRef.current?.click()}
      style={{
        width: '100%', aspectRatio: '3/4', maxHeight: 320,
        borderRadius: 16, overflow: 'hidden', cursor: preview ? 'default' : 'pointer',
        background: preview ? '#000' : 'rgba(124,58,237,0.03)',
        border: preview ? 'none' : '2px dashed rgba(124,58,237,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', transition: 'all 0.2s ease',
      }}
    >
      {preview ? (
        <>
          <img src={preview} alt="封面" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {hover && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              transition: 'opacity 0.2s ease',
            }}>
              <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                style={actionBtn('#fff')}>
                <ArrowPathIcon style={{ width: 15, height: 15 }} /> 更换
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleRemove() }}
                style={actionBtn('#fca5a5')}>
                <TrashIcon style={{ width: 15, height: 15 }} /> 删除
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: '#9b8e84' }}>
          <CameraIcon style={{ width: 36, height: 36, marginBottom: 8, opacity: 0.4 }} />
          <div style={{ fontSize: 12 }}>点击上传封面</div>
          <div style={{ fontSize: 10, marginTop: 2, opacity: 0.6 }}>支持 JPG / PNG</div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
    </div>
  )
}

const actionBtn = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 14px', borderRadius: 8, border: `1px solid ${color}40`,
  background: 'rgba(255,255,255,0.1)', color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(4px)',
})
