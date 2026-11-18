import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 處方箋 Google Sheet 匯入測試共用工具：只連 DEV、只用 VW/ZT 測試門市與保留年份 2038、結束只清自己建的。
const nodeRequire = createRequire(__filename);
export const ROOT = path.resolve(__dirname, '..', '..');
export const DEV_REF = 'mjpdfpxqttbhzeimmtqr';
export const BASE_URL = process.env.RXGS_BASE_URL || 'http://localhost:3014';
export const TEST_YEAR_MONTH = '2038-10';
export const TEST_STORE_CODES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];
export const ACCOUNTS = { admin: 'admin', viewer: 'performance_view', editor: 'performance_edit' } as const;
export type Who = keyof typeof ACCOUNTS;

let envLoaded = false;
export function devEnv(): Record<string, string> {
  if (!envLoaded) {
    nodeRequire('@next/env').loadEnvConfig(ROOT, true);
    envLoaded = true;
  }
  const e = process.env as Record<string, string>;
  const ref = new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  if (ref !== DEV_REF || ref.startsWith('odvk') || e.EXPECTED_SUPABASE_PROJECT_REF !== ref || e.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') {
    throw new Error('拒絕執行：目前環境不是 DEV（mjpdfpxqttbhzeimmtqr）');
  }
  const refFile = path.join(ROOT, 'supabase', '.temp', 'project-ref');
  if (fs.existsSync(refFile) && !fs.readFileSync(refFile, 'utf8').trim().startsWith('mjpd')) throw new Error('supabase/.temp/project-ref 不是 DEV');
  return e;
}

export function account(key: string): { email: string; password: string; userId: string } {
  const file = process.env.RXGS_CREDENTIALS_FILE || path.resolve(ROOT, '.tmp-check', 'test-credentials.json');
  const a = JSON.parse(fs.readFileSync(file, 'utf8')).accounts?.[key];
  if (!a?.email || !a?.password || !a?.userId) throw new Error(`測試帳號 ${key} 不存在`);
  if (!String(a.email).toLowerCase().endsWith('@example.test')) throw new Error(`帳號 ${key} 不是 @example.test，拒絕使用`);
  return a;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;
export function adminDb(): Db {
  const e = devEnv();
  const { createClient } = nodeRequire('@supabase/supabase-js');
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function testStores(): Promise<Record<string, string>> {
  const r = await adminDb().from('stores').select('id, store_code').in('store_code', TEST_STORE_CODES);
  if (r.error) throw new Error(r.error.message);
  return Object.fromEntries((r.data as { id: string; store_code: string }[]).map(s => [s.store_code, s.id]));
}

/** 清掉自己建的：2038 年測試門市的月報與測試簡稱（只刪指向測試門市的對照）。回傳殘留數。 */
export async function cleanup(): Promise<{ reports: number; aliases: number }> {
  const db = adminDb();
  const ids = Object.values(await testStores());
  if (ids.length === 0) return { reports: 0, aliases: 0 };
  await db.from('monthly_prescription_reports').delete().like('year_month', '2038-%').in('store_id', ids);
  await db.from('prescription_store_aliases').delete().in('store_id', ids);
  const reports = await db.from('monthly_prescription_reports').select('store_id', { count: 'exact', head: true }).like('year_month', '2038-%').in('store_id', ids);
  const aliases = await db.from('prescription_store_aliases').select('id', { count: 'exact', head: true }).in('store_id', ids);
  return { reports: reports.count ?? 0, aliases: aliases.count ?? 0 };
}
