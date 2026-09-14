# ☁️ Cloudflare 部署

<a href="https://deploy.workers.cloudflare.com/" target="_blank" rel="noopener">
  <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
</a>

本仓库适配 Cloudflare 自动部署。开始前先分清两组概念，避免选错方案。

## 两组容易混淆的概念

**① 部署形态 —— 前端放在哪**

| 形态 | 做法 | 适合 |
|---|---|---|
| **一体化**（默认） | 前端产物打进 Worker 的 `[assets]`，只部署一个 Worker | 个人自托管，最省事 |
| **前后端分离** | 前端单独部署到 CF Pages / Vercel，Worker 只做 API | 前端要 CDN 加速或独立迭代 |

**② 部署通道 —— 谁来执行部署**

| 通道 | 谁执行 | 能否自动跟随上游 | 绑定是否会丢 |
|---|---|---|---|
| **A. GitHub Actions** | GitHub 跑 workflow，再 `wrangler deploy` | ✅ 能（workflow 内 merge 上游） | ✅ 不丢 |
| **B. Cloudflare Workers Builds** | Cloudflare 直连仓库，push 后自动构建 | ❌ 只能跟随「你的仓库」 | ⚠️ 需按 B2 改 Deploy command，否则会丢 |

> ### ⚠️ 两条通道写的是**同一个 Worker**，必须二选一
>
> 同时开启会互相覆盖配置与绑定，且每次上游同步都会触发两次部署。
> **推荐只用通道 A**：它既解决上游跟随，又天然保住绑定；通道 B 无法自己跟随上游，
> 本质上仍然依赖 A 先把上游 merge 进你的仓库。

---

# 两种部署模式：步骤清单

## 模式 A：GitHub Actions（推荐）

| # | 步骤 | 在哪里做 |
|---|---|---|
| 1 | 删掉旧 fork，重新 fork `PastKing/xi-mail` | GitHub 网页 |
| 2 | 放入自动化文件（见「重新 fork 要加哪些文件」）并 commit + push | 本地 |
| 3 | 加 8 个必填 Secret（A3 表） | 仓库 → Settings → Secrets and variables → Actions |
| 4 | 手动跑一次验证：勾选「先从上游同步」 | Actions → Deploy xi-mail → Run workflow |
| 5 | 确认 `Verify bindings` 与 `/api/init` 两步都绿 | Actions 运行日志 |
| 6 | 配收信路由 | Cloudflare → Email Routing → Send to a Worker |
| 之后 | **全自动**：push 即部署 / 每天 11:00 自动同步上游并部署 | — |

需要自己维护的东西：**只有 Secrets**（资源 ID、域名、密钥）。绑定、初始化、上游同步全部由 workflow 负责。

## 模式 B：Cloudflare Workers Builds（备选）

| # | 步骤 | 在哪里做 |
|---|---|---|
| 1 | 同模式 A 的第 1、2 步 | — |
| 2 | 把 `wrangler.toml` 强制提交进仓库（B0） | 本地：`git add -f mail-worker/wrangler.toml` |
| 3 | 建 D1 / KV 资源，记下 ID | Cloudflare 网页 |
| 4 | 连接仓库，并改 **Build command** 与 **Deploy command**（B2） | Worker → Settings → Build → Build configuration |
| 5 | 填 **Build variables**：`D1_DATABASE_ID`、`KV_NAMESPACE_ID`、`MAIL_DOMAIN`、`ADMIN_EMAIL`（B3） | 同上 → Build variables and secrets |
| 6 | 加运行时 Secret：`jwt_secret`（B4） | Worker → Settings → Variables and Secrets |
| 7 | 触发一次构建，在日志里确认 `env.db` / `env.kv` 出现（B5） | 构建日志 |
| 8 | 初始化数据库：访问 `/api/init/<jwt_secret>`（B6） | 浏览器 |
| 之后 | 每次 push 自动构建 —— **但上游更新仍要靠模式 A 同步进来** | — |

需要自己维护的东西：**Secrets 分散在两处**（Build variables + 运行时 Secret），且每次上游更新后仍要有人把上游 merge 进仓库。

