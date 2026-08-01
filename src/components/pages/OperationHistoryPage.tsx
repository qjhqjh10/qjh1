// ── Operation History Page (v14.3) ──
// 内容逻辑已提取到 settings/tabs/agent/OperationHistorySection（供设置页 Agent 子标签复用）。
// 本页保留全页容器 + 路由 /operation-history（无导航入口，供直接访问/兼容）。

import OperationHistorySection from '@/components/pages/settings/tabs/agent/OperationHistorySection'

export default function OperationHistoryPage() {
  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>操作记录</h1>
      <p style={{ fontSize: 13, color: '#9b8e84', marginBottom: 20 }}>
        AI 写作助手的所有文件操作记录，数据持久化保存。
      </p>
      <OperationHistorySection />
    </div>
  )
}
