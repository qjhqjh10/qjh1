// ── Hallucination Detector ──
// Detects when AI claims to have performed an action but did not actually call a tool.

export class HallucinationDetector {
  // Keywords that suggest the AI is claiming an action was done
  private actionClaims = /已创建|已修改|已编辑|已删除|已生成|已写入|已完成|已保存|已添加|已追加|已读取|已列出/

  detect(text: string, knownTools: Set<string>): string | null {
    if (!text || typeof text !== 'string') return null
    if (!this.actionClaims.test(text)) return null

    // Check if the text claims tool-like actions but no tools were called
    const claimedActions: string[] = []
    if (/已创建/.test(text)) claimedActions.push('创建文件')
    if (/已修改|已编辑/.test(text)) claimedActions.push('编辑文件')
    if (/已删除/.test(text)) claimedActions.push('删除文件')
    if (/已生成/.test(text)) claimedActions.push('生成内容')
    if (/已写入/.test(text)) claimedActions.push('写入文件')
    if (/已保存/.test(text)) claimedActions.push('保存内容')

    if (claimedActions.length > 0 && knownTools.size === 0) {
      return `检测到你在回复中声称了这些操作: ${claimedActions.join('、')}，但你没有调用任何工具。请立即调用对应工具完成操作。`
    }

    return null
  }
}
