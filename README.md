# 存货小管家 — 保质期与库存管理

面向家庭的食品与日用消耗品保质期 + 库存管理网页应用，手帐风 UI，小仓鼠管家互动。

## 如何运行（本地预览）

1. 用浏览器直接打开项目里的 **`index.html`** 即可，无需安装任何东西。
2. 或使用本地静态服务器（可选）：
   - 在项目根目录执行：`npx serve .` 或 `python3 -m http.server 8000`
   - 浏览器访问：`http://localhost:8000` 或 `http://localhost:3000`

## 第一版已实现

- **首页**：今日提醒（3 天内即将过期）· 仓鼠贺卡式展示；无临期时显示「今天没有快过期的东西，真棒！」
- **库存管理**：列表（在库/已使用完筛选）、顶部「添加」、一页填完表单、一级/二级品类可输入并自动保存、从已有复制、编辑/删除/标记已使用完、操作后盖章动效
- **报告**：周报（未来 7 天即将过期 + 在库/已使用完数量）、月报（本月新登记、在库、已使用完、登记金额）
- **设置**：提醒周期、通知邮箱、**Notion 同步**（可选）
- **数据**：本地 localStorage；开启 Notion 同步后数据仅存于**用户自己的 Notion**，本应用服务器不保留任何数据

## 邮件提醒（发送今日报告到邮箱）

1. **部署到 Vercel**（邮件接口需要同源或后端）  
   - 安装 [Vercel CLI](https://vercel.com/docs/cli)：`npm i -g vercel`  
   - 在项目根目录执行：`vercel`，按提示登录并部署。  
   - 部署后会得到一个网址，如 `https://xxx.vercel.app`。

2. **配置发信（二选一）**  
   - **方案 A：Gmail（0 成本、无需域名，任意收件人都能收到）**  
     - 使用你的 Gmail 账号，在 Google 账户里开启两步验证后，生成「应用专用密码」。  
     - 在 Vercel 项目 → Settings → Environment Variables 中添加：  
       - `SMTP_USER`：你的 Gmail 完整邮箱（如 `you@gmail.com`）  
       - `SMTP_PASS`：上一步生成的应用专用密码（16 位）  
     - 发件人将显示为该 Gmail，收件人无限制；Gmail 个人账号约 500 封/天。  
   - **方案 B：Resend**  
     - 注册 [Resend](https://resend.com)，创建 API Key。  
     - 在 Vercel 中添加 `RESEND_API_KEY`；（可选）`RESEND_FROM` 为已验证域名的发件人。  
     - 未验证域名时，仅你注册 Resend 的邮箱能收到；验证域名后任意收件人可收。

3. **使用**  
   - 在「设置」中填写**通知邮箱**。  
   - 在首页点击「发送今日报告到邮箱」，即可把今日提醒 + 货单总结（进货/消耗）发到该邮箱。邮件为信纸风 HTML，含小仓鼠与摘要表格。

**说明**：当前为「手动点击发送」。定时按提醒周期自动发邮件需再增加定时任务（如 Vercel Cron + 需后端能读取用户数据），后续可扩展。

**若只有你自己能收到、其他人收不到（使用 Resend 时）**：未验证域名时 Resend 只投递到注册邮箱。**零成本做法**：改用 **Gmail 发信**（上面方案 A），在 Vercel 中只配置 `SMTP_USER` + `SMTP_PASS`，不配 `RESEND_API_KEY`，即可向任意收件人发信，无需域名。若坚持用 Resend，则需在 Resend 验证域名并设置 `RESEND_FROM`。

## 项目结构

```
vibecoding/
├── index.html      # 单页结构 + 四栏底部导航 + 表单弹层
├── api/
│   ├── send-report.js   # Vercel 云函数：发邮件
│   └── notion-proxy.js  # Vercel 云函数：仅代理 Notion API，不存任何数据
├── css/
│   └── style.css   # 手帐风样式（偏暖色、圆角、便签感）
├── js/
│   ├── data.js     # 数据层：CRUD、品类、临期/货单统计、设置、Notion 缓存
│   ├── notion-sync.js   # Notion 同步：映射与请求（仅与用户 Notion 通信）
│   └── app.js      # 视图与交互、发送报告
├── package.json    # 依赖：resend
├── 需求说明.md
├── 设计说明.md
├── 软件开发流程指南.md
└── README.md
```

## Notion 数据同步（0 成本、最低权限、数据仅存你的 Notion）

- **数据与隐私**：开启后，存货数据只写入**你自己的 Notion 账户**；本应用服务器仅提供「代理转发」请求到 Notion API，**不存储、不记录**你的密钥或任何存货内容。
- **权限**：使用 Notion「内部集成」：你在 [notion.so/my-integrations](https://www.notion.so/my-integrations) 创建集成，并**仅将某一个数据库（或一个父页面）共享给该集成**，集成无法访问你未共享的页面。
- **成本**：Notion API 与 Vercel 代理均在免费额度内，无需付费。

**使用步骤**：设置 → 启用 Notion 同步 → 填写集成密钥（Secret）与数据库 ID（可从「创建数据库」用父页面 ID 一键生成）→ 在 Notion 中把该数据库「连接」到你的集成后即可使用。

## 后续计划

- 定时邮件（按设置周期自动发送）
- 替换仓鼠为定制插画/动图
