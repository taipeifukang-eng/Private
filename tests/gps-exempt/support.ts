import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 巡店定位例外測試共用工具（沿用 Vue 版 I01 的做法：只連 DEV、只用 VW/ZT 測試門市、備註帶標記、依 id 清除）。
// 執行方式見 tests/gps-exempt/README.md。這裡不讀 .env.local / .env.production*，只讀 .env.development.local。

const nodeRequire = createRequire(__filename);
export const ROOT = path.resolve(__dirname, '..', '..');
export const DEV_REF = 'mjpdfpxqttbhzeimmtqr';
export const BASE_URL = process.env.GPSEX_BASE_URL || 'http://localhost:3014';
export const TEST_STORE_CODES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];
export const GPS_EXEMPT_CODE = 'inspection.gps_exempt';

export const RUN_ID = (process.env.GPSEX_RUN_ID ||= `G${Date.now().toString(36)}${randomUUID().slice(0, 4)}`);
export const marker = (tag: string) => `ZTGPSEX-${RUN_ID}-${tag}`;

/** 測試帳號：allowed = 暫時加上測試角色（含巡店定位例外）、denied = 有新增巡店權限但沒有例外、admin = 系統管理員。 */
export const ACCOUNTS = { allowed: 'supervisor', denied: 'inspection_edit', admin: 'admin' } as const;
export type Who = keyof typeof ACCOUNTS;

