#!/usr/bin/env node
/**
 * 校验主 Worker 的 D1 / KV（可选 R2）绑定是否生效。
 *
 * 为什么要校验：
 *   `wrangler deploy` 会用本地配置覆盖远端，配置里没声明的绑定会被清空 —— 这正是本项目
 *   反复丢绑定的根因。workflow 已在 wrangler.ci.toml 中显式声明 db/kv(/r2)，正常情况下这里
 *   必然通过；一旦不通过，说明绑定确实丢了，直接让 CI 失败，而不是让 Worker 带着残缺绑定静默上线。
 *
 * 为什么不在这里自动补绑：
 *   补绑接口 PATCH /accounts/{account_id}/workers/scripts/{script_name}/settings 是
 *   「整体替换 bindings 数组」，secret 类绑定（secret_text / secret_key）无法回填明文，
 *   自动补绑有静默丢 secret 的风险。恢复办法很简单：重新运行一次本 workflow，
 *   它会按 wrangler.ci.toml 重新声明全部绑定。
 *
 * 参考接口：GET /accounts/{account_id}/workers/scripts/{script_name}/settings
 */

const {
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  WORKER_NAME: scriptName,
  D1_DATABASE_ID: d1Id,
  KV_NAMESPACE_ID: kvId,
  R2_BUCKET_NAME: r2Bucket,
} = process.env;

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

if (!token || !accountId || !scriptName) {
  fail('缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / WORKER_NAME');
}

// 期望存在的绑定（与 wrangler.ci.toml 中声明的保持一致）
const expected = ['db', 'kv'];
if (r2Bucket) expected.push('r2');

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/settings`;

let json;
try {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
} catch (e) {
  fail(`读取 Worker settings 失败：${e.message}`);
}

const bindings = Array.isArray(json.result?.bindings) ? json.result.bindings : [];
const names = bindings.map((b) => b.name);

console.log('当前绑定：' + (bindings.map((b) => `${b.name}:${b.type}`).join(', ') || '(无)'));

const missing = expected.filter((name) => !names.includes(name));
if (missing.length > 0) {
  fail(
    `缺少绑定：${missing.join(', ')}。请重新运行本 workflow（会按 wrangler.ci.toml 重新声明绑定）；` +
      `若仍失败，检查 Secret D1_DATABASE_ID / KV_NAMESPACE_ID 是否正确。`,
  );
}

// 绑定存在还不够：核对资源 ID 是否指向 Secrets 里声明的那个资源，
// 防止「绑定在、但指错库」静默通过（例如手滑把 Secret 填成了另一个 D1 的 ID）。
const byName = Object.fromEntries(bindings.map((b) => [b.name, b]));
const idChecks = [
  { name: 'db', actual: byName.db?.id, want: d1Id, secretName: 'D1_DATABASE_ID' },
  { name: 'kv', actual: byName.kv?.namespace_id, want: kvId, secretName: 'KV_NAMESPACE_ID' },
];
const idMismatch = idChecks.filter(
  (c) => c.want && c.actual && c.actual !== c.want,
);
if (idMismatch.length > 0) {
  // 不打印任何真实 ID，只打印前 6 位用于人工比对
  const detail = idMismatch
    .map((c) => `${c.name}: 远端=${String(c.actual).slice(0, 6)}… Secret(${c.secretName})=${String(c.want).slice(0, 6)}…`)
    .join('；');
  fail(`绑定指向的资源与 Secret 不一致 → ${detail}。请核对 GitHub Secrets 后重跑。`);
}

console.log(`✅ 绑定校验通过：${expected.join(', ')}（资源 ID 与 Secrets 一致）`);
