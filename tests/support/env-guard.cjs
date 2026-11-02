'use strict';
/**
 * 測試用環境守衛（Node）。
 * - 只解析 .env.development.local，不使用 dotenv / @next/env，因此不會讀到 .env.local 或 .bak。
 * - 驗證項目：Supabase URL ref、anon / service_role JWT 的 role 與 ref claim、
 *   EXPECTED_SUPABASE_PROJECT_REF、ALLOW_DEV_DATABASE_OPERATIONS、NODE_ENV。
 * - 任何錯誤訊息都不得包含祕密；ref 一律遮罩。
 * CLI：node tests/support/env-guard.cjs [--server [baseUrl]]  失敗時 exit 2。
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  DEV_REF,
  PRODUCTION_REFS,
  PRODUCTION_REF_PREFIX,
  ALLOWED_ENV_FILE,
  TEST_SITE_ORIGIN,
} = require('./env-refs.cjs');

class EnvGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvGuardError';
    this.exitCode = 2;
  }
}

function mask(value) {
  if (!value) return '<missing>';
  const v = String(value);
  if (v.length <= 8) return `${v.slice(0, 2)}...${v.slice(-2)}`;
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

/** 解析 .env 文字（KEY=VALUE、可含引號與註解），不展開變數。 */
function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * 載入 env 檔。只接受檔名完全等於 .env.development.local；
 * 其他任何檔案（.env.local、.bak、.env.production.local…）一律丟錯。
 */
function loadDevEnvFile(root, fileName = ALLOWED_ENV_FILE) {
  const requested = String(fileName);
  if (requested !== ALLOWED_ENV_FILE) {
    throw new EnvGuardError(
      `拒絕載入 env 檔 "${path.basename(requested)}"：測試工具只允許 ${ALLOWED_ENV_FILE}`,
    );
  }
  const full = path.join(root, ALLOWED_ENV_FILE);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    throw new EnvGuardError(`找不到 ${ALLOWED_ENV_FILE}（應位於專案根目錄）`);
  }
  return parseEnvText(text);
}

function parseSupabaseRef(urlValue) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new EnvGuardError('NEXT_PUBLIC_SUPABASE_URL 不是有效的網址');
  }
  const m = parsed.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.co$/);
  if (!m) throw new EnvGuardError('NEXT_PUBLIC_SUPABASE_URL 不是 Supabase 專案網域');
  return m[1];
}

function decodeJwtPayload(token, label) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new EnvGuardError(`${label} 不是有效的 JWT`);
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    throw new EnvGuardError(`${label} 的內容無法解碼`);
  }
}

function isProductionRef(ref) {
  return PRODUCTION_REFS.includes(ref) || String(ref).startsWith(PRODUCTION_REF_PREFIX);
}

/**
 * 驗證 env 物件（純函式，可用假 env 測試）。通過時回傳安全摘要，否則丟 EnvGuardError。
 * @param {Record<string,string|undefined>} env
 * @param {{nodeEnv?: string}} [opts]
 */
