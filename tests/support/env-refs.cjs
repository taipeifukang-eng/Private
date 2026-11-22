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

module.exports = {
  DEV_REF,
  PRODUCTION_REFS,
  PRODUCTION_REF_PREFIX,
  ALLOWED_ENV_FILE,
  FORBIDDEN_ENV_FILES,
  TEST_SITE_ORIGIN,
};
