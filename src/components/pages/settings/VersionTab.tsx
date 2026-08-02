import { useState } from 'react'
import versionData from '@/data/version_history.json'
import SoftwareGuideModal from './SoftwareGuideModal'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

// v14.9.x: 版本更新改为在线文档方式——GitHub 网络受限，git 更新功能不可用，
// 已移除检查更新 IPC 与更新源地址，点击按钮弹窗说明并跳转腾讯在线文档查看网盘下载链接
const UPDATE_DOC_URL = 'https://docs.qq.com/sheet/DZmhreVBGUVhnZGN0?tab=BB08J2'

export function VersionTab() {
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const currentVersion = versionData.currentVersion
  const currentDate = versionData.currentDate
  const versionHistory = versionData.history

  const openUpdateDoc = () => {
    window.open(UPDATE_DOC_URL, '_blank', 'noopener')
    setShowUpdateModal(false)
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
            </div>
          </div>
        </div>

        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>版本更新</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowUpdateModal(true)} style={{
              padding: '8px 20px', borderRadius: 12, border: 'none', background: '#7c3aed', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              📥 版本更新
            </button>
            <span style={{ fontSize: 11, color: '#9b8e84' }}>查看最新版本及下载链接（腾讯在线文档）</span>
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

      {/* 版本更新弹窗 — 说明 git 更新不可用，引导进入腾讯在线文档查看下载链接 */}
      <Modal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} title="版本更新" width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%', margin: '0 auto',
            background: 'rgba(124,58,237,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ArrowTopRightOnSquareIcon style={{ width: 26, height: 26, color: '#7c3aed' }} />
          </div>
          <div style={{ fontSize: 13, color: '#4a3f38', lineHeight: 1.9 }}>
            <p style={{ margin: '0 0 8px' }}>
              因 GitHub 网络受限，软件内置的 <b>git 更新功能无法使用</b>，已改为在线文档方式。
            </p>
            <p style={{ margin: 0 }}>
              点击「确定」进入 <b>腾讯在线文档</b>，可查看小说软件的最新版本说明与<b>下载网盘链接</b>。
            </p>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', fontSize: 11, color: '#9b8e84', wordBreak: 'break-all', userSelect: 'text' }}>
            {UPDATE_DOC_URL}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
            <Button variant="secondary" onClick={() => setShowUpdateModal(false)}>取消</Button>
            <Button variant="primary" onClick={openUpdateDoc}>确定</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
