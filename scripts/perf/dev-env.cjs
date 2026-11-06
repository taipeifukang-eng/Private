'use strict';
/**
 * 每月人員狀態加速：DEV 環境守衛與共用工具。
 * 只讀 .env.development.local；URL / anon / service_role 的 ref 必須是 DEV，且不得為 Production（odvk 開頭）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV_REF = 'mjpdfpxqttbhzeimmtqr';

function loadDevEnv() {
  const file = path.join(ROOT, '.env.development.local');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error('找不到 .env.development.local（只允許讀這個 env 檔）');
  }
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, '').trim();
    env[m[1]] = v;
  }
  const jwtRef = (t, label, role) => {
    const p = JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (p.role !== role) throw new Error(`${label} 的 JWT role 必須是 ${role}`);
    return p.ref;
  };
  const urlRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const refs = [
    urlRef,
    env.EXPECTED_SUPABASE_PROJECT_REF,
    jwtRef(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'anon key', 'anon'),
    jwtRef(env.SUPABASE_SERVICE_ROLE_KEY, 'service role key', 'service_role'),
  ];
  for (const r of refs) {
    if (String(r).toLowerCase().startsWith('odvk')) throw new Error('偵測到 Production ref，拒絕執行');
    if (r !== DEV_REF) throw new Error('Supabase ref 不是 DEV，拒絕執行');
  }
  if (env.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') throw new Error('ALLOW_DEV_DATABASE_OPERATIONS 必須為 true');
  if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV 不得為 production');
  return env;
}

module.exports = { ROOT, DEV_REF, loadDevEnv };