let envLoaded = false;
export function devEnv(): Record<string, string> {
  if (!envLoaded) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

function credentialsFile(): string {
  return process.env.GPSEX_CREDENTIALS_FILE || path.resolve(ROOT, '..', '富康菁英業務網', '.tmp-check', 'test-credentials.json');
}
export function account(key: string): { email: string; password: string; userId: string } {
  const store = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
  const a = store.accounts?.[key];
  if (!a?.email || !a?.password || !a?.userId) throw new Error(`測試帳號 ${key} 不存在`);
  if (!String(a.email).toLowerCase().endsWith('@example.test')) throw new Error(`帳號 ${key} 不是 @example.test，拒絕使用`);
  return a;
}
export const userIdOf = (who: Who) => account(ACCOUNTS[who]).userId;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
export function adminDb(): Db {
  const e = devEnv();
  const { createClient } = nodeRequire('@supabase/supabase-js');
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
/** 以該測試帳號登入的 supabase client（帶使用者 JWT，會受 RLS 與 trigger 的 auth.uid() 約束）。 */
export async function userDb(who: Who): Promise<Db> {
  const e = devEnv();
  const { createClient } = nodeRequire('@supabase/supabase-js');
  const client = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const a = account(ACCOUNTS[who]);
  const { error } = await client.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw new Error(`測試帳號 ${who} 登入失敗：${error.message}`);
  return client;
}

export async function storeIdByCode(code: string): Promise<string> {
  if (!TEST_STORE_CODES.includes(code)) throw new Error(`${code} 不是測試門市`);
  const r = await adminDb().from('stores').select('id').eq('store_code', code).maybeSingle();
  if (r.error || !r.data) throw new Error(`DEV 缺少測試門市 ${code}`);
  return r.data.id;
}

export function taipeiDate(d: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

// 本次 run 建立的巡店 id：只依 id 刪除（不依樣式批次刪除）。
const created = new Set<string>();
const CREATED_FILE = path.join(ROOT, 'tests', 'gps-exempt', `.created-${RUN_ID}.json`);
export function registerInspection(id: string) {
  created.add(id);
  const all = new Set<string>(fs.existsSync(CREATED_FILE) ? JSON.parse(fs.readFileSync(CREATED_FILE, 'utf8')) : []);
  all.add(id);
  fs.writeFileSync(CREATED_FILE, JSON.stringify([...all]));
}
export function registeredIds(): string[] {
  return fs.existsSync(CREATED_FILE) ? JSON.parse(fs.readFileSync(CREATED_FILE, 'utf8')) : [];
}
export async function deleteRegistered(): Promise<void> {
  const ids = registeredIds();
  if (!ids.length) return;
  const db = adminDb();
  // 只刪備註帶本次標記的列（雙重確認）；子表以 ON DELETE CASCADE 清除。
  const found = await db.from('inspection_masters').select('id,supervisor_notes').in('id', ids);
  if (found.error) throw new Error(`回查測試巡店失敗：${found.error.message}`);
  const safe = (found.data as { id: string; supervisor_notes: string | null }[])
    .filter((r) => (r.supervisor_notes || '').startsWith(`ZTGPSEX-${RUN_ID}-`))
    .map((r) => r.id);
  if (safe.length) {
    const del = await db.from('inspection_masters').delete().in('id', safe);
    if (del.error) throw new Error(`刪除測試巡店失敗：${del.error.message}`);
  }
}
/** 殘留檢查：依本次登錄的 id 與備註標記計數（只計數，不刪除）。 */
export async function leftoverCount(): Promise<{ byId: number; byMarker: number }> {
  const db = adminDb();
  const ids = registeredIds();
  const a = ids.length ? await db.from('inspection_masters').select('id', { count: 'exact', head: true }).in('id', ids) : { count: 0, error: null };
  const b = await db.from('inspection_masters').select('id', { count: 'exact', head: true }).like('supervisor_notes', `ZTGPSEX-${RUN_ID}-%`);
  if (a.error || b.error) throw new Error(`殘留檢查失敗：${(a.error || b.error).message}`);
  return { byId: a.count ?? 0, byMarker: b.count ?? 0 };
}

export interface InsertOpts {
  storeCode?: string;
  tag: string;
  patch?: Record<string, unknown>;
  /** 以哪個身分寫入；省略 = service role（沒有 auth.uid()）。 */
  as?: Who;
}
/** 直接寫入巡店主表（驗證資料庫 trigger）。回傳 { data, error }；成功的列會登錄待清除。 */
export async function insertMaster(opts: InsertOpts) {
  const store = await storeIdByCode(opts.storeCode || 'ZT01');
  const uid = userIdOf(opts.as || 'admin');
  const db = opts.as ? await userDb(opts.as) : adminDb();
  const r = await db
    .from('inspection_masters')
    .insert({
      store_id: store,
      inspector_id: uid,
      created_by: uid,
      inspection_date: taipeiDate(),
      inspection_type: 'supervisor',
      inspection_no: `GX-${randomUUID().slice(0, 8)}`,
      status: 'draft',
      supervisor_notes: marker(opts.tag),
      ...opts.patch,
    })
    .select('*')
    .maybeSingle();
  if (r.data?.id) registerInspection(r.data.id);
  return r as { data: Record<string, any> | null; error: { code?: string; message: string } | null };
}
export async function updateMaster(id: string, patch: Record<string, unknown>, as?: Who) {
  const db = as ? await userDb(as) : adminDb();
  return db.from('inspection_masters').update(patch).eq('id', id).select('*').maybeSingle();
}
export async function readMaster(id: string): Promise<Record<string, any> | null> {
  const r = await adminDb().from('inspection_masters').select('*').eq('id', id).maybeSingle();
  if (r.error) throw new Error(`回讀巡店失敗：${r.error.message}`);
  return r.data;
}
export async function findMastersByNotes(notes: string): Promise<Record<string, any>[]> {
  const r = await adminDb().from('inspection_masters').select('*').eq('supervisor_notes', notes);
  if (r.error) throw new Error(`回讀巡店失敗：${r.error.message}`);
  return r.data;
}

// ---------------------------------------------------------------------------
// 測試角色：建立一個只含 inspection.gps_exempt 的暫時角色，指派給 ACCOUNTS.allowed；結束時移除。
// ---------------------------------------------------------------------------
export const ROLE_STATE_FILE = path.join(ROOT, 'tests', 'gps-exempt', `.role-${RUN_ID}.json`);

export async function setupTestRole(): Promise<void> {
  const db = adminDb();
  const perm = await db.from('permissions').select('id').eq('code', GPS_EXEMPT_CODE).maybeSingle();
  if (perm.error || !perm.data) throw new Error('DEV 缺少 inspection.gps_exempt 權限（請先套用 migration）');
  const role = await db
    .from('roles')
    .insert({ code: `zt_gpsex_${RUN_ID.toLowerCase()}`, name: `ZT 定位例外測試角色 ${RUN_ID}`, description: '巡店定位例外自動測試用，測完即刪', is_active: true })
    .select('id')
    .single();
  if (role.error) throw new Error(`建立測試角色失敗：${role.error.message}`);
  const rp = await db.from('role_permissions').insert({ role_id: role.data.id, permission_id: perm.data.id, is_allowed: true }).select('id').single();
  if (rp.error) throw new Error(`授權測試角色失敗：${rp.error.message}`);
  const ur = await db.from('user_roles').insert({ user_id: userIdOf('allowed'), role_id: role.data.id, is_active: true }).select('id').single();
  if (ur.error) throw new Error(`指派測試角色失敗：${ur.error.message}`);
  fs.writeFileSync(ROLE_STATE_FILE, JSON.stringify({ roleId: role.data.id, rpId: rp.data.id, urId: ur.data.id }));
}
export async function teardownTestRole(): Promise<void> {
  if (!fs.existsSync(ROLE_STATE_FILE)) return;
  const { roleId, rpId, urId } = JSON.parse(fs.readFileSync(ROLE_STATE_FILE, 'utf8'));
  const db = adminDb();
  await db.from('user_roles').delete().eq('id', urId);
  await db.from('role_permissions').delete().eq('id', rpId);
  await db.from('roles').delete().eq('id', roleId);
  fs.unlinkSync(ROLE_STATE_FILE);
}
export async function roleLeftoverCount(): Promise<number> {
  const db = adminDb();
  const r = await db.from('roles').select('id', { count: 'exact', head: true }).eq('code', `zt_gpsex_${RUN_ID.toLowerCase()}`);
  return r.count ?? 0;
}

// ---------------------------------------------------------------------------
// 管理員樣式角色（lib/permissions/check.ts 的 admin-like 代碼）暫時指派給帳號，且帳號的 profiles.role 不是 admin。
// 只依 id 還原：本次若新建了角色就刪角色，否則只刪指派列。回傳 cleanup。
// ---------------------------------------------------------------------------
export async function grantAdminLikeRole(who: Who): Promise<() => Promise<void>> {
  const db = adminDb();
  const code = 'dev_full_admin';
  let roleId: string | null = null;
  let createdRole = false;
  const existing = await db.from('roles').select('id').eq('code', code).maybeSingle();
  if (existing.data) {
    roleId = existing.data.id;
  } else {
    const ins = await db.from('roles').insert({ code, name: `ZT 管理員樣式角色 ${RUN_ID}`, description: '巡店定位例外自動測試用，測完即刪', is_active: true }).select('id').single();
    if (ins.error) throw new Error(`建立管理員樣式角色失敗：${ins.error.message}`);
    roleId = ins.data.id;
    createdRole = true;
  }
  const ur = await db.from('user_roles').insert({ user_id: userIdOf(who), role_id: roleId, is_active: true }).select('id').single();
  if (ur.error) {
    if (createdRole) await db.from('roles').delete().eq('id', roleId);
    throw new Error(`指派管理員樣式角色失敗：${ur.error.message}`);
  }
  return async () => {
    await db.from('user_roles').delete().eq('id', ur.data.id);
    if (createdRole) await db.from('roles').delete().eq('id', roleId);
  };
}
