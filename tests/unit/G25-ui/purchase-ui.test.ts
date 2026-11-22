import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { PO_ACTIONS, canViewPo, maskVendorBilling, poAbilities, validateActionPayload, validateHeader, validateSettingsPayload } from '@/lib/workspace/general-affairs/purchase-order-rules';
import { validateSerialPayload } from '@/lib/workspace/general-affairs/purchase-receipt-rules';
import { EVENT_TEXT, FULFIL_TEXT, dateText, eventText, taipeiToday, visibleActions } from '../../../vue-workspace/src/lib/ga-purchase';

// 第 4 批 G25（畫面與 API 層）：導覽旗標與側欄、頁面登錄一致、動作與事件文字涵蓋、按鈕可見規則（abilities）、API 邊界輸入驗證。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (...allowed: string[]) => (...codes: string[]) => codes.some((c) => allowed.includes(c));
const REVIEW_MANAGE = 'general_affairs.purchase_review.manage';
const REVIEW_VIEW = 'general_affairs.purchase_review.view';
const TXN = 'general_affairs.inventory_transaction.manage';
const PART = 'general_affairs.part.view';
const APPROVE = 'general_affairs.purchase_order.approve';

describe('G25 導覽旗標與側欄', () => {
  const f = (...c: string[]) => gaFlags(has(...c), false);
  it('採購單＝採購評估檢視／管理或採購核准；待簽核＝只有採購核准', () => {
    expect(f(REVIEW_VIEW)).toMatchObject({ gaPurchaseOrders: true, gaPurchaseApprovals: false });
    expect(f(REVIEW_MANAGE)).toMatchObject({ gaPurchaseOrders: true, gaPurchaseApprovals: false });
    expect(f(APPROVE)).toMatchObject({ gaPurchaseOrders: true, gaPurchaseApprovals: true });
    expect(f(TXN, PART)).toMatchObject({ gaPurchaseOrders: false, gaPurchaseApprovals: false });
    expect(f()).toMatchObject({ gaPurchaseOrders: false, gaPurchaseApprovals: false });
  });
  it('完整 href 對應（含 ?view=approvals）到獨立頁面 kind，kind 已登錄', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/purchase-orders']).toEqual({ kind: 'ga-purchase-orders', flag: 'gaPurchaseOrders' });
    expect(GA_PAGE_BY_HREF['/general-affairs/purchase-orders?view=approvals']).toEqual({ kind: 'ga-purchase-approvals', flag: 'gaPurchaseApprovals' });
    for (const k of ['ga-purchase-orders', 'ga-purchase-order-edit', 'ga-purchase-approvals']) expect(WORKSPACE_TAB_KINDS).toContain(k);
  });
  const nav = (perm: string[]) => {
    const p = new Set(['general_affairs.service_center.access', ...perm]);
    return gaNavigation({ has: (...c: string[]) => c.some((x) => p.has(x)), permissions: p as any, roleCodes: new Set(['x']), isAdmin: false });
  };
  const items = (g: ReturnType<typeof nav>) => {
    const out: any[] = [];
    const walk = (list: any[]) => list.forEach((i) => { out.push(i); if (i.children) walk(i.children); });
    g.forEach((x) => walk(x.items));
    return out;
  };
  it('側欄：採購人員看到「採購單」；核准人另看到「待簽核採購單」（href 帶 ?view=approvals）；沒權限都看不到', () => {
    const buyer = items(nav([REVIEW_MANAGE, TXN, PART]));
    expect(buyer.find((i) => i.kind === 'ga-purchase-orders')).toMatchObject({ label: '採購單', href: '/general-affairs/purchase-orders' });
    expect(buyer.some((i) => i.kind === 'ga-purchase-approvals')).toBe(false);
    const approver = items(nav([APPROVE]));
    expect(approver.find((i) => i.kind === 'ga-purchase-approvals')).toMatchObject({ label: '待簽核採購單', href: '/general-affairs/purchase-orders?view=approvals' });
    expect(approver.some((i) => i.kind === 'ga-purchase-orders')).toBe(true);
    const none = items(nav([TXN, PART]));
    expect(none.some((i) => i.kind === 'ga-purchase-orders' || i.kind === 'ga-purchase-approvals')).toBe(false);
  });
});

