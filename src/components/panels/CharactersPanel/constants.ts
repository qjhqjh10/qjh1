export const AI_FORMAT_INSTRUCTION = `
请严格按照以下格式输出角色信息（每行一个字段，标签与内容之间用英文冒号+空格）：

姓名: <角色姓名>
角色类型: <男主/女主/男配/女配/反派/其他>
性别: <性别>
年龄: <年龄>
职业/身份: <职业或身份>
背景设定: <背景故事>
外观特征: <外貌描述>
性格特征: <性格描述>
能力: <能力或技能>
弱点: <弱点或缺陷>
角色关系网: <与其他角色的关系描述>
角色成长弧线: <角色故事发展轨迹>
关系标签: <标签1、标签2、标签3>
重要程度: <1-100的整数，数值越大越重要，默认50>
形象图描述: <英文关键词描述，用于图片搜索，如"young swordsman with silver hair, blue eyes, dark armor, anime style, portrait">

注意：
- 每个字段都必须填写，不确定的可以写"暂无"
- 关系标签请从以下选择或自行发挥：恋人、后宫、父亲、母亲、姐姐、妹妹、哥哥、弟弟、师父、徒弟、挚友、敌人、宿敌、竞争对手、青梅竹马、初恋、暗恋对象等
- 形象图描述请使用英文关键词，描述角色外貌特征，便于搜索匹配的图片
- 只输出上述格式的角色信息，不要输出其他内容`

export const ROLE_COLORS: Record<string, string> = {
  '男主': '#dc2626',
  '女主': '#ec4899',
  '男配': '#3b82f6',
  '女配': '#8b5cf6',
  '反派': '#f59e0b',
  '其他': '#6b7280',
}

export interface CharactersPanelProps {
  showWorldbuildingPanel?: boolean
  standalone?: boolean
}
