'use strict';
/**
 * DEV / Production 專案 ref 的唯一來源。
 * 這些只是專案識別碼（非祕密），但輸出到 log 時仍一律遮罩。
 * tests/support/env_guard.py 需與此檔保持一致（由 T00 單元測試比對）。
 */
const DEV_REF = 'mjpdfpxqttbhzeimmtqr';
const PRODUCTION_REFS = Object.freeze(['odvksgucvfoaqrumpran']);
const PRODUCTION_REF_PREFIX = 'odvk';

/** 測試工具唯一允許載入的 env 檔（檔名必須完全相等）。 */
const ALLOWED_ENV_FILE = '.env.development.local';

/** 一律拒絕載入的 env 檔（明確列出，避免被誤用）。 */
const FORBIDDEN_ENV_FILES = Object.freeze([
  '.env.local',
  '.env',
  '.env.production',
  '.env.production.local',
  '.env.production-candidate.local.bak',
]);

const TEST_SITE_ORIGIN = 'http://localhost:3002';

/**
 * 測試目標網址：預設本機 3002；設 E2E_BASE_URL（或 PLAYWRIGHT_BASE_URL）可改打 Vercel preview。
 * 只接受 https 的 *.vercel.app（或本機 http），其他一律丟錯，避免誤打正式網域。
 */
function resolveBaseUrl(env = process.env) {
  const raw = String(env.E2E_BASE_URL || env.PLAYWRIGHT_BASE_URL || '').trim();
  if (!raw) return TEST_SITE_ORIGIN;
  let u;
  try { u = new URL(raw); } catch { throw new Error('E2E_BASE_URL 不是合法網址'); }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  const preview = u.protocol === 'https:' && /\.vercel\.app$/.test(u.hostname);
  if (!local && !preview) throw new Error('E2E_BASE_URL 只接受 https://*.vercel.app 或 localhost');
  return u.origin;
}

/** 是否改打遠端（非預設本機 3002）；此時不啟動本機 webServer。 */
function isRemoteBase(env = process.env) {
  return resolveBaseUrl(env) !== TEST_SITE_ORIGIN;
}

/** Vercel Deployment Protection 繞過標頭；沒設 VERCEL_PROTECTION_BYPASS 就是空物件。 */
function bypassHeaders(env = process.env) {
  const v = env.VERCEL_PROTECTION_BYPASS;
  if (!v) return {};
  return { 'x-vercel-protection-bypass': v, 'x-vercel-set-bypass-cookie': 'samesitenone' };
}

module.exports = {
  resolveBaseUrl,
  isRemoteBase,
  bypassHeaders,
  DEV_REF,
  PRODUCTION_REFS,
  PRODUCTION_REF_PREFIX,
  ALLOWED_ENV_FILE,
  FORBIDDEN_ENV_FILES,
  TEST_SITE_ORIGIN,
};