describe('G25 頁面登錄一致', () => {
  it('三個 kind 都有頁面元件、頁面權限旗標、標題', () => {
    const pages = read('vue-workspace/src/workspace-pages.ts');
    const meta = read('vue-workspace/src/workspace-page-meta.ts');
    expect(pages).toMatch(/"ga-purchase-orders": PurchaseOrders/);
    expect(pages).toMatch(/"ga-purchase-order-edit": PurchaseOrderEdit/);
    expect(pages).toMatch(/"ga-purchase-approvals": PurchaseApprovals/);
    expect(meta).toMatch(/"ga-purchase-orders": meta\("採購單", \["gaPurchaseOrders"\]\)/);
    expect(meta).toMatch(/"ga-purchase-order-edit": meta\("採購單編輯", \["gaPurchaseOrders"\]\)/);
    expect(meta).toMatch(/"ga-purchase-approvals": meta\("待簽核採購單", \["gaPurchaseApprovals"\]\)/);
    for (const f of ['PurchaseOrders', 'PurchaseOrderEdit', 'PurchaseApprovals']) expect(fs.existsSync(path.join(root, `vue-workspace/src/pages/ga/${f}.vue`))).toBe(true);
    expect(read('vue-workspace/src/stores.ts')).toMatch(/gaPurchaseOrders: boolean;[\s\S]*gaPurchaseApprovals: boolean;/);
  });
  it('路由分派：purchase-orders 在 router.ts；序號補填在 onboarding.ts', () => {
    expect(read('lib/workspace/general-affairs/router.ts')).toMatch(/case "purchase-orders":\s*return purchaseOrdersApi/);
    expect(read('lib/workspace/general-affairs/onboarding.ts')).toMatch(/head === "serial" && m === "POST"/);
  });
});

describe('G25 文字與動作涵蓋', () => {
  it('每個採購單動作與事件都有白話文字', () => {
    for (const a of [...PO_ACTIONS, 'create', 'update', 'receive', 'dispatch', 'from_review', 'settings']) expect(EVENT_TEXT[a], a).toBeTruthy();
    expect(eventText('unknown_type')).toBe('unknown_type');
    expect(Object.keys(FULFIL_TEXT).sort()).toEqual(['DIRECT_ASSET', 'NO_STOCK', 'STOCK']);
  });
  it('日期工具：台北今天格式 YYYY-MM-DD；dateText 取前 10 碼', () => {
    expect(taipeiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateText('2038-05-06T00:00:00+00:00')).toBe('2038-05-06');
    expect(dateText(null)).toBe('');
  });
});

describe('G25 按鈕可見規則（abilities）', () => {
  const who = (over: Partial<Parameters<typeof poAbilities>[0]> = {}) => ({ reviewManage: true, transactionManage: true, partView: true, approve: false, vendorView: false, reviewView: false, userId: 'u1', ...over });
  it('採購人員：草稿可編輯、送核准、取消；不能核准', () => {
    const a = poAbilities(who(), { status: 'DRAFT', created_by: 'u1' });
    expect(a).toMatchObject({ edit: true, submit: true, cancel: true, approve: false, reject: false, problem: '' });
  });
  it('缺權限：三個缺一個都不能寫，訊息指出缺哪個；仍可看（有採購評估檢視）', () => {
    const a = poAbilities(who({ partView: false, reviewView: true }), { status: 'DRAFT' });
    expect(a.edit).toBe(false);
    expect(a.submit).toBe(false);
    expect(a.problem).toContain('料件查看');
    expect(canViewPo(who({ reviewManage: false, reviewView: true }))).toBe(true);
    expect(poAbilities(who({ reviewManage: false, transactionManage: false }), { status: 'DRAFT' }).problem).toContain('採購評估管理、庫存交易管理');
  });
  it('核准人：不是開單人也不是送簽人才能核准、駁回；自己開的單看到說明；不需要三個採購權限', () => {
    const po = { status: 'PENDING_APPROVAL', created_by: 'u1', submitted_by: 'u1' };
    const other = poAbilities(who({ userId: 'u2', approve: true, reviewManage: false, transactionManage: false, partView: false }), po);
    expect(other).toMatchObject({ approve: true, reject: true, submit: false, place_order: false });
    const self = poAbilities(who({ userId: 'u1', approve: true }), po);
    expect(self).toMatchObject({ approve: false, reject: false });
    expect(self.approveBlocked).toContain('開單人');
    const submitter = poAbilities(who({ userId: 'u3', approve: true }), { ...po, created_by: 'u1', submitted_by: 'u3' });
    expect(submitter.approve).toBe(false);
    expect(submitter.approveBlocked).toContain('送核准');
  });
  it('持三個採購權限但沒有核准權限（含管理員身分，DB 無 admin bypass）：待核准單不能核准', () => {
    expect(poAbilities(who({ userId: 'admin' }), { status: 'PENDING_APPROVAL', created_by: 'u1', submitted_by: 'u1' })).toMatchObject({ approve: false, reject: false });
  });
  it('已下訂且已有到貨：不能取消、只能短收結案；已核准：不可編輯，可撤回核准與下訂', () => {
    const ordered = poAbilities(who(), { status: 'ORDERED', received_qty_total: 1 });
    expect(ordered).toMatchObject({ cancel: false, edit: false, editNotesOnly: true });
    expect(poAbilities(who(), { status: 'PARTIALLY_RECEIVED', received_qty_total: 1 })).toMatchObject({ short_close: true, cancel: false, close: false });
    expect(poAbilities(who(), { status: 'RECEIVED', received_qty_total: 3 })).toMatchObject({ close: true, short_close: false });
    expect(poAbilities(who(), { status: 'ORDERED', received_qty_total: 0 }).cancel).toBe(true);
    expect(poAbilities(who(), { status: 'APPROVED' })).toMatchObject({ edit: false, revoke_approval: true, place_order: true });
  });
  it('草稿只留一條路：超過門檻只顯示「送核准」，未超過只顯示「下訂」（避免按了才被擋）', () => {
    const base = { status: 'DRAFT', abilities: poAbilities(who(), { status: 'DRAFT' }) };
    expect(visibleActions({ ...base, approval_required: true })).toEqual(['submit', 'cancel']);
    expect(visibleActions({ ...base, approval_required: false })).toEqual(['place_order', 'cancel']);
    const approver = poAbilities(who({ userId: 'u2', approve: true, reviewManage: false, transactionManage: false, partView: false }), { status: 'PENDING_APPROVAL', created_by: 'u1', submitted_by: 'u1' });
    expect(visibleActions({ status: 'PENDING_APPROVAL', approval_required: true, abilities: approver })).toEqual(['approve', 'reject']);
  });
  it('帳務欄位遮蔽：沒有廠商檢視就拿掉統編與付款條件', () => {
    const po = { vendor_name: 'A', vendor_tax_id: '12345678', vendor_payment_terms: '月結', vendor_billing_visible: true };
    expect(maskVendorBilling(po, false)).toMatchObject({ vendor_name: 'A', vendor_tax_id: null, vendor_payment_terms: null, vendor_billing_visible: false });
    expect(maskVendorBilling(po, true)).toEqual(po);
  });
});

