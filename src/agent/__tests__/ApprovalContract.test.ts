// ── Approval & Contract Tests (v14.5.0, 全自由模式 v14.6.0 修订) ──
// C1: HTTP/浏览器工具契约保留 detail（截断 4000）——模型能看到抓取内容
// C2: 全自由模式——list_directory/find_files/delete_file/rename_file 一律免审批；
//     update_prompt 仍 PROJECT_ASK / toggle_prompt AUTO
// C4: 审批超时（60s）→ 拒绝且工具未执行；WAITING_APPROVAL 阶段接线

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContractExecutor } from '../context/ContractExecutor'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import { createToolExecutor } from '../bridge/toolExecutorFactory'
import { V4SecurityFence } from '../V4SecurityFence'
import { AuditTrail } from '../audit/AuditTrail'
import { useAgentStore } from '../store/AgentStore'

toolRegistry.registerAll(ALL_TOOLS)

describe('C1 ContractExecutor: HTTP/浏览器工具 detail 保留', () => {
  it('http_get detail > 4000 → 截断并标记', () => {
    const { resultForApi } = ContractExecutor.filterForContext('http_get', {
      status: 'success' as const, summary: 'HTTP 200: https://x', detail: 'x'.repeat(5000),
    })
    expect(resultForApi.detail).toBeDefined()
    expect(String(resultForApi.detail).length).toBeLessThanOrEqual(4100)
    expect(String(resultForApi.detail)).toContain('已截断')
  })

  it('http_fetch/browser_open/browser_search 同样保留 detail', () => {
    for (const tool of ['http_fetch', 'browser_open', 'browser_search']) {
      const { resultForApi } = ContractExecutor.filterForContext(tool, {
        status: 'success' as const, summary: 'ok', detail: '内容',
      })
      expect(resultForApi.detail, tool).toBe('内容')
    }
  })

  it('detail ≤ 4000 原样保留', () => {
    const detail = '短内容'
    const { resultForApi } = ContractExecutor.filterForContext('http_get', {
      status: 'success' as const, summary: 'HTTP 200', detail,
    })
    expect(resultForApi.detail).toBe(detail)
  })

  it('error 状态 detail 保留（错误详情供模型自我修复）', () => {
    const detail = 'Connection refused: 10.0.0.1:8080'
    const { resultForApi } = ContractExecutor.filterForContext('browser_search', {
      status: 'error' as const, summary: '失败', detail,
    })
    expect(resultForApi.detail).toBe(detail)
  })

  it('read_file 等读工具契约不受影响', () => {
    const detail = '文件内容'
    const { resultForApi } = ContractExecutor.filterForContext('read_file', {
      status: 'success' as const, summary: 'ok', detail,
    })
    expect(resultForApi.detail).toBe(detail)
  })
})

describe('C2 审批门 (v14.5.1 全自由模式)', () => {
  it('list_directory 一律免审批（含 broad），find_files/delete/rename 免审批', () => {
    expect(toolRegistry.needsApproval('list_directory', { broad: true })).toBe(false)
    expect(toolRegistry.needsApproval('list_directory', { dir_path: 'characters/' })).toBe(false)
    expect(toolRegistry.needsApproval('list_directory')).toBe(false)
    expect(toolRegistry.needsApproval('find_files', { pattern: '*.yaml', scope: 'computer' })).toBe(false)
    expect(toolRegistry.needsApproval('delete_file', { file_path: 'chapters/ch3.txt' })).toBe(false)
    expect(toolRegistry.needsApproval('rename_file', { file_path: 'a.md', new_path: 'b.md' })).toBe(false)
  })

  it('update_prompt 需审批（PROJECT_ASK），toggle_prompt 免审批（AUTO）', () => {
    expect(toolRegistry.needsApproval('update_prompt')).toBe(true)
    expect(toolRegistry.needsApproval('toggle_prompt')).toBe(false)
  })

  it('无审批路径（子代理）时 update_prompt 直接拒绝', async () => {
    const executor = createToolExecutor({
      securityFence: new V4SecurityFence('test-project'),
      auditTrail: new AuditTrail(),
      projectId: 'test-project',
      // 不传 onApprovalRequired → 模拟子代理环境
    })
    const result = await executor({ title: 't', content: 'c' }, {
      projectId: 'test-project', configId: 'test-config',
      callId: 'c1', toolName: 'update_prompt', signal: new AbortController().signal,
    })
    expect(result.status).toBe('error')
    expect(result.summary).toContain('不支持审批')
  })
})

describe('C4 审批超时竞态 + WAITING_APPROVAL (v14.5.0)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('审批挂起超过 60s → 拒绝且工具未执行', async () => {
    const executor = createToolExecutor({
      securityFence: new V4SecurityFence('test-project'),
      auditTrail: new AuditTrail(),
      projectId: 'test-project',
      approvalTimeoutMs: 60_000,
      onApprovalRequired: () => new Promise<boolean>(() => {}),  // 永不结算 → 靠超时拒绝
    })
    const execPromise = executor({ title: 't', content: 'c' }, {
      projectId: 'test-project', configId: 'test-config',
      callId: 'c1', toolName: 'update_prompt', signal: new AbortController().signal,
    })
    // 59s 未决
    await vi.advanceTimersByTimeAsync(59_000)
    let settled = false
    execPromise.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    // 61s → 超时拒绝
    const result = await vi.advanceTimersByTimeAsync(2_000).then(() => execPromise)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('拒绝')
  })

  it('审批等待期间 AgentStore phase = WAITING_APPROVAL，结束后恢复 EXECUTE', async () => {
    // 预热动态 import（避免首个测试的模块加载时序影响 phase 断言）
    await import('../store/AgentStore')
    const phaseCalls: string[] = []
    const origSetPhase = useAgentStore.getState().setPhase
    const setPhaseSpy = vi.spyOn(useAgentStore.getState(), 'setPhase').mockImplementation((p: any) => {
      phaseCalls.push(String(p))
      origSetPhase(p)
    })
    const executor = createToolExecutor({
      securityFence: new V4SecurityFence('test-project'),
      auditTrail: new AuditTrail(),
      projectId: 'test-project',
      approvalTimeoutMs: 60_000,
      onApprovalRequired: () => new Promise<boolean>(() => {}),  // 挂起 → 期间 phase 应为 WAITING_APPROVAL
    })
    const execPromise = executor({ title: 't', content: 'c' }, {
      projectId: 'test-project', configId: 'test-config',
      callId: 'c1', toolName: 'update_prompt', signal: new AbortController().signal,
    })
    // flush 微任务队列（动态 import + 审批进入挂起需要若干轮微任务）
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentStore.getState().run.phase).toBe('WAITING_APPROVAL')
    // 超时拒绝后恢复 EXECUTE
    const result = await vi.advanceTimersByTimeAsync(61_000).then(() => execPromise)
    expect(result.status).toBe('error')
    expect(useAgentStore.getState().run.phase).toBe('EXECUTE')
    setPhaseSpy.mockRestore()
  })
})
