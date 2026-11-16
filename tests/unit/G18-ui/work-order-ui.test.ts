import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_NAV_KINDS, WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { WO_FOCUS_KEYS, WO_STAGES, checkWoAction, focusOf, woNo, workOrderAbilities, type WoState } from '@/lib/workspace/general-affairs/work-order-rules';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import { EVENT_LABEL, FOCUS_LABEL, PRIORITY_LABEL, QUICK_PROGRESS, SUPPLEMENT_LABEL, selectableStages, storeLabel } from '../../../vue-workspace/src/lib/ga-work-orders';

// 第 5 批 G18-ui（畫面層）：導覽旗標與側欄、頁面登錄一致、階段選單與快捷鈕符合流轉表、焦點卡與事件文字涵蓋、
// 列印樣式與按鈕文案（W3 強制結案改名、W8 舊式單不提供重新開啟、W7 內部備註預設不印）、原始碼層級的畫面規則。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (...allowed: string[]) => (...codes: string[]) => codes.some((c) => allowed.includes(c));
const VIEW_OWN = 'general_affairs.work_order.view_own_store';
const VIEW_ALL = 'general_affairs.work_order.view_all';
const UPDATE = 'general_affairs.work_order.update';
const MR_CREATE = 'general_affairs.maintenance_request.create';
const CROSS_SUBMIT = 'cross_dept.maintenance.submit';

describe('G18 導覽旗標與頁面登錄', () => {
  const f = (...c: string[]) => gaFlags(has(...c), false);
  it('工單中心與跨部門頁的入口條件：任一查看、更新或回報權限；沒有權限都是 false', () => {
    for (const c of [VIEW_OWN, VIEW_ALL, UPDATE, MR_CREATE, CROSS_SUBMIT, 'general_affairs.work_order.manage', 'cross_dept.maintenance.view_all', 'cross_dept.maintenance.update', 'general_affairs.maintenance_request.view_all']) {
      expect(f(c), c).toMatchObject({ gaWorkOrders: true, gaCrossDeptMaintenance: true });
    }
    expect(f()).toMatchObject({ gaWorkOrders: false, gaCrossDeptMaintenance: false });
    expect(f('general_affairs.part.view', 'general_affairs.inventory_transaction.manage')).toMatchObject({ gaWorkOrders: false });
    // 兩頁共用同一組條件（Q19：跨部門頁也認新總務權限）
    for (const c of [VIEW_OWN, UPDATE]) expect(f(c).gaWorkOrders).toBe(f(c).gaCrossDeptMaintenance);
  });
  it('旗標與 workOrderAbilities.canEnter 一致（入口不比 API 寬也不比 API 窄）', () => {
    for (const c of [VIEW_OWN, VIEW_ALL, UPDATE, MR_CREATE, CROSS_SUBMIT, 'general_affairs.part.view', 'general_affairs.request.view_all']) {
      const p = new Set([c]);
      expect(f(c).gaWorkOrders, c).toBe(workOrderAbilities(p).canEnter);
    }
  });
  it('舊網址 /general-affairs/work-orders 對到 ga-work-orders；兩個 kind 都已登錄且標題與權限鍵正確', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/work-orders']).toEqual({ kind: 'ga-work-orders', flag: 'gaWorkOrders' });
    expect(WORKSPACE_TAB_KINDS).toEqual(expect.arrayContaining(['ga-work-orders', 'cross-dept-maintenance']));
    expect(WORKSPACE_NAV_KINDS as readonly string[]).toContain('cross-dept-maintenance');
    expect(WORKSPACE_PAGE_META['ga-work-orders']).toMatchObject({ title: '工單中心', permission: ['gaWorkOrders'] });
    expect(WORKSPACE_PAGE_META['cross-dept-maintenance']).toMatchObject({ title: '總務組維修', permission: ['gaCrossDeptMaintenance'] });
    const pages = read('vue-workspace/src/workspace-pages.ts');
    expect(pages).toMatch(/"ga-work-orders": WorkOrderCenter,/);
    expect(pages).toMatch(/"cross-dept-maintenance": CrossDeptMaintenance,/);
  });
  const nav = (perm: string[]) => {
    const p = new Set(perm);
    return gaNavigation({ has: (...c: string[]) => c.some((x) => p.has(x)), permissions: p as any, roleCodes: new Set(['x']), isAdmin: false });
  };
  const kinds = (g: ReturnType<typeof nav>) => g.flatMap((x) => x.items.flatMap((i) => [i, ...(i.children || [])])).map((i) => i.kind).filter(Boolean);
  it('側欄：有工單權限的人看得到「工單中心」且 kind 是 ga-work-orders；沒有權限的人看不到', () => {
    for (const c of [VIEW_OWN, VIEW_ALL, UPDATE]) {
      const g = nav([c]);
      expect(kinds(g), c).toContain('ga-work-orders');
      const item = g.flatMap((x) => x.items).find((i) => i.kind === 'ga-work-orders')!;
      expect(item.label).toBe('工單中心');
    }
    expect(kinds(nav([]))).not.toContain('ga-work-orders');
    expect(kinds(nav(['general_affairs.part.view']))).not.toContain('ga-work-orders');
  });
  it('只持維修回報權限（舊側欄沒有工單旗標）也補上「工單中心」，不重複列出', () => {
    const g = nav([MR_CREATE]);
    const all = g.flatMap((x) => x.items.flatMap((i) => [i, ...(i.children || [])])).filter((i) => i.kind === 'ga-work-orders');
    expect(all.length).toBe(1);
  });
  it('navigation.ts 的總務組項目掛上 cross-dept-maintenance kind；GaCenter 不再說工單在舊版', () => {
    const navSrc = read('lib/workspace/navigation.ts');
    expect(navSrc).toMatch(/"\/cross-dept\/maintenance"[\s\S]{0,260}"cross-dept-maintenance"/);
    const center = read('vue-workspace/src/pages/ga/GaCenter.vue');
    expect(center).not.toMatch(/工單.{0,6}仍在舊版/);
    expect(center).not.toMatch(/需求單、工單、庫存/);
  });
});

