import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF } from '@/lib/workspace/general-affairs/nav';
import {
  ATTENTION, BADGE_MENUS, BADGE_MENU_KIND, HOME_ITEMS, HOME_ITEM_KEYS, MENU_PAYLOAD, attentionOn, avgDaysText, capBadge, groupBadgeTotal, homeTotal, parseAnalysisMonth, parsePerfRange, workOrderAttention,
} from '@/lib/workspace/general-affairs/home-rules';
import { parseListFilters } from '@/lib/workspace/general-affairs/work-order-rules';
import { isOverdue as transferOverdue } from '@/lib/workspace/general-affairs/inventory-transfer-rules';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

// 第 6 批 G22 廠商績效與採購分析、G24 首頁與導覽徽章（純函式）單元測試：
// 徽章九項與權限對照、99+ 上限、首頁合計、點進去的頁面與篩選、attention 參數解析、績效與採購分析參數驗證、資料累積中文字、
// 選單／頁面／API 權限常數一致、SQL 檔內的條件常數與 TS 常數逐條對齊（徽章與列表共用述詞）、調撥逾期邊界。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.sql'), 'utf8');
const has = (set: string[]) => (...codes: string[]) => codes.some((c) => set.includes(c));

describe('徽章九項與權限對照', () => {
  it('九項鍵齊全且各自有名稱、選單、權限、頁面 kind；kind 都是登錄過的頁面', () => {
    expect(HOME_ITEM_KEYS).toHaveLength(9);
    for (const k of HOME_ITEM_KEYS) {
      const d = HOME_ITEMS[k];
      expect(d.label, k).toBeTruthy();
      expect(BADGE_MENUS, k).toContain(d.menu);
      expect(d.perms.length, k).toBeGreaterThan(0);
      for (const p of d.perms) expect(p, k).toMatch(/^general_affairs\./);
      expect(WORKSPACE_TAB_KINDS, k).toContain(d.kind);
      expect(WORKSPACE_PAGE_META[d.kind], k).toBeTruthy();
    }
  });
  it('每個選單鍵對應唯一的頁面 kind，且 kind 有對應的側欄入口旗標', () => {
    const kinds = BADGE_MENUS.map((m) => BADGE_MENU_KIND[m]);
    expect(new Set(kinds).size).toBe(kinds.length);
    const hrefKinds = new Set(Object.values(GA_PAGE_BY_HREF).map((p) => p.kind));
    for (const k of kinds) expect(hrefKinds.has(k) || ['ga-my-reports', 'ga-requests', 'ga-work-orders', 'ga-inventory-transfers', 'ga-onboarding-review', 'ga-purchase-approvals'].includes(k), k).toBe(true);
  });
  it('點進去的頁面與篩選：需求單、我的追蹤待辦帶 attention；帳單帶 overdue；廠商帶 contract_due；工單帶 store_rejected；採購單選單是聯集（attention）', () => {
    expect(HOME_ITEMS.request_intake.payload).toEqual({ attention: '1' });
    expect(HOME_ITEMS.store_wait.payload).toEqual({ attention: '1' });
    expect(HOME_ITEMS.bill_overdue.payload).toEqual({ overdue: true });
    expect(HOME_ITEMS.contract_due.payload).toEqual({ contract_due: true });
    expect(HOME_ITEMS.wo_store_rejected.payload).toEqual({ attention: 'store_rejected' });
    expect(HOME_ITEMS.po_overdue.payload).toEqual({ overdue: true });
    expect(HOME_ITEMS.po_pending.kind).toBe('ga-purchase-approvals');
    expect(MENU_PAYLOAD.purchase_orders).toEqual({ attention: '1' });
    expect(MENU_PAYLOAD.work_orders).toEqual({ attention: 'store_rejected' });
  });
  it('只有持資料庫權限的人才有對應旗標：門市待確認只認自己門市的確認／留言權限；採購核准人沒有採購單以外的旗標', () => {
    const f = gaFlags(has(['general_affairs.purchase_order.approve']), false, false, false, has(['general_affairs.purchase_order.approve']));
    expect(f.gaPurchaseOrders).toBe(true);
    expect(f.gaPurchaseApprovals).toBe(true);
    expect(f.gaVendorStats).toBe(false);
    expect(f.gaPurchaseAnalysis).toBe(false); // 採購分析要採購評估檢視／管理，核准人不放行
    const coop = gaFlags(has(['general_affairs.cooperation_record.view']), false, false, false, has(['general_affairs.cooperation_record.view']));
    expect(coop.gaVendorStats).toBe(true);
    expect(coop.gaVendors).toBe(false);
    const review = gaFlags(has(['general_affairs.purchase_review.view']), false, false, false, has(['general_affairs.purchase_review.view']));
    expect(review.gaPurchaseAnalysis).toBe(true);
    expect(review.gaVendorStats).toBe(false);
    // 舊式管理員（導覽 has 含後備、資料庫語意沒有）：導覽看得到入口的旗標不包含合作紀錄與採購分析（兩個都用資料庫語意，入口不比 API 寬）
    const admin = gaFlags(() => true, false, false, false, has([]));
    expect(admin.gaVendorStats).toBe(false);
    expect(admin.gaPurchaseAnalysis).toBe(false);
  });
});

