import {
  BookOpenIcon, DocumentTextIcon, ListBulletIcon,
  SparklesIcon, LightBulbIcon, FireIcon,
} from '@heroicons/react/24/outline'
import type { PreviewTab, NovelType, DimKey } from './types'

export const TABS: { key: PreviewTab; label: string; icon: typeof BookOpenIcon }[] = [
  { key: 'chapter', label: '章节', icon: BookOpenIcon },
  { key: 'srcOutline', label: '原书大纲', icon: DocumentTextIcon },
  { key: 'srcDetails', label: '原书细纲', icon: ListBulletIcon },
  { key: 'generate', label: '生成', icon: SparklesIcon },
  { key: 'outline', label: '大纲', icon: DocumentTextIcon },
  { key: 'details', label: '细纲', icon: ListBulletIcon },
  { key: 'timeline', label: '时间线', icon: LightBulbIcon },
  { key: 'write', label: '章节创作', icon: BookOpenIcon },
]

export const STATUS_LABELS: Record<string, string> = {
  draft: '未开始', extracting: '提取中', aggregated: '已聚合', completed: '已完成',
}

export const STATUS_COLORS: Record<string, string> = {
  draft: '#9b8e84', extracting: '#f59e0b', aggregated: '#3b82f6', completed: '#16a34a',
}

export const TYPE_LABELS: Record<string, string> = {
  general: '通用', urban: '都市', urban_cultivation: '都市玄幻', urban_soldier: '都市兵王',
  cultivation: '修仙', martial: '武侠',
  romance: '恋爱', ancient: '古风', mystery: '悬疑', historical: '历史',
  transmigration: '穿越', scifi: '科幻', erotic: '情色',
}

export const TYPE_DIM_PRESETS: Record<string, string[]> = {
  general: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  urban: ['characters','worldbuilding','chapterSummary','events','foreshadowing','emotionalTone','romanceDynamics','economics'],
  urban_cultivation: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  urban_soldier: ['characters','worldbuilding','items','militarySystem','chapterSummary','events','foreshadowing','emotionalTone'],
  cultivation: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  martial: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  romance: ['characters','worldbuilding','chapterSummary','events','emotionalTone','romanceDynamics'],
  ancient: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone'],
  mystery: ['characters','worldbuilding','chapterSummary','events','foreshadowing','emotionalTone','mysteryChain'],
  historical: ['characters','worldbuilding','chapterSummary','events','foreshadowing','politics','economics','militarySystem'],
  transmigration: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','politics'],
  scifi: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','technology'],
  erotic: ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone','erotic'],
}

export const DIM_LABELS: Record<string, string> = {
  characters: '角色', worldbuilding: '世界观', items: '道具',
  powerSystem: '等级', foreshadowing: '伏笔', emotionCurve: '情绪', erotic: '情色',
  technology: '科技体系', politics: '政治/势力格局',
  romanceDynamics: '感情线', mysteryChain: '推理链',
  militarySystem: '军事/战力体系', economics: '经济/资源体系',
}

export function normalizeRole(role: string): string {
  const r = (role || '').trim()
  if (['男主','女主','男配','女配','反派'].includes(r)) return r
  if (r.includes('男主') || r === '主角') return '男主'
  if (r.includes('女主')) return '女主'
  if (r.includes('男配') || r.includes('兄弟') || r.includes('朋友')) return '男配'
  if (r.includes('女配') || r.includes('姐妹')) return '女配'
  if (r.includes('反派') || r.includes('敌人') || r.includes('对手')) return '反派'
  return '其他'
}

export const NOVEL_TYPE_CARDS: { type: NovelType; label: string; icon: typeof BookOpenIcon; color: string; desc: string }[] = [
  { type: 'general', label: '通用', icon: BookOpenIcon, color: '#7c3aed', desc: '角色·世界观·等级·摘要·伏笔·情节结构' },
  { type: 'urban', label: '都市', icon: BookOpenIcon, color: '#3b82f6', desc: '职场·社交·感情线·经济(无等级)' },
  { type: 'urban_cultivation', label: '都市玄幻', icon: BookOpenIcon, color: '#8b5cf6', desc: '都市+修炼·境界·丹药·秘境' },
  { type: 'urban_soldier', label: '都市兵王', icon: BookOpenIcon, color: '#ef4444', desc: '军衔·战力·装备·任务' },
  { type: 'cultivation', label: '修仙', icon: BookOpenIcon, color: '#16a34a', desc: '境界·丹药·秘境·功法' },
  { type: 'martial', label: '武侠', icon: BookOpenIcon, color: '#e67e00', desc: '门派·经脉·招式·江湖' },
  { type: 'romance', label: '恋爱', icon: BookOpenIcon, color: '#ec4899', desc: '感情阶段·好感度(无道具等级)' },
  { type: 'ancient', label: '古风', icon: BookOpenIcon, color: '#8b5cf6', desc: '礼仪·称谓·古物·诗词' },
  { type: 'mystery', label: '悬疑', icon: BookOpenIcon, color: '#1e293b', desc: '线索·嫌疑人·反转·推理链' },
  { type: 'historical', label: '历史', icon: BookOpenIcon, color: '#92400e', desc: '官职·制度·权谋·战争·经济' },
  { type: 'transmigration', label: '穿越', icon: BookOpenIcon, color: '#06b6d4', desc: '现代知识·新旧对比·身份冲突·政治' },
  { type: 'scifi', label: '科幻', icon: BookOpenIcon, color: '#6366f1', desc: '科技等级·机甲·星际·基因·经济' },
  { type: 'erotic', label: '情色', icon: FireIcon, color: '#dc2626', desc: 'dom-sub·身体状态·性爱流程·体液·权力' },
]
