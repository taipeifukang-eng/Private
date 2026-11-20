import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_DEFAULT_STATUSES, PAID_BACKDATE_DAYS, STALE_DRAFT_DAYS, buildExportCsv, paidDateProblem, paidDateRange, parseExportStatuses, parseRequestFilters, payErrorMessage,
} from '@/lib/workspace/general-affairs/payment-request-rules';
import { HOME_ITEMS, HOME_ITEM_KEYS } from '@/lib/workspace/general-affairs/home-rules';
import { BANK_FIELD_LABELS, bankChangeLines } from '../../../vue-workspace/src/lib/ga-vendors';

// 驗收追加（2026-11-20）F1 至 F7 的 API／畫面純函式與原始碼約束：
// F2 對帳 CSV 預設狀態、F3 付款日期範圍與訊息、F1 錯誤訊息、F5 取消買受人統編遮蔽、F6 修改歷程文字與權限門檻、F7 首頁待辦項目與清單篩選、設定頁提示、手機搜尋框與詳情副標。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const q = (s: string) => new URLSearchParams(s);

describe('F2 對帳 CSV 預設只含已送出與已付款', () => {
  it('沒帶參數＝已送出＋已付款；includeDraft／includeVoid 各自加入；順序固定', () => {
    expect(EXPORT_DEFAULT_STATUSES).toEqual(['SUBMITTED', 'PAID']);
    expect(parseExportStatuses(q('month=2038-01'))).toEqual(['SUBMITTED', 'PAID']);
    expect(parseExportStatuses(q('includeDraft=1'))).toEqual(['DRAFT', 'SUBMITTED', 'PAID']);
    expect(parseExportStatuses(q('includeVoid=true'))).toEqual(['SUBMITTED', 'PAID', 'VOID']);
    expect(parseExportStatuses(q('includeVoid=1&includeDraft=true'))).toEqual(['DRAFT', 'SUBMITTED', 'PAID', 'VOID']);
    expect(parseExportStatuses(q('includeDraft=0&includeVoid=no'))).toEqual(['SUBMITTED', 'PAID']);
  });
  it('明確指定單一狀態時只匯出該狀態（不理 include 參數）；亂填狀態被擋', () => {
    expect(parseExportStatuses(q('status=draft&includeVoid=1'))).toEqual(['DRAFT']);
    expect(parseExportStatuses(q('status=VOID'))).toEqual(['VOID']);
    expect(() => parseExportStatuses(q('status=X'))).toThrow('狀態篩選值錯誤');
  });
  it('API 逐狀態呼叫資料庫匯出函式，再依建立時間與單號合併；CSV 欄位不因此改變', () => {
    const src = read('lib/workspace/general-affairs/payment-requests.ts');
    expect(src).toContain('parseExportStatuses(p)');
    expect(src).toMatch(/for \(const st of statuses\)[\s\S]*ga_ws_pay_export[\s\S]*status: st/);
    const csv = buildExportCsv([{ pr_no: 'PY-20381101-001', status: 'PAID', created_at: '2038-11-01T01:00:00Z', vendor_name: 'QA', claim_total: 100 }], false);
    expect(csv.split('\r\n')[0]).toContain('請款單號');
  });
  it('畫面：有「加入草稿」「加入已作廢」勾選框，預設不勾；下載時才帶參數', () => {
    const v = read('vue-workspace/src/pages/ga/PaymentRequests.vue');
    expect(v).toContain('data-testid="pr-export-draft"');
    expect(v).toContain('data-testid="pr-export-void"');
    expect(v).toContain('預設只含已送出與已付款');
    expect(v).toMatch(/const includeDraft = ref\(false\)/);
    expect(v).toContain('q.set("includeDraft", "1")');
    expect(v).toContain('q.set("includeVoid", "1")');
  });
});

