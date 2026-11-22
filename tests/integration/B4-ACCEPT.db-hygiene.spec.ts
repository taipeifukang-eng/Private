import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';

// 第 4 批驗收（資料庫層，只讀檢查）：DEV 專案、採購核准權限碼存在且只有 DEV 種子角色或測試角色持有、流程設定預設值、
// 採購相關資料表都在、事件表不可改刪、測試資料沒有殘留。
const db = () => adminDb();

test.describe.configure({ mode: 'serial' });

test('連的是 DEV（專案代碼 mjpd 開頭）', async () => {
  await assertGaBaseline();
  expect(fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim().startsWith('mjpd')).toBe(true);
});

test('採購核准權限碼存在；持有它的角色只可能是 DEV 種子角色或測試用角色（不是任何門市或總務的正式角色）', async () => {
  const perm = (await db().from('permissions').select('id, code').eq('code', 'general_affairs.purchase_order.approve').single()).data as any;
  expect(perm?.code).toBe('general_affairs.purchase_order.approve');
  const rp = ((await db().from('role_permissions').select('role_id, is_allowed').eq('permission_id', perm.id)).data || []) as any[];
  const ids = rp.filter((r) => r.is_allowed).map((r) => r.role_id);
  if (ids.length) {
    const roles = ((await db().from('roles').select('id, name').in('id', ids)).data || []) as any[];
    for (const r of roles) expect(/^(vue_workspace_|m7m8_test_)|測試/.test(r.name), `角色 ${r.name} 不該持有採購核准`).toBe(true);
  }
});

test('流程設定預設值：門檻 5000、稅率 0.05、逾期 7 天、歷史價 5 筆', async () => {
  const rows = ((await db().from('ga_workflow_settings').select('key, value_num')).data || []) as any[];
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value_num)]));
  expect(m.po_approval_threshold).toBe(5000);
  expect(m.po_tax_rate).toBe(0.05);
  expect(m.request_overdue_confirm_days).toBe(7);
  expect(m.po_price_history_limit).toBe(5);
});

test('採購相關資料表都在；事件表不可更新與刪除', async () => {
  for (const t of ['ga_purchase_orders', 'ga_purchase_order_items', 'ga_purchase_order_events', 'ga_purchase_receipts', 'ga_purchase_receipt_items', 'ga_asset_transfer_moved_requests']) {
    const r = await db().from(t).select('*', { count: 'exact', head: true });
    expect(r.error, t).toBeNull();
  }
  const ev = (await db().from('ga_purchase_order_events').select('id').limit(1)).data as any[];
  if (ev?.length) {
    expect((await db().from('ga_purchase_order_events').update({ note: 'x' }).eq('id', ev[0].id)).error, '事件表不可更新').not.toBeNull();
    expect((await db().from('ga_purchase_order_events').delete().eq('id', ev[0].id)).error, '事件表不可刪除').not.toBeNull();
  }
});

test('測試資料沒有殘留（採購單的自動測試標記為 0）', async () => {
  expect(await cleanupM7M8()).toEqual([]);
  const r = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8%');
  expect(r.count).toBe(0);
});