## 两者对比

| 维度 | 模式 A GitHub Actions | 模式 B CF Workers Builds |
|---|---|---|
| 自动跟随上游 | ✅ 内置 merge | ❌ 只监听本仓库 |
| 绑定是否保留 | ✅ | ✅（前提是改对 Deploy command） |
| 自动跑 `/api/init` | ✅ | ❌ 需手动访问一次 |
| 配置放哪 | GitHub Secrets（一处） | CF Build variables + 运行时 Secret（两处） |
| 部署次数 | 每次上游更新 1 次 | 上游同步时 A、B 各部署一次，共 2 次 |

**结论：只需要一种。** 推荐模式 A，它把上游跟随、绑定保留、数据库初始化三件事一次解决；
模式 B 单独用会丢掉「自动跟随上游」这个你最想要的能力。

## 相对上游增加了什么

**上游现状**：仓库里**没有任何 CI / 自动化**（没有 `.github` 目录），部署只能靠两种人工方式 ——
README 里的手动 wrangler CLI，或者 Cloudflare 网页的 "Import a repository" 按钮。

上游另外提供了一个 `mail-worker/wrangler-action.toml`，里面写着 `${D1_DATABASE_ID}` 这类占位符。
**注意它不会自动生效**：wrangler 不支持配置文件里的 `${}` 插值（实测会把占位符原样传下去，
最终变成字面量 `${D1_DATABASE_ID}`），而 `cloudflare/wrangler-action` 的 `vars` 输入也只是
把变量绑定成 Worker 环境变量、不做配置替换。所以它只是个**供人手工 find-replace 的模板**，
上游自己的文档里也没有引用它。

**本方案新增的能力**：

| 能力 | 上游 | 本方案 |
|---|---|---|
| 上游更新后同步 | ❌ 手动 merge | ✅ 每天定时自动 merge（也可手动触发） |
| 部署 | 手动 CLI / 网页点按钮 | ✅ push 即部署 |
| 保住 db/kv 绑定 | ❌ 部署后要去后台重绑 | ✅ 部署时显式声明绑定 |
| 绑定校验 | ❌ 无 | ✅ 缺绑定直接让 CI 失败 |
| 数据库初始化 | ❌ 手动访问 `/api/init/<secret>` | ✅ 自动调用（带 5 次重试） |
| 定时自愈 | ❌ 无 | ✅ 每天跑一次，绑定被清掉会自动补回 |
| 前端构建 | 手动 `npm install && npm run build` | ✅ 自动（Node 22 + pnpm 11 固定） |
| 资源 ID 暴露面 | 要写进 `wrangler.toml` | ✅ 全走 Secrets，公开仓库不含真实 ID |

## 重新 fork 要加哪些文件

相对上游**只新增文件、不修改任何上游文件**，所以永远不会产生合并冲突：

| 文件 | 作用 | 必需 |
|---|---|---|
| `.github/workflows/deploy.yml` | 部署流程（13 步） | ✅ |
| `.github/scripts/gen-wrangler-ci.mjs` | 生成带绑定的部署配置，两种模式共用 | ✅ |
| `.github/scripts/ensure-bindings.mjs` | 部署后只读校验 db/kv | ✅ |
| `mail-view/pnpm-workspace.yaml` | `allowBuilds` 白名单，缺了前端构建必然失败 | ✅ |
| `doc/DEPLOY_CF.md` | 本文档 | ⬜ |
| `mail-worker/wrangler.toml` | 仅模式 B 需要（见 B0） | ⬜ |

**不需要动**：`.gitignore`、`README.md`、`README-en.md`（都是上游文件，改了就有冲突风险）。

一次性加入（假设压缩包已解到当前目录）：

```bash
git add .github doc/DEPLOY_CF.md mail-view/pnpm-workspace.yaml
git commit -m "ci: 加入 Cloudflare 自动部署"
git push
```

---

# 模式 A 详解：GitHub Actions 自动化（推荐）

仓库内置 `.github/workflows/deploy.yml`，一次运行完成：

**构建前端 → 生成带绑定的部署配置 → 部署 Worker → 校验绑定 → 调用 `/api/init`**

