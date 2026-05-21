import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'

interface Props {
  isOpen: boolean
  onClose: () => void
}

interface Section {
  title: string
  icon: string
  items: string[]
}

const SECTIONS: Section[] = [
  {
    title: '项目管理',
    icon: '📁',
    items: [
      '首页可创建三种项目类型：普通写作、小说仿写、小说续写',
      '项目卡片支持封面图上传、小说分类设置',
      '支持 .zip 格式的项目导出/导入（含续写/仿写数据）',
      '首页三栏统计：完成章节数 / 总字数 / 项目类型',
    ],
  },
  {
    title: 'AI 写作助手（悬浮聊天窗）',
    icon: '💬',
    items: [
      'Plan 模式：AI 仅使用只读工具进行安全分析，不会修改文件',
      'Action 模式：AI 可读写文件、创建项目、编辑章节等全部操作',
      '文件操作工具：查看/编辑/创建/删除/重命名项目文件，编辑预览 Diff 确认',
      '智能备份：每次编辑自动备份（每文件保留 10 份），支持一键回滚',
      '草稿笔记：AI 可管理 notes/ 目录下的 5 个笔记操作（列出/读取/写入/追加/删除）',
      '知识库搜索：索引后的文件可语义搜索，注入 AI 上下文',
      '联网搜索：DuckDuckGo 实时搜索补充信息',
      '图片搜索：search_images 通过 Unsplash 搜索高清图片保存到项目',
      '上下文用量条：实时显示当前会话已用 token / 模型总上下文（绿黄红三级预警）',
      '📄 文件按钮：上传 .txt/.md 文件内容作为对话上下文',
      '📷 图片按钮：上传图片保存到项目 images/ 目录',
      '多窗口弹窗：大纲/世界观/草稿可拖拽独立窗口，AI 同时编辑多个文档',
      '语音对话：语音输入（麦克风）+ AI 朗读回复（扬声器），零依赖',
      '会话持久化：对话历史保存到 localStorage，支持多会话切换',
    ],
  },
  {
    title: '大纲与细纲',
    icon: '📋',
    items: [
      '大纲页：10 个 Tab（基础设定/世界观/角色/道具/地点/势力/等级/伏笔/情绪/故事线）',
      '大纲内容支持 AI 自动生成和手动编辑，1 秒自动保存',
      '细纲页：结构化字段（剧情概述/角色/地点/关键事件），2 列卡片网格',
      '细纲支持拖拽排序、弹窗编辑全字段、章节状态管理',
      '存储格式统一为 JSON，向后兼容旧 TXT 自动迁移',
    ],
  },
  {
    title: '角色系统',
    icon: '👤',
    items: [
      '角色卡片：支持 AI 根据描述生成完整角色（11 个字段）',
      'AI 生成时自动搜索匹配形象图（英文关键词 → Unsplash）',
      '形象图显示在卡片顶部，点击打开灯箱（滚轮缩放 / 拖拽平移 / 键盘 +/-/0 重置）',
      '支持手动上传/更换/移除角色形象图，图片存储为文件',
      '角色关系图：AI 分析角色关系网生成可视化图谱（G6 力导向布局）',
      '角色重要度数值化（1-100），关系标签系统（恋人/师徒/敌人等）',
    ],
  },
  {
    title: '章节写作',
    icon: '✍️',
    items: [
      'TipTap 富文本编辑器：支持粗体/斜体/下划线/删除线/标题/列表/引用/分割线',
      '字体/字号/行距/字距/颜色/首行缩进可调',
      '插入图片：点击 🖼 按钮，支持 base64 嵌入',
      '图片对齐：左对齐（文字环绕）/ 居中 / 右对齐（文字环绕）',
      '图片大小：CSS resize 拖拽调整，尺寸自动持久化到节点属性',
      '嵌入/独立切换：图片可在文字中嵌入或独立成行',
      '插入链接、符号库、查找替换',
      'AI 功能：生成内容 / 续写 / 润色 / 审稿（结构化评分）/ 摘要 / 改写',
      '批量生成：选择范围一次性生成多章',
      '版本对比：行级 LCS diff 算法，红绿灰高亮差异',
    ],
  },
  {
    title: '小说仿写',
    icon: '📖',
    items: [
      '11 种小说类型支持（普通/情色/都市/修仙/武侠/恋爱/古风/悬疑/历史/科幻/穿越）',
      '流程：导入 TXT → 选择分析维度 → 逐章提取 → 自动聚合（6 模式）',
      '风格分析：AI 逐章分析文风 → 聚合 StyleProfile → 保存为模板',
      '大纲模仿：7 个维度独立生成（角色/世界观/道具/等级/伏笔/情绪/情色）',
      '细纲模仿：逐章生成，每章精准对应原作章节，7 维全部注入 prompt',
      '章节写作：三栏编辑器（左参考/中正文/右大纲），可 AI 生成',
    ],
  },
  {
    title: '小说续写',
    icon: '⏩',
    items: [
      '6 步向导：导入原文 → 逐章分析 → 聚合总结 → 剧情走向 → 大纲融合 → 细纲/写作',
      '9 维分析：角色/设定/伏笔/等级/道具/势力/地点/情绪/关系',
      '自动编码检测：jschardet + iconv-lite 支持 GBK/UTF-8/Big5',
      '大纲融合：续写大纲与原著大纲合并，约束注入（已死/已毁黑名单）',
    ],
  },
  {
    title: '风格工坊与场景工坊',
    icon: '🎨',
    items: [
      '风格工坊：导入 TXT → AI 逐章分析 26 维文风 → 聚合 StyleProfile',
      '风格模板库：手动创建/编辑/AI 辅助填充，保存为可复用模板',
      '双层基调：底层色情基调（不可动摇）+ 上层风格辨识',
      '场景工坊：10 区块卡片式配置（角色/地点/叙事技法/情绪/感官/伏笔等）',
      '场景模板：新建/编辑/复制/删除，支持普通小说和情色小说双类型',
      'AI 生成章节时自动注入风格和场景配置',
    ],
  },
  {
    title: '故事脉络',
    icon: '🗺️',
    items: [
      '独立系统，零项目依赖，导入 TXT 即用',
      '14 个分析标签页：时间线/伏笔链/一致性/情绪曲线/出场热力图/节奏分析',
      '支线分析/POV 视角/角色成长/设定状态/时间流速/共现网络/感情线/修炼进度',
      '硬规则引擎：代码级检测角色生死/道具/势力/地点 4 类冲突，100% 准确',
    ],
  },
  {
    title: '知识库 (RAG)',
    icon: '📚',
    items: [
      '支持 PDF/DOCX/TXT/MD 文件上传',
      '自动分块 → Embedding 向量化 → 语义搜索',
      '可分配文件到指定项目，按项目过滤',
      'AI 对话时可选择知识库文件作为上下文来源',
    ],
  },
  {
    title: '剧情改写',
    icon: '🔄',
    items: [
      '3 步工作流：导入 TXT → AI 逐章分析 → 三栏改写编辑器',
      'AI 改写红蓝标注：原文标红 + 改写内容标蓝',
      '纯文本改写：支持 @@原文@@ / @@修改@@ 格式',
      '直接替换模式：AI 直接修改章节文件，编辑器自动刷新',
    ],
  },
  {
    title: 'EPUB 电子书导出',
    icon: '📕',
    items: [
      '章节写作页 → 导出按钮 → 选择「EPUB 电子书」模式',
      '支持书名和作者自定义',
      '标准 EPUB 3.0 格式，兼容手机/Kindle/Apple Books',
      '章节内的图片自动提取嵌入到 OEBPS/images/',
      '自动生成目录导航 (toc.ncx)',
    ],
  },
  {
    title: '系统设置',
    icon: '⚙️',
    items: [
      '模型配置：支持 10 种服务商预设（DeepSeek/OpenAI/Claude/智谱/通义千问等）',
      '上下文窗口大小可配（128K ~ 1M），用量条根据模型动态切换',
      'API 密钥加密存储（Electron safeStorage）',
      '推理深度可调（min/low/medium/high/max），仅 DeepSeek Pro / OpenAI o 系列',
      '价格设置：自定义输入/输出/缓存命中的每百万 token 价格，Token 统计自动计费',
      '提示词库：10 个默认模板覆盖全部写作类型，支持自定义',
      '显示设置：侧边栏/卡片/按钮/编辑器/工具栏字号 + 暗色模式',
      'Token 统计：按项目/日期/模型查询用量和费用',
    ],
  },
  {
    title: '快捷键与操作提示',
    icon: '⌨️',
    items: [
      '灯箱缩放：鼠标滚轮 / 键盘 +/- 缩放，按住拖拽平移，按 0 重置',
      'AI 聊天窗：右下角悬浮，可拖拽移动、四角缩放调整大小',
      '编辑器：Ctrl+B 粗体 / Ctrl+I 斜体 / Ctrl+Z 撤销 / Ctrl+Y 重做',
      'Plan 模式安全提示：检测到文件修改建议时显示黄色提醒横幅',
      '悬浮 AI 按钮：右下角快捷打开/关闭 AI 聊天窗口',
    ],
  },
]

export default function SoftwareGuideModal({ isOpen, onClose }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="软件功能说明" width={700}>
      <ScrollArea maxHeight="70vh" style={{ paddingRight: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SECTIONS.map((section, si) => (
            <div key={si} style={{
              padding: 16, borderRadius: 14,
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(0,0,0,0.05)',
            }}>
              <h3 style={{
                fontSize: 15, fontWeight: 700, color: '#2d2520',
                marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>{section.icon}</span>
                <span>{section.title}</span>
              </h3>
              <ul style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none' }}>
                {section.items.map((item, ii) => (
                  <li key={ii} style={{
                    fontSize: 12, color: '#4a3f38', lineHeight: 1.7,
                    padding: '3px 0 3px 12px',
                    borderLeft: '2px solid rgba(124,58,237,0.15)',
                    marginBottom: 2,
                  }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Modal>
  )
}