describe('G25 API 邊界輸入驗證', () => {
  it('動作：必填原因的動作缺原因會擋；缺版本資訊會擋；未知動作與多餘欄位會擋', () => {
    const ver = '2038-01-01T00:00:00Z';
    expect(() => validateActionPayload({ action: 'reject', expected_updated_at: ver }, 'PENDING_APPROVAL')).toThrow('駁回必須填寫原因');
    expect(() => validateActionPayload({ action: 'short_close', expected_updated_at: ver }, 'PARTIALLY_RECEIVED')).toThrow('短收結案必須填寫原因');
    expect(() => validateActionPayload({ action: 'approve' })).toThrow('缺少版本資訊');
    expect(() => validateActionPayload({ action: 'nuke', expected_updated_at: ver })).toThrow('不支援的動作');
    expect(() => validateActionPayload({ action: 'approve', expected_updated_at: ver, foo: 1 })).toThrow('不支援的欄位');
    expect(validateActionPayload({ action: 'approve', expected_updated_at: ver, note: ' ok ' }, 'PENDING_APPROVAL')).toMatchObject({ action: 'approve', note: 'ok' });
  });
  it('表頭：只收白名單鍵；已下訂時只改備註與預計到貨日的驗證', () => {
    expect(validateHeader({ notes: '備註', expected_delivery_date: '2038-03-04' })).toEqual({ notes: '備註', expected_delivery_date: '2038-03-04' });
    expect(() => validateHeader({ expected_delivery_date: '2038-02-31' })).toThrow('預計到貨日');
    expect(() => validateHeader({ total_amount: 1 })).toThrow('不支援的欄位');
    expect(validateHeader({ vendor_id: '' })).toEqual({ vendor_id: null });
  });
  it('設定：門檻、稅率範圍', () => {
    const ver = '2038-01-01T00:00:00Z';
    expect(validateSettingsPayload({ approval_threshold: 8000, expected_updated_at: ver }).values).toEqual({ approval_threshold: 8000 });
    expect(() => validateSettingsPayload({ tax_rate: 0.5, expected_updated_at: ver })).toThrow('稅率');
    expect(() => validateSettingsPayload({ expected_updated_at: ver })).toThrow('沒有要調整的設定');
    expect(() => validateSettingsPayload({ po_secret: 1, expected_updated_at: ver })).toThrow('不支援的設定');
  });
  it('序號補填：onboarding 序號路由去掉 equipmentId 後交給共用驗證', () => {
    expect(validateSerialPayload({ serial: ' SN-001 ', reason: ' 更正 ' })).toEqual({ serial: 'SN-001', reason: '更正' });
    expect(() => validateSerialPayload({ serial: '' })).toThrow('請輸入序號');
    expect(() => validateSerialPayload({ serial: 'x', equipmentId: 'x' })).toThrow('不支援的欄位');
  });
});
