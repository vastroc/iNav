# 上传 GitHub 与部署到 Cloudflare

本文按「先跑通一次，再交给 Git 自动部署」的顺序写。只需完整做一次第 1～3 步，之后每次改代码只要 `git push`。

- 目标架构：Cloudflare Workers（运行 `worker/index.ts`）+ D1（`DB`）+ Workers Static Assets（`./dist`）
- 需要：Node.js ≥ 22.12、Git、GitHub 账号、Cloudflare 账号
- 不需要：服务器、信用卡（免费额度足够跑导航站）、Docker

---

## 0. 三分钟版

```bash
# 1) 本地仓库
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main

# 2) 首次创建 Cloudflare 资源
npx wrangler login
npx wrangler d1 create inav          # 把返回的 database_id 填进 wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put SESSION_SECRET    # 依次设置 5 个 Secret
npx wrangler secret put SITE_URL
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ADMIN_GITHUB_LOGINS
npm run deploy

# 3) 在 Cloudflare 控制台连接仓库，开启 push 自动部署（见第 4 步）
```

下面解释每一步的细节和容易出错的地方。

---

## 1. 上传到 GitHub

### 1.1 提交前自检

仓库里**不能**出现这些内容：

- `.dev.vars`（本地密钥）
- `.wrangler/`（本地 D1 数据与缓存）
- `dist/`、`node_modules/`
- 任何真实 Secret、OAuth Secret、API Key

本项目 `.gitignore` 已覆盖上述路径。提交前再确认一次：

```bash
git add .
git status --short          # 不应出现 .dev.vars / .wrangler / dist / node_modules
git ls-files | findstr /i "dev.vars"    # Windows：应无输出
```

> 如果不小心提交过密钥：立刻在 GitHub 删除仓库或改写历史，并到对应平台重置密钥。删文件再提交并不能让密钥从历史中消失。

### 1.2 创建 GitHub 仓库

1. 打开 <https://github.com/new>。
2. 填仓库名，例如 `iNav`。
3. **不要**勾选 “Add a README file”“Add .gitignore”“Choose a license”——本地已有文件，勾选会造成首次推送冲突。
4. 可见性：公开或私有都可以（Cloudflare 的 Git 集成两种都支持）。
5. 点 Create repository，记下页面给出的仓库地址。

### 1.3 推送

```bash
git init
git add .
git commit -m "Initial commit: iNav"
git branch -M main
git remote add origin https://github.com/<你的账号>/iNav.git
git push -u origin main
```

如果 `git commit` 报 `Please tell me who you are`：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

如果 `git push` 要求密码：GitHub 已不支持账号密码，请用 **Personal Access Token**（Settings → Developer settings → Personal access tokens → Fine-grained tokens，给该仓库 Contents: Read and write），或用 GitHub Desktop / SSH。

---

## 2. 首次创建 Cloudflare 资源（只做一次）

这一步在本机执行，目的是把「数据库、密钥」准备好，让之后任何自动部署都能直接跑。

### 2.1 登录并创建 D1

```bash
npx wrangler login
npx wrangler d1 create inav
```

命令会输出类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "inav"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 **database_id** 替换进 `wrangler.jsonc` 的占位值（当前是 `8f0c2b1a-...`）：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "inav",
    "database_id": "你的真实 UUID",
    "migrations_dir": "migrations"
  }
]
```

> 不替换会报 `Couldn't find a D1 DB with that name/id` 或 `database_id is not a valid UUID`。这一步必须提交到 Git，否则 Cloudflare 构建时同样找不到数据库。

### 2.2 应用数据库迁移

```bash
npm run db:migrate:remote
```

等价于 `npx wrangler d1 migrations apply DB --remote`，会依次执行 `migrations/0001`～`0009`。重复执行是安全的，已应用的迁移会跳过。

演示数据可选，正式站一般不加：

```bash
npm run db:seed:remote
```

### 2.3 设置 Secrets

先准备一个强随机 `SESSION_SECRET`（至少 16 字符）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

