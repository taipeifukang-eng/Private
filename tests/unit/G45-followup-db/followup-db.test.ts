import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../../support/m7m8-fixtures';
import { anonClient } from '../../support/m7m8-po-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../../support/m7m8-ga45-fixtures';

// 第 4.5 批追加（驗收問卷 2026-11-20）資料庫層：F1 採購單總額上限、F3 付款日期 30 天規則、F6 廠商銀行修改歷程（含可見性）、F7 逾 14 天草稿提醒、尾差調低後送出重驗。
// 整合測試：連 DEV（只用 DEV，環境由 env-guard 檢查），測試廠商帶 QA-GA45- 標記、採購單備註帶 [自動測試]M7M8 標記；結束只清自己的（cleanupM7M8）。
// 這個檔案要有 TEST_RUN_ID；沒給就自己產生一個符合格式的（單獨執行 vitest 時用）。
const nodeRequire = createRequire(import.meta.url);
if (!process.env.TEST_RUN_ID) process.env.TEST_RUN_ID = (nodeRequire('../../support/registry.cjs') as { newRunId: () => string }).newRunId();

const KEYS: Ga45Key[] = ['clerk', 'novendor', 'payonly', 'vendor_mgr', 'vendor_view', 'nobody', 'admin'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let seq = 0;
let originalTol = 5;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const fn = (who: Ga45Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
function expectErr(r: any, status: number, code: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  expect(r.code, JSON.stringify(r)).toBe(code);
  expect(typeof r.error).toBe('string');
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
const taipeiDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ 前置資料
const itemId = (po: any, line: number) => po.items.find((i: any) => i.line_no === line).id as string;
async function mkPo(vendor: any, its: any[]) {
  const c = okData(await fn('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(`F45-${(seq += 1)}`), vendor_id: vendor.id }, p_items: its, p_create_key: key() }));
  return okData(await fn('clerk', 'ga_ws_po_action', { p_id: c.id, p_action: 'place_order', p_expected_updated_at: c.updated_at, p_note: null }));
}
async function recv(po: any, lines: any[]) {
  return okData(await fn('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: lines, p_key: key() }));
}
const newVendor = (suffix: string, over: Record<string, unknown> = {}) => seedGa45Vendor(`F${suffix}${(seq += 1)}`, over);
/** 一張進貨單、整張可請款的基本情境（品項一 10 個 x 100：未稅 1000、稅 50、含稅 1050）。 */
async function scene() {
  const vendor = await newVendor('S');
  const po = await mkPo(vendor, [{ item_name: 'QA-GA45 品項一', unit: '個', quantity: 10, unit_price: 100 }]);
  const receipt = await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 10 }]);
  return { vendor, po, receipt };
}
const create = (vendor: any, lines: any[], extra: Record<string, unknown> = {}) => fn('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines, ...extra }, p_key: key() });
const act = (pr: any, action: string, payload: Record<string, unknown> = {}) =>
  fn('clerk', 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: key(), p_expected_updated_at: pr.updated_at });
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
async function setTol(n: number) {
  const s = okData(await fn('clerk', 'ga_ws_pay_settings_get', {}));
  if (Number(s.tolerance_amount) === n) return;
  okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: n }, p_expected_updated_at: s.updated_at }));
}
let invSeq = 0;
async function goodInv(vendor: any, receipts: any[]) {
  const payload = { invoice_type: 'TRIPLE', invoice_no: `QA${String(Date.now()).slice(-6)}${String((invSeq += 1)).padStart(3, '0')}`, invoice_date: taipeiDate(new Date()), vendor_id: vendor.id, amount_untaxed: 1000, receipts: receipts.map((r) => ({ receipt_id: r.id })) };
  const inv = okData(await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: null, p_payload: payload, p_key: key() }));
  const id = crypto.randomUUID();
  const img = await users.clerk.client.from('ga_resource_attachments').insert({
    resource_type: 'PURCHASE_INVOICE', resource_id: inv.id, purpose: 'INVOICE_IMAGE', storage_path: `purchase_invoice/${inv.id}/invoice_image/${id}.png`, file_name: `m7m8t-${id}.png`,
    content_type: 'image/png', size_bytes: 100, uploaded_by: users.clerk.id,
  }).select('*').single();
  expect(img.error, JSON.stringify(img.error)).toBeNull();
  return okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id }));
}

