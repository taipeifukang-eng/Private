import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8 } from '../support/m7m8-fixtures';
import { cleanupGaup, gaupName, mkBill, seedPayee, setupGaupUsers, todayIso, type GaupUser } from '../support/g46-fixtures';

// G46 補充測試（審查後新增）：
//  A. 水電管理者直接對資料表寫入（繞過函式）時，paid_by_pr_id 與 payee_vendor_id 仍受觸發器保護。
//  B. 正式區 05 補填腳本（含撤回）在 DEV 實跑：補填、再補填不重複、只補空白且只補唯一對應、被有效請款單占用時撤回被擋、作廢後可撤回。
// 測試資料只用 QA-GAUP- 標記、VW 測試門市、2038 年；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let users: Record<string, GaupUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const db = () => adminDb();
const root = path.resolve(__dirname, '../..');
const SQL_DIR = 'docs/vue-workspace/parity-plan/ga-utility-payment-sql';
const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
function runSql(file: string) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `supabase db query --linked --file ${file}`], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const bakCount = async () => {
  const r = await db().from('ga_utility_bills_payee_backfill_bak').select('bill_id', { count: 'exact', head: true });
  return r.error ? -1 : (r.count ?? 0);
};

test.beforeAll(async () => {
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(['clerk']);
  users = made.users;
  teardownUsers = made.teardown;
});
test.afterAll(async () => {
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
});

test('直接寫入防護：水電管理者直接 PATCH 不能偽造 paid_by_pr_id，也不能把繳費單位指向非公用事業或已停用的廠商', async () => {
  const clerk = users.clerk.client;
  const payee = await seedPayee('DW');
  const b = await mkBill(clerk, { payee_vendor_id: payee.id, billing_month: '2038-06-01', amount: 500 });
  const other = await mkBill(clerk, { payee_vendor_id: payee.id, billing_month: '2038-06-01', amount: 700 });
  // 先建一張請款單當偽造目標（草稿即可，只要是真的請款單 id）
  const pr = okData(await callFn(clerk, 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: '2038-06', bill_ids: [other.id], auto_mark_paid: false }, p_key: crypto.randomUUID() }));
  const patched = await clerk.from('ga_utility_bills').update({ paid_at: todayIso(), paid_by_pr_id: pr.id }).eq('id', b.id);
  expect(patched.error, JSON.stringify(patched.error)).toBeNull();
  const row = await dbBill(b.id);
  expect(row.paid_at, '手動標記照常生效').toBe(todayIso());
  expect(row.paid_by_pr_id, '不能偽造成由請款單自動標記').toBeNull();
  // 只改 paid_by_pr_id（不動 paid_at）也一樣還原
  const only = await clerk.from('ga_utility_bills').update({ paid_by_pr_id: pr.id }).eq('id', b.id);
  expect(only.error).toBeNull();
  expect((await dbBill(b.id)).paid_by_pr_id).toBeNull();
  // 繳費單位：非公用事業廠商、已停用的公用事業廠商都擋；合法的公用事業可以
  const { data: plain, error: pe } = await db().from('ga_vendors').insert({ name: gaupName('PLAIN'), vendor_type: 'company', status: 'active', service_category_ids: [] }).select('*').single();
  expect(pe).toBeNull();
  const stopped = await seedPayee('STOP', { status: 'inactive' });
  const good = await seedPayee('GOOD');
  const bad1 = await clerk.from('ga_utility_bills').update({ payee_vendor_id: (plain as any).id }).eq('id', b.id);
  expect(bad1.error, '非公用事業應被擋').not.toBeNull();
  const bad2 = await clerk.from('ga_utility_bills').update({ payee_vendor_id: stopped.id }).eq('id', b.id);
  expect(bad2.error, '已停用應被擋').not.toBeNull();
  expect((await dbBill(b.id)).payee_vendor_id).toBe(payee.id);
  const ok = await clerk.from('ga_utility_bills').update({ payee_vendor_id: good.id }).eq('id', b.id);
  expect(ok.error).toBeNull();
  expect((await dbBill(b.id)).payee_vendor_id).toBe(good.id);
});

test('05 補填腳本在 DEV 實跑：補填、再補填不重複、只補空白與唯一對應；被請款單占用時撤回被擋，作廢後撤回乾淨', async () => {
  const clerk = users.clerk.client;
  const target = await seedPayee('BF');
  const filled = await seedPayee('BFOTHER');
  const mk = (over: Record<string, unknown>) => mkBill(clerk, { billing_month: '2038-07-01', amount: 300, payee_vendor_id: null, ...over });
  const b1 = await mk({ provider_name: target.name });
  const b2 = await mk({ provider_name: gaupName('NOMATCH') });
  const b3 = await mk({ provider_name: target.name, payee_vendor_id: filled.id });
  const b4 = await mk({ provider_name: target.name });
  okData(await callFn(clerk, 'ga_ws_ub_delete', { p_id: b4.id, p_reason: '補填測試刪除', p_confirm_paid_change: false, p_expected_updated_at: (await dbBill(b4.id)).updated_at }));
  expect((await dbBill(b1.id)).payee_vendor_id).toBeNull();

  const r1 = runSql(`${SQL_DIR}/05-backfill-payee.sql`);
  expect(r1.status, r1.out).toBe(0);
  expect((await dbBill(b1.id)).payee_vendor_id, '唯一對應者補填').toBe(target.id);
  expect((await dbBill(b2.id)).payee_vendor_id, '名稱對不上不動').toBeNull();
  expect((await dbBill(b3.id)).payee_vendor_id, '已有單位不動').toBe(filled.id);
  expect((await dbBill(b4.id)).payee_vendor_id, '已刪除不動').toBeNull();
  const n1 = await bakCount();
  expect(n1).toBeGreaterThanOrEqual(1);
  // 再補填：不重複、結果相同
  const r2 = runSql(`${SQL_DIR}/05-backfill-payee.sql`);
  expect(r2.status, r2.out).toBe(0);
  expect(await bakCount()).toBe(n1);
  expect((await dbBill(b1.id)).payee_vendor_id).toBe(target.id);
  // 補填後的帳單被放進有效請款單 → 撤回被擋
  const pr = okData(await callFn(clerk, 'ga_ws_pay_ub_create', { p_payload: { vendor_id: target.id, bill_month: '2038-07', bill_ids: [b1.id] }, p_key: crypto.randomUUID() }));
  const rb1 = runSql(`${SQL_DIR}/05-backfill-payee.rollback.sql`);
  expect(rb1.status, '被占用時應失敗').not.toBe(0);
  expect((await dbBill(b1.id)).payee_vendor_id, '撤回被擋時不動').toBe(target.id);
  expect(await bakCount(), '備份表仍在').toBeGreaterThanOrEqual(1);
  // 作廢請款單後可撤回：清回空白、備份表刪除、其他帳單不動
  okData(await callFn(clerk, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: 'void', p_payload: { reason: '補填測試' }, p_key: crypto.randomUUID(), p_expected_updated_at: pr.updated_at }));
  const rb2 = runSql(`${SQL_DIR}/05-backfill-payee.rollback.sql`);
  expect(rb2.status, rb2.out).toBe(0);
  expect((await dbBill(b1.id)).payee_vendor_id).toBeNull();
  expect((await dbBill(b3.id)).payee_vendor_id).toBe(filled.id);
  expect(await bakCount(), '備份表已刪（PostgREST 結構快取可能還回 0 筆，資料庫端另以 to_regclass 確認）').toBeLessThanOrEqual(0);
});