然后逐个执行，命令会提示粘贴值（输入不回显）：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SITE_URL
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ADMIN_GITHUB_LOGINS
# 使用 AI 简介时再设：
# npx wrangler secret put AI_API_KEY
```

| Secret | 值 |
| --- | --- |
| `SESSION_SECRET` | 上面生成的随机串 |
| `SITE_URL` | 站点公开地址，如 `https://inav.你的子域.workers.dev`（绑定自定义域名后改成正式域名） |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret |
| `ADMIN_GITHUB_LOGINS` | 管理员 GitHub 用户名，多个用逗号分隔 |

`SITE_URL` 用于 sitemap、管理接口的 Origin 校验和 OAuth。**它必须和浏览器实际访问的地址完全一致**（协议 + 域名，不带结尾斜杠），否则后台保存会返回 403。

GitHub OAuth App 在 <https://github.com/settings/developers> 创建：

- Homepage URL：`https://你的域名`
- Authorization callback URL：`https://你的域名/api/auth/github/callback`

首次部署前如果还没有正式域名，可以先填 workers.dev 地址，部署完再回来改。

### 2.4 第一次部署

```bash
npm run build
npm run deploy
```

`deploy` 会先构建再 `wrangler deploy`。成功后终端会打印：

```text
https://inav.<你的子域>.workers.dev
```

打开 `/api/health` 应返回 JSON；打开 `/admin` 应显示 GitHub 登录入口。

---

## 3. 绑定自定义域名（可选但推荐）

1. Cloudflare Dashboard → Workers & Pages → `inav` → Settings → Domains & Routes → Add → Custom domain。
2. 输入域名（该域名需已托管在同一个 Cloudflare 账号）。
3. 等待证书生效，然后把 `SITE_URL` 改成新域名：

```bash
npx wrangler secret put SITE_URL
```

4. 回到 GitHub OAuth App，把 Homepage URL 和 Callback URL 改成新域名。
5. 重新部署一次让 sitemap 等使用新地址：`npm run deploy`。

---

## 4. 一键部署：push 即上线（推荐）

Cloudflare 提供 Git 集成（Workers Builds），连一次仓库后，每次 push 到 `main` 自动构建并部署，不需要本机环境。

### 4.1 连接仓库

1. 打开 Cloudflare Dashboard → Workers & Pages → Create application。
2. 选择 **Workers** 标签 → **Import a repository**（有的界面叫 “Connect to Git”）。
3. 授权 GitHub，选择刚推送的仓库和 `main` 分支。
4. 填写构建配置：

| 配置项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |
| Root directory | `/`（留空） |
| Node version | `22`（在环境变量里加 `NODE_VERSION=22`） |

> Deploy command 里带上迁移，是为了以后新增 `migrations/0010_*.sql` 时也能随 push 自动应用；迁移是幂等的，已有记录会跳过。

5. 保存并触发第一次构建。构建日志里能看到 `vite build`、迁移、`Uploaded iNav`。

### 4.2 日常发布

```bash
git add .
git commit -m "feat: xxx"
git push
```

Cloudflare 自动构建部署，1～2 分钟上线。控制台 Deployments 里可以看日志、重试、回滚到上一个版本。

### 4.3 注意事项

- 同一个 Worker 不要同时开「Git 自动部署」和「GitHub Actions 自动部署」，否则一次 push 会部署两次。
- Secrets 不参与构建，仍在 Cloudflare 后台或 `wrangler secret put` 管理；改了 Secret 需要重新部署才生效（Workers Builds 可点 Retry deployment）。
- 预览分支：默认只有 `main` 部署到生产；其它分支可在 Workers Builds 设置里开启 preview URL。

---

## 5. 备选：GitHub Actions 自动部署

如果不想在 Cloudflare 里授权 GitHub，或需要更自由的 CI 流程，可以用仓库自带的 `.github/workflows/deploy.yml`。