## A1. 触发方式

| 触发 | 行为 |
|---|---|
| push 到 `main`（涉及 `mail-worker/`、`mail-view/` 等代码路径） | 自动部署 |
| push 到 `main`（只改文档等非代码路径） | 不触发（paths 过滤，避免无谓部署） |
| 手动 `workflow_dispatch` | 立即部署，可勾选跳过 init |

## A2. 上游同步（手动 Sync Fork 即可）

上游更新时，在 GitHub 网页上正常使用 **Sync fork** 或手动 merge PR 都可以——
只要 merge 结果 push 到了 `main` 且涉及代码路径，本 workflow 就会自动部署新版本。

> 网页 "Sync fork" 在分叉时会提示你开 PR：照做即可，merge 那个 PR 同样触发部署。
> 不需要 `--force` 硬同步（那会丢掉 fork 的自有文件）。

本 fork 相对上游**只新增文件、不修改任何上游文件**（`.gitignore` 也保持与上游一致），
正常情况下 merge **永远不会冲突**。万一冲突（例如上游新增了同名文件），网页会标出
冲突文件，人工解决后 merge 即可。

## A3. 配置 Secrets（4 个必填 + 4 个可选）

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ 1/4 | 权限需含 **Workers Scripts: Edit**、**D1: Edit**、**KV: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ 2/4 | Cloudflare 账户 ID |
| `D1_DATABASE_ID` | ✅ 3/4 | D1 数据库 ID（`Workers & Pages → D1 → 你的库 → 详情`） |
| `KV_NAMESPACE_ID` | ✅ 4/4 | KV Namespace ID（`Workers & Pages → KV → 你的命名空间`） |
| `CUSTOM_DOMAIN` | ⬜ | **有自定义域名强烈建议配置**（如 `mail.example.com`）：写入 `[[routes]]`；不配则每次部署会移除 Worker 的自定义域名路由 |
| `R2_BUCKET_NAME` | ⬜ | 留空则不绑定 R2，附件回退 KV（**R2 非必选**） |
| `INIT_URL` | ⬜ | `https://<worker域名>/api/init/<jwt_secret>` 完整串；配了则每次部署后自动迁移数据库，不配则手动访问一次 |
| `D1_DATABASE_NAME` | ⬜ | D1 数据库名（仅展示用，不影响绑定），默认 `xi-mail` |

> `WORKER_NAME` 不在这里 —— 它直接写死在 workflow 里（`xi-mail`），不经过 Secret。
>
> 缺任何一个必填项，`Validate required secrets` 这一步会**在部署前**直接失败并逐个列出缺哪个，
> 不会部署出一个没有绑定的半成品 Worker。

**业务变量不进 Secrets**（`domain` / `admin` / `jwt_secret`）：它们在 Cloudflare Dashboard
配置一次（见下表），`keep_vars = true` 让每次部署自动保留 vars 与 secrets——实测从未丢失。
丢的从来只有 db/kv 绑定（那是 wrangler 声明式覆盖问题，见 A4）。

