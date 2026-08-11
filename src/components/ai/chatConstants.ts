export type { Message, Conversation } from './chat/types'
export { WELCOME_MSG } from './chat/welcomeMessage'
// v16.3.0(审计 L4 修复): LAST_ACTIVE_KEY 死导出删除（chatStorageService 使用自己的字面量，双份声明有漂移风险）
export { STORAGE_KEY, WINDOW_KEY } from './chat/storageKeys'