### 5.1 创建 API Token

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token。
2. 用模板 **Edit Cloudflare Workers**，并在权限里补上 **D1 → Edit**。
3. Account Resources 选择你的账号，Zone Resources 可留空（本 Worker 不用 Zone 级权限）。
4. 复制 Token（只显示一次），再在账号首页或 Workers 页面找到 **Account ID**。

### 5.2 配置仓库 Secrets

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

### 5.3 触发

推送到 `main`，或在 Actions 页面手动 Run workflow。流程为：安装依赖 → 类型检查 → 构建 → 远程迁移 → 部署。

Token 权限不足时常见报错是 `Authentication error` 或 `D1 migration failed`，检查是否漏了 D1 编辑权限。

---

## 6. 验证清单

部署完成后依次检查：

- [ ] `https://你的域名/api/health` 返回正常 JSON
- [ ] 首页能加载样式和图标（说明 `dist` 已上传）
- [ ] `/admin` 出现 GitHub 登录按钮
- [ ] GitHub 登录后能进入后台并保存一条书签（验证 `SITE_URL`、Cookie、OAuth 回调）
- [ ] 前台跳转一个站点，浏览量 +1
- [ ] `/sitemap.xml` 中的域名是正式域名
- [ ] Cloudflare 后台 Cron Triggers 显示每天 03:00 UTC 的检测任务

---

## 7. 常见问题

**`Couldn't find a D1 DB with that name/id`**
`wrangler.jsonc` 的 `database_id` 还是占位值，或 D1 建在了另一个 Cloudflare 账号。运行 `npx wrangler d1 list` 核对。

**`SESSION_SECRET must be at least 16 characters` / 登录后立刻掉线**
Secret 没设置、太短，或改了 Secret 没重新部署。重新 `wrangler secret put SESSION_SECRET` 并部署。

**后台保存返回 403**
浏览器地址与 `SITE_URL` 不一致（`http`/`https`、`www`、末尾斜杠都算不同）。把 `SITE_URL` 改成实际访问的 origin。

**OAuth 报 `redirect_uri_mismatch`**
GitHub OAuth App 的 Callback URL 必须是 `https://你的域名/api/auth/github/callback`，且与 `SITE_URL` 同域。

**页面空白 / 静态资源 404**
部署前没构建，`dist` 是空的。Workers Builds 的 Build command 必须是 `npm run build`；本地部署用 `npm run deploy`（内部会构建）。

**`wrangler deploy` 报 assets directory not found**
同上，先 `npm run build`。

**迁移报 `duplicate column` / 已存在**
说明手工改过数据库或迁移被重复执行。先 `npx wrangler d1 migrations list DB --remote` 查看状态，不要直接改线上表结构。

**想回滚**
Workers & Pages → 该 Worker → Deployments → 选择上一个版本 → Rollback。数据库迁移不会自动回滚，涉及破坏性迁移时要先备份：

```bash
npx wrangler d1 export inav --remote --output backup.sql
```

**本地能跑、线上 500**
优先看 `npx wrangler tail inav` 的实时日志；多数是缺少 Secret 或 D1 未迁移。

---

## 8. 可选：Deploy to Cloudflare 按钮

仓库公开后，可以在 README 顶部放一个一键部署按钮：

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<你的账号>/iNav)
```

它会引导访问者 fork 仓库并在自己的 Cloudflare 账号创建 Worker。由于本项目还需要 D1 与 5 个 Secret，按钮只能完成仓库导入和资源创建，Secrets 仍需按第 2.3 节手动设置。自用部署仍推荐第 4 节的 Git 集成。

---

## 9. 免费额度参考

| 资源 | 免费额度（以官网为准） |
| --- | --- |
| Workers 请求 | 100,000 次/天 |
| Workers CPU | 10 ms/请求（免费计划） |
| D1 存储 | 5 GB |
| D1 行读取 | 5,000,000 行/天 |
| D1 行写入 | 100,000 行/天 |
| 静态资源 | 不限请求，计入 Workers 请求 |

个人导航站正常流量远低于以上限制。图片截图走第三方服务，不占 Worker 额度。
