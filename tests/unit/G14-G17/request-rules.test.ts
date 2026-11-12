import { describe, expect, it } from 'vitest';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import {
  REQUEST_STATUSES, REQUEST_TRANSITIONS, TERMINAL_STATUSES, acceptConflict, blockedByDocuments, canTransition, fulfillmentAbilities, fulfillmentLabel, isConfirmOverdue, isReadyToDeliver,
  maskComments, maskEvents, maskPurchaseDoc, maskRequest, nextStatus, overdueCutoff, remainingQuantity, requestAbilities, validateOverdueDays, type DocSummary,
} from '@/lib/workspace/general-affairs/request-rules';

// 第 4 批 G14 至 G17：需求單狀態流轉表、D4 受理擋、D5 逾期判斷、欄位遮蔽、可按動作、待交付、導覽旗標。
const NONE: DocSummary = { po_count: 0, po_received: 0, issued: 0, transfer_active: 0, work_order_open: false };

describe('Q17 合法流轉表', () => {
  it('每個動作只在規定的狀態可執行，其餘全部不可（12 個動作 × 9 個狀態）', () => {
    const allowed: Record<string, string[]> = {
      accept: ['PENDING_INTAKE', 'WAITING_GA_REVIEW'],
      reject: ['PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED'],
      request_supplement: ['PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS'],
      update_progress: ['ACCEPTED', 'IN_PROGRESS'],
      request_store_confirmation: ['IN_PROGRESS'],
      assign: ['PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_STORE_CONFIRMATION'],
      cancel: ['PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS'],
      reopen: ['COMPLETED', 'REJECTED'],
      withdraw: ['PENDING_INTAKE'],
      submit_supplement: ['WAITING_STORE_SUPPLEMENT'],
      confirm_complete: ['WAITING_STORE_CONFIRMATION'],
      report_problem: ['WAITING_STORE_CONFIRMATION'],
    };
    expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual(Object.keys(allowed).sort());
    for (const [action, from] of Object.entries(allowed)) {
      for (const s of REQUEST_STATUSES) expect(canTransition(action, s), `${action}@${s}`).toBe(from.includes(s));
    }
  });
  it('終態：已取消沒有任何動作；已完成與已駁回只能重新開啟', () => {
    for (const a of Object.keys(REQUEST_TRANSITIONS)) expect(canTransition(a, 'CANCELED'), a).toBe(false);
    for (const s of ['COMPLETED', 'REJECTED']) expect(Object.keys(REQUEST_TRANSITIONS).filter((a) => canTransition(a, s))).toEqual(['reopen']);
    expect(TERMINAL_STATUSES).toEqual(['COMPLETED', 'REJECTED', 'CANCELED']);
  });
  it('結果狀態：重新開啟已完成→處理中、已駁回→待受理；補資料→待複核；門市回報問題→處理中', () => {
    expect(nextStatus('reopen', 'COMPLETED')).toBe('IN_PROGRESS');
    expect(nextStatus('reopen', 'REJECTED')).toBe('PENDING_INTAKE');
    expect(nextStatus('submit_supplement', 'WAITING_STORE_SUPPLEMENT')).toBe('WAITING_GA_REVIEW');
    expect(nextStatus('report_problem', 'WAITING_STORE_CONFIRMATION')).toBe('IN_PROGRESS');
    expect(nextStatus('assign', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(nextStatus('accept', 'ACCEPTED')).toBeNull();
    expect(nextStatus('nope', 'ACCEPTED')).toBeNull();
    expect(canTransition('nope', 'ACCEPTED')).toBe(false);
  });
});

describe('D4 受理擋與有效單據前置檢查', () => {
  it('維修單不能走採購評估；非料件不能走庫存出庫；添購不能維修派工；合理組合回 null', () => {
    expect(acceptConflict({ request_type: 'REPAIR' }, 'PURCHASE_REVIEW')).toContain('維修單不能走採購評估');
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'OTHER_PURCHASE' }, 'STOCK_ISSUE')).toContain('只有料件需求');
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: null }, 'STOCK_ISSUE')).toBeTruthy();
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART' }, 'REPAIR_DISPATCH')).toContain('只有維修需求');
    expect(acceptConflict({ request_type: 'REPAIR' }, 'REPAIR_DISPATCH')).toBeNull();
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART' }, 'STOCK_ISSUE')).toBeNull();
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'GENERAL_SUPPLY' }, 'PURCHASE_REVIEW')).toBeNull();
    expect(acceptConflict({ request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART' }, 'TRANSFER')).toBeNull();
  });
  it('有採購單（含草稿）或已出庫不可請門市補資料；已出庫、有採購單、調撥、進行中工單不可取消；有工單或有效單據不可駁回', () => {
    expect(blockedByDocuments('request_supplement', { ...NONE, po_count: 1 })).toContain('請改用留言');
    expect(blockedByDocuments('request_supplement', { ...NONE, issued: 2 })).toBeTruthy();
    expect(blockedByDocuments('request_supplement', { ...NONE, transfer_active: 1 })).toBeNull(); // 調撥不擋補資料（D4 只列採購單與出庫）
    for (const d of [{ issued: 1 }, { po_count: 1 }, { transfer_active: 1 }, { work_order_open: true }]) {
      expect(blockedByDocuments('cancel', { ...NONE, ...d }), JSON.stringify(d)).toBeTruthy();
      expect(blockedByDocuments('reject', { ...NONE, ...d }), JSON.stringify(d)).toBeTruthy();
    }
    expect(blockedByDocuments('cancel', NONE)).toBeNull();
    expect(blockedByDocuments('reject', NONE)).toBeNull();
    expect(blockedByDocuments('update_progress', { ...NONE, po_count: 3 })).toBeNull();
  });
});

