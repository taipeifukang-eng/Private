'use strict';
/**
 * 測試帳號憑證（D04）：唯一來源是 gitignored 的 .tmp-check/test-credentials.json。
 * 格式：{ version, updatedAt, accounts: { <key>: { email, password, userId } } }
 * 此模組永不 log 密碼；toString / JSON 輸出請用 describeAccount（只含 email 遮罩）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CREDENTIALS_FILE = path.join(ROOT, '.tmp-check', 'test-credentials.json');
const TEST_EMAIL_DOMAIN = 'example.test';

function emptyStore() {
  return { version: 1, updatedAt: null, accounts: {} };
}

function loadCredentials(file = CREDENTIALS_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return emptyStore();
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.accounts !== 'object') return emptyStore();
  return parsed;
}

/** 原子寫入（暫存檔 + rename），避免中途失敗遺失已產生的密碼。 */
function saveCredentials(store, file = CREDENTIALS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...store, version: 1, updatedAt: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return next;
}

/** 取得帳號憑證；不存在就丟錯（訊息不含密碼）。 */
function getAccount(key, file = CREDENTIALS_FILE) {
  const store = loadCredentials(file);
  const account = store.accounts[key];
  if (!account || !account.email || !account.password) {
    throw new Error(`test-credentials.json 沒有帳號 "${key}"，請先執行 node scripts/seed-workspace-role-matrix-dev.cjs`);
  }
  if (!String(account.email).toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`)) {
    throw new Error(`帳號 "${key}" 不是 @${TEST_EMAIL_DOMAIN}，拒絕使用`);
  }
  return account;
}

/**
 * 舊 seed 腳本相容層：回傳 { accounts: [{ key, email, id }] }，只含非機密欄位（不含密碼）。
 * 來源是 test-credentials.json；取代過去的 .tmp-check/workspace-accounts.json 等明碼檔。
 */
function readWorkspaceAccounts(file = CREDENTIALS_FILE) {
  const store = loadCredentials(file);
  return {
    accounts: Object.entries(store.accounts).map(([key, a]) => ({ key, email: a.email, id: a.userId })),
  };
}

/** 取得單一帳號的 { key, email, id }（不含密碼）；沒有就丟錯並提示 seed 指令。 */
function requireWorkspaceAccount(key, file = CREDENTIALS_FILE) {
  const found = readWorkspaceAccounts(file).accounts.find((a) => a.key === key);
  if (!found || !found.id) {
    throw new Error(`test-credentials.json 沒有帳號 "${key}"，請先執行對應的 seed 腳本（node scripts/seed-workspace-role-matrix-dev.cjs）`);
  }
  return found;
}

/** 寫入（或更新）一組帳號到 test-credentials.json；永不 log 密碼。 */
function registerAccount(key, { email, password, userId }, file = CREDENTIALS_FILE) {
  const store = loadCredentials(file);
  store.accounts[key] = { email: String(email).toLowerCase(), password, userId };
  return saveCredentials(store, file);
}

function randomPassword() {
  // 32 個 base64url 字元 + 補齊大小寫／數字／符號，符合 Supabase 密碼強度。
  return `${crypto.randomBytes(24).toString('base64url')}aA1!`;
}

function maskEmail(email) {
  const [name = '', domain = ''] = String(email).split('@');
  return `${name.slice(0, 3)}***@${domain}`;
}

module.exports = {
  ROOT,
  CREDENTIALS_FILE,
  TEST_EMAIL_DOMAIN,
  loadCredentials,
  saveCredentials,
  getAccount,
  readWorkspaceAccounts,
  requireWorkspaceAccount,
  registerAccount,
  randomPassword,
  maskEmail,
};
