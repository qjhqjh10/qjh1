import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService } from '@/services/fileService'
import { loadCharacters } from '@/services/characterService'
import { loadOutlineContent, saveOutlineContent, loadWorldbuildingContent, saveWorldbuildingContent } from '@/services/outlineService'
import { htmlToMarkdown } from '@/utils/markdownConverter'
import { outlineTabPath } from '@/utils/filePaths'
import { loadSections, saveSections } from '@/services/outlineSectionService'
import { migrateOutlineLayout } from '@/services/outlineMigration'
import WordCount from '@/components/common/WordCount'
import Button from '@/components/common/Button'
import { SkeletonCard } from '@/components/common/Skeleton'
import RichTextEditor from '@/components/common/RichTextEditor'
import CharactersPanel from '@/components/panels/CharactersPanel'
import { EntitySectionView } from './EntitySectionView'
import { SectionWizardModal } from './SectionWizardModal'
import { PlusIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import type { OutlineSectionDef } from '@/types/outline'

// ── v16.4.1(用户需求): 大纲部分化——侧边栏由 sections.json 动态渲染：
// 固定 3 部分（故事剧情/世界观/角色）+ 可增删部分（道具/地点/势力/等级/伏笔/情绪/故事线 + 用户自定义）。
// 实体部分统一"角色式"卡片管理（点击卡片编辑，一个实体一个文件）。 ──

// v16.4.1(审查修复): 图标收敛共享单一真源（builtinSections.SECTION_EMOJI）
import { SECTION_EMOJI } from '@/data/builtinSections'
const sectionIcon = (key: string) => SECTION_EMOJI[key] || '📄'

export default function OutlinePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileVersion = useStore(s => s.fileVersion)
  const outlineContent = useStore(s => s.outlineContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)

  const [projectPath, setProjectPath] = useState('')
  const [rawOutline, setRawOutline] = useState('')
  const [rawWorldbuilding, setRawWorldbuilding] = useState('')
  const [sections, setSections] = useState<OutlineSectionDef[]>([])
  const [activeTab, setActiveTab] = useState<string>('story')
  const [loading, setLoading] = useState(true)
  // AI 直接改文件 → 实体部分刷新信号（命中 outline/<部分>/ 目录时 +1）
  const [entityReloadTick, setEntityReloadTick] = useState(0)
  // 新增部分向导
  const [showWizard, setShowWizard] = useState(false)

  // Auto-save on user edit (debounced 1s). Flag prevents saving during initial load.
  const outlineDirty = useRef(false)
  const handleOutlineChange = useCallback((text: string) => {
    setOutlineContent(text)
    outlineDirty.current = true
  }, [])
  useEffect(() => {
    if (!projectPath || !outlineDirty.current) return
    const timer = setTimeout(() => { saveOutlineContent(projectPath, outlineContent); outlineDirty.current = false }, 1000)
    return () => clearTimeout(timer)
  }, [outlineContent, projectPath])

  const wbDirty = useRef(false)
  const handleWbChange = useCallback((text: string) => {
    setWorldbuildingContent(text)
    wbDirty.current = true
  }, [])
  useEffect(() => {
    if (!projectPath || !wbDirty.current) return
    const timer = setTimeout(() => { saveWorldbuildingContent(projectPath, worldbuildingContent); wbDirty.current = false }, 1000)
    return () => clearTimeout(timer)
  }, [worldbuildingContent, projectPath])

  // Sync raw content when user edits (for character count)
  useEffect(() => { setRawOutline(htmlToMarkdown(outlineContent)) }, [outlineContent])
  useEffect(() => { setRawWorldbuilding(htmlToMarkdown(worldbuildingContent)) }, [worldbuildingContent])

  // Let AI assistant know which page we're on
  useEffect(() => {
    setActivePage(activeTab === 'worldbuilding' ? 'worldbuilding' : activeTab === 'characters' ? 'characters' : 'outline')
  }, [activeTab])

  // Sync tab to URL
  useEffect(() => {
    const currentTab = searchParams.get('tab')
    if (activeTab !== currentTab && activeTab !== 'story') {
      setSearchParams({ tab: activeTab }, { replace: true })
    } else if (activeTab === 'story' && currentTab) {
      setSearchParams({}, { replace: true })
    }
  }, [activeTab])

  // Load data（先迁移旧布局 → 再读 sections/正文/角色）
  useEffect(() => {
    if (!activeProjectId) { navigate('/'); return }
    if (!projectsBasePath) { return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    setLoading(true)

    ;(async () => {
      await migrateOutlineLayout(pp).catch(() => {})
      await Promise.all([
        loadSections(pp).then(setSections),
        loadOutlineContent(pp).then(c => { setOutlineContent(c) }),
        loadWorldbuildingContent(pp).then(c => { setWorldbuildingContent(c) }),
        fileService.read(`${pp}/outline/plot.md`).then(c => setRawOutline(c)).catch(() => setRawOutline('')),
        fileService.read(`${pp}/outline/worldbuilding.md`).then(c => setRawWorldbuilding(c)).catch(() => setRawWorldbuilding('')),
        loadCharacters(pp).then(chars => { useStore.getState().setCharacters(chars) }),
      ])
    })().finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath, fileVersion])

  // 初始 tab：URL 指定且存在 → 用之；否则 story
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && sections.some(s => s.key === tab)) setActiveTab(tab)
  }, [sections])

  // AI direct edit via edit_file → reload content（兼容新目录 + 旧平铺路径）
  useEffect(() => {
    if (!fileEditNotify || !projectPath) return
    const normalized = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    const pp = projectPath.replace(/\\/g, '/').toLowerCase()
    const projectName = pp.split('/').filter(Boolean).pop() || ''
    const tabPath = (tab: string) => outlineTabPath(projectName, tab).toLowerCase()

    let handled = false
    // doc 部分：新路径 story/worldbuilding + 旧平铺路径
    const storyPaths = [tabPath('story'), tabPath('storyLegacy'), `${projectName}/outline/plot.md`]
    const wbPaths = [tabPath('worldbuilding'), tabPath('worldbuildingLegacy'), `${projectName}/outline/worldbuilding.md`]
    if (storyPaths.some(p => normalized === p) || normalized === `${projectName}/outline/outline.json`) {
      handled = true
      loadOutlineContent(projectPath).then(setOutlineContent)
    } else if (wbPaths.some(p => normalized === p)) {
      handled = true
      loadWorldbuildingContent(projectPath).then(setWorldbuildingContent)
    } else if (normalized.endsWith('/sections.json') && normalized.includes('/outline/')) {
      handled = true
      loadSections(projectPath).then(setSections)
    } else {
      // 实体目录：outline/<sectionKey>/... → 刷新对应实体列表
      const entityHit = sections.find(s => s.type === 'entities' && normalized.includes(`/outline/${s.key.toLowerCase()}/`))
      if (entityHit) {
        handled = true
        setEntityReloadTick(t => t + 1)
      }
    }
    if (handled) setFileEditNotify(null)
  }, [fileEditNotify, projectPath, sections])

  const handleCreateSection = async (name: string, fields: OutlineSectionDef['fields']) => {
    // v16.4.1(审查修复): key 净化——非法路径字符替换（原直接 trim 会破坏目录）
    const key = name.trim().replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40)
    if (!key) { alert('部分名称不能为空'); return }
    if (sections.some(s => s.key === key || s.name === name.trim())) {
      alert(`已存在同名部分「${name}」`)
      return
    }
    const next: OutlineSectionDef = { key, name: name.trim(), type: 'entities', fields: fields || [] }
    const updated = [...sections, next]
    setSections(updated)
    await saveSections(projectPath, updated)
    setShowWizard(false)
    setActiveTab(key)
  }

  // v16.4.1(用户需求): 屏蔽/恢复部分——数据与文件保留，侧边栏划线表示暂不需要
  const toggleSectionHidden = async (section: OutlineSectionDef) => {
    const updated = sections.map(s => s.key === section.key ? { ...s, hidden: !s.hidden } : s)
    setSections(updated)
    await saveSections(projectPath, updated)
  }

  if (!activeProjectId) return null
  if (loading) return <div style={{ flex: 1, padding: 24 }}><SkeletonCard lines={3} /></div>

  const activeSection = sections.find(s => s.key === activeTab)
  const tabTitle = activeSection?.name || '大纲'

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left tabs（v16.4.1: 动态部分列表 + 新增/删除） */}
        <div className="glass custom-scrollbar" style={{ width: 210, minWidth: 210, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 3, overflowY: 'auto' }}>
          {sections.map(section => (
            <div key={section.key} style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: section.hidden ? 0.55 : 1 }}>
              <button onClick={() => setActiveTab(section.key)} className="interactive-accent" style={{
                flex: 1, textAlign: 'left', padding: '9px 12px', borderRadius: 10, border: 'none', minWidth: 0,
                background: activeTab === section.key ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: activeTab === section.key ? '#7c3aed' : section.hidden ? '#b0a89e' : '#6b5e54',
                fontWeight: activeTab === section.key ? 700 : 400, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.1s',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                textDecoration: section.hidden ? 'line-through' : 'none',
              }}>
                <span style={{ flexShrink: 0, filter: section.hidden ? 'grayscale(1)' : 'none' }}>{sectionIcon(section.key)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.name}</span>
                {section.fixed && <span style={{ fontSize: 9, color: '#b0a89e', flexShrink: 0 }}>·固定</span>}
              </button>
              {!section.fixed && (
                <button
                  onClick={() => toggleSectionHidden(section)}
                  title={section.hidden ? `恢复「${section.name}」` : `屏蔽「${section.name}」（数据保留，划线表示暂不需要）`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0, borderRadius: 6, color: section.hidden ? '#7c3aed' : '#c0b8ae' }}
                  onMouseEnter={e => { e.currentTarget.style.color = section.hidden ? '#7c3aed' : '#6b5e54'; e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = section.hidden ? '#7c3aed' : '#c0b8ae'; e.currentTarget.style.background = 'transparent' }}
                >
                  {section.hidden ? <EyeIcon style={{ width: 14, height: 14 }} /> : <EyeSlashIcon style={{ width: 14, height: 14 }} />}
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setShowWizard(true)} title="新增一个自定义部分（如：恋爱关系、时间线）"
            style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 10, marginTop: 6,
              border: '1px dashed rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.03)', color: '#7c3aed',
              fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', fontWeight: 500 }}>
            <PlusIcon style={{ width: 15, height: 15 }} />
            新增部分
          </button>
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{tabTitle}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {activeTab === 'story' && <WordCount text={outlineContent} rawText={rawOutline} />}
              {activeTab === 'worldbuilding' && <WordCount text={worldbuildingContent} rawText={rawWorldbuilding} />}
            </div>
          </div>
          {(() => {
            if (!activeSection) return <div style={{ padding: 40, fontSize: 12, color: '#9b8e84' }}>部分不存在</div>
            if (activeSection.hidden) {
              // v16.4.1: 屏蔽占位——数据仍在，可随时恢复
              return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>{sectionIcon(activeSection.key)}</div>
                    <div style={{ fontSize: 14.5, color: '#6b5e54', fontWeight: 600 }}>「{activeSection.name}」已屏蔽</div>
                    <div style={{ fontSize: 12.5, color: '#9b8e84', margin: '6px 0 16px' }}>数据与文件均保留，点击下方按钮恢复使用</div>
                    <Button size="sm" variant="secondary" onClick={() => toggleSectionHidden(activeSection)} icon={<EyeIcon style={{ width: 13, height: 13 }} />}>
                      恢复「{activeSection.name}」
                    </Button>
                  </div>
                </div>
              )
            }
            if (activeSection.type === 'doc') {
              if (activeTab === 'story') {
                return (
                  <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
                    <RichTextEditor
                      content={outlineContent}
                      onContentChange={handleOutlineChange}
                      placeholder="故事剧情协作空间。直接输入，或让 AI 帮你整理。支持标题、列表、图片、排版..."
                    />
                  </div>
                )
              }
              return (
                <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
                  <RichTextEditor
                    content={worldbuildingContent}
                    onContentChange={handleWbChange}
                    placeholder="世界观设定。直接输入，或让 AI 帮你整理。支持标题、列表、图片、排版..."
                  />
                </div>
              )
            }
            if (activeTab === 'characters') {
              return <CharactersPanel showWorldbuildingPanel={false} standalone={false} />
            }
            return (
              <EntitySectionView
                key={activeSection.key}
                projectPath={projectPath}
                section={activeSection}
                activeConfigId={activeConfigId}
                reloadSignal={entityReloadTick}
              />
            )
          })()}
        </div>
      </div>

      {/* 新增部分向导 */}
      <SectionWizardModal
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onCreate={handleCreateSection}
      />
    </div>
  )
}
