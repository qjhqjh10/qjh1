import Sidebar from './Sidebar'

export default function AppLayout() {
  return (
    <div style={{ flexShrink: 0, height: '100vh', zIndex: 10 }}>
      <Sidebar />
    </div>
  )
}
