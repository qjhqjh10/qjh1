import {
  ClockIcon, LinkIcon, ShieldCheckIcon, ChartBarIcon,
  TableCellsIcon, ArrowsRightLeftIcon, Bars3Icon,
  EyeIcon, ArrowTrendingUpIcon, SparklesIcon,
  UserGroupIcon, HeartIcon,
} from '@heroicons/react/24/outline'
import type { StoryEvent } from '@/types/story'

export type TabKey = 'timeline' | 'foreshadowing' | 'consistency' | 'emotion' | 'presence' | 'rhythm' | 'plotline' | 'pov' | 'growth' | 'timeFlow' | 'coOccurrence' | 'romanceProgress' | 'cultivationProgress'

export const TABS: { key: TabKey; label: string; icon: typeof ClockIcon }[] = [
  { key: 'growth', label: '成长', icon: ArrowTrendingUpIcon },
  { key: 'timeFlow', label: '时间流速', icon: ClockIcon },
  { key: 'timeline', label: '时间线', icon: SparklesIcon },
  { key: 'foreshadowing', label: '伏笔链', icon: LinkIcon },
  { key: 'consistency', label: '一致性', icon: ShieldCheckIcon },
  { key: 'emotion', label: '情绪', icon: ChartBarIcon },
  { key: 'romanceProgress', label: '感情线', icon: HeartIcon },
  { key: 'coOccurrence', label: '共现网络', icon: UserGroupIcon },
  { key: 'presence', label: '出场', icon: TableCellsIcon },
  { key: 'rhythm', label: '节奏', icon: ArrowsRightLeftIcon },
  { key: 'cultivationProgress', label: '修炼进度', icon: ArrowTrendingUpIcon },
  { key: 'plotline', label: '支线', icon: Bars3Icon },
  { key: 'pov', label: 'POV', icon: EyeIcon },
]

export const EVENT_TYPE_LABELS: Record<string, string> = {
  event: '事件', foreshadowing: '伏笔·埋', payoff: '伏笔·收',
}

export const EVENT_TYPE_COLORS: Record<string, string> = {
  event: '#3b82f6', foreshadowing: '#f59e0b', payoff: '#16a34a',
}

export const EMPTY_EVENT: Omit<StoryEvent, 'id' | 'createdAt'> = {
  type: 'event', timeLabel: '', chapterId: '', chapterOrder: 0, chapterTitle: '',
  characters: [], location: '', summary: '', quote: '', source: 'manual',
}

export const EMOTION_LINES = [
  { key: 'tension', label: '紧张', color: '#ef4444' },
  { key: 'warmth', label: '温情', color: '#ec4899' },
  { key: 'sadness', label: '悲伤', color: '#3b82f6' },
  { key: 'excitement', label: '激昂', color: '#f59e0b' },
  { key: 'lightness', label: '轻松', color: '#16a34a' },
] as const

export const PLOTLINE_COLORS = ['#7c3aed', '#ec4899', '#3b82f6', '#f59e0b', '#16a34a']

export const POV_TYPE_LABELS: Record<string, string> = {
  first: '第一人称', 'third-close': '第三人称·近', 'third-omniscient': '第三人称·全知', mixed: '混合视角',
}

export const CHANGE_LABELS: Record<string, string> = {
  new: '+新增', upgrade: '↑升级', downgrade: '↓降级', lost: '✕失去', same: '初始',
}

export const CHANGE_COLORS: Record<string, string> = {
  new: '#3b82f6', upgrade: '#16a34a', downgrade: '#ef4444', lost: '#9b8e84', same: '#6b7280',
}
