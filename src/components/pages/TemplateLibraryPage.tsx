import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function TemplateLibraryPage() {
  const navigate = useNavigate()
  useEffect(() => { navigate('/style-workshop', { replace: true }) }, [navigate])
  return null
}
