interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6, maxWidth: 280, marginBottom: action ? 16 : 0 }}>
          {description}
        </div>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: '8px 20px',
            borderRadius: 10,
            border: '1px solid rgba(124,58,237,0.2)',
            background: 'rgba(124,58,237,0.06)',
            color: '#7c3aed',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