beforeAll(async () => {
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  originalTol = Number(okData(await fn('clerk', 'ga_ws_pay_settings_get', {})).tolerance_amount);
}, 300_000);

afterAll(async () => {
  try {
    if (users.clerk) await setTol(originalTol);
  } finally {
    const left = await cleanupM7M8();
    const gone = await teardownUsers();
    const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
    expect(left, '清除總務測試資料').toEqual([]);
    expect(gone, '清除測試帳號與臨時角色').toEqual([]);
    expect(v.count, '測試廠商殘留').toBe(0);
  }
}, 300_000);

// ================================================================== F1
describe('F1 採購單含稅總額上限（累計請款 ≤ 採購單含稅總額 + 尾差；與累計驗入上限並存）', () => {
  it('分批進貨各自四捨五入使驗入含稅額高於採購單總額：尾差 0 擋下、尾差 1 放行；跨多張請款單累計；送出時也驗', async () => {
    // 採購單：3 個 x 10 元，未稅 30、稅 1.5 -> 2、含稅總額 32。分三次各收 1 個：每張未稅 10、稅 round(0.5) = 1，三張含稅合計 33（比採購單總額多 1 元）。
    const vendor = await newVendor('F1');
    const po = await mkPo(vendor, [{ item_name: 'QA-GA45 小額品項', unit: '個', quantity: 3, unit_price: 10 }]);
    expect(Number(po.total_amount)).toBe(32);
    const r1 = await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 1 }]);
    const r2 = await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 1 }]);
    const r3 = await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 1 }]);
    const line = (r: any) => ({ receipt_id: r.id });
    try {
      await setTol(0);
      // 預設口徑：每張進貨 11，單張與兩張合計沒超過 32
      const a = okData(await create(vendor, [line(r1), line(r2)]));
      expect(Number(a.amount_total)).toBe(22);
      // 第三張：累計 33 沒超過累計驗入 33，但超過採購單總額 32 + 尾差 0 -> OVER_PO_TOTAL（跨請款單累計）
      const over = await create(vendor, [line(r3)]);
      expectErr(over, 409, 'OVER_PO_TOTAL');
      expect(over).toMatchObject({ po_total: 32, claimed_total: 33, tolerance: 0 });
      expect(over.error).toContain('採購單含稅總額');
      // 尾差 1：剛好放行（33 ≤ 32 + 1）
      await setTol(1);
      const b = okData(await create(vendor, [line(r3)]));
      expect(Number(b.amount_total)).toBe(11);
      // 尾差調回 0 後送出請款單 a：總額 33 > 32 + 0，送出時重驗擋下；請款單仍是草稿
      await setTol(0);
      expectErr(await act(a, 'submit'), 409, 'OVER_PO_TOTAL');
      expect((await dbPr(a.id)).status).toBe('DRAFT');
      // 作廢草稿 b 釋放額度（非作廢才計）：a 單獨 22 可送出
      okData(await act(b, 'void'));
      okData(await act(a, 'submit'));
    } finally {
      await setTol(originalTol);
    }
  }, 180_000);

  it('尾差 5：驗入含稅額只高 1 元仍可全額請款（既有分批進貨不被誤擋）；超過累計驗入仍回 OVER_CLAIM（錯誤碼不變）', async () => {
    const vendor = await newVendor('F1b');
    const po = await mkPo(vendor, [{ item_name: 'QA-GA45 小額品項', unit: '個', quantity: 3, unit_price: 10 }]);
    const rs = [];
    for (let i = 0; i < 3; i += 1) rs.push(await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 1 }]));
    await setTol(5);
    const all = okData(await create(vendor, rs.map((r) => ({ receipt_id: r.id }))));
    expect(Number(all.amount_total)).toBe(33);
    // 再多請一筆（同一張進貨再請）：累計 44 > 驗入 33 + 5 -> OVER_CLAIM，不是 OVER_PO_TOTAL
    expectErr(await create(vendor, [{ receipt_id: rs[0].id }]), 409, 'OVER_CLAIM');
  }, 180_000);
});

