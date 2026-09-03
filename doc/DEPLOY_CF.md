# ☁️ Cloudflare 部署

通过 **Workers & Pages → Import a repository** 把本仓库连到 Cloudflare，push 上游更新即
自动构建部署。**无需任何 GitHub Actions / Secrets**。

## 绑定为什么不会丢

仓库里的 `mail-worker/wrangler.toml` 采用「只声明必带的、不写死资源」策略：

- **D1 `db` / KV `kv` / R2 `r2`**：**不写进配置**（注释掉）。Wrangler 未声明这些绑定，
  因此每次部署**不会覆盖**你在 Cloudflare Dashboard 手动配置的绑定。
- **Workers AI `ai`**：**固定声明** `[ai] binding = "ai"`（无需资源 ID），每次部署保留，
  供后续验证码识别等功能使用（代码里 `env.ai`）。
- **`keep_vars = true`**：保证 Dashboard 里配置的变量（`domain`/`admin`/`jwt_secret` 等）
  不被部署覆盖。

仓库文件里**没有任何真实资源 ID / 密钥**，公开仓库安全。

> 前提：所用的 Wrangler v4（仓库锁定 `^4.7.0`）已支持「远端配置感知」——部署时遇到
> Dashboard 已配置、但配置文件中未声明的绑定，会**保留**而非清空。

## 一次性连接（首次）

1. Cloudflare → **Workers & Pages** → **Create application** → **Import a repository**。
2. 选择本仓库（需授权 GitHub）。
3. **Production branch**：`main`（或你实际部署的分支）。
4. **Root directory**：`mail-worker`。
5. Build command 留空（用 `wrangler.toml` 里的 `[build]` 即可）；
   Deploy command 默认 `npx wrangler deploy`。
6. **Save and Deploy**。

部署后，在 Worker → **Settings** 配置（仓库不含任何 ID / 密钥）：

- **Bindings**：
  - D1 database　→ 绑定名 `db`
  - KV namespace → 绑定名 `kv`
  - R2 bucket（可选）→ 绑定名 `r2`
  - Workers AI → 绑定名 `ai`（如需）

- **Variables and Secrets**（可选，取决于你的需求）：
  - `domain`（JSON 数组，如 `["mail.example.com"]`）
  - `admin`（管理员邮箱）
  - `jwt_secret`（保持与初始化一致，勿随意改动）
  - `orm_log`（可选）

> 绑定名必须与代码里 `env.db` / `env.kv` / `env.r2` / `env.ai` 一致。

## 后续更新

之后每次 `git push`（触及 `mail-worker/**` 或 `mail-view/**`），Cloudflare 自动重新
构建并部署。因为 `db`/`kv`/`r2` 未在配置里声明、`ai` 为固定声明，**D1/KV/R2/AI 绑定以及
Dashboard 配置的变量都会原样保留，不会被清空。**

## 初始化数据库

部署后访问（返回 `success` 即成功）：

```text
https://你的worker域名/api/init/<jwt_secret>
```

## 配置收信域名（Email Routing）

1. Cloudflare → 邮箱域名 → **Email → Email Routing** → 开启。
2. 添加 **MX** 与 **SPF（TXT）** 记录。
3. **Routing rules** → 添加路由 → 动作 "Send to a Worker" → Worker 选 `xi-mail`。
4. 可选：添加 **DKIM** 记录提升投递率。

> 仅用 `*.workers.dev` 测试时可不配 Email Routing，登录与站内信可用，外域收信需以上配置。

## 常见问题

- **收不到外域邮件**：检查 `db`/`kv` 绑定是否生效，以及 Email Routing 的 MX/SPF/路由。
- **登录后 401 / authExpired**：确认 KV 绑定生效，`jwt_secret` 与初始化时一致（勿改）。
- **附件异常**：`r2` 未绑定正常回退到 KV；超大附件（>25MB）可补 R2。
- **构建失败 / 前端报错**：`mail-view` 需 pnpm 构建，`mail-view/pnpm-workspace.yaml` 已
  允许必要的 build scripts（esbuild 等）；尽量不改 `package.json`，保持与上游一致。
