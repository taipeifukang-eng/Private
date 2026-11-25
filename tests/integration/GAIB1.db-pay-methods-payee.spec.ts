import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { call, cleanupGaib1, cleanupM7Users, expectErr, key, mkPo, okData, prAct, prGet, receive, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1 階段 4（資料庫層）：G4 付款方式（信用卡末四碼、網購平台）與同仁代墊。
// 涵蓋：新付款方式與欄位互斥／格式驗證、已付款後鎖定；同仁代墊（草稿指定與改回廠商、廠商與銀行快照維持原樣、送出要有同仁帳戶、同仁帳戶遮蔽、標已付款的人不可是付款對象本人、
//      代墊單不可用信用卡或網購、送出後付款對象鎖定）；同仁匯款帳戶（本人讀寫、請款管理加廠商檢視才能代登錄與查看、事件不含帳號本文）；同仁挑選與「我的代墊款」；對帳匯出 extended 欄位（預設欄位不變）。
// 測試資料：廠商名稱帶 QA-GAIB1- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'novendor', 'payonly', 'nobody', 'perf_nopay', 'vendor_view', 'admin'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let vendor: any;

test.beforeAll(async () => {
  await assertGaBaseline();
  const left = await cleanupGaib1();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupGa45Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  vendor = await seedGaib1Vendor('PAYEE');
});
test.afterAll(async () => {
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
  expect(await cleanupM7Users(), '清除測試帳號（殘留）').toEqual([]);
});

const clerk = () => users.clerk;
const accountant = () => users.accountant;
const empA = () => users.nobody;
const empB = () => users.perf_nopay;
const ACCT = { bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試同仁' };

/** 一張已送出的一般請款單（不指定代墊）。 */
async function mkSubmitted(notes: string, payload: Record<string, unknown> = {}) {
  const po = await mkPo(clerk(), vendor, { notes });
  const rc = await receive(clerk(), po);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], ...payload }, p_key: key() }));
  return { po, rc, pr };
}

test('付款方式：信用卡（末四碼）與網購平台，欄位互斥與格式驗證', async () => {
  const { pr } = await mkSubmitted('pm1');
  const sub = okData(await prAct(clerk(), pr, 'submit'));
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'BITCOIN' }), 400, 'PAY_METHOD');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'TRANSFER', card_last4: '1234' }), 400, 'PAY_FIELD_MISMATCH');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'CREDIT_CARD', platform: '蝦皮' }), 400, 'PAY_FIELD_MISMATCH');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'CREDIT_CARD', card_last4: '12ab' }), 400, 'CARD_LAST4');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'CREDIT_CARD', card_last4: '1234567890123456' }), 400, 'CARD_LAST4');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'ONLINE_PLATFORM', platform: 'x'.repeat(41) }), 400, 'PLATFORM_TOO_LONG');
  const paid = okData(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'CREDIT_CARD', card_last4: '4321', paid_ref: 'CARD-REF' }));
  expect(paid).toMatchObject({ status: 'PAID', pay_method: 'CREDIT_CARD', pay_card_last4: '4321', pay_platform: null });
  // 已付款後付款資訊鎖定（直接寫資料表也不行）
  const direct = await adminDb().from('ga_payment_requests').update({ pay_card_last4: '9999' }).eq('id', pr.id);
  expect(direct.error?.message || '').toContain('付款資訊不能修改');
  // 卡號末四碼不是完整卡號：資料表不接受長字串
  const bad = await adminDb().from('ga_payment_requests').update({ pay_card_last4: '1234567' }).eq('id', pr.id);
  expect(bad.error).toBeTruthy();

  const { pr: pr2 } = await mkSubmitted('pm2');
  const sub2 = okData(await prAct(clerk(), pr2, 'submit'));
  const paid2 = okData(await prAct(accountant(), sub2, 'mark_paid', { pay_method: 'ONLINE_PLATFORM', platform: '蝦皮購物', paid_ref: 'ORDER-123' }));
  expect(paid2).toMatchObject({ status: 'PAID', pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮購物', pay_card_last4: null });
  // 原有三種方式照舊（不帶新欄位）
  const { pr: pr3 } = await mkSubmitted('pm3');
  const sub3 = okData(await prAct(clerk(), pr3, 'submit'));
  const paid3 = okData(await prAct(accountant(), sub3, 'mark_paid', { pay_method: 'check' }));
  expect(paid3).toMatchObject({ pay_method: 'CHECK', pay_card_last4: null, pay_platform: null });
});

