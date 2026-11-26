import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { adminDb, apiForUser, runIdOrThrow, stores } from './m5-fixtures';

/**
 * M7/M8 第 1 批（G01-G05）測試共用工具。
 * 規則：只用 DEV、只用 VW/ZT 測試門市；所有資料名稱帶「[自動測試]M7M8 <runId>」、分類與架型代碼帶 M7M8<RUNID> 前綴，
 * 測試只刪「自己建立（帶標記）」的資料；sweeper 以同一標記回報孤兒（sweep-targets.cjs）。
 * 帳號以 m7m8-test-* 建立（店長角色用 DEV 既有的真正 store_manager 角色），teardown 與下次 setup 開頭依標記清除。
 */
export { adminDb, apiForUser, stores };
export const M7_EMAIL_PREFIX = 'm7m8-test-';
export const M7_FILE_PREFIX = 'm7m8t-';
export const M7_ROLE_PREFIX = 'm7m8_test_';

export const m7Tag = () => `[自動測試]M7M8 ${runIdOrThrow()}`;
export const m7Name = (tag: string) => `${m7Tag()} ${tag}`;
/** 分類／架型代碼：M7M8 + runId（去掉連字號、大寫）+ 後綴，全公司唯一。 */
export const m7Code = (suffix: string) => `M7M8${runIdOrThrow().replace('-', '').toUpperCase()}${suffix}`.toUpperCase();
export const MARK_LIKE = '[自動測試]M7M8 T%';
/** 第 6 批（G20 至 G24）測試資料標記：廠商、分類、區域名稱與代碼以 QA-GA6- 開頭（名稱再帶 runId），cleanupM7M8 只清這些。 */
export const GA6_PREFIX = 'QA-GA6-';
/** 第 4.5 批（G45）測試資料標記：廠商名稱以 QA-GA45- 開頭（再帶 runId）；請款單、發票、附件、設定變更由 DEV 專用函式 ga_dev_cleanup_m7m8_b45 依此清除。 */
export const GA45_PREFIX = 'QA-GA45-';
export const ga45Name = (suffix: string) => `${GA45_PREFIX}${runIdOrThrow()}-${suffix}`;
export const ga6Name = (suffix: string) => `${GA6_PREFIX}${runIdOrThrow()}-${suffix}`;
export const CODE_LIKE = 'M7M8T%';

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export type Cat = { id: string; code: string; name: string };
type CatKind = 'equipment' | 'facility' | 'part';
const CAT_TABLE: Record<CatKind, string> = { equipment: 'ga_equipment_categories', facility: 'ga_facility_categories', part: 'ga_part_categories' };

/** 以 service role 直接建立分類（測試前置資料；API 的建立另有專門測試）。 */
export async function seedCategory(kind: CatKind, suffix: string, over: Record<string, unknown> = {}): Promise<Cat> {
  const row = must(
    await adminDb().from(CAT_TABLE[kind]).insert({ name: m7Name(suffix), code: m7Code(suffix), sort_order: 10, is_active: true, ...over }).select('id,code,name').single(),
    `建立${kind}分類 ${suffix}`,
  ) as Cat;
  return row;
}

export async function seedPart(categoryId: string, suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_parts').insert({ category_id: categoryId, name: m7Name(suffix), base_unit: '個', specs: {}, tags: [], is_active: true, notes: `內部備註-${suffix}`, ...over }).select('*').single(),
    `建立料件 ${suffix}`,
  ) as any;
}

export async function seedEquipmentTemplate(categoryId: string, suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_equipment_templates').insert({ category_id: categoryId, name: m7Name(suffix), brand: `B-${suffix}`, model: `M-${suffix}`, specs: {}, default_fields: {}, is_active: true, ...over }).select('*').single(),
    `建立設備型號 ${suffix}`,
  ) as any;
}

export async function seedFacilityTemplate(suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_facility_templates').insert({ code: m7Code(suffix), name: m7Name(suffix), specs: {}, is_active: true, ...over }).select('*').single(),
    `建立設施架型 ${suffix}`,
  ) as any;
}