describe('99+ 與首頁合計', () => {
  it('0 與無效值不顯示；1 至 99 原樣；100 以上顯示 99+', () => {
    for (const v of [0, -3, NaN, null, undefined]) expect(capBadge(v as number), String(v)).toBe('');
    expect(capBadge(1)).toBe('1');
    expect(capBadge(99)).toBe('99');
    expect(capBadge(100)).toBe('99+');
    expect(capBadge(12345)).toBe('99+');
    expect(capBadge(7.9)).toBe('7');
  });
  it('首頁合計＝九項加總（缺項當 0、不重複加採購單選單的聯集）', () => {
    expect(homeTotal({})).toBe(0);
    expect(homeTotal({ request_intake: 3, bill_overdue: 2, po_pending: 1, po_overdue: 4, po_menu: 5 })).toBe(10);
    expect(homeTotal(Object.fromEntries(HOME_ITEM_KEYS.map((k) => [k, 11])))).toBe(99);
  });
});

describe('attention 參數與參數驗證', () => {
  it('attention 只接受 1 與 true；工單只接受 store_rejected', () => {
    expect(attentionOn('1')).toBe(true);
    expect(attentionOn('true')).toBe(true);
    for (const v of ['0', 'false', '', 'yes', null, undefined]) expect(attentionOn(v as string)).toBe(false);
    expect(workOrderAttention('store_rejected')).toBe('store_rejected');
    expect(workOrderAttention('x')).toBeNull();
    expect(parseListFilters(new URLSearchParams('attention=store_rejected')).focus).toBe('store_rejected');
    expect(() => parseListFilters(new URLSearchParams('attention=bogus'))).toThrow();
    expect(parseListFilters(new URLSearchParams('')).focus).toBeUndefined();
  });
  it('績效區間：格式、起迄顛倒、36 個月上限（含剛好 36 個月）', () => {
    expect(parsePerfRange(new URLSearchParams(''))).toEqual({ from: null, to: null });
    expect(parsePerfRange(new URLSearchParams('from=2038-01&to=2038-12'))).toEqual({ from: '2038-01', to: '2038-12' });
    expect(parsePerfRange(new URLSearchParams('from=2038-01&to=2040-12'))).toEqual({ from: '2038-01', to: '2040-12' });
    for (const q of ['from=2038-13', 'from=2038-1', 'to=abc', 'from=2038-05&to=2038-04', 'from=2038-01&to=2041-01']) expect(() => parsePerfRange(new URLSearchParams(q)), q).toThrow();
  });
  it('採購分析月份：YYYY-MM；yearMonth 與 month 都接受；空白回 null', () => {
    expect(parseAnalysisMonth(new URLSearchParams('yearMonth=2038-03'))).toBe('2038-03');
    expect(parseAnalysisMonth(new URLSearchParams('month=2038-03'))).toBe('2038-03');
    expect(parseAnalysisMonth(new URLSearchParams(''))).toBeNull();
    for (const q of ['yearMonth=2038', 'yearMonth=2038-00', 'yearMonth=2038-13', 'yearMonth=x']) expect(() => parseAnalysisMonth(new URLSearchParams(q)), q).toThrow();
  });
  it('資料不足顯示「資料累積中」而不是 0；有樣本才顯示天數', () => {
    expect(avgDaysText({ wo_count: 0, avg_days: null })).toBe('資料累積中');
    expect(avgDaysText({ wo_count: 3, avg_days: null })).toBe('資料累積中');
    expect(avgDaysText({ wo_count: 3, avg_days: 2.5 })).toBe('2.5 天');
    expect(avgDaysText({ wo_count: 1, avg_days: 0 })).toBe('0 天');
  });
});