describe('F3 付款日期：可比建立日早最多 30 天，不可是未來', () => {
  it('可填範圍：建立日往前 30 天到今天（跨月、跨年）', () => {
    expect(PAID_BACKDATE_DAYS).toBe(30);
    expect(paidDateRange('2038-11-20', '2038-11-25')).toEqual({ min: '2038-10-21', max: '2038-11-25' });
    expect(paidDateRange('2038-01-10', '2038-01-10')).toEqual({ min: '2037-12-11', max: '2038-01-10' });
  });
  it('邊界：早 30 天可、早 31 天不可、建立日當天與之後可、明天不可', () => {
    const c = '2038-11-20';
    const t = '2038-11-25';
    expect(paidDateProblem('2038-10-21', c, t)).toBeNull();
    expect(paidDateProblem('2038-10-20', c, t)).toContain('超過 30 天');
    expect(paidDateProblem('2038-10-20', c, t)).toContain('最早可填 2038-10-21');
    expect(paidDateProblem('2038-11-20', c, t)).toBeNull();
    expect(paidDateProblem('2038-11-25', c, t)).toBeNull();
    expect(paidDateProblem('2038-11-26', c, t)).toContain('不能是未來');
    expect(paidDateProblem('', c, t)).toBeNull();
    expect(paidDateProblem('2038-13-40', c, t)).toContain('格式錯誤');
  });
  it('畫面的日期選擇器 min／max 與提示文字', () => {
    const v = read('vue-workspace/src/pages/ga/PaymentRequestEdit.vue');
    expect(v).toContain(':min="paidRange.min" :max="paidRange.max"');
    expect(v).toContain('data-testid="act-date-hint"');
    expect(v).toContain('paidDateProblem(actDate.value, createdDay.value, taipeiToday())');
  });
});

describe('F1 超過採購單總額的錯誤訊息', () => {
  it('OVER_PO_TOTAL 帶伺服端白話訊息再加下一步；DIFF_REASON_REQUIRED 提示尾差可能被調低；其他錯誤原樣', () => {
    const m = '採購單 PO-1 累計請款 33 元，超過採購單含稅總額 32 元（容許尾差 0 元）';
    expect(payErrorMessage('OVER_PO_TOTAL', m)).toContain(m);
    expect(payErrorMessage('OVER_PO_TOTAL', m)).toContain('請減少這張請款單的金額');
    expect(payErrorMessage('DIFF_REASON_REQUIRED', '第 1 筆要填差異原因')).toContain('尾差設定可能剛被調低');
    expect(payErrorMessage('OVER_CLAIM', '超過累計驗入')).toBe('超過累計驗入');
    expect(payErrorMessage('', '網路錯誤')).toBe('網路錯誤');
  });
  it('請款單頁的儲存、送出、動作錯誤都走 payErrorText', () => {
    const v = read('vue-workspace/src/pages/ga/PaymentRequestEdit.vue');
    expect(v).not.toMatch(/error\.value = errorText\(e\)/);
    expect(v).toContain('actError.value = payErrorText(e)');
  });
});

describe('F5 自家統編（買受人）各處都顯示', () => {
  it('發票頁設定 meta 不再依廠商權限遮蔽買受人統編；賣方統編的遮蔽仍在', () => {
    const src = read('lib/workspace/general-affairs/purchase-invoices.ts');
    expect(src).toContain('buyer_tax_id: s.buyer_tax_id ?? null');
    expect(src).not.toMatch(/buyer_tax_id: ab\.vendorVisible/);
    expect(src).toContain('maskInvoice(');
  });
});