test('同仁匯款帳戶：本人讀寫、格式驗證、事件不含帳號本文', async () => {
  // 沒登入權限的人（只是同仁）可以讀寫自己的，看不到別人的
  expect(okData(await call(empA(), 'ga_ws_payout_account_get_own')).account).toBeNull();
  expectErr(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { bank_name: '銀行' } }), 400, 'FIELD_REQUIRED');
  expectErr(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { ...ACCT, bank_account: 'ABC' } }), 400, 'ACCOUNT_FORMAT');
  expectErr(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { ...ACCT, bank_account: '1'.repeat(31) } }), 400, 'ACCOUNT_FORMAT');
  const set = okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: ACCT }));
  expect(set.account_last4).toBe('9012');
  expect(set.changed_fields).toContain('bank_account');
  const own = okData(await call(empA(), 'ga_ws_payout_account_get_own'));
  expect(own.account).toMatchObject(ACCT);
  // 沒改動：不新增事件
  const same = okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: ACCT }));
  expect(same.changed_fields).toEqual([]);
  const upd = okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { bank_account: '999-888-777666' } }));
  expect(upd.changed_fields).toEqual(['bank_account']);
  okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { bank_account: ACCT.bank_account } }));
  // 事件：記哪些欄位變了與末四碼，不含帳號本文
  const ev = await adminDb().from('ga_employee_payout_account_events').select('*').eq('profile_id', empA().id).order('created_at');
  expect(ev.data!.length).toBe(3);
  const text = JSON.stringify(ev.data);
  expect(text).not.toContain('123-456-789012');
  expect(text).not.toContain('999-888-777666');
  expect(ev.data![0].via).toBe('SELF');
  // 事件不可修改刪除
  const del = await adminDb().from('ga_employee_payout_account_events').delete().eq('profile_id', empA().id);
  expect(del.error?.message || '').toContain('不可修改或刪除');
  // 代登錄與查看別人的帳戶：要請款管理加廠商帳務檢視
  for (const who of [users.novendor, users.payonly, users.nobody, users.vendor_view, users.admin]) {
    expectErr(await call(who, 'ga_ws_payout_account_get_for', { p_profile: empA().id }), 403, 'PERMISSION_DENIED');
    expectErr(await call(who, 'ga_ws_payout_account_set_for', { p_profile: empB().id, p_payload: ACCT }), 403, 'PERMISSION_DENIED');
  }
  expect(okData(await call(accountant(), 'ga_ws_payout_account_get_for', { p_profile: empA().id })).account).toMatchObject({ bank_account: ACCT.bank_account });
  const proxy = okData(await call(accountant(), 'ga_ws_payout_account_set_for', { p_profile: empB().id, p_payload: { ...ACCT, bank_account_name: '同仁乙' } }));
  expect(proxy.account_last4).toBe('9012');
  const ev2 = await adminDb().from('ga_employee_payout_account_events').select('via,actor_id').eq('profile_id', empB().id);
  expect(ev2.data![0]).toMatchObject({ via: 'PROXY', actor_id: accountant().id });
  expectErr(await call(accountant(), 'ga_ws_payout_account_set_for', { p_profile: crypto.randomUUID(), p_payload: ACCT }), 404, 'PAYEE_NOT_FOUND');
  // 同仁本人看不到別人的帳戶（RPC 只回自己的）
  expect(okData(await call(empB(), 'ga_ws_payout_account_get_own')).account).toMatchObject({ bank_account_name: '同仁乙' });
});

test('同仁挑選：要請款管理、可搜尋、顯示有沒有帳戶但不含帳戶內容', async () => {
  expectErr(await call(users.nobody, 'ga_ws_pay_employee_options', { p_q: null, p_page: 1 }), 403, 'PERMISSION_DENIED');
  expectErr(await call(users.payonly, 'ga_ws_pay_employee_options', { p_q: null, p_page: 1 }), 403, 'PERMISSION_DENIED');
  const r = okData(await call(clerk(), 'ga_ws_pay_employee_options', { p_q: 'GA45 nobody', p_page: 1 }));
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({ id: empA().id, has_account: true });
  expect(JSON.stringify(r)).not.toContain('123-456');
  const none = okData(await call(clerk(), 'ga_ws_pay_employee_options', { p_q: 'GA45 perf_nopay', p_page: 1 }));
  expect(none.rows[0].has_account).toBe(true); // empB 已由會計代登錄
  expect(okData(await call(clerk(), 'ga_ws_pay_employee_options', { p_q: null, p_page: 1 })).rows.length).toBeGreaterThan(0);
});

