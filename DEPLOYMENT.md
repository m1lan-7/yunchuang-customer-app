# 团队共享版部署与飞书应用落地

## 目标形态

第一版采用“HTTPS 网页应用 + 飞书工作台入口”：

- APP 本体部署为 Node.js 服务。
- 数据存储优先使用 PostgreSQL。
- 团队通过飞书网页应用免登进入。
- 飞书自建应用配置网页入口，指向部署后的 HTTPS 地址。
- 仍然手动粘贴一级/二级台账，不读取、不修改飞书原表。

## 环境变量

复制 `.env.example` 后按实际环境配置：

```text
PORT=4184
HOST=0.0.0.0
NODE_ENV=production
APP_PASSWORD=你的团队访问密码
FEISHU_APP_ID=飞书应用 App ID
FEISHU_APP_SECRET=飞书应用 App Secret
DATABASE_URL=postgres://user:password@host:5432/yunchuang
```

如果暂时没有 PostgreSQL，可以不填 `DATABASE_URL`，系统会继续使用 `data/customers.json`。

## 服务器部署步骤

1. 安装 Node.js 20+ 和 PostgreSQL。
2. 上传项目目录到服务器。
3. 在项目目录执行：

```bash
npm install
node server.js
```

4. 使用 Nginx 或云平台网关配置 HTTPS，把公网域名反代到 `http://127.0.0.1:4184`。
5. 浏览器打开 HTTPS 地址，本机测试时不配置免登可直接进入；飞书内使用时配置 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`。

## Render 快速部署步骤

你已经完成 Render 注册并进入 Dashboard 后，按下面做：

1. 先把项目上传到 GitHub 仓库。
2. 在 Render Dashboard 点 `+ New`。
3. 如果看到 `Blueprint`，选择本项目仓库，Render 会读取 `render.yaml`，自动创建：
   - `yunchuang-customer-app`
   - `yunchuang-customer-db`
4. 如果不用 Blueprint，就手动创建：
   - `+ New` -> `PostgreSQL`
   - `+ New` -> `Web Service`
5. Web Service 配置：
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
6. 环境变量：
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `DATABASE_URL=Render PostgreSQL 的 Internal Database URL`
   - `FEISHU_APP_ID=飞书应用 App ID`
   - `FEISHU_APP_SECRET=飞书应用 App Secret`
7. 部署完成后，Render 会给一个 HTTPS 地址，例如：

```text
https://yunchuang-customer-app.onrender.com
```

这个地址就是飞书网页应用的首页 URL。

## 数据迁移

首次配置 `DATABASE_URL` 后，服务启动时会自动读取当前 `data/customers.json` 并写入 PostgreSQL 的 `app_store` 表。

当前实现使用 JSONB 保存完整业务数据，目的是最大限度保留本机版本逻辑并降低迁移风险。后续如果需要更细的个人权限、统计审计或大数据量查询，可再拆为标准关系表。

## 备份

手动触发备份：

```bash
npm run backup
```

建议在服务器上配置每天一次定时任务：

```bash
0 23 * * * cd /path/to/yunchuang-customer-app && APP_PASSWORD=你的团队访问密码 npm run backup
```

如果使用 PostgreSQL，备份写入 `app_backups` 表；如果使用本地 JSON，备份写入 `data/backups/`。

## 飞书 CLI 步骤

当前项目不是飞书小程序包，而是网页应用。飞书 CLI 用来协助配置飞书侧应用能力。

安装：

```bash
npm install -g @larksuite/cli
npx -y skills add https://open.feishu.cn --skill -y
```

初始化应用凭证：

```bash
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status
```

Windows PowerShell 如果提示禁止运行 `lark-cli.ps1`，请改用：

```powershell
lark-cli.cmd config init --new
lark-cli.cmd auth login --recommend
lark-cli.cmd auth status
```

飞书开放平台中创建企业自建应用：

- 应用类型：网页应用 / H5。
- 工作台入口：首页 URL 填 HTTPS 地址。
- 在安全设置中配置重定向 URL，地址必须以 `/` 结尾。
- 在安全设置中配置 H5 可信域名。
- 第一版无需申请读取飞书表格权限。
- 用户从飞书工作台打开后，系统使用飞书免登自动识别用户。

## 上线验收

- 电脑浏览器、手机浏览器、飞书工作台内均可打开。
- 从飞书工作台打开后自动进入系统。
- 操作日志能记录飞书用户名称。
- 一级/二级台账导入成功。
- 跟进、删除、预计到访、一级转访、自动一转二比对正常。
- 多人同时访问时数据一致。
- 可成功执行一次备份。
