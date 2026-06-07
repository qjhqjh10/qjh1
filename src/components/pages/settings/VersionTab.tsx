import { useState } from 'react'
import versionData from '@/data/version_history.json'
import SoftwareGuideModal from './SoftwareGuideModal'

export function VersionTab() {
  const [checkResult, setCheckResult] = useState<'idle' | 'checking' | 'latest' | 'update' | 'error'>('idle')
  const [latestVersion, setLatestVersion] = useState('')
  const [releaseUrl, setReleaseUrl] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  const currentVersion = versionData.currentVersion
  const currentDate = versionData.currentDate
  const repoUrl = 'https://github.com/qjhqjh10/qjh1/releases'
  const versionHistory = versionData.history

  const handleCheckUpdate = async () => {
    setCheckResult('checking')
    try {
      const res = await fetch('https://api.github.com/repos/qjhqjh10/qjh1/releases/latest')
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      const remoteVer = data.tag_name?.replace(/^v/, '') || ''
      setLatestVersion(remoteVer)
      setReleaseUrl(data.html_url || repoUrl)
      if (remoteVer && remoteVer !== currentVersion) {
        setCheckResult('update')
      } else {
        setCheckResult('latest')
      }
    } catch {
      setCheckResult('error')
    }
  }

  return (
    <div className="custom-scrollbar" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>当前版本</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#7c3aed' }}>v{currentVersion}</div>
            <button onClick={() => setShowGuide(true)} style={{
              padding: '6px 16px', borderRadius: 10, border: '1px solid #7c3aed',
              background: 'rgba(124,58,237,0.04)', color: '#7c3aed',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}>📖 软件说明</button>
            <div>
              <div style={{ fontSize: 13, color: '#6b5e54' }}>发布日期: {currentDate}</div>
              <div style={{ fontSize: 12, color: '#9b8e84', marginTop: 2 }}>序列号: build-{currentDate.replace(/-/g, '')}</div>
              {checkResult === 'latest' && <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>已是最新版本</div>}
              {checkResult === 'update' && <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginTop: 4 }}>可更新到 v{latestVersion}</div>}
              {checkResult === 'error' && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>GitHub 连接失败（国内网络限制），请手动查看</div>}
            </div>
          </div>
        </div>

        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>检查更新</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={handleCheckUpdate} disabled={checkResult === 'checking'} style={{
              padding: '8px 20px', borderRadius: 12, border: 'none', background: '#7c3aed', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: checkResult === 'checking' ? 'not-allowed' : 'pointer',
              opacity: checkResult === 'checking' ? 0.6 : 1, fontFamily: 'inherit',
            }}>
              {checkResult === 'checking' ? '检查中...' : '检查更新'}
            </button>
            {checkResult === 'update' && (
              <a href={releaseUrl} target="_blank" rel="noreferrer" style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid #16a34a', background: 'rgba(22,163,74,0.05)',
                color: '#16a34a', fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit',
              }}>下载 v{latestVersion}</a>
            )}
            {checkResult === 'error' && (
              <a href={repoUrl} target="_blank" rel="noreferrer" style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid #7c3aed', background: 'rgba(124,58,237,0.05)',
                color: '#7c3aed', fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit',
              }}>打开 GitHub Releases 查看更新</a>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 10 }}>
            更新源: github.com/qjhqjh10/qjh1/releases
          </div>
        </div>

        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>版本历史</h4>
          {versionHistory.map(v => (
            <div key={v.version} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>v{v.version} — {v.date}</div>
              {v.features.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>新增功能</div>
                  {v.features.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#4a3f38', padding: '3px 0 3px 14px', borderLeft: '2px solid rgba(22,163,74,0.2)', marginLeft: 4, marginBottom: 2 }}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
              {(v as any).fixes && (v as any).fixes.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#3b82f6', marginBottom: 6 }}>修复问题</div>
                  {(v as any).fixes.map((f: string, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: '#4a3f38', padding: '3px 0 3px 14px', borderLeft: '2px solid rgba(59,130,246,0.2)', marginLeft: 4, marginBottom: 2 }}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <SoftwareGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  )
}
