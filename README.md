# 用例管理平台

版本：**1.0.1**

一个基于 Flask 和 MySQL 的测试用例管理平台，面向内网测试团队使用。平台以“项目 → 版本 → 用例”为核心结构，支持 Excel 导入、在线编辑、执行结果管理、版本副本、合并单元格和图片粘贴。

## 本次版本内容

- 增加当前版本用例导出为 Excel 功能。
- 按当前列设置导出可见列、列顺序、列宽、删除线和纵向合并关系。
- 备注中的图片直接以单元格锚定图片写入 Excel。
- 图片本体保存到 MySQL `LONGBLOB`，不依赖本地 `uploads` 文件夹。
- 增加数据库结构快速创建文件：`backups/case_manager_schema.sql`。
- 增加脱敏配置说明：`case_tool_user_guide_safe.md`。

## 技术栈

- 后端：Python、Flask
- 数据访问：Flask-SQLAlchemy、SQLAlchemy、PyMySQL
- 数据库：MySQL 8，字符集 `utf8mb4`
- Excel：openpyxl、Pillow
- 前端：HTML5、CSS3、原生 JavaScript

## 环境准备

1. 安装 Python 3.8 或更高版本、MySQL 8。
2. 创建虚拟环境并安装依赖：

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. 复制 `.env.example` 为 `.env`，填写实际数据库配置。不要把 `.env` 提交到仓库。
4. 初始化数据库结构：

   ```powershell
   flask --app app init-db
   ```

   或在新数据库中执行 `backups/case_manager_schema.sql`。

## 启动

```powershell
python app.py
```

应用默认监听 `0.0.0.0:5005`，本机访问 `http://127.0.0.1:5005`，局域网访问使用运行电脑的 IP 地址加 `5005` 端口。

## 主要功能

- 第一行自动识别 Excel 表头和列数量，未匹配表头自动生成自定义列。
- 导入时识别纵向合并单元格和删除线。
- 用例编号按顺序自动生成，并支持在列设置中重置。
- 编辑模式下单击直接输入，双击打开长文本编辑框。
- 备注支持文字与图片混排、剪贴板粘贴、缩略图、放大和删除。
- 支持列显示/隐藏、拖动排序、自定义列和默认排序恢复。
- 支持版本排序、版本副本、多选删除、执行结果重置。
- 项目和版本删除需要密码并进行二次确认。
- 数据库备份 SQL 会包含 MySQL 中保存的图片本体。

## Excel 导出说明

选择项目和版本后，点击顶部“下载当前版本 Excel”。导出的是当前版本全部用例，不受当前分页影响；列内容按照当前可见列和排序生成。备注图片会直接放在对应备注单元格的单元格锚点中，Excel 中可拖动和查看。

Excel 的图片属于浮动对象，不能像网页富文本那样与文字共享同一个字符流；因此图片会固定在对应单元格位置，备注文字仍保留在单元格中。

## 数据与安全

- 业务数据和图片本体保存在 MySQL 中。
- `.env`、数据库备份和运行日志不应提交到 Git。
- `backups/case_manager_schema.sql` 只保存数据库结构，不包含业务数据。
- `case_tool_user_guide.html` 如填写真实密码，仅限内部保存，不要提交到公开仓库。
- 生产环境应修改默认密码，并限制数据库和应用端口的访问范围。

完整功能说明请查看 `case_tool_user_guide.html`；对外分享时使用 `case_tool_user_guide_safe.md`。
