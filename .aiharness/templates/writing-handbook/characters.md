# 角色管理

**适用**: 用户要求操作角色（创建/查看/修改/删除等）

- 15字段和格式要求已在路径速查中。role 严格6选1: 男主|女主|男配|女配|反派|其他。
- 缩进2空格禁Tab | 多行文本用>-块标量 | abilities/weaknesses/relationships为纯文本禁止对象数组。
- **创建流程**: ①(可选)read_file参考1个已有角色看格式风格 → ②**立即同一轮create_file**，不要等下一轮。
- 批量创建→逐个完成，每完成一个立即create_file下一个。
- **删除角色**: delete_file("{项目名}/characters/角色名.yaml")
- **修改角色**: read_file 角色文件 → edit_file 精确替换要改的字段。单字段用 old_string=原文，全字段用 __FULL_REPLACE__
- **重命名角色**: rename_file("{项目名}/characters/旧名.yaml", "{项目名}/characters/新名.yaml")
- 如需完整格式参考: read_file("../.aiharness/templates/character.yaml")