| 变量（Dashboard > Settings > Variables and Secrets） | 类型 | 示例 |
|---|---|---|
| `domain` | Variable（JSON 文本） | `["mail.example.com"]` |
| `admin` | Variable（文本） | `admin@example.com` |
| `jwt_secret` | Secret | 长随机串，**勿含 `? % # / \`**（拼进 `/api/init` URL 路径用；代码无长度强制，≥32 位是安全建议） |

## A4. 为什么不会丢 db/kv 绑定

部署前用 Secrets 现场生成 `wrangler.ci.toml`，**把 D1/KV(/R2) 绑定显式写进部署配置**，
由 wrangler 自己声明绑定。`wrangler deploy` 只会清空「配置里没声明」的绑定，因此不再丢失。

这个结论有源码依据。wrangler 在组装上传元数据时（`createWorkerUploadForm`）：

```js
let keep_bindings = undefined;
if (keepVars)    keep_bindings.push("plain_text", "json");          // keep_vars = true 时
if (keepSecrets) keep_bindings.push("secret_text", "secret_key");   // deploy 时 = keepVars
if (keepBindings) keep_bindings.push(...keepBindings);              // 仅内部 API 使用
```

即 **`keep_bindings` 只会保留 vars 与 secrets，永远不会保留 `d1` / `kv_namespace` / `r2_bucket`**；
wrangler.toml 也没有对应的配置键，CLI 也没有 `--keep-bindings` 开关。
所以「部署后补绑」是治标，**唯一可靠的解法是部署时就把绑定写进配置**。

顺带一提：`keep_vars = true` 同时会带上 `secret_text` / `secret_key`，因此 Dashboard 里
手工设过的 `jwt_secret` 不会被清掉。

### `--keep-vars` 能保住 db/kv 吗？不能

这是最容易踩的坑：**`keep_vars` 保的是「变量」，不是「绑定」。** 两者在 Cloudflare 里是不同的
绑定类型，`keep_vars` 管不到 D1 / KV / R2。

| `--keep-vars`（= 配置里 `keep_vars = true`）**会**保留 | **不会**保留 |
|---|---|
| `plain_text` 变量（后台设的 `domain`、`admin`、`orm_log`…） | `d1` 数据库绑定 |
| `json` 变量 | `kv_namespace` 绑定 |
| `secret_text` 密钥（`jwt_secret`…）※因 `keepSecrets = keepVars` | `r2_bucket` 绑定 |
| `secret_key` 密钥 | 其余绑定类型 |

`keep_bindings` 的候选类型在源码里是**写死的**，只有上表左侧那 4 种。`keepBindings` 这个变量
在整份 wrangler 源码里只出现三处 —— 解构、读取、以及在 Pages 路径里被显式设为 `void 0`，
**没有任何地方往里面塞过 `d1` / `kv_namespace` / `r2_bucket`**。CLI 也只有 `--keep-vars`，
**不存在 `--keep-bindings`**。

所以：**加了 `--keep-vars`，db/kv 该丢还是丢。** 它唯一的价值是保护你在后台手改的变量与密钥，
而我们的 `wrangler.ci.toml` 已经写了 `keep_vars = true`，与 `--keep-vars` 完全等价 ——
再加这个 flag 是冗余的。

生成逻辑集中在 `.github/scripts/gen-wrangler-ci.mjs`，**两条部署通道共用同一实现**，避免各自维护一份而漂移。

部署后还有一步**只读校验**（`.github/scripts/ensure-bindings.mjs`）：读取 Worker 的实际绑定，
缺 `db`/`kv` 就直接让 CI 失败，而不是让 Worker 带着残缺绑定静默上线。

> 刻意不做「自动补绑」：补绑接口是**整体替换** `bindings` 数组，secret 类绑定无法回填明文，
> 自动补绑有静默丢 secret 的风险。恢复办法很简单 —— **重新运行一次本 workflow**，
> 它会按 `wrangler.ci.toml` 重新声明全部绑定。

## A5. 注意事项

- 仓库若开启分支保护规则，需允许 `github-actions[bot]` 直接推送 `main`。
- GitHub 会在仓库 60 天无活动后暂停定时任务，长期不提交需留意。
- `/api/init` 幂等，重复执行不会清空数据；排障时可在手动触发时勾选 `skip_init`。

---

# 模式 B 详解：Cloudflare Workers Builds 直连仓库（备选）

适用场景：你想让 Cloudflare 自己在 push 后构建部署，不依赖 GitHub Actions 的额度。

> **必须先接受两个前提：**
> 1. 通道 B **不能自动跟随上游**。Cloudflare 只监听「你的仓库」，上游 `PastKing/xi-mail`
>    的更新要先由模式 A（或你手动）merge 进你的仓库，通道 B 才会看到。
> 2. 仓库里提交的 `mail-worker/wrangler.toml` **刻意不声明 db/kv**（避免把真实资源 ID
>    写进公开仓库）。若直接沿用默认的 `npx wrangler deploy`，**每次构建都会清空 db/kv**。
>    因此 B2 必须改 Deploy command，让它在部署前用 Build variables 生成配置。

## B0. 先把 `wrangler.toml` 提交进仓库

上游 `.gitignore` 忽略了 `mail-worker/wrangler.toml`，所以**新 fork 的仓库里根本没有这个文件**。
如果仓库里完全没有 Wrangler 配置，Cloudflare 会触发 *autoconfig*（自动识别框架并**在你的仓库开一个 PR**），
或者直接报 `Missing entry-point`。所以走通道 B 前，先把仓库里已有的那份强制加入：

```bash
git add -f mail-worker/wrangler.toml
git commit -m "chore: 提交 wrangler.toml 供 CF Workers Builds 使用"
```

> 这份文件**不含任何真实资源 ID**（db/kv 都是注释掉的占位），提交它是安全的；
> 相对上游它是**纯新增文件**，不会产生合并冲突。
> 它唯一的作用是让 Cloudflare 有配置可读、跳过 autoconfig —— 真正带绑定的配置由 B2 的
> Deploy command 现场生成。
>
> 如果你只用模式 A，这一步**可以跳过**。

## B1. 准备 Cloudflare 资源

在 Cloudflare Dashboard 创建以下资源，记下 ID：

- **D1 数据库**（必需）→ 记下 `database_id`
- **KV Namespace**（必需）→ 记下 `id`
- **R2 Bucket**（可选，不创建则附件回退到 KV 存储）

## B2. 连接仓库并改两条命令

1. Cloudflare → **Workers & Pages** → **Create application** → **Get started**（Import a repository），选择你的 fork。
2. Worker 名称填 `xi-mail`（**必须与配置文件里的 `name` 一致**，否则构建会报
   `The name in your Wrangler configuration file must match the name of your Worker`）。
3. 进入 **Settings → Build → Build configuration**，把两条命令改成：

| 配置项 | 值 |
|---|---|
| **Git branch** | `main` |
| **Root directory** | `/mail-worker` |
| **Build command** | `npm ci && npx --yes pnpm@11 -C ../mail-view install --frozen-lockfile && npx --yes pnpm@11 -C ../mail-view run build` |
| **Deploy command** | `node ../.github/scripts/gen-wrangler-ci.mjs && npx wrangler deploy --config wrangler.ci.toml` |

> **为什么必须自定义 Deploy command**
>
> 默认值是 `npx wrangler deploy`，它读 `mail-worker/wrangler.toml` —— 那份配置里 db/kv 是注释掉的，
> 结果就是每次构建都把绑定清空。改成上面这行后，会先用 Build variables 生成
> `wrangler.ci.toml`（显式声明 db/kv），再按它部署，效果与模式 A 完全一致。
>
> 另外，Workers Builds **不读取** wrangler 配置里的 `[build]` 块
> （官方说明：*Currently, Workers Builds does not honor the configurations set in Custom Builds*），
> 所以构建命令必须像上表那样在 Dashboard 里单独填。
>
> **实测对照**（`wrangler deploy --dry-run`，wrangler 4.131.0）：
>
> ```text
> # 默认配置 mail-worker/wrangler.toml —— db / kv 不见了
> env.ai               AI
> env.assets           Assets
> env.orm_log (false)  Environment Variable
>
> # 改用生成脚本产出的 wrangler.ci.toml —— 绑定齐全
> env.kv (…)           KV Namespace
> env.db (…)           D1 Database
> env.ai               AI
> env.assets           Assets
> env.orm_log (false)  Environment Variable
> env.domain (…)       Environment Variable
> env.admin (…)        Environment Variable
> ```

## B3. 配置 Build variables

**Settings → Build → Build variables and secrets**（只作用于构建期，不会泄漏到公开仓库）：

| 名称 | 必填 | 说明 |
|---|---|---|
| `D1_DATABASE_ID` | ✅ | D1 数据库 ID |
| `KV_NAMESPACE_ID` | ✅ | KV Namespace ID |
| `MAIL_DOMAIN` | ✅ | 如 `["mail.example.com"]` 或 `mail.example.com` |
| `ADMIN_EMAIL` | ✅ | 管理员邮箱 |
| `WORKER_NAME` | ⬜ | 默认 `xi-mail` |
| `D1_DATABASE_NAME` | ⬜ | 默认 `xi-mail` |
| `R2_BUCKET_NAME` | ⬜ | 留空则不生成 r2 绑定 |
| `CUSTOM_DOMAIN` | ⬜ | 如 `mail.example.com`，配置后写入 `[[routes]]` |

## B4. 配置运行时变量与 secret

**Settings → Variables and Secrets**（运行时生效，与构建期无关）：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `jwt_secret` | 较长随机串，勿含 `? % # / \` |