describe('F6 廠商銀行修改歷程', () => {
  it('每個有變的欄位一行「欄位：舊 → 新」，空值寫（空）', () => {
    expect(BANK_FIELD_LABELS.bank_account).toBe('銀行帳號');
    expect(bankChangeLines({ changed_fields: ['bank_account', 'bank_name'], old: { bank_account: '111', bank_name: null }, new: { bank_account: '222', bank_name: '台新' } }))
      .toEqual(['銀行帳號：111 → 222', '銀行名稱：（空） → 台新']);
    expect(bankChangeLines({ changed_fields: [], old: {}, new: {} })).toEqual([]);
  });
  it('API 路由 /vendors/:id/bank-log 需廠商檢視或管理（與銀行欄位可見規則相同），再由資料庫函式判斷一次', () => {
    const src = read('lib/workspace/general-affairs/vendors.ts');
    expect(src).toContain('b === "bank-log" && m === "GET"');
    expect(src).toMatch(/async function bankLog[\s\S]*billingVisible[\s\S]*403[\s\S]*ga_ws_vendor_bank_log/);
  });
  it('畫面：只有看得到銀行欄位（billing）才放入「修改歷程」區塊', () => {
    const d = read('vue-workspace/src/components/ga/VendorDetail.vue');
    expect(d).toMatch(/<VendorBankLog v-if="billing"/);
    expect(read('vue-workspace/src/components/ga/VendorBankLog.vue')).toContain('data-testid="vd-bank-log"');
  });
});

describe('F7 逾期草稿待辦', () => {
  it('首頁待辦項目 pay_stale_draft：點進請款單清單並帶 stale_draft；需請款檢視或管理；不改導覽徽章口徑', () => {
    expect(STALE_DRAFT_DAYS).toBe(14);
    expect(HOME_ITEM_KEYS).toContain('pay_stale_draft');
    expect(HOME_ITEMS.pay_stale_draft).toMatchObject({ menu: 'payment_requests', kind: 'ga-payment-requests', payload: { stale_draft: 'true' } });
    expect(HOME_ITEMS.pay_stale_draft.perms).toEqual(['general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage']);
    const rules = read('lib/workspace/general-affairs/home-rules.ts');
    expect(rules).toContain('payment_requests: { status: "SUBMITTED" }');
  });
  it('清單篩選 stale_draft 解析（1／true／staleDraft）；沒帶就不加', () => {
    expect(parseRequestFilters(q('stale_draft=true'))).toMatchObject({ stale_draft: true });
    expect(parseRequestFilters(q('staleDraft=1'))).toMatchObject({ stale_draft: true });
    expect(parseRequestFilters(q('stale_draft=0'))).not.toHaveProperty('stale_draft');
    expect(parseRequestFilters(q(''))).not.toHaveProperty('stale_draft');
  });
  it('清單頁收到 payload.stale_draft 顯示篩選提示並可清除', () => {
    const v = read('vue-workspace/src/pages/ga/PaymentRequests.vue');
    expect(v).toContain('data-testid="pr-stale-chip"');
    expect(v).toContain('q.set("stale_draft", "true")');
  });
});

describe('假設 (a) 與 (b)', () => {
  it('設定頁尾差旁一行提示', () => {
    const v = read('vue-workspace/src/components/ga/PaymentSettingsDialog.vue');
    expect(v).toContain('data-testid="ps-tol-hint"');
    expect(v).toContain('尚未送出的草稿在送出時會用新的尾差重新檢查');
  });
  it('手機版請款單清單搜尋框獨佔一行；詳情頁副標依狀態、不再沿用建立頁文字', () => {
    const list = read('vue-workspace/src/pages/ga/PaymentRequests.vue');
    expect(list).toMatch(/@media \(max-width: 700px\)[\s\S]*\.filter-bar \.grow \{ flex: 1 1 100%/);
    const e = read('vue-workspace/src/pages/ga/PaymentRequestEdit.vue');
    expect(e).toContain('v-if="creating || !pr" class="muted" data-testid="pe-subtitle"');
    expect(e).toContain('已付款，內容已鎖定');
  });
});

describe('D1 至 D5 白名單核可', () => {
  it('五項 approvedBy 為 user (2026-11-20 第4.5批驗收問卷)', () => {
    const list = JSON.parse(read('tests/parity/allowlist.json')) as Array<{ id: string; approvedBy: string | null }>;
    for (const id of ['entry-db-semantics', 'invoice-last-image-lock', 'analysis-pay-columns', 'badges-pay-attention', 'void-excluded-closed-blocked']) {
      expect(list.find((e) => e.id === `m7m8-b45-${id}`)?.approvedBy, id).toBe('user (2026-11-20 第4.5批驗收問卷)');
    }
  });
});