test('同仁代墊：草稿指定付款對象、送出要有帳戶、帳戶遮蔽、付款人不可是本人、付款方式限制、送出後鎖定', async () => {
  // 先把同仁 A 的帳戶移掉（直接用 service role 準備情境）來驗證 PAYEE_NO_ACCOUNT
  await adminDb().from('ga_employee_payout_accounts').delete().eq('profile_id', empA().id);
  const { po, rc, pr } = await mkSubmitted('payee1', { payee_type: 'EMPLOYEE', payee_profile_id: empA().id });
  expect(pr).toMatchObject({ payee_type: 'EMPLOYEE', payee_profile_id: empA().id, payee_account_snapshot: {} });
  expect(pr.payee_name_snapshot).toContain('M7M8 GA45 nobody');
  // 廠商仍記在請款單上，銀行快照是廠商的（沒被同仁取代）
  expect(pr.vendor_id).toBe(vendor.id);
  expect(pr.bank_snapshot.bank_account).toBe('123-456-789012');
  expectErr(await prAct(clerk(), pr, 'submit'), 409, 'PAYEE_NO_ACCOUNT');
  // 同仁登錄帳戶後，重抓帳戶快照（草稿專用）再送出
  okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: ACCT }));
  const refreshed = okData(await prAct(clerk(), pr, 'refresh_bank'));
  expect(refreshed.payee_account_snapshot).toMatchObject({ bank_account: ACCT.bank_account });
  const sub = okData(await prAct(clerk(), refreshed, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
  // 遮蔽：請款管理但沒有廠商帳務檢視者看不到同仁帳戶本文，只露末四碼
  const masked = await prGet(users.novendor, pr.id);
  expect(masked.payee_account_masked).toBe(true);
  expect(masked.payee_account_snapshot).toEqual({});
  expect(masked.payee_account_last4).toBe('9012');
  expect(masked.payee_name).toContain('M7M8 GA45 nobody');
  expect(JSON.stringify(masked)).not.toContain('123-456-789012');
  // 有廠商帳務檢視者看得到
  const full = await prGet(accountant(), pr.id);
  expect(full.payee_account_masked).toBe(false);
  expect(full.payee_account_snapshot).toMatchObject({ bank_account: ACCT.bank_account });
  // 列表也走同一個遮蔽
  const lst = okData(await call(users.novendor, 'ga_ws_pay_request_list', { p_filters: { payee_type: 'EMPLOYEE' }, p_page: 1, p_page_size: 50 }));
  const row = lst.rows.find((x: any) => x.id === pr.id);
  expect(row.payee_account_snapshot).toEqual({});
  expect(row.payee_type).toBe('EMPLOYEE');
  expect(okData(await call(clerk(), 'ga_ws_pay_request_list', { p_filters: { payee_type: 'VENDOR' }, p_page: 1, p_page_size: 100 })).rows.some((x: any) => x.id === pr.id)).toBe(false);
  // 送出後付款對象鎖定
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { payee_type: 'VENDOR' }, p_expected_updated_at: sub.updated_at }), 409, 'INVALID_STATE');
  const direct = await adminDb().from('ga_payment_requests').update({ payee_type: 'VENDOR', payee_profile_id: null }).eq('id', pr.id);
  expect(direct.error?.message || '').toContain('付款對象不能修改');
  // 代墊單不可用信用卡或網購平台
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'CREDIT_CARD', card_last4: '1111' }), 400, 'PAY_METHOD');
  expectErr(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'ONLINE_PLATFORM' }), 400, 'PAY_METHOD');
  const paid = okData(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'REIMB-1' }));
  expect(paid).toMatchObject({ status: 'PAID', payee_type: 'EMPLOYEE' });
  expect(po.vendor_id).toBe(vendor.id);
  expect(rc.po_id).toBe(po.id);

  // 付款的人不可是付款對象本人（會計自己是代墊同仁）
  const s2 = await mkSubmitted('payee2', { payee_type: 'EMPLOYEE', payee_profile_id: accountant().id });
  expectErr(await prAct(clerk(), s2.pr, 'submit'), 409, 'PAYEE_NO_ACCOUNT');
  okData(await call(accountant(), 'ga_ws_payout_account_set_own', { p_payload: { ...ACCT, bank_account_name: '會計本人' } }));
  const re2 = okData(await prAct(clerk(), s2.pr, 'refresh_bank'));
  const sub2 = okData(await prAct(clerk(), re2, 'submit'));
  expectErr(await prAct(accountant(), sub2, 'mark_paid', { pay_method: 'TRANSFER' }), 403, 'SELF_PAYEE');
  const paid2 = okData(await prAct(clerk(), sub2, 'mark_paid', { pay_method: 'CASH' }));
  expect(paid2.status).toBe('PAID');
  // 草稿可以改回廠商（付款對象欄位清回預設）
  const s3 = await mkSubmitted('payee3', { payee_type: 'EMPLOYEE', payee_profile_id: empB().id });
  expect(s3.pr.payee_profile_id).toBe(empB().id);
  const back = okData(await call(clerk(), 'ga_ws_pay_request_update', { p_id: s3.pr.id, p_payload: { payee_type: 'VENDOR' }, p_expected_updated_at: s3.pr.updated_at }));
  expect(back).toMatchObject({ payee_type: 'VENDOR', payee_profile_id: null, payee_name_snapshot: null, payee_account_snapshot: {} });
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: s3.pr.id, p_payload: { payee_type: 'FRIEND' }, p_expected_updated_at: back.updated_at }), 400, 'PAYEE_TYPE');
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: s3.pr.id, p_payload: { payee_type: 'EMPLOYEE', payee_profile_id: crypto.randomUUID() }, p_expected_updated_at: back.updated_at }), 404, 'PAYEE_NOT_FOUND');
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: s3.pr.id, p_payload: { payee_type: 'EMPLOYEE' }, p_expected_updated_at: back.updated_at }), 400);
});