> `domain` / `admin` 已由 B3 的 Build variables 写进配置，**不要**再在运行时重复配置，
> 以免两处取值不一致。
>
> `jwt_secret` 因为 `keep_vars = true`（→ 同时带上 `secret_text`）会被保留，
> 不会被后续部署清掉。

## B5. 校验绑定生效

构建日志中确认绑定列表包含 `db` / `kv`：

```text
Your Worker has access to the following bindings:
env.assets               Assets
env.db                   D1 Database
env.kv                   KV Namespace
env.orm_log (false)      Environment Variable
```

若只有 `assets`：说明 Deploy command 没改成 B2 的那行，绑定被清空了 —— 改好后重新构建。

## B6. 初始化数据库

`/api/init` 是**幂等**的（`CREATE TABLE IF NOT EXISTS` + 重复列 try/catch），**不会清空既有数据**：

```text
https://你的worker域名/api/init/<jwt_secret>
```

返回 `success` 即成功；返回 `❌ JWT secret mismatch` 说明与 B4 配置的 `jwt_secret` 不一致。

> 通道 B 没有内置的自动 init 步骤。若希望每次部署后自动初始化，仍建议启用模式 A 的定时任务。

---

# 前后端分离部署（可选）

默认是一体化（前端产物打进 Worker 的 `[assets]`）。若想把前端单独放到 CF Pages / Vercel：