export async function seedEquipment(storeCode: string, categoryId: string, suffix: string, over: Record<string, unknown> = {}) {
  const s = await stores();
  return must(
    await adminDb().from('ga_equipment').insert({ store_id: s[storeCode].id, category_id: categoryId, name: m7Name(suffix), brand: `EB-${suffix}`, model: `EM-${suffix}`, ...over }).select('*').single(),
    `建立設備 ${suffix}`,
  ) as any;
}

export async function seedFacility(storeCode: string, categoryId: string, suffix: string, over: Record<string, unknown> = {}) {
  const s = await stores();
  return must(
    await adminDb().from('ga_facilities').insert({ store_id: s[storeCode].id, category_id: categoryId, name: m7Name(suffix), ...over }).select('*').single(),
    `建立設施 ${suffix}`,
  ) as any;
}

/** 報修單（REPAIR）：指向設備或設施，狀態可指定（未結案／已結案測試用）。 */
export async function seedRepairRequest(storeCode: string, target: { equipmentId?: string; facilityId?: string }, suffix: string, status: string, userId: string, over: Record<string, unknown> = {}) {
  const s = await stores();
  return must(
    await adminDb().from('ga_service_requests').insert({
      store_id: s[storeCode].id, created_by: userId, request_type: 'REPAIR', title: m7Name(suffix), description: 'm7m8 測試',
      resource_type: target.equipmentId ? 'EQUIPMENT' : 'FACILITY', equipment_id: target.equipmentId ?? null, facility_id: target.facilityId ?? null, main_status: status, ...over,
    }).select('*').single(),
    `建立報修單 ${suffix}`,
  ) as any;
}

/**
 * 以 role-matrix 帳號登入的 Supabase 客戶端（anon key + 該帳號 JWT），用來直接呼叫 ga_ws_* 資料庫函式，驗證資料庫端權限語意。
 * 密碼來自 .tmp-check/test-credentials.json（gitignored），不輸出。
 */
export async function rpcClientFor(accountKey: string): Promise<any> {
  const nodeRequire = createRequire(path.join(__dirname, 'm7m8-fixtures.ts'));
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: path.resolve(__dirname, '..', '..') });
  const { getAccount } = nodeRequire('./credentials.cjs') as { getAccount: (k: string) => { email: string; password: string } };
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  const acct = getAccount(accountKey);
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email: acct.email, password: acct.password });
  if (login.error) throw new Error(`帳號 ${accountKey} 登入失敗（${login.error.message}）`);
  return client;
}

/** 呼叫 ga_ws_* 函式（回傳 {ok,status,data,error,...} 的 jsonb）；網路層錯誤直接丟出。 */
export async function callFn(client: any, name: string, args: Record<string, unknown>): Promise<any> {
  const r = await client.rpc(name, args);
  if (r.error) return { ok: false, status: 0, error: r.error.message, code: r.error.code };
  return r.data;
}

export async function seedLocation(storeCode: string | null, suffix: string, over: Record<string, unknown> = {}) {
  const s = storeCode ? await stores() : null;
  return must(
    await adminDb().from('ga_inventory_locations').insert({ code: m7Code(suffix), name: m7Name(suffix), location_type: storeCode ? 'STORE' : 'CENTRAL_WAREHOUSE', ...(s ? { store_id: s[storeCode!].id } : {}), ...over }).select('*').single(),
    `建立庫存位置 ${suffix}`,
  ) as any;
}

/** 位置料件設定（直接寫入，測試前置資料；API 的新增另有專門測試）。 */
export async function seedLocationPart(locationId: string, partId: string, over: Record<string, unknown> = {}) {
  return must(await adminDb().from('ga_inventory_location_parts').insert({ location_id: locationId, part_id: partId, ...over }).select('*').single(), '建立位置料件設定') as any;
}

export async function seedBalance(locationId: string, partId: string, qty: number) {
  return must(await adminDb().from('ga_inventory_balances').insert({ location_id: locationId, part_id: partId, quantity_base: qty }).select('*').single(), '建立庫存餘額') as any;
}

