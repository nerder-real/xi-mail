#!/usr/bin/env node
/**
 * 生成 wrangler.ci.toml —— 部署用的 Wrangler 配置。
 *
 * 为什么需要它：
 *   `wrangler deploy` 是「声明式」的：远端绑定会被本地配置整体覆盖。
 *   我们已从 wrangler 源码确认（v4.x，createWorkerUploadForm）：
 *
 *     let keep_bindings = undefined;
 *     if (keepVars)    keep_bindings.push("plain_text", "json");       // keep_vars = true
 *     if (keepSecrets) keep_bindings.push("secret_text", "secret_key"); // deploy 时 = keepVars
 *     if (keepBindings) keep_bindings.push(...keepBindings);            // 仅内部 API 用
 *
 *   —— 即 keep_bindings 只会保留 vars 与 secrets，**永远不会保留 d1 / kv_namespace /
 *   r2_bucket**；wrangler.toml 也没有对应的配置键，CLI 也没有 --keep-bindings 开关。
 *   结论：凡是配置里没声明的 db/kv/r2 绑定，部署后必然被清空。
 *   所以正确做法不是「部署后再补绑」，而是**部署时就把绑定写进配置**。
 *
 * 为什么不直接把资源 ID 提交进仓库：
 *   本仓库是公开 fork，写入真实 database_id / namespace_id 等于公开基础设施标识。
 *   因此改由「运行时注入」：CI 用 GitHub Secrets，Cloudflare Workers Builds 用
 *   Dashboard > Settings > Build > Build variables。两者都调用本脚本，产出同一份配置。
 *
 * 被谁调用：
 *   通道 A：.github/workflows/deploy.yml（GitHub Actions，用 Secrets）
 *   通道 B：Cloudflare Workers Builds（Dashboard 配置自定义 deploy command，用 Build variables）
 *
 * 环境变量：
 *   WORKER_NAME        Worker 名称，默认 xi-mail（必须与 Dashboard 上的 Worker 名一致）
 *   D1_DATABASE_ID     【必需】D1 数据库 ID
 *   D1_DATABASE_NAME   D1 数据库名，默认 xi-mail（仅展示用，不影响绑定）
 *   KV_NAMESPACE_ID    【必需】KV 命名空间 ID
 *   R2_BUCKET_NAME     可选；留空则不生成 r2 绑定（附件自动回退到 KV）
 *   CUSTOM_DOMAIN      可选；配置后写入 [[routes]]，例如 mail.example.com
 *   OUT                输出文件名，默认 wrangler.ci.toml
 *   EXAMPLE_TOML       入口/兼容日期的来源文件，默认 wrangler.example.toml
 *
 * 业务变量（domain/admin/jwt_secret）不在此生成：
 *   在 Cloudflare Dashboard > Settings > Variables and Secrets 配置一次，
 *   keep_vars = true 会保留它们（vars 与 secrets），实测每次部署均不丢失。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const env = process.env;

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};
const warn = (msg) => console.warn(`::warning::${msg}`);

// ── 1. 取变量 ──────────────────────────────────────────────────────────────
const WORKER_NAME = env.WORKER_NAME?.trim() || 'xi-mail';
const D1_DATABASE_ID = env.D1_DATABASE_ID?.trim() || '';
const D1_DATABASE_NAME = env.D1_DATABASE_NAME?.trim() || 'xi-mail';
const KV_NAMESPACE_ID = env.KV_NAMESPACE_ID?.trim() || '';
const R2_BUCKET_NAME = env.R2_BUCKET_NAME?.trim() || '';
const CUSTOM_DOMAIN = env.CUSTOM_DOMAIN?.trim() || '';
const OUT = env.OUT?.trim() || 'wrangler.ci.toml';
const EXAMPLE = env.EXAMPLE_TOML?.trim() || 'wrangler.example.toml';

const missing = [];
if (!D1_DATABASE_ID) missing.push('D1_DATABASE_ID');
if (!KV_NAMESPACE_ID) missing.push('KV_NAMESPACE_ID');
if (missing.length) fail(`缺少必需变量：${missing.join(', ')}`);

// ── 2. 入口 / 兼容日期跟随上游示例配置，避免上游升级后这里成为陈旧值 ──────────
const exampleText = existsSync(EXAMPLE) ? readFileSync(EXAMPLE, 'utf8') : '';
const pick = (text, key) => {
  const m = new RegExp(`^${key}[ \\t]*=[ \\t]*"([^"]*)"`, 'm').exec(text);
  return m ? m[1] : '';
};
const ENTRY = pick(exampleText, 'main') || 'src/index.js';
const COMPAT_DATE = pick(exampleText, 'compatibility_date') || '2025-06-04';
const exampleSource = exampleText ? EXAMPLE : '(未找到示例配置，使用默认值)';

// ── 3. TOML 字符串转义（域名等值里的 " 与 \ 会破坏 TOML） ────────────────────
const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ── 5. 组装配置 ────────────────────────────────────────────────────────────
const L = [];
L.push(`name = ${q(WORKER_NAME)}`);
L.push(`main = ${q(ENTRY)}`);
L.push(`compatibility_date = ${q(COMPAT_DATE)}`);
// keep_vars = true → keep_bindings 会带上 plain_text / json / secret_text / secret_key，
// 保住 Dashboard 里改过的变量与全部 secret（含 jwt_secret）。但它管不到 db/kv/r2。
L.push('keep_vars = true');
L.push('');
L.push('[observability]');
L.push('enabled = true');
L.push('');

// 关键：显式声明 D1 / KV，由 wrangler 自己带上绑定
L.push('[[d1_databases]]');
L.push('binding = "db"');
L.push(`database_name = ${q(D1_DATABASE_NAME)}`);
L.push(`database_id = ${q(D1_DATABASE_ID)}`);
L.push('');
L.push('[[kv_namespaces]]');
L.push('binding = "kv"');
L.push(`id = ${q(KV_NAMESPACE_ID)}`);

if (R2_BUCKET_NAME) {
  L.push('');
  L.push('[[r2_buckets]]');
  L.push('binding = "r2"');
  L.push(`bucket_name = ${q(R2_BUCKET_NAME)}`);
}

if (CUSTOM_DOMAIN) {
  L.push('');
  L.push('[[routes]]');
  L.push(`pattern = ${q(CUSTOM_DOMAIN)}`);
  L.push('custom_domain = true');
}

L.push('');
L.push('[ai]');
L.push('binding = "ai"');
L.push('');
L.push('[assets]');
L.push('binding = "assets"');
L.push('directory = "./dist"');
L.push('not_found_handling = "single-page-application"');
L.push('run_worker_first = true');
L.push('');
L.push('[triggers]');
L.push('crons = ["0 16 * * *"]');
L.push('');
L.push('[vars]');
L.push('orm_log = false');
L.push('');

const toml = L.join('\n');
writeFileSync(OUT, toml, 'utf8');

// ── 6. 回显（隐去资源 ID，避免日志泄漏） ────────────────────────────────────
if (!R2_BUCKET_NAME) warn('未提供 R2_BUCKET_NAME —— 不生成 r2 绑定，附件将回退到 KV');
if (CUSTOM_DOMAIN) warn(`已写入自定义域名路由：${CUSTOM_DOMAIN}`);

console.log(`入口=${ENTRY}  兼容日期=${COMPAT_DATE}  来源=${exampleSource}`);
console.log(`── 生成的 ${OUT}（已隐去资源 ID） ──`);
console.log(
  toml
    .split('\n')
    .filter((line) => !/database_id|^id =|bucket_name/.test(line))
    .join('\n'),
);
console.log('──────────────────────────────');
console.log(`✅ ${OUT} 生成完毕：db / kv${R2_BUCKET_NAME ? ' / r2' : ''} 绑定已显式声明`);
