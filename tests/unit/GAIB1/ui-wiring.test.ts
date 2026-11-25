import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { doneNotice } from '@/lib/workspace/general-affairs/notice-rules';

// ga-improve-b1（畫面）：兩個小錯字、G12 改名、新畫面的接線檢查（讀原始碼文字，不起瀏覽器）。
const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('doneNotice（小錯字：確認完成完成。）', () => {
  it('標題已以「完成」結尾只加句號，其餘照舊', () => {
    expect(doneNotice('確認完成')).toBe('確認完成。');
    expect(doneNotice('確認完成')).not.toContain('完成完成');
    expect(doneNotice('受理需求')).toBe('受理需求完成。');
    expect(doneNotice('請門市補資料')).toBe('請門市補資料完成。');
    expect(doneNotice('')).toBe('完成。');
  });
  it('需求單詳情的提示改用 doneNotice，沒有殘留舊寫法', () => {
    const src = read('vue-workspace/src/components/ga/RequestDetail.vue');
    expect(src).toContain('doneNotice(ACTION_TITLE[a])');
    expect(src).not.toContain('${ACTION_TITLE[a]}完成。');
  });
});

describe('登錄憑證連結（小錯字：已付款或已連結發票的進貨單不再顯示）', () => {
  const src = read('vue-workspace/src/components/ga/PoDetailDialog.vue');
  it('條件包含未連結發票與沒有已付款請款（含預付核銷）', () => {
    expect(src).toContain('r.voucher_status !== "LINKED"');
    expect(src).toContain('!r.has_paid_claim');
    expect(src).toMatch(/v-if="voucherOpen\(r\)"[^>]*reg-voucher-/);
  });
});

describe('G12 權限顯示名稱', () => {
  it('畫面程式碼沒有舊名稱「水電網費管理」', () => {
    const bad = walk('vue-workspace/src').filter((f) => /\.(vue|ts)$/.test(f) && read(f).includes('水電網費管理'));
    expect(bad).toEqual([]);
  });
  it('請款單列表的提示用常數', () => {
    expect(read('vue-workspace/src/pages/ga/PaymentRequests.vue')).toContain('UTILITY_BILL_MANAGE_LABEL');
  });
});

describe('新畫面接線', () => {
  it('採購單編輯：計價方式、調整列、買受人抬頭與金額計算用 computeTotalsV2', () => {
    const src = read('vue-workspace/src/pages/ga/PurchaseOrderEdit.vue');
    for (const id of ['pe-price-mode', 'pe-buyer', 'pe-adjustments', 'pe-adj-add-', 'pe-adj-amount-']) expect(src).toContain(id);
    expect(src).toContain('computeTotalsV2');
    expect(src).not.toMatch(/\bcomputeTotals\(/);
  });
  it('請款單：預付、代墊、付款方式欄位都有接上', () => {
    const edit = read('vue-workspace/src/pages/ga/PaymentRequestEdit.vue');
    for (const id of ['pe-prepay', 'pe-prepay-refund-btn', 'pe-payee-box', 'pe-payee-register', 'PaidFields', 'PayeeBuyerFields']) expect(edit).toContain(id);
    const paid = read('vue-workspace/src/components/ga/PaidFields.vue');
    for (const id of ['act-card', 'act-platform', 'act-method']) expect(paid).toContain(id);
    const util = read('vue-workspace/src/components/ga/PaymentRequestUtility.vue');
    for (const id of ['PayeeBuyerFields', 'pu-payee-box', 'PaidFields']) expect(util).toContain(id);
  });
  it('匯出按鈕帶 extended=1；列表有類型與付款對象篩選', () => {
    const src = read('vue-workspace/src/pages/ga/PaymentRequests.vue');
    expect(src).toContain('q.set("extended", "1")');
    for (const id of ['pr-filter-kind', 'pr-filter-payee', 'pr-prepay-overdue-toggle']) expect(src).toContain(id);
  });
  it('我的代墊款入口在頂端工具列，任何登入者可用（不掛頁面權限）', () => {
    const app = read('vue-workspace/src/App.vue');
    expect(app).toContain('open-my-reimbursements');
    expect(app).toContain('MyReimbursementsDialog');
  });
  it('請款設定有買受人公司清單，且保留預設抬頭與統編兩欄（舊測試與舊流程相容）', () => {
    const src = read('vue-workspace/src/components/ga/PaymentSettingsDialog.vue');
    for (const id of ['ps-companies', 'ps-company-add', 'ps-title', 'ps-tax', 'ps-tol']) expect(src).toContain(id);
  });
  it('列印頁：預付款標題、同仁代墊付款對象', () => {
    const src = read('vue-workspace/src/pages/ga/PaymentRequestPrint.vue');
    for (const id of ['pp-prepay-title', 'pp-payee', 'pp-buyer']) expect(src).toContain(id);
  });
});