function validateDevEnv(env, opts = {}) {
  const e = env || {};
  const url = e.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new EnvGuardError('NEXT_PUBLIC_SUPABASE_URL 為必填');
  const urlRef = parseSupabaseRef(url);
  const safe = `ref ${mask(urlRef)}`;

  if (isProductionRef(urlRef)) {
    throw new EnvGuardError(`Supabase ref 屬於 Production（${safe}），拒絕執行`);
  }
  if (urlRef !== DEV_REF) {
    throw new EnvGuardError(`Supabase URL 的 ref 不是 DEV（${safe}）`);
  }
  if (!e.EXPECTED_SUPABASE_PROJECT_REF) {
    throw new EnvGuardError('EXPECTED_SUPABASE_PROJECT_REF 為必填');
  }
  if (e.EXPECTED_SUPABASE_PROJECT_REF !== urlRef) {
    throw new EnvGuardError('EXPECTED_SUPABASE_PROJECT_REF 與 Supabase URL 的 ref 不一致');
  }
  if (e.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') {
    throw new EnvGuardError('ALLOW_DEV_DATABASE_OPERATIONS 必須嚴格等於 true');
  }
  const nodeEnv = opts.nodeEnv !== undefined ? opts.nodeEnv : process.env.NODE_ENV;
  if (nodeEnv === 'production' || e.NODE_ENV === 'production') {
    throw new EnvGuardError('NODE_ENV 不得為 production');
  }

  for (const [key, expectedRole] of [
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
  ]) {
    if (!e[key]) throw new EnvGuardError(`${key} 為必填`);
    const payload = decodeJwtPayload(e[key], key);
    if (payload.role !== expectedRole) {
      throw new EnvGuardError(`${key} 的 JWT role 必須是 ${expectedRole}`);
    }
    if (!payload.ref) throw new EnvGuardError(`${key} 的 JWT 缺少 ref claim`);
    if (isProductionRef(String(payload.ref))) {
      throw new EnvGuardError(`${key} 的 JWT ref 屬於 Production（ref ${mask(payload.ref)}）`);
    }
    if (payload.ref !== DEV_REF) {
      throw new EnvGuardError(`${key} 的 JWT ref 不是 DEV（ref ${mask(payload.ref)}）`);
    }
  }

  // 額外防線：任何其他變數值若含 Production ref 字串，也拒絕（不輸出值）。
  for (const [key, value] of Object.entries(e)) {
    if (typeof value === 'string' && PRODUCTION_REFS.some((r) => value.includes(r))) {
      throw new EnvGuardError(`環境變數 ${key} 含有 Production ref，拒絕執行`);
    }
  }

  return { projectRef: mask(urlRef), nodeEnv: nodeEnv || '<unset>' };
}

/** 讀取 .env.development.local 並驗證；回傳 { env, summary }。env 不會寫入 process.env。 */
function assertDevEnvironment({ root = process.cwd(), env, nodeEnv } = {}) {
  const loaded = env || loadDevEnvFile(root);
  const summary = validateDevEnv(loaded, { nodeEnv });
  return { env: loaded, summary };
}

/** 將通過守衛的 DEV 變數注入目標物件（預設 process.env，覆蓋既有值），供子程序繼承。 */
function applyDevEnv(env, target = process.env) {
  for (const [k, v] of Object.entries(env)) target[k] = v;
  return target;
}

/** 測試站 preflight：/api/workspace/session 不得為 503（200 或 401 皆可）。 */
async function preflightServer(baseUrl = TEST_SITE_ORIGIN, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new EnvGuardError('測試站只允許 localhost / 127.0.0.1');
  }
  let res;
  try {
    res = await fetchImpl(`${origin}/api/workspace/session`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
  } catch {
    throw new EnvGuardError(`無法連線測試站 ${origin}（伺服器未啟動？）`);
  }
  if (res.status === 503) {
    throw new EnvGuardError('測試站 /api/workspace/session 回 503：伺服器未通過 DEV 守衛，拒絕使用');
  }
  if (res.status >= 500) {
    throw new EnvGuardError(`測試站 /api/workspace/session 回 ${res.status}`);
  }
  return { status: res.status };
}

async function main(argv) {
  const root = path.resolve(__dirname, '..', '..');
  try {
    const { summary } = assertDevEnvironment({ root });
    console.log('Environment guard passed');
    console.log(`Project Ref: ${summary.projectRef}`);
    const i = argv.indexOf('--server');
    if (i >= 0) {
      const url = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : TEST_SITE_ORIGIN;
      const r = await preflightServer(url);
      console.log(`Server preflight passed (HTTP ${r.status})`);
    }
  } catch (error) {
    console.error('Environment guard failed');
    console.error(`Reason: ${error.message}`);
    process.exit(2);
  }
}

module.exports = {
  EnvGuardError,
  mask,
  parseEnvText,
  loadDevEnvFile,
  validateDevEnv,
  assertDevEnvironment,
  applyDevEnv,
  preflightServer,
};

if (require.main === module) main(process.argv.slice(2));