test('我的代墊款：只回付款對象是自己、已送出以後、不含廠商帳戶與統編', async () => {
  const mine = okData(await call(empA(), 'ga_ws_pay_my_reimbursements', { p_page: 1, p_page_size: 20 }));
  expect(mine.total).toBe(1);
  expect(mine.rows[0]).toMatchObject({ status: 'PAID', source: 'PURCHASE' });
  expect(Object.keys(mine.rows[0]).sort()).toEqual(['amount_total', 'created_at', 'id', 'paid_date', 'pr_no', 'source', 'status', 'vendor_name']);
  expect(JSON.stringify(mine)).not.toContain(vendor.tax_id);
  expect(JSON.stringify(mine)).not.toContain('123-456-789012');
  // 草稿不顯示
  const myDraft = okData(await call(empB(), 'ga_ws_pay_my_reimbursements', { p_page: 1, p_page_size: 20 }));
  expect(myDraft.total).toBe(0);
  // 沒有任何權限的人也能呼叫，但只看到自己的；未登入不行
  expect(okData(await call(users.payonly, 'ga_ws_pay_my_reimbursements', { p_page: 1, p_page_size: 20 })).total).toBe(0);
  const anon = await adminDb().rpc('ga_ws_pay_my_reimbursements', { p_page: 1, p_page_size: 20 });
  expect(anon.error || anon.data?.ok === false).toBeTruthy();
});

test('對帳匯出：預設欄位不變、extended 才多付款對象與付款方式欄位', async () => {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const plain = okData(await call(accountant(), 'ga_ws_pay_export', { p_filters: { month, vendor_id: vendor.id } }));
  const ext = okData(await call(accountant(), 'ga_ws_pay_export', { p_filters: { month, vendor_id: vendor.id, extended: '1' } }));
  expect(plain.rows.length).toBeGreaterThan(0);
  expect(plain.rows.length).toBe(ext.rows.length);
  const baseKeys = Object.keys(plain.rows[0]).sort();
  expect(Object.keys(ext.rows[0]).sort().filter((k) => baseKeys.includes(k))).toEqual(baseKeys);
  expect(baseKeys).not.toContain('payee_type');
  const emp = ext.rows.find((r: any) => r.payee_type === 'EMPLOYEE');
  expect(emp).toBeTruthy();
  expect(emp.payee_name).toContain('M7M8 GA45');
  expect(emp.payee_bank_account).toBeTruthy(); // 會計有廠商帳務檢視
  const card = ext.rows.find((r: any) => r.card_last4 === '4321');
  expect(card.pay_method).toBe('CREDIT_CARD');
  expect(ext.rows.find((r: any) => r.platform === '蝦皮購物')).toBeTruthy();
  // 沒有廠商帳務檢視者：同仁帳戶欄位整欄省略
  const ext2 = okData(await call(users.novendor, 'ga_ws_pay_export', { p_filters: { month, vendor_id: vendor.id, extended: '1' } }));
  expect(ext2.rows.some((r: any) => 'payee_bank_account' in r)).toBe(false);
  expect(ext2.rows.find((r: any) => r.payee_type === 'EMPLOYEE')).toBeTruthy();
});