// ================================================================== F3
describe('F3 付款日期：可早於請款單建立日最多 30 天、不可是未來', () => {
  async function submitted() {
    const { vendor, receipt } = await scene();
    const pr = okData(await create(vendor, [{ receipt_id: receipt.id }]));
    const sub = okData(await act(pr, 'submit'));
    const created = taipeiDate(new Date((await dbPr(pr.id)).created_at));
    return { sub, created };
  }
  const pay = (pr: any, paid_date: string) => act(pr, 'mark_paid', { pay_method: 'TRANSFER', paid_date });

  it('建立日前 30 天可、前 31 天擋下（含最早可填日提示）、未來擋下', async () => {
    const { sub, created } = await submitted();
    const tooEarly = await pay(sub, addDays(created, -31));
    expectErr(tooEarly, 400, 'PAID_TOO_EARLY');
    expect(tooEarly.error).toContain('30 天');
    expect(tooEarly.error).toContain(addDays(created, -30));
    expectErr(await pay(sub, addDays(taipeiDate(new Date()), 1)), 400, 'PAID_FUTURE');
    const ok = okData(await pay(sub, addDays(created, -30)));
    expect(ok.status).toBe('PAID');
    expect(ok.paid_date).toBe(addDays(created, -30));
  }, 120_000);

  it('建立日當天與前 1 天可；前 29 天可', async () => {
    for (const offset of [0, -1, -29]) {
      const { sub, created } = await submitted();
      const r = okData(await pay(sub, addDays(created, offset)));
      expect(r.status).toBe('PAID');
      expect(r.paid_date).toBe(addDays(created, offset));
    }
  }, 180_000);
});

// ================================================================== 尾差調低重驗（假設 a）
describe('尾差調低後，未送出的草稿在送出時用新尾差重驗；已送出的不受影響', () => {
  it('草稿原本在尾差內免填差異原因；尾差調低後送出被擋，補原因後可送出；已送出者不受影響', async () => {
    const { vendor, receipt } = await scene();
    try {
      await setTol(5);
      const inv = await goodInv(vendor, [receipt]);
      const alloc = Number(inv.receipts?.[0]?.allocated_untaxed ?? NaN) + Number(inv.receipts?.[0]?.allocated_tax ?? NaN);
      expect(Number.isFinite(alloc), JSON.stringify(inv.receipts)).toBe(true);
      // 請款額比發票分攤少 3 元：尾差 5 內免原因
      const tax = alloc - 1000 - 3;
      const mk = () => create(vendor, [{ receipt_id: receipt.id, invoice_id: inv.id, claim_untaxed: 1000, claim_tax: tax }]);
      const d1 = okData(await mk());
      expect(d1.lines[0].diff_reason ?? null).toBeNull();
      // 另一張已送出的請款單（同一進貨，額度內：用 0 額度很小的第二張比較複雜，所以先送出 d1，再讓 d2 作為草稿被擋）
      const d1s = okData(await act(d1, 'submit')); // 尾差 5 內，送出成功
      // 尾差調低到 2 後：新草稿（相差 3 > 2）建立時就要差異原因
      await setTol(2);
      expectErr(await mk(), 400, 'DIFF_REASON_REQUIRED');
      // d1 已送出，不受尾差調整影響：仍是 SUBMITTED
      expect((await dbPr(d1.id)).status).toBe('SUBMITTED');
      // 退回 d1 成草稿，尾差維持 2：送出時重驗擋下；補差異原因（修改草稿）後可送出
      const back = okData(await act(d1s, 'return', { reason: '重驗測試' }));
      expectErr(await act(back, 'submit'), 400, 'DIFF_REASON_REQUIRED');
      const upd = okData(await fn('clerk', 'ga_ws_pay_request_update', { p_id: back.id, p_payload: { lines: [{ receipt_id: receipt.id, invoice_id: inv.id, claim_untaxed: 1000, claim_tax: tax, diff_reason: '運費調整' }] }, p_expected_updated_at: back.updated_at }));
      okData(await act(upd, 'submit'));
    } finally {
      await setTol(originalTol);
    }
  }, 180_000);

  it('草稿在尾差內建立（免原因）後，尾差調低到不夠，送出被擋（草稿沒被改動）', async () => {
    const { vendor, receipt } = await scene();
    try {
      await setTol(5);
      const inv = await goodInv(vendor, [receipt]);
      const alloc = Number(inv.receipts[0].allocated_untaxed) + Number(inv.receipts[0].allocated_tax);
      const draft = okData(await create(vendor, [{ receipt_id: receipt.id, invoice_id: inv.id, claim_untaxed: 1000, claim_tax: alloc - 1000 - 4 }]));
      await setTol(1);
      const r = await act(draft, 'submit');
      expectErr(r, 400, 'DIFF_REASON_REQUIRED');
      expect(r.error).toContain('尾差');
      expect((await dbPr(draft.id)).status).toBe('DRAFT');
      await setTol(5);
      okData(await act(draft, 'submit'));
    } finally {
      await setTol(originalTol);
    }
  }, 180_000);
});