describe('D5 逾期未確認', () => {
  const now = new Date('2038-06-10T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  it('只有待門市確認且超過天數（不含剛好）才逾期；沒有起算時間或其他狀態都不逾期', () => {
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: ago(8) }, 7, now)).toBe(true);
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: ago(7) }, 7, now)).toBe(false);
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: ago(6.9) }, 7, now)).toBe(false);
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: ago(2) }, 1, now)).toBe(true);
    expect(isConfirmOverdue({ main_status: 'IN_PROGRESS', waiting_confirm_since: ago(30) }, 7, now)).toBe(false);
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: null }, 7, now)).toBe(false);
    expect(isConfirmOverdue({ main_status: 'WAITING_STORE_CONFIRMATION', waiting_confirm_since: 'bad' }, 7, now)).toBe(false);
  });
  it('篩選用的截止時間與天數驗證（1 到 90 的整數）', () => {
    expect(overdueCutoff(7, now)).toBe(ago(7));
    for (const ok of [1, 7, 90, '30']) expect(validateOverdueDays(ok)).toBe(Number(ok));
    for (const bad of [0, 91, 1.5, '', 'x', null, undefined, -3]) expect(() => validateOverdueDays(bad), String(bad)).toThrow();
  });
});

describe('Q16 欄位遮蔽', () => {
  it('門市看不到內部備註、承辦帳號、取消原因與待確認起算時間；總務全看', () => {
    const row = { id: 'r', title: 't', internal_note: '內部', assignee_user_id: 'u', cancel_reason: '原因', waiting_confirm_since: 'x', public_progress: '公開' };
    expect(maskRequest(row, true)).toEqual(row);
    const store = maskRequest(row, false);
    expect(store).toEqual({ id: 'r', title: 't', public_progress: '公開' });
    expect(Object.keys(store)).not.toContain('internal_note');
  });
  it('事件：門市只看公開事件且沒有 metadata；總務全看', () => {
    const evs = [{ visibility: 'PUBLIC', metadata: { a: 1 } }, { visibility: 'INTERNAL', metadata: { b: 2 } }];
    expect(maskEvents(evs, true)).toHaveLength(2);
    const s = maskEvents(evs, false);
    expect(s).toHaveLength(1);
    expect(s[0].metadata).toBeUndefined();
  });
  it('留言：門市看不到內部備註與原文；刪除只留占位；已編輯標示；總務看得到原文', () => {
    const rows = [
      { id: '1', visibility: 'PUBLIC', body: '新內容', original_body: '舊內容', edited_at: '2038-01-01', deleted_at: null },
      { id: '2', visibility: 'PUBLIC', body: '被刪的內容', original_body: '被刪的內容', edited_at: null, deleted_at: '2038-01-02' },
      { id: '3', visibility: 'INTERNAL', body: '內部', original_body: null, edited_at: null, deleted_at: null },
    ];
    const s = maskComments(rows, false);
    expect(s.map((c) => c.id)).toEqual(['1', '2']);
    expect(s[0]).toMatchObject({ is_edited: true, is_deleted: false, body: '新內容' });
    expect((s[0] as any).original_body).toBeUndefined();
    expect(s[1]).toMatchObject({ is_edited: false, is_deleted: true, body: '（此留言已刪除）' });
    expect(JSON.stringify(s)).not.toContain('被刪的內容');
    const g = maskComments(rows, true);
    expect(g).toHaveLength(3);
    expect(g[0].original_body).toBe('舊內容');
    expect(g[1]).toMatchObject({ is_deleted: true, body: '（此留言已刪除）', original_body: '被刪的內容' });
  });
  it('採購單據：沒有採購評估權限就拿掉金額、供應商與品項', () => {
    const doc = { po_no: 'PO-1', status: 'ORDERED', vendor_name: 'V', total_amount: 100, subtotal: 95, items: [1], quotes: [2], final_amount: 9 };
    expect(maskPurchaseDoc(doc, true)).toEqual(doc);
    expect(maskPurchaseDoc(doc, false)).toEqual({ po_no: 'PO-1', status: 'ORDERED' });
  });
});

