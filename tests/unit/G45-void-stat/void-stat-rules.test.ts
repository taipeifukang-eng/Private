import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { receiptVoidBlock, validateReceiptVoidPayload } from '@/lib/workspace/general-affairs/purchase-receipt-rules';
import { DEFAULT_TOLERANCE, isPayUnclaimed, unclaimedAmount } from '@/lib/workspace/general-affairs/payment-rules';
import { BADGE_MENUS, BADGE_MENU_KIND, HOME_ITEMS, HOME_ITEM_KEYS, MENU_PAYLOAD, homeTotal } from '@/lib/workspace/general-affairs/home-rules';

// 第 4.5 批 G45-unit（作廢進貨與統計部分）：作廢進貨輸入驗證與前端預判、待請款判斷（尾差邊界）、首頁與徽章新增兩項、
// DEV SQL 與正式區草稿的結構檢查（條件、權限、函式不帶固定 search_path、rollback 與草稿齊全）。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'void-key-1';
const OK = { reason: '進貨登錯品項', idempotency_key: KEY, expected_updated_at: '2038-03-01T10:00:00.000Z' };

describe('作廢進貨輸入驗證', () => {
  it('合法內容通過並去除前後空白', () => {
    expect(validateReceiptVoidPayload({ ...OK, reason: '  進貨登錯品項  ' })).toEqual(OK);
  });
  it('原因必填、最多 200 字', () => {
    expect(() => validateReceiptVoidPayload({ ...OK, reason: '' })).toThrow('必須填寫原因');
    expect(() => validateReceiptVoidPayload({ ...OK, reason: '   ' })).toThrow('必須填寫原因');
    expect(() => validateReceiptVoidPayload({ idempotency_key: KEY, expected_updated_at: OK.expected_updated_at })).toThrow('必須填寫原因');
    expect(validateReceiptVoidPayload({ ...OK, reason: 'x'.repeat(200) }).reason).toHaveLength(200);
    expect(() => validateReceiptVoidPayload({ ...OK, reason: 'x'.repeat(201) })).toThrow('200');
  });
  it('固定識別與版本資訊必填且格式正確', () => {
    expect(() => validateReceiptVoidPayload({ ...OK, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateReceiptVoidPayload({ ...OK, idempotency_key: 'k'.repeat(65) })).toThrow('過長');
    expect(() => validateReceiptVoidPayload({ ...OK, expected_updated_at: '' })).toThrow('版本資訊');
    expect(() => validateReceiptVoidPayload({ ...OK, expected_updated_at: 'not-a-date' })).toThrow('格式錯誤');
  });
  it('不支援的欄位與非物件一律拒絕（不能夾帶別的欄位）', () => {
    expect(() => validateReceiptVoidPayload({ ...OK, voided_by: 'x' })).toThrow('不支援的欄位');
    expect(() => validateReceiptVoidPayload(null)).toThrow('格式錯誤');
    expect(() => validateReceiptVoidPayload([])).toThrow('格式錯誤');
    expect(() => validateReceiptVoidPayload('x')).toThrow('格式錯誤');
  });
});

describe('作廢進貨的前端預判', () => {
  it('正常情況不擋', () => {
    for (const s of ['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED']) expect(receiptVoidBlock({ poStatus: s, voided: false, dispatchedQty: 0 })).toBe('');
  });
  it('已作廢、已結案、已取消、尚未下訂的採購單都擋下並說明', () => {
    expect(receiptVoidBlock({ poStatus: 'ORDERED', voided: true })).toContain('已經作廢');
    expect(receiptVoidBlock({ poStatus: 'CLOSED', voided: false })).toContain('已結案');
    expect(receiptVoidBlock({ poStatus: 'CANCELED', voided: false })).toContain('已取消');
    for (const s of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED']) expect(receiptVoidBlock({ poStatus: s, voided: false })).toContain('沒有可作廢');
  });
  it('已配發成設備與直接建立設備的進貨擋下並請走報廢', () => {
    expect(receiptVoidBlock({ poStatus: 'RECEIVED', voided: false, dispatchedQty: 1 })).toContain('報廢');
    expect(receiptVoidBlock({ poStatus: 'RECEIVED', voided: false, directAssetAccepted: true })).toContain('報廢');
  });
});

describe('待請款判斷（與資料庫 ga_pay_unclaimed_po_ids 同一口徑）', () => {
  it('驗入含稅額減有效請款累計「大於」尾差才算待請款（剛好等於尾差不算）', () => {
    expect(DEFAULT_TOLERANCE).toBe(5);
    expect(isPayUnclaimed(1050, 0)).toBe(true);
    expect(isPayUnclaimed(1050, 1045)).toBe(false); // 差 5 元：視為尾差
    expect(isPayUnclaimed(1050, 1044)).toBe(true); // 差 6 元
    expect(isPayUnclaimed(1050, 1050)).toBe(false);
    expect(isPayUnclaimed(1050, 1055)).toBe(false); // 超請在尾差內
    expect(isPayUnclaimed(0, 0)).toBe(false); // 沒有驗入不算
  });
  it('尾差可調整（設定 0 或 100）', () => {
    expect(isPayUnclaimed(1050, 1049, 0)).toBe(true);
    expect(isPayUnclaimed(1050, 1050, 0)).toBe(false);
    expect(isPayUnclaimed(1050, 960, 100)).toBe(false);
    expect(isPayUnclaimed(1050, 949, 100)).toBe(true);
  });
  it('已驗入尚未請款額不為負', () => {
    expect(unclaimedAmount(1050, 0)).toBe(1050);
    expect(unclaimedAmount(1050, 1050)).toBe(0);
    expect(unclaimedAmount(1050, 2000)).toBe(0);
  });
  it('已作廢進貨後驗入變少：驗入 1050 作廢一張 525 後只剩 525，已請款 525 就不再待請款', () => {
    expect(isPayUnclaimed(1050, 525)).toBe(true);
    expect(isPayUnclaimed(1050 - 525, 525)).toBe(false);
  });
});

describe('首頁與徽章新增兩項', () => {
  it('待請款採購單點進採購單清單的待請款篩選；待付款請款單點進請款單清單的待付款頁籤；都要請款檢視或管理', () => {
    expect(HOME_ITEMS.pay_unclaimed).toMatchObject({ menu: 'purchase_orders', kind: 'ga-purchase-orders', payload: { payUnclaimed: '1' } });
    expect(HOME_ITEMS.pay_submitted).toMatchObject({ menu: 'payment_requests', kind: 'ga-payment-requests', payload: { status: 'SUBMITTED' } });
    for (const k of ['pay_unclaimed', 'pay_submitted'] as const) {
      expect(HOME_ITEM_KEYS).toContain(k);
      expect(HOME_ITEMS[k].perms).toEqual(['general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage']);
    }
    expect(BADGE_MENUS).toContain('payment_requests');
    expect(BADGE_MENU_KIND.payment_requests).toBe('ga-payment-requests');
    expect(MENU_PAYLOAD.payment_requests).toEqual({ status: 'SUBMITTED' });
  });
  it('首頁合計包含新兩項', () => {
    expect(homeTotal({ pay_unclaimed: 4, pay_submitted: 6 })).toBe(10);
  });
});

describe('DEV SQL 結構：作廢進貨 170000', () => {
  const sql = read('supabase/workspace-dev/20261119170000_m7m8_b45_receipt_void.sql');
  const rb = read('supabase/workspace-dev/20261119170000_m7m8_b45_receipt_void.rollback.sql');
  it('函式簽章、權限、單一交易、固定識別與版本檢查', () => {
    expect(sql).toContain('ga_ws_po_receipt_void(p_po_id uuid, p_receipt_id uuid, p_reason text, p_key text, p_expected_updated_at timestamptz)');
    expect(sql).toContain('SECURITY DEFINER SET search_path TO \'public\', \'pg_temp\'');
    expect(sql).toContain('ga_po_perm_error(v_uid)'); // 採購評估管理＋庫存交易管理＋料件查看
    expect(sql).toContain("'REASON_REQUIRED'");
    expect(sql).toContain("'IDEMPOTENCY_KEY_REQUIRED'");
    expect(sql).toContain("'STALE'");
    expect(sql).toContain('ga_pay_lock_po');
  });
  it('擋下條件與白話訊息：已請款（指出請款單號）、已配發、連有效發票、已結案或取消、庫存不足、已作廢、直接建設備', () => {
    for (const code of ['RECEIPT_CLAIMED', 'RECEIPT_DISPATCHED', 'RECEIPT_HAS_INVOICE', 'INVALID_STATE', 'STOCK_INSUFFICIENT', 'ALREADY_VOIDED', 'RECEIPT_ASSET_CREATED']) expect(sql, code).toContain(`'${code}'`);
    expect(sql).toContain('q.status <> \'VOID\'');
    expect(sql).toContain('請先作廢或退回該請款單');
    expect(sql).toContain('請走設備報廢');
    expect(sql).toContain('v_ri.dispatched_qty > 0');
    expect(sql).toContain("i.status = 'ACTIVE'");
    expect(sql).toContain("IN ('CLOSED', 'CANCELED')");
  });
  it('效果：反向庫存交易沖回、扣回驗入量、重算採購單狀態、寫事件與原因、標記作廢', () => {
    expect(sql).toContain("ga_ws_inv_post('ISSUE'");
    expect(sql).toContain('received_qty = received_qty - v_ri.accepted_qty');
    for (const s of ["'ORDERED'", "'PARTIALLY_RECEIVED'", "'RECEIVED'"]) expect(sql).toContain(`v_new_status := ${s}`);
    expect(sql).toContain("ga_po_event(p_po_id, 'receipt_void'");
    expect(sql).toContain('voided_at = now(), voided_by = v_uid, void_reason = v_reason');
  });
  it('進貨讀取與配發排除已作廢進貨（文字替換、形狀不符就中止）', () => {
    expect(sql).toContain("'ga_ws_po_receipts_get', 'ga_ws_po_dispatch'");
    expect(sql).toContain('vr.voided_at IS NOT NULL');
    expect(sql).toContain('形狀與預期不符');
  });
  it('rollback 拿掉函式、欄位與排除條件', () => {
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_ws_po_receipt_void');
    expect(rb).toContain('DROP COLUMN IF EXISTS void_key');
    expect(rb).toContain('vr.voided_at');
  });
});

describe('DEV SQL 結構：分析與徽章 160000', () => {
  const sql = read('supabase/workspace-dev/20261119160000_m7m8_b45_analysis.sql');
  const rb = read('supabase/workspace-dev/20261119160000_m7m8_b45_analysis.rollback.sql');
  it('待請款述詞：單一 SQL 函式、不帶 search_path（可內嵌）、排除已作廢進貨與作廢請款單、大於尾差', () => {
    const m = sql.match(/CREATE OR REPLACE FUNCTION public\.ga_pay_unclaimed_po_ids[\s\S]*?\$f\$;/);
    expect(m, '找不到 ga_pay_unclaimed_po_ids').toBeTruthy();
    const fn = m![0];
    expect(fn).not.toMatch(/SET search_path/i);
    expect(fn).not.toMatch(/SECURITY DEFINER/i);
    expect(fn).toContain('LANGUAGE sql STABLE');
    expect(fn).toContain('r.voided_at IS NULL');
    expect(fn).toContain("q.status <> 'VOID'");
    expect(fn).toContain('> p_tol');
  });
  it('徽章、清單篩選、首頁都用同一個述詞函式；待付款用 SUBMITTED', () => {
    expect(sql).toContain("'pay_unclaimed'");
    expect(sql).toContain("'pay_submitted'");
    expect(sql).toContain("status = 'SUBMITTED'");
    expect(sql.match(/ga_pay_unclaimed_po_ids\(v_tol\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("'payment_requests', v_c -> 'pay_submitted'");
    expect(sql).toContain('ga_pay_can_view(v_uid)');
  });
  it('採購分析與廠商績效新增欄位；沒有請款權限時欄位不存在', () => {
    for (const k of ['claimed_amount', 'paid_amount', 'unclaimed_received_amount', 'can_view_payment', 'po_paid_amount', 'po_paid_total', 'can_view_pay_amount']) expect(sql, k).toContain(k);
    expect(sql).toContain('IF v_can_pay THEN');
    expect(sql).toContain("q.status = 'PAID'");
  });
  it('文字替換：已套用就略過、形狀不符就中止；rollback 反向替換並移除輔助函式', () => {
    expect(sql).toContain('RETURN; END IF;');
    expect(sql).toContain('函式形狀與預期不符');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_pay_unclaimed_po_ids');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_pay_po_amounts');
  });
  it('原有欄位與口徑不動：不重寫整個函式，只在原定義上加欄位', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.ga_ws_purchase_analysis/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.ga_hm_counts/);
    expect(sql).toContain('pg_get_functiondef(');
    expect(sql).toContain('public.ga_ws_purchase_analysis(text,integer,integer)');
  });
});

describe('套用腳本與正式區草稿', () => {
  it('套用腳本依序列出 160000、170000', () => {
    const s = read('scripts/apply-workspace-m7m8-b45-dev.cjs');
    expect(s.indexOf('20261119150000_m7m8_b45_functions')).toBeLessThan(s.indexOf('20261119160000_m7m8_b45_analysis'));
    expect(s.indexOf('20261119160000_m7m8_b45_analysis')).toBeLessThan(s.indexOf('20261119170000_m7m8_b45_receipt_void'));
  });
  it('57、58 草稿與 rollback 都存在、包交易、57 標明性能實測', () => {
    for (const n of ['57-b45-analysis', '58-b45-receipt-void']) {
      const up = read(`docs/vue-workspace/parity-plan/m7m8-sql/${n}.sql`);
      const down = read(`docs/vue-workspace/parity-plan/m7m8-sql/${n}-rollback.sql`);
      expect(up, n).toContain('BEGIN;');
      expect(up, n).toContain('COMMIT;');
      expect(down, n).toContain('BEGIN;');
      expect(down, n).toContain('COMMIT;');
    }
    expect(read('docs/vue-workspace/parity-plan/m7m8-sql/57-b45-analysis.sql')).toContain('十萬');
    const readme = read('docs/vue-workspace/parity-plan/m7m8-sql/README.md');
    expect(readme).toContain('57-b45-analysis');
    expect(readme).toContain('58-b45-receipt-void');
  });
});