// ================================================================== F6
describe('F6 廠商銀行修改歷程（觸發器寫入；只有廠商查看／管理權限讀得到）', () => {
  const log = (who: Ga45Key, id: string, page = 1, size = 20) => fn(who, 'ga_ws_vendor_bank_log', { p_vendor_id: id, p_page: page, p_page_size: size });

  it('新增廠商記一筆 INSERT；經 ga_ws_vendor_save 修改銀行欄位記舊值與新值與修改人；改非銀行欄位不記', async () => {
    const vendor = await newVendor('F6');
    let rows = okData(await log('vendor_mgr', vendor.id)).rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ op: 'INSERT', changed_by: null, old: { bank_name: null, bank_account: null }, new: { bank_name: '測試銀行', bank_account: '123-456-789012' } });
    expect(rows[0].changed_fields).toEqual(['bank_account', 'bank_account_name', 'bank_branch', 'bank_name']);

    const got = okData(await fn('vendor_mgr', 'ga_ws_vendor_get', { p_id: vendor.id }));
    const saved = okData(await fn('vendor_mgr', 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { bank_name: '第一銀行', bank_account: '999-888-777' }, p_expected_updated_at: got.updated_at }));
    rows = okData(await log('vendor_mgr', vendor.id)).rows as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      op: 'UPDATE', changed_by: users.vendor_mgr.id, changed_fields: ['bank_account', 'bank_name'],
      old: { bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試戶名' },
      new: { bank_name: '第一銀行', bank_branch: '測試分行', bank_account: '999-888-777', bank_account_name: '測試戶名' },
    });
    expect(typeof rows[0].changed_by_name).toBe('string');
    expect(new Date(rows[0].changed_at).getTime()).toBeGreaterThan(Date.now() - 60_000);

    // 改非銀行欄位（備註、付款條件）不記
    okData(await fn('vendor_mgr', 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { payment_terms: '月結 60 天' }, p_expected_updated_at: saved.updated_at }));
    expect(okData(await log('vendor_mgr', vendor.id)).total).toBe(2);
    // 帳號沒變的重複儲存不記
    const again = okData(await fn('vendor_mgr', 'ga_ws_vendor_get', { p_id: vendor.id }));
    okData(await fn('vendor_mgr', 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { bank_name: '第一銀行', bank_account: '999-888-777' }, p_expected_updated_at: again.updated_at }));
    expect(okData(await log('vendor_mgr', vendor.id)).total).toBe(2);
  }, 120_000);

  it('任何路徑都留紀錄：service role 直接改銀行欄位也記（修改人留空，不算到上一位編輯者頭上）', async () => {
    const vendor = await newVendor('F6b');
    const got = okData(await fn('vendor_mgr', 'ga_ws_vendor_get', { p_id: vendor.id }));
    okData(await fn('vendor_mgr', 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { bank_branch: '新分行' }, p_expected_updated_at: got.updated_at }));
    const up = await db().from('ga_vendors').update({ bank_account: '000-111' }).eq('id', vendor.id);
    expect(up.error).toBeNull();
    const rows = okData(await log('vendor_mgr', vendor.id)).rows as any[];
    expect(rows[0]).toMatchObject({ op: 'UPDATE', changed_by: null, changed_fields: ['bank_account'], new: { bank_account: '000-111' }, old: { bank_account: '123-456-789012' } });
    expect(rows).toHaveLength(3);
    // 分頁
    const p1 = okData(await log('vendor_mgr', vendor.id, 1, 2));
    expect(p1.rows).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(okData(await log('vendor_mgr', vendor.id, 2, 2)).rows).toHaveLength(1);
  }, 120_000);

  it('可見性：廠商查看與管理者可讀；沒有廠商權限者（只有請款檢視、無關權限、profiles.role=admin 但沒有角色、有請款管理但沒有廠商權限的角色）一律 403；未登入讀不到；表本身不能直接讀', async () => {
    const vendor = await newVendor('F6c');
    expect(okData(await log('vendor_view', vendor.id)).total).toBe(1);
    expect(okData(await log('vendor_mgr', vendor.id)).total).toBe(1);
    for (const who of ['payonly', 'nobody', 'admin', 'novendor'] as Ga45Key[]) expectErr(await log(who, vendor.id), 403, 'PERMISSION_DENIED');
    expectErr(await log('vendor_view', crypto.randomUUID()), 404, 'NOT_FOUND');
    const anon = await callFn(anonClient(), 'ga_ws_vendor_bank_log', { p_vendor_id: vendor.id });
    expect(anon.ok).toBe(false);
    expect(anon.data).toBeUndefined();
    // 登入者直接讀表：沒有權限（RLS 開且沒有 policy，且已撤銷權限），拿不到任何資料
    for (const who of ['vendor_mgr', 'vendor_view', 'payonly'] as Ga45Key[]) {
      const direct = await users[who].client.from('ga_vendor_bank_changes').select('*').eq('vendor_id', vendor.id);
      expect(direct.data === null || direct.data.length === 0, `${who} 不應讀到歷程列`).toBe(true);
      const ins = await users[who].client.from('ga_vendor_bank_changes').insert({ vendor_id: vendor.id, op: 'UPDATE' });
      expect(ins.error).not.toBeNull();
    }
    // 與廠商頁一致：沒有廠商權限者本來就看不到銀行欄位
    expectErr(await fn('payonly', 'ga_ws_vendor_get', { p_id: vendor.id }), 403, 'PERMISSION_DENIED');
  }, 120_000);

  it('歷程不可改刪（UPDATE、DELETE、TRUNCATE 都擋）；刪廠商時歷程連鎖刪除', async () => {
    const vendor = await newVendor('F6d');
    const row = (await db().from('ga_vendor_bank_changes').select('id').eq('vendor_id', vendor.id).single()).data as any;
    const upd = await db().from('ga_vendor_bank_changes').update({ op: 'INSERT', old_bank: {} }).eq('id', row.id);
    expect(upd.error?.message).toContain('不可修改或刪除');
    const del = await db().from('ga_vendor_bank_changes').delete().eq('id', row.id);
    expect(del.error?.message).toContain('不可修改或刪除');
    const rm = await db().from('ga_vendors').delete().eq('id', vendor.id);
    expect(rm.error, JSON.stringify(rm.error)).toBeNull();
    const left = await db().from('ga_vendor_bank_changes').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id);
    expect(left.count).toBe(0);
  }, 120_000);
});

