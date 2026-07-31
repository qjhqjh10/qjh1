import { inputStyle } from '@/components/common/styles';
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import type { PlotThread, ForeshadowItem, OutlineMeta } from '@/types/story';
import { DocumentTextIcon, GlobeAltIcon, UserGroupIcon, CubeIcon, MapPinIcon, ShieldCheckIcon, StarIcon, LightBulbIcon, ChartBarIcon, ArrowsRightLeftIcon, ArrowTrendingUpIcon, FaceSmileIcon, FlagIcon } from '@heroicons/react/24/outline';

export type Tab = 'basic' | 'worldbuilding' | 'characters' | 'items' | 'locations' | 'factions' | 'powerSystem' | 'foreshadow' | 'emotion' | 'threads'

/**
 * 大纲页 10 个 Tab 定义
 *
 * 故事剧情 (basic) — 核心剧情协作空间: 用户与AI在此讨论、碰撞和发展故事剧情。
 *   数据: outline/plot.md（纯文本/Markdown）。AI 可通过 edit_file 实时修改，界面自动刷新。
 *   设计意图: 多用、活用此 Tab，让AI成为创作伙伴而非一次性工具。
 *
 * 世界观（设定） (worldbuilding) — 世界观体系设定: 地理/政治/社会/历史/魔法科技。
 *   数据: outline/worldbuilding.md（纯文本/Markdown）。与故事剧情互补，前者聚焦"发生了什么"，
 *   后者聚焦"这个世界是怎样的"。
 *
 * 角色/道具/地点/势力/等级/伏笔/情绪/故事线 — 结构化数据管理。
 */
export const TABS: { key: Tab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'basic', label: '故事剧情', icon: DocumentTextIcon },
  { key: 'worldbuilding', label: '世界观（设定）', icon: GlobeAltIcon },
  { key: 'characters', label: '角色', icon: UserGroupIcon },
  { key: 'items', label: '道具', icon: CubeIcon },
  { key: 'locations', label: '地点', icon: MapPinIcon },
  { key: 'factions', label: '势力', icon: ShieldCheckIcon },
  { key: 'powerSystem', label: '等级', icon: ArrowTrendingUpIcon },
  { key: 'foreshadow', label: '伏笔', icon: LightBulbIcon },
  { key: 'emotion', label: '情绪', icon: FaceSmileIcon },
  { key: 'threads', label: '故事线', icon: FlagIcon },
]

export const THREAD_TYPES: { value: PlotThread['type']; label: string; color: string }[] = [
  { value: 'main', label: '主线', color: '#7c3aed' },
  { value: 'sub', label: '副线', color: '#3b82f6' },
  { value: 'hidden', label: '暗线', color: '#f59e0b' },
]

export const THREAD_COLORS = ['#7c3aed', '#3b82f6', '#f59e0b', '#ec4899', '#16a34a', '#ef4444', '#8b5cf6', '#06b6d4']

export const DEFAULT_OUTLINE_META: OutlineMeta = { foreshadowing: [], plotThreads: [], updatedAt: '' }

export const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: '#fff' }
export const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }
export const fieldInput: React.CSSProperties = { ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%' }

export const cardStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }

export const ITEM_TYPES = ['武器', '法宝', '丹药', '功法', '道具', '其他']
export const LOCATION_TYPES = ['门派', '城池', '秘境', '自然', '其他']
export const FACTION_TYPES = ['正道', '邪道', '中立', '皇朝', '其他']
