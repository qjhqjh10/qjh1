export const STORAGE_KEY = 'ai-chat-conversations'
export const WINDOW_KEY = 'ai-chat-window'
// v16.3.0(审计 L4 修复): LAST_ACTIVE_KEY 删除——chatStorageService.ts:19 已用同值字面量
//（唯一消费方），此处双份声明有漂移风险