describe('G18 畫面用的階段選單、快捷鈕與文字表', () => {
  it('更新進度的階段選單不含「待門市確認」；有需求單時也不含「等待門市補充資料」；其餘 14／15 個階段都在', () => {
    const legacy = selectableStages(false).map((s) => s.code);
    const linked = selectableStages(true).map((s) => s.code);
    expect(legacy).not.toContain('WAITING_STORE_CONFIRMATION');
    expect(legacy).toContain('WAITING_STORE_INFO');
    expect(linked).not.toContain('WAITING_STORE_INFO');
    expect(legacy.length).toBe(WO_STAGES.length - 1);
    expect(linked.length).toBe(WO_STAGES.length - 2);
  });
  it('選單裡的每個階段都能通過流轉表（存進度），選單外的兩個階段會被擋', () => {
    const open: WoState = { status: 'PROCESSING', stage: 'INITIAL_REVIEW', linked: true, requestStatus: 'IN_PROGRESS' };
    for (const s of selectableStages(true)) expect(checkWoAction('SAVE_PROGRESS', open, { stage: s.code }).ok, s.code).toBe(true);
    expect(checkWoAction('SAVE_PROGRESS', open, { stage: 'WAITING_STORE_CONFIRMATION' }).ok).toBe(false);
    expect(checkWoAction('SAVE_PROGRESS', open, { stage: 'WAITING_STORE_INFO' }).ok).toBe(false);
  });
  it('快捷鈕的階段都在可選階段內、說明不是空的、id 不重複', () => {
    const ok = new Set(selectableStages(true).map((s) => s.code));
    for (const q of QUICK_PROGRESS) {
      expect(ok.has(q.stage as any), q.id).toBe(true);
      expect(q.note.length).toBeGreaterThan(3);
      expect(q.label.length).toBeGreaterThan(1);
    }
    expect(new Set(QUICK_PROGRESS.map((q) => q.id)).size).toBe(QUICK_PROGRESS.length);
  });
  it('焦點卡名稱涵蓋六個焦點；每個階段都分得到一張焦點卡', () => {
    for (const k of WO_FOCUS_KEYS) expect(FOCUS_LABEL[k], k).toBeTruthy();
    for (const s of WO_STAGES) expect(WO_FOCUS_KEYS).toContain(focusOf('PROCESSING', s.code));
    expect(focusOf('COMPLETED', 'VENDOR_WORKING')).toBe('completed');
  });
  it('補資料類型六種、優先順序四種、事件文字涵蓋時間軸會出現的事件', () => {
    expect(Object.keys(SUPPLEMENT_LABEL).sort()).toEqual(['DESCRIPTION_INSUFFICIENT', 'MISSING_PHOTO', 'OTHER', 'PHOTO_UNCLEAR', 'QUANTITY_OR_SPEC_INSUFFICIENT', 'RESOURCE_SELECTION_WRONG']);
    expect(Object.keys(PRIORITY_LABEL)).toEqual(['low', 'normal', 'high', 'urgent']);
    for (const e of ['CREATED', 'ACCEPT', 'MIGRATED', 'STORE_MOVED', 'PART_ISSUED', 'CATEGORY_CHANGED', 'FORCE_CLOSE_NOTICE', 'REQUEST_SYNC_SKIPPED']) expect(EVENT_LABEL[e], e).toBeTruthy();
  });
  it('門市文字與工單編號', () => {
    expect(storeLabel({ store_code: 'VW001', store_name: '測試店' })).toBe('VW001 測試店');
    expect(storeLabel({})).toBe('—');
    expect(woNo('abcdef12-3456')).toBe('WO-ABCDEF12');
  });
});