describe('導覽、頁面與 API 權限常數一致', () => {
  it('合作紀錄與採購分析：側欄舊網址對到新版 kind，頁面所需旗標與 API 放行條件相同', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/stats']).toEqual({ kind: 'ga-vendor-stats', flag: 'gaVendorStats' });
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/purchases']).toEqual({ kind: 'ga-purchase-analysis', flag: 'gaPurchaseAnalysis' });
    expect(WORKSPACE_PAGE_META['ga-vendor-stats'].permission).toEqual(['gaVendorStats']);
    expect(WORKSPACE_PAGE_META['ga-purchase-analysis'].permission).toEqual(['gaPurchaseAnalysis']);
    const stats = fs.readFileSync(path.join(ROOT, 'lib/workspace/general-affairs/vendor-stats.ts'), 'utf8');
    const analysis = fs.readFileSync(path.join(ROOT, 'lib/workspace/general-affairs/purchase-analysis.ts'), 'utf8');
    const access = fs.readFileSync(path.join(ROOT, 'lib/workspace/general-affairs/access.ts'), 'utf8');
    expect(stats).toContain('VD.coopView');
    expect(access).toContain('gaVendorStats: dbHas("general_affairs.cooperation_record.view")');
    expect(analysis).toContain('VD.reviewView, VD.reviewManage');
    expect(access).toContain('gaPurchaseAnalysis: dbHas("general_affairs.purchase_review.view", "general_affairs.purchase_review.manage")');
  });
  it('首頁項目的權限碼都出現在資料庫函式裡（徽章只對有權限者回傳）', () => {
    // 權限碼寫在 ga_hm_counts 本身，或它呼叫的判斷函式（帳單 ga_ub_can_view、廠商 ga_vd_can_view、採購 ga_po_can_view）
    const read = (n: string) => fs.readFileSync(path.join(ROOT, 'supabase/workspace-dev', n), 'utf8');
    const body = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.ga_hm_counts'), SQL.indexOf('CREATE OR REPLACE FUNCTION public.ga_ws_home_badges'))
      + read('20261118110000_m7m8_b6_utility_bills.sql') + read('20261118100000_m7m8_b6_vendor_rpc.sql') + read('20261112110000_m7m8_b4_purchase_orders.sql');
    for (const k of HOME_ITEM_KEYS) for (const p of HOME_ITEMS[k].perms) expect(body, `${k} ${p}`).toContain(p);
  });
});