```bash
cd mail-view
VITE_BASE_URL=https://your-worker.workers.dev/api npx --yes pnpm@11 run build:standalone
```

然后把产物目录发布到 Pages / Vercel。同时需要让 Worker 不再托管前端：
在部署配置里去掉整个 `[assets]` 块（`.github/scripts/gen-wrangler-ci.mjs` 中对应几行），
Worker 即作为纯 API 运行。

---

# 附件存储：R2 是可选的

**结论：R2 非必选。** 不绑定 `r2` 也能正常收发，附件与内嵌图片会自动落到 KV。

源码里的存储选择逻辑（`mail-worker/src/service/r2-service.js` → `storageType()`）按优先级三选一：

| 优先级 | 类型 | 判定条件 | 说明 |
|---|---|---|---|
| 1 | **S3** | 后台设置里 `bucket` + `endpoint` + `s3AccessKey` + `s3SecretKey` 四项齐全 | 用你自己的对象存储 |
| 2 | **R2** | Worker 存在 `env.r2` 绑定 | 需在部署配置里声明 r2 绑定 |
| 3 | **KV** | 兜底 | **什么都不配就走这里** |

对应代码：

```js
async storageType(c) {
  const { bucket, endpoint, s3AccessKey, s3SecretKey } = await settingService.query(c);
  if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) return 'S3';
  if (c.env.r2) return 'R2';
  return 'KV';
}
```

`putObj` / `getObj` / `delete` 三个操作都按同一优先级分发，所以三种存储可以随时切换、不用改代码。
后台「系统设置 → 集成」里的**存储类型**标签显示的正是当前实际生效的那一个（S3 / R2 / KV）。

## 那什么时候该补 R2？

| 场景 | KV 够不够 |
|---|---|
| 纯文字邮件、普通附件 | ✅ 够 |
| 图片签名、内嵌小图 | ✅ 够 |
| 单个附件接近或超过 25 MiB | ❌ KV 单值上限 25 MiB，需换 R2 / S3 |
| 附件量大，想省 KV 写入配额 | ⚠️ 建议 R2 |

所以：

- **只想先跑起来** → 什么都不配，`R2_BUCKET_NAME` 留空，走 KV。
- **要收大附件** → 补 R2（`R2_BUCKET_NAME` 填桶名即可），或改用 S3。