export async function seedServiceRequest(storeCode: string, partId: string, suffix: string, status: string, userId: string) {
  const s = await stores();
  return must(
    await adminDb().from('ga_service_requests').insert({
      store_id: s[storeCode].id, created_by: userId, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name(suffix), description: 'm7m8 測試', resource_type: 'PART', part_id: partId, desired_quantity: 1, main_status: status,
    }).select('*').single(),
    `建立需求單 ${suffix}`,
  ) as any;
}

export async function seedTransfer(sourceId: string, destId: string, partId: string, suffix: string, status = 'REQUESTED') {
  const t = must(await adminDb().from('ga_inventory_transfers').insert({ source_location_id: sourceId, destination_location_id: destId, status, reason: m7Name(suffix) }).select('*').single(), '建立調撥單') as any;
  must(await adminDb().from('ga_inventory_transfer_items').insert({ transfer_id: t.id, part_id: partId, quantity_input: 1 }), '建立調撥明細');
  return t;
}

// ------------------------------------------------------------------ 帳號
export type M7User = { key: string; id: string; email: string; password: string };

/** 建立測試帳號：real_store_manager（DEV 既有的真正 store_manager 角色 + 指派 VW001）、admin_ungranted（舊式管理員，沒掛任何角色）。 */
export async function setupM7Users(keys: ('real_store_manager' | 'admin_ungranted' | 'plain_member' | 'roster_supervisor' | 'roster_area_manager' | 'bare_supervisor' | 'bare_area_manager')[]): Promise<{ users: Record<string, M7User>; teardown: () => Promise<string[]> }> {
  runIdOrThrow();
  const db = adminDb();
  const left = await cleanupM7Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await stores();
  const users: Record<string, M7User> = {};
  for (const key of keys) {
    const email = `${M7_EMAIL_PREFIX}${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    users[key] = { key, id: uid, email, password };
    must(await db.from('profiles').update({ role: key === 'admin_ungranted' ? 'admin' : 'member', job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    if (key === 'real_store_manager') {
      const role = must(await db.from('roles').select('id').eq('code', 'store_manager').maybeSingle(), '讀取 store_manager 角色') as { id: string } | null;
      if (!role) throw new Error('DEV 沒有 store_manager 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: s.VW001.id, role_type: 'store_manager', is_primary: true }), `store_managers ${key}`);
    }
    // 決定 A：只有無權限的 member 角色、沒有任何總務權限，只在 ZT01 門市名單上的督導／區經理（總務中心入口只靠名單身分）。
    if (key === 'bare_supervisor' || key === 'bare_area_manager') {
      // 掛沒有任何權限的 member 角色：完全沒有角色的帳號會被擋在「帳號待管理員開通」說明頁，真實的督導與區經理一定有角色。
      const memberRole = must(await db.from('roles').select('id').eq('code', 'member').maybeSingle(), '讀取 member 角色') as { id: string } | null;
      if (!memberRole) throw new Error('DEV 沒有 member 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: memberRole.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: s.ZT01.id, role_type: key === 'bare_supervisor' ? 'supervisor' : 'area_manager', is_primary: false }), `store_managers ${key}`);
    }
    // 在門市名單上（督導、區經理），掛 store_manager 角色：用來驗證 C12「三種名單身分都能唯讀看自己門市」。
    if (key === 'roster_supervisor' || key === 'roster_area_manager') {
      // 掛 DEV 既有的 store_manager 角色只是為了有總務服務中心的入口（service_center.access）；名單身分仍是督導／區經理。
      const role = must(await db.from('roles').select('id').eq('code', 'store_manager').maybeSingle(), '讀取 store_manager 角色') as { id: string } | null;
      if (!role) throw new Error('DEV 沒有 store_manager 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: s.ZT01.id, role_type: key === 'roster_supervisor' ? 'supervisor' : 'area_manager', is_primary: false }), `store_managers ${key}`);
    }
  }
  return { users, teardown: () => cleanupM7Users(db) };
}

export async function cleanupM7Users(db: any = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${M7_EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  // 第 4 批：測試用的臨時角色（m7m8_test_*，只有測試帳號掛用）
  const tmpRoles = await db.from('roles').select('id').like('code', `${M7_ROLE_PREFIX}%`);
  const roleIds = (tmpRoles.data || []).map((r: { id: string }) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const dr = await db.from('roles').delete().in('id', roleIds);
    if (dr.error) log.push(`roles: ${dr.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    const list = r.data.users || [];
    for (const u of list) {
      if (u.email && u.email.startsWith(M7_EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (list.length < 200) break;
  }
  return log;
}

// ------------------------------------------------------------------ 清除（只刪帶標記的資料）
async function ids(db: any, table: string, col: string, like: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from(table).select('id').like(col, like).order('id').range(from, from + 999);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    out.push(...(r.data || []).map((x: { id: string }) => x.id));
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}
async function del(db: any, table: string, col: string, values: string[], log: string[]) {
  for (let i = 0; i < values.length; i += 100) {
    const r = await db.from(table).delete().in(col, values.slice(i, i + 100));
    if (r.error) log.push(`${table}.${col}: ${r.error.message}`);
  }
}

/** G46 水電話費請款：清除請款單、明細、事件、帳單、附件紀錄與測試廠商（標記 QA-GAUP-），並刪除回傳的附件實體檔。函式還沒套用時略過。 */
async function sweepGaup(db: any, log: string[]) {
  const r = await db.rpc('ga_dev_cleanup_ga_utility_payment');
  if (r.error) {
    if (r.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_ga_utility_payment: ${r.error.message}`);
    return;
  }
  const paths: string[] = (r.data && r.data.storage_paths) || [];
  if (paths.length) {
    const rm = await db.storage.from('general-affairs-attachments').remove(paths);
    if (rm.error) log.push(`gaup storage: ${rm.error.message}`);
  }
}

/** 呼叫第 4.5 批清除函式，並把回傳的附件實體檔一併刪除。 */
async function sweepGa45(db: any, log: string[]) {
  const r = await db.rpc('ga_dev_cleanup_m7m8_b45');
  if (r.error) {
    if (r.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_m7m8_b45: ${r.error.message}`);
    return;
  }
  const paths: string[] = (r.data && r.data.storage_paths) || [];
  if (paths.length) {
    const rm = await db.storage.from('general-affairs-attachments').remove(paths);
    if (rm.error) log.push(`ga45 storage: ${rm.error.message}`);
  }
}

/** 清除本測試建立的全部總務資料（標記：名稱 [自動測試]M7M8 T…、代碼 M7M8T…）。回傳殘留說明（空陣列代表乾淨）。 */
export async function cleanupM7M8(): Promise<string[]> {
  const db = adminDb();
  const log: string[] = [];
  const partIds = await ids(db, 'ga_parts', 'name', MARK_LIKE);
  const eqTplIds = await ids(db, 'ga_equipment_templates', 'name', MARK_LIKE);
  const facTplIds = await ids(db, 'ga_facility_templates', 'name', MARK_LIKE);
  const eqIds = await ids(db, 'ga_equipment', 'name', MARK_LIKE);
  const facIds = await ids(db, 'ga_facilities', 'name', MARK_LIKE);
  const locIds = await ids(db, 'ga_inventory_locations', 'name', MARK_LIKE);
  const reqIds = await ids(db, 'ga_service_requests', 'title', MARK_LIKE);
  const transferIds = await ids(db, 'ga_inventory_transfers', 'reason', MARK_LIKE);
  const woIds = await ids(db, 'maintenance_requests', 'title', MARK_LIKE);

  // 第 2 批：異動紀錄、轉移單（含照片檔）、匯入批次（先刪，資產之後才刪）
  const transferIds2 = await ids(db, 'ga_asset_transfers', 'asset_name', MARK_LIKE);
  const eventIds = await ids(db, 'ga_asset_events', 'asset_name', MARK_LIKE);
  await del(db, 'ga_asset_events', 'id', eventIds, log);
  if (transferIds2.length) {
    await del(db, 'ga_asset_events', 'transfer_id', transferIds2, log);
    const ph = await db.from('ga_asset_transfer_photos').select('storage_path').in('transfer_id', transferIds2);
    const phPaths = (ph.data || []).map((x: { storage_path: string }) => x.storage_path);
    if (phPaths.length) await db.storage.from('general-affairs-attachments').remove(phPaths);
    await del(db, 'ga_asset_transfers', 'id', transferIds2, log);
  }
  const batchIds = await ids(db, 'ga_asset_import_batches', 'file_name', MARK_LIKE);
  await del(db, 'ga_asset_import_batches', 'id', batchIds, log);

  // 附件（紀錄與實體檔；這些檔案是測試自己上傳的）
  const resourceIds = [...partIds, ...eqIds, ...facIds, ...reqIds];
  const paths: string[] = [];
  for (let i = 0; i < resourceIds.length; i += 100) {
    const r = await db.from('ga_resource_attachments').select('id,storage_path').in('resource_id', resourceIds.slice(i, i + 100));
    if (r.error) log.push(`attachments: ${r.error.message}`);
    else paths.push(...(r.data || []).map((x: { storage_path: string }) => x.storage_path));
  }
  await del(db, 'ga_resource_attachments', 'resource_id', resourceIds, log);
  if (paths.length) {
    const rm = await db.storage.from('general-affairs-attachments').remove(paths);
    if (rm.error) log.push(`storage: ${rm.error.message}`);
  }

  // 第 5 批（G18 工單）：工單附件（含刪除工單後只標記刪除、資源已不存在的，以檔名前綴 m7m8t- 辨識）、儲存檔、舊照片列與舊 bucket 檔
  {
    const attPaths: string[] = [];
    const attIds: string[] = [];
    const ar = await db.from('ga_resource_attachments').select('id,storage_path').in('resource_type', ['MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE']).like('file_name', `${M7_FILE_PREFIX}%`);
    if (ar.error) log.push(`wo attachments: ${ar.error.message}`);
    for (const x of ar.data || []) { attIds.push(x.id); attPaths.push(x.storage_path); }
    await del(db, 'ga_resource_attachments', 'id', attIds, log);
    if (attPaths.length) {
      const rm = await db.storage.from('general-affairs-attachments').remove(attPaths);
      if (rm.error) log.push(`wo storage: ${rm.error.message}`);
    }
    if (woIds.length) {
      const legacy: string[] = [];
      const p1 = await db.from('maintenance_photos').select('storage_path').in('request_id', woIds);
      for (const x of p1.data || []) legacy.push(x.storage_path);
      const ups = await db.from('maintenance_updates').select('id').in('request_id', woIds);
      const upIds = (ups.data || []).map((x: { id: string }) => x.id);
      if (upIds.length) {
        const p2 = await db.from('maintenance_update_photos').select('storage_path').in('update_id', upIds);
        for (const x of p2.data || []) legacy.push(x.storage_path);
      }
      if (legacy.length) {
        const rm = await db.storage.from('maintenance-photos').remove(legacy);
        if (rm.error) log.push(`legacy photo storage: ${rm.error.message}`);
      }
    }
  }
  await del(db, 'ga_part_target_compatibilities', 'part_id', partIds, log);
  await del(db, 'ga_part_target_compatibilities', 'target_id', [...eqTplIds, ...facTplIds, ...eqIds, ...facIds], log);
  await del(db, 'ga_part_compatibilities', 'part_id', partIds, log);
  await del(db, 'ga_inventory_transfer_items', 'transfer_id', transferIds, log);
  await del(db, 'ga_inventory_transfers', 'id', transferIds, log);
  // 測試真的過帳（呼叫過帳函式）留下的流水有不可改刪觸發器：用 DEV 專用清除函式（只處理名稱帶標記的位置與料件）清掉，之後才能刪餘額、位置與料件。
  // 第 4 批：採購單、進貨、配發、測試供應商（事件表有不可改刪觸發器，用 DEV 專用函式；函式還沒套用時略過）
  // 第 4.5 批（G45）：請款單與事件、發票與連結、發票與進貨單附件紀錄（事件表有不可改刪觸發器，用 DEV 專用函式）。要在刪採購單、進貨之前執行；函式還沒套用時略過。
  await sweepGa45(db, log);
  await sweepGaup(db, log); // G46 水電請款單與帳單先清（它們引用的是水電廠商，與採購單無關）
  const sweptPo = await db.rpc('ga_dev_cleanup_m7m8_purchasing');
  if (sweptPo.error && sweptPo.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_m7m8_purchasing: ${sweptPo.error.message}`);
  await sweepGa45(db, log); // 採購單清掉後，再清沒有採購單參照的 QA-GA45- 測試廠商
  const swept = await db.rpc('ga_dev_cleanup_m7m8_inventory');
  if (swept.error && swept.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_m7m8_inventory: ${swept.error.message}`);
  await del(db, 'ga_inventory_balances', 'part_id', partIds, log);
  await del(db, 'ga_inventory_balances', 'location_id', locIds, log);
  await del(db, 'ga_inventory_location_parts', 'part_id', partIds, log);
  await del(db, 'ga_inventory_location_parts', 'location_id', locIds, log);
  await del(db, 'ga_service_requests', 'id', reqIds, log);
  await del(db, 'maintenance_requests', 'id', woIds, log);
  await del(db, 'maintenance_categories', 'id', await ids(db, 'maintenance_categories', 'name', MARK_LIKE), log);
  await del(db, 'ga_equipment', 'id', eqIds, log);
  await del(db, 'ga_facilities', 'id', facIds, log);
  await del(db, 'ga_equipment_templates', 'id', eqTplIds, log);
  await del(db, 'ga_facility_templates', 'id', facTplIds, log);
  await del(db, 'ga_parts', 'id', partIds, log);
  await del(db, 'ga_inventory_locations', 'id', locIds, log);

  // 分類：先刪子層，再刪父層（反覆直到沒有可刪的）
  for (const table of Object.values(CAT_TABLE)) {
    for (let round = 0; round < 8; round += 1) {
      const all = await ids(db, table, 'code', CODE_LIKE);
      if (!all.length) break;
      const parents = new Set<string>();
      const p = await db.from(table).select('parent_id').in('id', all);
      for (const r of p.data || []) if (r.parent_id) parents.add(r.parent_id);
      const leaves = all.filter((id) => !parents.has(id));
      const r = await db.from(table).delete().in('id', leaves);
      if (r.error) {
        log.push(`${table}: ${r.error.message}`);
        break;
      }
    }
    const left = await ids(db, table, 'code', CODE_LIKE);
    if (left.length) log.push(`${table} 殘留 ${left.length} 筆`);
  }
  // 第 6 批（G23）：水電帳單（供應商名稱 QA-GA6-）與其附件（紀錄與實體檔）。帳單寫入走資料庫函式，這裡用 service role 直接刪除（刪除不經觸發器）。
  {
    const billIds = await ids(db, 'ga_utility_bills', 'provider_name', `${GA6_PREFIX}%`);
    if (billIds.length) {
      const attPaths: string[] = [];
      for (let i = 0; i < billIds.length; i += 100) {
        const r = await db.from('ga_resource_attachments').select('storage_path').eq('resource_type', 'UTILITY_BILL').in('resource_id', billIds.slice(i, i + 100));
        if (r.error) log.push(`bill attachments: ${r.error.message}`);
        else attPaths.push(...(r.data || []).map((x: { storage_path: string }) => x.storage_path));
      }
      await del(db, 'ga_resource_attachments', 'resource_id', billIds, log);
      if (attPaths.length) {
        const rm = await db.storage.from('general-affairs-attachments').remove(attPaths);
        if (rm.error) log.push(`bill storage: ${rm.error.message}`);
      }
      await del(db, 'ga_utility_bills', 'id', billIds, log);
    }
  }
  // 第 6 批（G20／G21）：廠商（名稱 QA-GA6-）、服務分類與區域（代碼 QA-GA6-，先刪子層）。採購單或工單若還參照廠商，前面已先清掉。
  {
    await del(db, 'ga_vendors', 'id', await ids(db, 'ga_vendors', 'name', `${GA6_PREFIX}%`), log);
    for (const table of ['ga_service_categories', 'ga_service_regions']) {
      for (let round = 0; round < 8; round += 1) {
        const all = await ids(db, table, 'code', `${GA6_PREFIX}%`);
        if (!all.length) break;
        const parents = new Set<string>();
        const p = await db.from(table).select('parent_id').in('id', all);
        for (const r of p.data || []) if (r.parent_id) parents.add(r.parent_id);
        const leaves = all.filter((id) => !parents.has(id));
        const r = await db.from(table).delete().in('id', leaves);
        if (r.error) {
          log.push(`${table}: ${r.error.message}`);
          break;
        }
      }
    }
  }
  for (const [table, col, like] of [
    ['ga_utility_bills', 'provider_name', `${GA6_PREFIX}%`], ['ga_vendors', 'name', `${GA6_PREFIX}%`], ['ga_service_categories', 'code', `${GA6_PREFIX}%`], ['ga_service_regions', 'code', `${GA6_PREFIX}%`],
    ['ga_parts', 'name', MARK_LIKE], ['ga_equipment_templates', 'name', MARK_LIKE], ['ga_facility_templates', 'name', MARK_LIKE],
    ['ga_equipment', 'name', MARK_LIKE], ['ga_facilities', 'name', MARK_LIKE], ['ga_inventory_locations', 'name', MARK_LIKE], ['ga_service_requests', 'title', MARK_LIKE],
    ['ga_asset_transfers', 'asset_name', MARK_LIKE], ['ga_asset_events', 'asset_name', MARK_LIKE], ['ga_asset_import_batches', 'file_name', MARK_LIKE],
    ['ga_vendors', 'name', MARK_LIKE], ['ga_purchase_orders', 'notes', MARK_LIKE],
  ] as const) {
    const left = await ids(db, table, col, like);
    if (left.length) log.push(`${table} 殘留 ${left.length} 筆`);
  }
  return log;
}

/** 基準保護：測試前確認 DEV 的分類種子資料、型號與架型沒有被改動（只讀）。 */
export async function assertGaBaseline() {
  const db = adminDb();
  for (const [table, min] of [['ga_part_categories', 50], ['ga_equipment_categories', 50], ['ga_facility_categories', 30]] as const) {
    const r = await db.from(table).select('id', { count: 'exact', head: true }).is('deleted_at', null).not('code', 'like', CODE_LIKE);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    if ((r.count || 0) < min) throw new Error(`${table} 種子資料只有 ${r.count} 筆（預期至少 ${min}），DEV 基準異常，停止測試`);
  }
}

/** 讀庫回資料列（只讀，供寫入後回讀比對）。 */
export async function row(table: string, id: string): Promise<any | null> {
  return must(await adminDb().from(table).select('*').eq('id', id).maybeSingle(), `讀取 ${table}`);
}
export async function rowsWhere(table: string, col: string, value: string): Promise<any[]> {
  return (must(await adminDb().from(table).select('*').eq(col, value), `讀取 ${table}`) as any[]) || [];
}

// ------------------------------------------------------------------ 第 5 批（G18／G19）工單種子
/**
 * 維修工單種子（直接寫入，測試前置資料；工單函式另有專門測試）。標題帶 [自動測試]M7M8 標記，只用 VW／ZT 測試門市。
 * over 可指定 status、progress_stage、reported_by、ga_service_request_id、category_id 等欄位；預設回報人是 reporterId。
 */
export async function seedWorkOrder(storeCode: string, suffix: string, reporterId: string, over: Record<string, unknown> = {}) {
  const s = await stores();
  return must(
    await adminDb().from('maintenance_requests').insert({
      store_id: s[storeCode].id, title: m7Name(suffix), description: 'm7m8 工單測試', reported_by: reporterId, reporter_name: 'M7M8 回報人', status: 'UNACCEPTED', priority: 'normal', ...over,
    }).select('*').single(),
    `建立工單 ${suffix}`,
  ) as any;
}

/** 維修分類（DEV 專用種子之外，測試自己的；名稱帶標記，cleanupM7M8 清除）。 */
export async function seedMaintenanceCategory(suffix: string, over: Record<string, unknown> = {}) {
  return must(await adminDb().from('maintenance_categories').insert({ name: m7Name(suffix), sort_order: 900, ...over }).select('*').single(), `建立維修分類 ${suffix}`) as any;
}