describe('TS 常數與 SQL 述詞逐條對齊（徽章與列表共用條件）', () => {
  it('需求單待受理、門市待確認／待補資料、採購單待核准與逾期、調撥待收貨狀態、合約提醒天數', () => {
    expect(SQL).toContain(`p_main_status = '${ATTENTION.requestIntakeStatus}'`);
    for (const s of ATTENTION.storeWaitStatuses) expect(SQL, s).toContain(`'${s}'`);
    expect(SQL).toContain(`p_status = '${ATTENTION.poPendingStatus}'`);
    expect(SQL).toContain(`p_status IN (${ATTENTION.poOverdueStatuses.map((s) => `'${s}'`).join(', ')})`);
    expect(SQL).toContain(`p_status IN (${ATTENTION.transferAwaitingStatuses.map((s) => `'${s}'`).join(', ')})`);
    expect(SQL).toContain(`ga_wo_focus(status, progress_stage) = '${ATTENTION.woFocus}'`);
    // 合約到期述詞在第 100000 檔（ga_vd_contract_due）：與 TS 常數一致
    const vendorSql = fs.readFileSync(path.join(ROOT, 'supabase/workspace-dev/20261118100000_m7m8_b6_vendor_rpc.sql'), 'utf8');
    expect(vendorSql).toContain(`p_end <= public.ga_po_today() + ${ATTENTION.contractDueDays}`);
  });
  it('列表篩選程式碼用同一組常數（需求單、我的追蹤、採購單、工單）', () => {
    const requests = fs.readFileSync(path.join(ROOT, 'lib/workspace/general-affairs/requests.ts'), 'utf8');
    expect(requests).toContain('ATTENTION.storeWaitStatuses');
    expect(requests).toContain('ATTENTION.requestIntakeStatus');
    const po = fs.readFileSync(path.join(ROOT, 'lib/workspace/general-affairs/purchase-orders.ts'), 'utf8');
    expect(po).toContain('filters.attention = true');
    expect(SQL).toContain('public.ga_att_po(o.status, o.expected_delivery_date');
  });
  it('調撥逾期：剛好 N 天整不算逾期、超過才算；只有待收貨狀態；沒有交出時間不算（與 SQL 的「早於現在減 N 天」同一個方向）', () => {
    const days = 3;
    const at = (min: number) => new Date(Date.now() - days * 86_400_000 - min * 60_000).toISOString();
    expect(transferOverdue({ status: 'SOURCE_CONFIRMED', source_confirmed_at: at(1) }, days)).toBe(true);
    expect(transferOverdue({ status: 'IN_TRANSIT', source_confirmed_at: at(1) }, days)).toBe(true);
    expect(transferOverdue({ status: 'SOURCE_CONFIRMED', source_confirmed_at: at(-1) }, days)).toBe(false);
    expect(transferOverdue({ status: 'RECEIVED', source_confirmed_at: at(1000) }, days)).toBe(false);
    expect(transferOverdue({ status: 'REQUESTED', source_confirmed_at: null }, days)).toBe(false);
    expect(SQL).toContain('p_source_confirmed_at < now() - make_interval(days => COALESCE(p_days, 3))');
  });
  it('績效完成數定義寫在資料庫：完成＝COMPLETED 且 STORE_CONFIRMED；強制結案與未記方式另計；平均天數只算門市確認的', () => {
    expect(SQL).toContain("status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED'");
    expect(SQL).toContain("status = 'COMPLETED' AND completion_method = 'ADMIN_FORCE_CLOSED'");
    expect(SQL).toContain("status = 'COMPLETED' AND completion_method IS NULL");
    expect(SQL).toMatch(/avg\(extract\(epoch FROM \(completed_at - accepted_at\)\) \/ 86400\.0\) FILTER \(WHERE status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED'/);
    expect(SQL).toContain("o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED')");
  });
  it('每個資料庫對外函式都有 REVOKE 與 GRANT，內部述詞不開放', () => {
    for (const f of ['ga_ws_vendor_perf', 'ga_ws_purchase_analysis', 'ga_ws_home_badges', 'ga_ws_home_summary']) expect(SQL).toContain(`public.${f}(`);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.ga_att_request_intake\(text\)[\s\S]*public\.ga_hm_counts\(\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.ga_ws_vendor_perf\(text, text\)[\s\S]*TO authenticated;/);
    expect(fs.readFileSync(path.join(ROOT, 'supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.rollback.sql'), 'utf8')).toContain('DROP FUNCTION IF EXISTS public.ga_ws_home_summary()');
  });
});

describe('群組徽章加總（審查 B3）', () => {
  it('採購單選單（待核准加逾期）與待簽核採購單同群組時，待核准不重複算', () => {
    // 核准人：待核准 2、逾期 3 → 採購單選單 5、待簽核採購單 2，群組應為 5 而不是 7
    expect(groupBadgeTotal([{ kind: 'ga-purchase-orders', count: 5 }, { kind: 'ga-purchase-approvals', count: 2 }, { kind: 'ga-requests', count: 4 }])).toBe(9);
  });
  it('沒有核准權限（待簽核為 0）或只有其中一個入口時照原樣加總；不會變負數', () => {
    expect(groupBadgeTotal([{ kind: 'ga-purchase-orders', count: 3 }, { kind: 'ga-purchase-approvals', count: 0 }])).toBe(3);
    expect(groupBadgeTotal([{ kind: 'ga-purchase-approvals', count: 2 }, { kind: 'ga-requests', count: 1 }])).toBe(3);
    expect(groupBadgeTotal([{ kind: 'ga-purchase-orders', count: 0 }, { kind: 'ga-purchase-approvals', count: 2 }])).toBe(0);
    expect(groupBadgeTotal([])).toBe(0);
  });
});