describe('G18 畫面原始碼規則（文案與可見條件）', () => {
  const detail = read('vue-workspace/src/components/ga/WorkOrderDetail.vue');
  const board = read('vue-workspace/src/components/ga/WorkOrderBoard.vue');
  it('W3：強制結案按鈕叫「不處理，強制結案」，原因必填且說明門市只看到「總務已結案」', () => {
    expect(detail).toContain('不處理，強制結案');
    expect(detail).toContain('門市只會看到「總務已結案」');
    expect(detail).toMatch(/force_close_reason: notes/);
  });
  it('W8：沒有任何「重新開啟」按鈕（沒有需求單的舊式單完成後不提供；有需求單者引導到需求單端）', () => {
    expect(detail).not.toMatch(/>\s*重新開啟\s*</);
    expect(detail).not.toContain('act-reopen');
    expect(detail).toContain('reopen_note');
  });
  it('W2：領用料件走 issue-part，帶固定識別，說明庫存流水記工單編號；W1：補資料說明工單與需求單同進待補資料', () => {
    expect(detail).toContain('/issue-part');
    expect(detail).toContain('idempotency_key: partKey');
    expect(detail).toContain('庫存流水記這張工單的編號');
    expect(detail).toContain('工單與需求單會同時進入「待門市補資料」');
  });
  it('寫入一律帶 expected_updated_at，衝突（STALE）時提示重新載入', () => {
    expect((detail.match(/expected_updated_at/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(detail).toContain('isStaleWo');
    expect(detail).toContain('重新載入最新內容');
  });
  it('W4：刪除按鈕只看伺服端 can_delete，說明附件只標記；不能刪時列出原因', () => {
    expect(detail).toContain('ab.can_delete');
    expect(detail).toContain('附件照片只會標記為已刪除');
    expect(detail).toContain('delete_reason');
  });
  it('W5：照片區合併顯示，舊版照片標「舊版照片」；上傳只收圖片、最多 5 張', () => {
    expect(detail).toContain('舊版照片');
    expect(detail).toMatch(/images-only :max="5"/);
  });
  it('W7：列印入口在工單詳情；「包含內部備註」預設不勾，只有總務端看得到勾選', () => {
    expect(detail).toContain('列印工單表單');
    const print = read('vue-workspace/src/components/ga/WorkOrderPrint.vue');
    expect(print).toContain('const includeInternal = ref(false)');
    expect(print).toMatch(/v-if="canInternal" class="wo-print-internal"/);
    expect(print).toContain('? "?include_internal=1" : ""');
    expect(print).toContain('window.print()');
    const css = read('vue-workspace/src/style.css');
    expect(css).toMatch(/@page\{size:A4;margin:15mm\}html:has\(\.wo-print-output\)/);
    expect(css).toContain('body:has(>.wo-print-output)>*:not(.wo-print-output){display:none!important}');
    const sheet = read('vue-workspace/src/components/ga/WorkOrderSheet.vue');
    expect(sheet).toContain('v-if="data.include_internal"');
  });
  it('列表：焦點卡由資料庫計數（focus_counts），不是只算已載入的；搜尋、分頁、精確筆數都走伺服端', () => {
    expect(board).toContain('res.focus_counts');
    expect(board).toContain('共 {{ total }} 張');
    expect(board).toContain('pageSize');
    expect(board).not.toMatch(/\.filter\(\(r\) => r\.title/);
  });
  it('手機單欄：窄螢幕列表與詳情擇一顯示，並有「回到列表」', () => {
    expect(board).toMatch(/\.wob\.has-detail \.wob-list \{ display: none; \}/);
    expect(detail).toContain('回到列表');
  });
  it('W6：跨部門頁新增回報最多 5 張照片、只收圖片；維修分類管理只給有分類編輯權限者', () => {
    const create = read('vue-workspace/src/components/ga/WorkOrderCreate.vue');
    expect(create).toMatch(/images-only :max="5"/);
    expect(create).toContain('idempotency_key');
    expect(board).toContain('perms?.canEditCategories');
    expect(board).toContain('perms?.canCreateLegacy');
  });
  it('需求單詳情顯示工單摘要（階段、公開進度、結案方式、前往工單），沒有工單查看權限時整塊不顯示', () => {
    const req = read('vue-workspace/src/components/ga/RequestDetail.vue');
    expect(req).toContain('<WorkOrderSummary v-if="row.maintenance_request_id"');
    const sum = read('vue-workspace/src/components/ga/WorkOrderSummary.vue');
    for (const t of ['wos-stage', 'wos-progress', 'wos-completion', 'wos-goto']) expect(sum).toContain(t);
    expect(sum).toContain('v-if="data"');
    expect(sum).toContain('catch { data.value = null; }');
  });
});