// ================================================================== F7
describe('F7 逾 14 天未送出的請款草稿提醒（首頁待辦與列表篩選共用同一個述詞，只給請款檢視／管理）', () => {
  const stale = async (who: Ga45Key) => {
    const s = await fn(who, 'ga_ws_home_summary', {});
    const items = (okData(s).items || []) as any[];
    return items.find((i) => i.key === 'pay_stale_draft') as any | undefined;
  };
  const backdate = (id: string, days: number) => db().from('ga_payment_requests').update({ created_at: new Date(Date.now() - days * 86_400_000).toISOString() }).eq('id', id);
  const listStale = async (vendor: any) => okData(await fn('payonly', 'ga_ws_pay_request_list', { p_filters: { stale_draft: 'true', vendor_id: vendor.id }, p_page: 1, p_page_size: 20 }));

  it('草稿放 14 天不算、15 天算；篩選 stale_draft 與待辦數字一致；沒有請款權限看不到', async () => {
    const { vendor, receipt } = await scene();
    const before = (await stale('payonly'))?.count ?? 0;
    const pr = okData(await create(vendor, [{ receipt_id: receipt.id }]));
    expect((await stale('payonly'))?.count ?? 0).toBe(before);
    expect((await listStale(vendor)).total).toBe(0);
    expect((await backdate(pr.id, 14)).error).toBeNull();
    expect((await stale('payonly'))?.count ?? 0).toBe(before);
    expect((await backdate(pr.id, 15)).error).toBeNull();
    const item = await stale('payonly');
    expect(item.count).toBe(before + 1);
    expect(item.menu).toBe('payment_requests');
    expect(item.label).toContain('14 天');
    const l = await listStale(vendor);
    expect(l.total).toBe(1);
    expect(l.rows[0].id).toBe(pr.id);
    expect(l.rows).toHaveLength(1);
    // 不是 stale 的篩選回全部（沒有被誤用）
    const all = okData(await fn('payonly', 'ga_ws_pay_request_list', { p_filters: { vendor_id: vendor.id }, p_page: 1, p_page_size: 20 }));
    expect(all.total).toBe(1);
    // 沒有請款權限的人：首頁沒有這個待辦
    expect(await stale('nobody')).toBeUndefined();
    expect(await stale('vendor_mgr')).toBeUndefined();
    // 請款管理者（clerk）也看得到
    expect((await stale('clerk'))?.count).toBe(before + 1);
    // 導覽徽章維持待付款（SUBMITTED）口徑：草稿不計入
    const badges = okData(await fn('payonly', 'ga_ws_home_badges', {}));
    const subBefore = Number(badges.payment_requests ?? badges.badges?.payment_requests ?? 0);
    expect(Number.isFinite(subBefore)).toBe(true);
  }, 180_000);

  it('已送出的不算；退回後的草稿從退回那天重新計算；作廢的不算', async () => {
    const { vendor, receipt } = await scene();
    const before = (await stale('payonly'))?.count ?? 0;
    const pr = okData(await create(vendor, [{ receipt_id: receipt.id }]));
    expect((await backdate(pr.id, 20)).error).toBeNull();
    expect((await stale('payonly'))?.count).toBe(before + 1);
    // 送出：不再是草稿
    const sub = okData(await act(pr, 'submit'));
    expect((await stale('payonly'))?.count ?? 0).toBe(before);
    // 退回：以退回時間重新計算，不是 stale（建立日雖然是 20 天前）
    const back = okData(await act(sub, 'return', { reason: '補資料' }));
    expect(back.status).toBe('DRAFT');
    expect((await stale('payonly'))?.count ?? 0).toBe(before);
    // 把退回時間也往前推 15 天：又算
    expect((await db().from('ga_payment_requests').update({ last_return_at: new Date(Date.now() - 15 * 86_400_000).toISOString() }).eq('id', pr.id)).error).toBeNull();
    expect((await stale('payonly'))?.count).toBe(before + 1);
    // 作廢：不算
    okData(await act(await dbPr(pr.id), 'void'));
    expect((await stale('payonly'))?.count ?? 0).toBe(before);
  }, 180_000);
});