> 顺带说明：`R2_BUCKET_NAME` 留空时，生成脚本**不会**输出 `[[r2_buckets]]` 段，
> 因此 `env.r2` 不存在，`storageType()` 自然落到 KV —— 这是设计意图，不是降级失败。
> 两条部署模式的 R2 相关变量（`R2_BUCKET_NAME`）都是**可选**，留空即可。

---

# 配置收信域名（Email Routing）

两种模式都需要，在 Cloudflare 侧配置：

1. Cloudflare → 邮箱域名 → **Email → Email Routing** → 开启。
2. 添加 **MX** 与 **SPF（TXT）** 记录。
3. **Routing rules** → 添加路由 → 动作 "Send to a Worker" → Worker 选 `xi-mail`。
4. 可选：添加 **DKIM** 记录提升投递率。

> 仅用 `*.workers.dev` 测试时可不配 Email Routing，登录与站内信可用，外域收信需以上配置。

---

# 本地开发部署（wrangler CLI）

`mail-worker/wrangler.toml` 被上游 `.gitignore` 忽略，本地需要自建：

```bash
git clone <你的 fork>
cd xi-mail/mail-worker && npm ci

# 创建 Cloudflare 资源，记录输出的 ID
npx wrangler d1 create xi-mail
npx wrangler kv namespace create kv
npx wrangler r2 bucket create xi-mail

cp wrangler.example.toml wrangler.toml   # 按需填入上面拿到的 ID 与域名/密钥

cd ../mail-view && npx --yes pnpm@11 install && npx --yes pnpm@11 run build   # 产物输出到 ../mail-worker/dist
cd ../mail-worker && npx wrangler deploy
```

或者直接复用 CI 的生成脚本（推荐，避免手写 ID 出错）：

```bash
cd xi-mail/mail-worker
D1_DATABASE_ID=xxx KV_NAMESPACE_ID=yyy MAIL_DOMAIN=mail.example.com ADMIN_EMAIL=admin@example.com \
  node ../.github/scripts/gen-wrangler-ci.mjs
npx wrangler deploy --config wrangler.ci.toml
```

> 关于上游的 `mail-worker/wrangler-action.toml`：那份文件里的 `${D1_DATABASE_ID}` 之类占位符
> **不会被 wrangler 自动替换**（wrangler 配置不支持 `${}` 插值），它只是给你手动 find-replace
> 的模板，上游文档中也没有引用它。本仓库的生成脚本取代了这种手工做法。

---

# 常见问题

- **构建失败 / 前端报错**：查看构建日志；尽量不改 `package.json`，保持与上游一致。
- **加 `--keep-vars` 能解决丢绑定吗？**：**不能。** 它只保变量与密钥
  （`plain_text` / `json` / `secret_text` / `secret_key`），不含 `d1` / `kv_namespace` / `r2_bucket`；
  CLI 也没有 `--keep-bindings`。必须把绑定写进部署配置 —— 详见 A4。
- **`ERR_PNPM_IGNORED_BUILDS`**：`mail-view/pnpm-workspace.yaml` 的 `allowBuilds` 缺失或
  用了旧版 pnpm。该文件是必需的，且需要 pnpm 11+。
- **`The name in your Wrangler configuration file ... must match`**：Dashboard 上的 Worker 名
  与配置里的 `name` 不一致，统一改成 `xi-mail`。
- **收不到外域邮件**：检查绑定是否生效（模式 A 看 `Verify bindings` 步骤，模式 B 见 B5），
  以及 Email Routing 的 MX/SPF/路由。
- **登录后 401 / authExpired**：确认 KV 绑定生效，`jwt_secret` 与初始化时一致。
- **附件异常**：先看后台「系统设置 → 集成」的**存储类型**标签，确认实际生效的是 S3 / R2 / KV。
  `r2` 未绑定会正常回退到 KV（**R2 非必选**）；单个附件接近或超过 25 MiB 时 KV 存不下，
  需补 R2 或改配 S3（详见「附件存储：R2 是可选的」）。
- **绑定又丢了**：说明有另一条模式在部署同一个 Worker。停掉它，只保留一种。