describe('可按的動作（requestAbilities）', () => {
  const who = { manage: false, ownStore: true, creator: true, commentOwnStore: true, confirmOwnStore: true, purchaseManage: false, stockIssue: false };
  const row = (s: string, extra: Record<string, unknown> = {}) => ({ main_status: s, request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART', intake_route: null, ...extra });
  it('店長：待受理可撤回；待補資料可補；待確認可確認與回報；不能受理或取消', () => {
    expect(requestAbilities(who, row('PENDING_INTAKE'), NONE)).toMatchObject({ withdraw: true, accept: false, cancel: false, comment: true });
    expect(requestAbilities(who, row('WAITING_STORE_SUPPLEMENT'), NONE)).toMatchObject({ submitSupplement: true, withdraw: false });
    expect(requestAbilities(who, row('WAITING_STORE_CONFIRMATION'), NONE)).toMatchObject({ confirmComplete: true, reportProblem: true, confirmIsProxy: false });
    expect(requestAbilities({ ...who, ownStore: false, creator: false }, row('WAITING_STORE_CONFIRMATION'), NONE)).toMatchObject({ confirmComplete: false, comment: false });
    expect(requestAbilities({ ...who, confirmOwnStore: false }, row('WAITING_STORE_CONFIRMATION'), NONE)).toMatchObject({ confirmComplete: false });
  });
  it('總務：代門市確認標記；有採購單或已出庫時取消、駁回、補資料的鈕收起；採購評估與出庫只在對的分流與狀態', () => {
    const ga = { ...who, manage: true, ownStore: false, creator: false, purchaseManage: true, stockIssue: true };
    expect(requestAbilities(ga, row('WAITING_STORE_CONFIRMATION'), NONE)).toMatchObject({ confirmComplete: true, confirmIsProxy: true });
    expect(requestAbilities(ga, row('ACCEPTED'), NONE)).toMatchObject({ cancel: true, reject: true, requestSupplement: true });
    expect(requestAbilities(ga, row('ACCEPTED'), { ...NONE, po_count: 1 })).toMatchObject({ cancel: false, reject: false, requestSupplement: false });
    expect(requestAbilities(ga, row('ACCEPTED', { intake_route: 'STOCK_ISSUE' }), NONE)).toMatchObject({ stockIssue: true, purchaseReview: false });
    expect(requestAbilities(ga, row('ACCEPTED', { intake_route: 'PURCHASE_REVIEW' }), NONE)).toMatchObject({ stockIssue: false, purchaseReview: true });
    expect(requestAbilities(ga, row('ACCEPTED', { intake_route: 'PURCHASE_REVIEW', request_type: 'REPAIR' }), NONE).purchaseReview).toBe(false);
    expect(requestAbilities(ga, row('PENDING_INTAKE', { intake_route: 'STOCK_ISSUE' }), NONE).stockIssue).toBe(false);
    expect(requestAbilities(ga, row('COMPLETED'), NONE)).toMatchObject({ reopen: true, cancel: false });
    expect(requestAbilities({ ...ga, purchaseManage: false, stockIssue: false }, row('ACCEPTED', { intake_route: 'STOCK_ISSUE' }), NONE)).toMatchObject({ stockIssue: false });
  });
});

describe('Q18 料件處理單：待交付與動作', () => {
  it('待交付＝已處理量達需求量且還沒送門市確認；異常、待決定、已送出、已完成都不算', () => {
    const f = (status: string, req: number | null, got: number) => ({ status, requested_quantity: req, fulfilled_quantity: got });
    expect(isReadyToDeliver(f('STOCK_ISSUE', 3, 3))).toBe(true);
    expect(isReadyToDeliver(f('WAITING_ARRIVAL', 3, 5))).toBe(true);
    expect(isReadyToDeliver(f('STOCK_ISSUE', 3, 2))).toBe(false);
    expect(isReadyToDeliver(f('STOCK_ISSUE', null, 2))).toBe(false);
    expect(isReadyToDeliver(f('STOCK_ISSUE', 0, 0))).toBe(false);
    for (const s of ['EXCEPTION', 'PENDING_DECISION', 'WAITING_STORE_CONFIRMATION', 'COMPLETED', 'CANCELED']) expect(isReadyToDeliver(f(s, 3, 3)), s).toBe(false);
    expect(fulfillmentLabel(f('STOCK_ISSUE', 3, 3))).toBe('待交付');
    expect(fulfillmentLabel(f('STOCK_ISSUE', 3, 1))).toBe('庫存出庫');
    expect(fulfillmentLabel(f('EXCEPTION', 3, 3))).toBe('異常');
    expect(remainingQuantity(f('STOCK_ISSUE', 3, 1))).toBe(2);
    expect(remainingQuantity(f('STOCK_ISSUE', 3, 9))).toBe(0);
  });
  it('可按動作：只有待交付才能送門市確認；異常才能作廢單據；已送出後不能再選處理方式', () => {
    const who = { manage: true, stockIssue: true, transfer: true, purchase: true };
    const base = { requested_quantity: 3, fulfilled_quantity: 3 };
    expect(fulfillmentAbilities(who, { ...base, status: 'STOCK_ISSUE' })).toMatchObject({ deliver: true, decide: true, voidDocuments: false, reportException: true, stockIssue: true });
    expect(fulfillmentAbilities(who, { ...base, status: 'EXCEPTION' })).toMatchObject({ deliver: false, voidDocuments: true, decide: true });
    expect(fulfillmentAbilities(who, { ...base, status: 'WAITING_STORE_CONFIRMATION' })).toMatchObject({ deliver: false, decide: false, reportException: true });
    expect(fulfillmentAbilities(who, { ...base, status: 'COMPLETED' })).toMatchObject({ decide: false, reportException: false });
    expect(fulfillmentAbilities({ ...who, manage: false }, { ...base, status: 'STOCK_ISSUE' })).toMatchObject({ deliver: false, decide: false, stockIssue: false });
    expect(fulfillmentAbilities(who, { requested_quantity: 3, fulfilled_quantity: 1, status: 'PURCHASING' })).toMatchObject({ purchase: true, deliver: false });
  });
});

describe('導覽與權限旗標（G14 至 G17）', () => {
  const has = (...allowed: string[]) => (...codes: string[]) => codes.some((c) => allowed.includes(c));
  it('四個旗標各自對應條件：新增需求＝需求單建立；我的追蹤＝查看自己門市／全部／管理；工作台＝查看全部或管理；料件處理中心＝處理單查看或管理', () => {
    const f = (...c: string[]) => gaFlags(has(...c), false);
    expect(f('general_affairs.request.create')).toMatchObject({ gaReportCreate: true, gaMyReports: false, gaRequests: false, gaPartFulfillments: false });
    expect(f('general_affairs.request.view_own_store')).toMatchObject({ gaReportCreate: false, gaMyReports: true, gaRequests: false });
    expect(f('general_affairs.request.view_all')).toMatchObject({ gaMyReports: true, gaRequests: true });
    expect(f('general_affairs.request.manage')).toMatchObject({ gaMyReports: true, gaRequests: true, gaReportCreate: false });
    expect(f('general_affairs.part_fulfillment.view')).toMatchObject({ gaPartFulfillments: true, gaRequests: false });
    expect(f('general_affairs.part_fulfillment.manage')).toMatchObject({ gaPartFulfillments: true });
    expect(f()).toMatchObject({ gaReportCreate: false, gaMyReports: false, gaRequests: false, gaPartFulfillments: false });
  });
  it('舊網址對應新版頁面；kind 已登錄', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/reports/new']).toEqual({ kind: 'ga-report-create', flag: 'gaReportCreate' });
    expect(GA_PAGE_BY_HREF['/general-affairs/reports/mine']).toEqual({ kind: 'ga-my-reports', flag: 'gaMyReports' });
    expect(GA_PAGE_BY_HREF['/general-affairs/requests']).toEqual({ kind: 'ga-requests', flag: 'gaRequests' });
    expect(GA_PAGE_BY_HREF['/general-affairs/part-fulfillments']).toEqual({ kind: 'ga-part-fulfillments', flag: 'gaPartFulfillments' });
    for (const k of ['ga-report-create', 'ga-my-reports', 'ga-requests', 'ga-part-fulfillments']) expect(WORKSPACE_TAB_KINDS).toContain(k);
  });
  it('側欄：持對應權限的人看得到新版入口；沒權限看不到', () => {
    const codes = (...c: string[]) => new Set(c);
    const nav = (perm: string[], role = 'x') => {
      const p = codes('general_affairs.service_center.access', ...perm);
      return gaNavigation({ has: (...c: string[]) => c.some((x) => p.has(x)), permissions: p as any, roleCodes: new Set([role]), isAdmin: false });
    };
    const kinds = (g: ReturnType<typeof nav>) => {
      const out: string[] = [];
      const walk = (items: any[]) => items.forEach((i) => { if (i.kind) out.push(i.kind); if (i.children) walk(i.children); });
      g.forEach((x) => walk(x.items));
      return out;
    };
    const ga = kinds(nav(['general_affairs.request.manage', 'general_affairs.request.create', 'general_affairs.part_fulfillment.manage']));
    expect(ga).toEqual(expect.arrayContaining(['ga-report-create', 'ga-my-reports', 'ga-requests', 'ga-part-fulfillments']));
    const store = kinds(nav(['general_affairs.request.view_own_store', 'general_affairs.request.create']));
    expect(store).toEqual(expect.arrayContaining(['ga-report-create', 'ga-my-reports']));
    expect(store).not.toContain('ga-requests');
    expect(store).not.toContain('ga-part-fulfillments');
    const none = kinds(nav([]));
    for (const k of ['ga-report-create', 'ga-my-reports', 'ga-requests', 'ga-part-fulfillments']) expect(none).not.toContain(k);
  });
});
