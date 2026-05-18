export const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4,
}

export const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit',
}

export const iconBtn = (color: string): React.CSSProperties => ({
  background: 'none', border: 'none', cursor: 'pointer', padding: 4, color, display: 'flex', borderRadius: 6,
})
