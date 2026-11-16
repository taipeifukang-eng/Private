import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAINTENANCE_PROGRESS_STAGE_LABELS, EXECUTION_PROGRESS_STAGES } from '@/lib/maintenance/status';
import {
  checkWoAction, escapeLike, focusOf, isExecStage, isImageName, LEGACY_MAX_PHOTOS, maskTimeline, maskWorkOrderDetail, maskWorkOrderRow, mergePhotos, normalizeSearch, parseExpected, parseListFilters,
  shapePrint, sniffImageType, stageLabel, validateForceClose, validateIssuePart, validateLegacyReport, validateProgressPayload, validateSupplement, WO, WO_ACTIONS, WO_FOCUS_KEYS, WO_STAGES, WO_STATUSES,
  woNo, workOrderAbilities, type WoAction, type WoState,
} from '@/lib/workspace/general-affairs/work-order-rules';

// M7/M8 第 5 批 G18-api：工單規則純函式（流轉表全覆蓋、焦點卡、abilities、搜尋跳脫、階段常數與 DB 16 列一致、驗證、遮蔽、照片、列印）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const U = '3f2b1c9e-8a1d-4c47-9b52-1d2e3f4a5b6c';
const U2 = '4f2b1c9e-8a1d-4c47-9b52-1d2e3f4a5b6d';
const has = (...codes: string[]) => ({ has: (c: string) => codes.includes(c) });
const S = (status: WoState['status'], stage: string | null = null, linked = false, requestStatus: string | null = null): WoState => ({ status, stage, linked, requestStatus });

describe('G18.unit 階段常數', () => {
  it('16 階段碼與標籤、執行類與 lib/maintenance/status.ts 完全相同（含順序）', () => {
    expect(WO_STAGES.map((s) => s.code)).toEqual(Object.keys(MAINTENANCE_PROGRESS_STAGE_LABELS));
    for (const s of WO_STAGES) {
      expect(s.label).toBe((MAINTENANCE_PROGRESS_STAGE_LABELS as Record<string, string>)[s.code]);
      expect(s.exec, s.code).toBe(EXECUTION_PROGRESS_STAGES.has(s.code as any));
    }
    expect(WO_STAGES).toHaveLength(16);
  });
  it('階段碼、排序與 DB 16 列（種子 migration）一致；OTHER 排序 990', () => {
    const sql = read('supabase/migrations/20260827131500_seed_maintenance_progress_stages.sql');
    const rows = Array.from(sql.matchAll(/\('([A-Z_]+)', '([^']+)', (\d+), true\)/g)).map((m) => ({ code: m[1], label: m[2], sort: Number(m[3]) }));
    expect(rows).toHaveLength(16);
    expect(WO_STAGES.map((s) => ({ code: s.code, label: s.label, sort: s.sort }))).toEqual(rows);
    expect(WO_STAGES.find((s) => s.code === 'OTHER')!.sort).toBe(990);
  });
  it('階段碼與資料庫函式 ga_wo_stage_codes／標籤對齊', () => {
    const sql = read('supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules.sql');
    const codes = /ga_wo_stage_codes\(\)[^$]*\$\$ SELECT ARRAY\[([^\]]+)\]/.exec(sql)![1].match(/'([A-Z_]+)'/g)!.map((x) => x.replace(/'/g, ''));
    expect(codes).toEqual(WO_STAGES.map((s) => s.code));
    for (const s of WO_STAGES) expect(sql).toContain(`'${s.label}'`);
  });
  it('執行類階段與 DB ga_wo_is_exec_stage 同一批', () => {
    const sql = read('supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules.sql');
    const block = /ga_wo_is_exec_stage[\s\S]*?\$\$ SELECT p_code = ANY \(ARRAY\[([\s\S]*?)\]::text\[\]\)/.exec(sql)![1].match(/'([A-Z_]+)'/g)!.map((x) => x.replace(/'/g, ''));
    expect(block.sort()).toEqual(WO_STAGES.filter((s) => s.exec).map((s) => s.code).sort());
  });
  it('工單編號 WO- 加 id 前 8 碼大寫；標籤查詢', () => {
    expect(woNo(U)).toBe('WO-3F2B1C9E');
    expect(stageLabel('WAITING_PARTS')).toBe('等待料件');
    expect(stageLabel('NOPE')).toBeNull();
    expect(isExecStage('INITIAL_REVIEW')).toBe(false);
    expect(isExecStage('VENDOR_WORKING')).toBe(true);
  });
});

describe('G18.unit 焦點卡分類', () => {
  it('16 階段 × 狀態：已完成最優先；其餘依階段', () => {
    const expected: Record<string, string> = {
      INITIAL_REVIEW: 'arrange', WAITING_STORE_INFO: 'arrange', INTERNAL_HANDLING: 'arrange', SEARCHING_VENDOR: 'vendor', WAITING_VENDOR_REPLY: 'vendor', WAITING_VENDOR_QUOTE: 'vendor',
      QUOTE_REVIEW: 'vendor', VENDOR_ASSIGNED: 'vendor', WAITING_VENDOR_VISIT: 'vendor', VENDOR_WORKING: 'vendor', WAITING_PARTS: 'parts', PARTS_IN_TRANSIT: 'parts',
      WAITING_INTERNAL_APPROVAL: 'arrange', WAITING_STORE_CONFIRMATION: 'store_confirmation', REOPENED: 'store_rejected', OTHER: 'arrange',
    };
    for (const s of WO_STAGES) {
      expect(focusOf('PROCESSING', s.code), s.code).toBe(expected[s.code]);
      expect(focusOf('COMPLETED', s.code)).toBe('completed');
    }
    expect(focusOf('UNACCEPTED', null)).toBe('arrange');
    expect(new Set(Object.values(expected))).toEqual(new Set(['arrange', 'vendor', 'parts', 'store_confirmation', 'store_rejected']));
    expect(WO_FOCUS_KEYS).toHaveLength(6);
  });
  it('與 DB ga_wo_focus 的分類一致（SQL 文字核對）', () => {
    const sql = read('supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules.sql');
    const fn = /ga_wo_focus\(p_status text, p_stage text\)[\s\S]*?ELSE 'arrange' END;/.exec(sql)![0];
    expect(fn).toContain("p_stage = 'REOPENED' THEN 'store_rejected'");
    expect(fn).toContain("p_stage = 'WAITING_STORE_CONFIRMATION' THEN 'store_confirmation'");
    expect(fn).toContain("p_stage IN ('WAITING_PARTS', 'PARTS_IN_TRANSIT') THEN 'parts'");
  });
});

describe('G18.unit 合法流轉表（全覆蓋）', () => {
  const allStates: WoState[] = [];
  for (const status of WO_STATUSES) for (const stage of [null, ...WO_STAGES.map((s) => s.code)]) for (const linked of [false, true]) allStates.push(S(status, stage, linked, linked ? 'IN_PROGRESS' : null));

  it('已完成：所有動作都擋（要重新處理走需求單的重新開啟）', () => {
    for (const a of WO_ACTIONS) {
      const r = checkWoAction(a, S('COMPLETED', 'OTHER'));
      expect(r.ok, a).toBe(false);
    }
    const r = checkWoAction('SAVE_PROGRESS', S('COMPLETED', 'OTHER', true, 'COMPLETED'));
    expect(r).toMatchObject({ ok: false, httpStatus: 409, code: 'INVALID_STATE' });
    expect((r as any).message).toContain('需求單按「重新開啟」');
    expect((checkWoAction('SAVE_PROGRESS', S('COMPLETED', 'OTHER')) as any).message).toContain('不能重新開啟');
  });
  it('未受理：只有存進度（自動受理）與刪除（未連需求單）可做', () => {
    for (const a of WO_ACTIONS) {
      for (const linked of [false, true]) {
        const r = checkWoAction(a, S('UNACCEPTED', null, linked, linked ? 'IN_PROGRESS' : null));
        const allowed = a === 'SAVE_PROGRESS' || (a === 'DELETE' && !linked);
        expect(r.ok, `${a} linked=${linked}`).toBe(allowed);
      }
    }
    expect(checkWoAction('SAVE_PROGRESS', S('UNACCEPTED'))).toEqual({ ok: true, next: { status: 'ACCEPTED', stage: 'INITIAL_REVIEW' } });
    expect(checkWoAction('SAVE_PROGRESS', S('UNACCEPTED'), { stage: 'VENDOR_WORKING' })).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'VENDOR_WORKING' } });
    expect(checkWoAction('SAVE_PROGRESS', S('UNACCEPTED'), { stage: 'INTERNAL_HANDLING' })).toEqual({ ok: true, next: { status: 'ACCEPTED', stage: 'INTERNAL_HANDLING' } });
  });
  it('存進度：執行類階段推成處理中；非執行類保留狀態；不能直選待確認或（有需求單）等待補資料', () => {
    expect(checkWoAction('SAVE_PROGRESS', S('ACCEPTED', 'INITIAL_REVIEW'), { stage: 'WAITING_PARTS' })).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'WAITING_PARTS' } });
    expect(checkWoAction('SAVE_PROGRESS', S('PROCESSING', 'WAITING_PARTS'), { stage: 'INITIAL_REVIEW' })).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'INITIAL_REVIEW' } });
    expect(checkWoAction('SAVE_PROGRESS', S('ACCEPTED', 'INITIAL_REVIEW'))).toEqual({ ok: true, next: { status: 'ACCEPTED', stage: 'INITIAL_REVIEW' } });
    expect(checkWoAction('SAVE_PROGRESS', S('ACCEPTED', 'INITIAL_REVIEW'), { stage: 'WAITING_STORE_CONFIRMATION' })).toMatchObject({ ok: false, httpStatus: 422, code: 'USE_REQUEST_COMPLETION' });
    expect(checkWoAction('SAVE_PROGRESS', S('ACCEPTED', 'INITIAL_REVIEW', true, 'IN_PROGRESS'), { stage: 'WAITING_STORE_INFO' })).toMatchObject({ ok: false, httpStatus: 422, code: 'USE_SUPPLEMENT' });
    expect(checkWoAction('SAVE_PROGRESS', S('ACCEPTED', 'INITIAL_REVIEW'), { stage: 'WAITING_STORE_INFO' }).ok).toBe(true); // 舊式單可直選
    expect(checkWoAction('SAVE_PROGRESS', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toMatchObject({ ok: false, code: 'WAITING_STORE_CONFIRMATION' });
    expect(checkWoAction('SAVE_PROGRESS', S('PROCESSING', 'WAITING_STORE_INFO', true, 'WAITING_STORE_SUPPLEMENT'))).toMatchObject({ ok: false, code: 'WAITING_STORE_SUPPLEMENT' });
    expect(checkWoAction('SAVE_PROGRESS', S('PROCESSING', 'WAITING_STORE_INFO', false)).ok).toBe(true);
  });
  it('送門市確認：已受理或處理中，不在待確認、需求單不在等補資料', () => {
    expect(checkWoAction('REQUEST_COMPLETION', S('PROCESSING', 'VENDOR_WORKING'))).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'WAITING_STORE_CONFIRMATION' } });
    expect(checkWoAction('REQUEST_COMPLETION', S('ACCEPTED', 'INITIAL_REVIEW')).ok).toBe(true);
    expect(checkWoAction('REQUEST_COMPLETION', S('UNACCEPTED'))).toMatchObject({ ok: false, httpStatus: 409 });
    expect(checkWoAction('REQUEST_COMPLETION', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toMatchObject({ ok: false, code: 'WAITING_STORE_CONFIRMATION' });
    expect(checkWoAction('REQUEST_COMPLETION', S('PROCESSING', 'WAITING_STORE_INFO', true, 'WAITING_STORE_SUPPLEMENT'))).toMatchObject({ ok: false, code: 'WAITING_STORE_SUPPLEMENT' });
  });
  it('強制結案：只有已受理或處理中；結果已完成並保留階段（沒有階段用 OTHER）', () => {
    expect(checkWoAction('FORCE_CLOSE', S('PROCESSING', 'WAITING_PARTS'))).toEqual({ ok: true, next: { status: 'COMPLETED', stage: 'WAITING_PARTS' } });
    expect(checkWoAction('FORCE_CLOSE', S('ACCEPTED'))).toEqual({ ok: true, next: { status: 'COMPLETED', stage: 'OTHER' } });
    expect(checkWoAction('FORCE_CLOSE', S('UNACCEPTED'))).toMatchObject({ ok: false });
    expect(checkWoAction('FORCE_CLOSE', S('COMPLETED', 'OTHER'))).toMatchObject({ ok: false });
  });
  it('補資料（W1）：已受理或處理中；不在等補資料／待確認；需求單狀態、有採購單（含草稿）、已出庫都擋', () => {
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW', true, 'IN_PROGRESS'))).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'WAITING_STORE_INFO' } });
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('ACCEPTED', 'INITIAL_REVIEW')).ok).toBe(true);
    for (const rs of ['ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW']) expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW', true, rs)).ok, rs).toBe(true);
    for (const rs of ['COMPLETED', 'REJECTED', 'CANCELED', 'WAITING_STORE_CONFIRMATION', 'WAITING_STORE_SUPPLEMENT']) {
      expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW', true, rs)), rs).toMatchObject({ ok: false, httpStatus: 409, code: 'REQUEST_STATE' });
    }
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW', true, 'IN_PROGRESS'), { docs: { po_count: 1 } })).toMatchObject({ ok: false, code: 'HAS_DOCUMENTS' });
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW', true, 'IN_PROGRESS'), { docs: { issued: 2 } })).toMatchObject({ ok: false, code: 'HAS_DOCUMENTS' });
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'WAITING_STORE_INFO'))).toMatchObject({ ok: false });
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toMatchObject({ ok: false });
    expect(checkWoAction('REQUEST_SUPPLEMENT', S('UNACCEPTED'))).toMatchObject({ ok: false });
  });
  it('門市確認／仍有問題：只有待門市確認；有需求單且需求單在等確認要走我的追蹤', () => {
    expect(checkWoAction('STORE_CONFIRM', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toEqual({ ok: true, next: { status: 'COMPLETED', stage: 'WAITING_STORE_CONFIRMATION' } });
    expect(checkWoAction('REPORT_UNRESOLVED', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'REOPENED' } });
    for (const a of ['STORE_CONFIRM', 'REPORT_UNRESOLVED'] as WoAction[]) {
      for (const st of allStates) {
        const should = st.status === 'PROCESSING' && st.stage === 'WAITING_STORE_CONFIRMATION' && !(st.linked && st.requestStatus === 'WAITING_STORE_CONFIRMATION');
        expect(checkWoAction(a, st).ok, `${a} ${st.status}/${st.stage}/${st.linked}`).toBe(should);
      }
      expect(checkWoAction(a, S('PROCESSING', 'WAITING_STORE_CONFIRMATION', true, 'WAITING_STORE_CONFIRMATION'))).toMatchObject({ ok: false, code: 'USE_REQUEST' });
    }
  });
  it('舊式單回覆補資料：只有沒需求單且在等門市補資料；完成後回初步評估', () => {
    expect(checkWoAction('REPLY_SUPPLEMENT', S('PROCESSING', 'WAITING_STORE_INFO'))).toEqual({ ok: true, next: { status: 'PROCESSING', stage: 'INITIAL_REVIEW' } });
    expect(checkWoAction('REPLY_SUPPLEMENT', S('PROCESSING', 'WAITING_STORE_INFO', true, 'WAITING_STORE_SUPPLEMENT'))).toMatchObject({ ok: false, code: 'USE_REQUEST' });
    expect(checkWoAction('REPLY_SUPPLEMENT', S('PROCESSING', 'INITIAL_REVIEW'))).toMatchObject({ ok: false });
  });
  it('領用料件：已受理或處理中且不在待確認', () => {
    expect(checkWoAction('ISSUE_PART', S('PROCESSING', 'WAITING_PARTS')).ok).toBe(true);
    expect(checkWoAction('ISSUE_PART', S('ACCEPTED', 'INITIAL_REVIEW')).ok).toBe(true);
    expect(checkWoAction('ISSUE_PART', S('PROCESSING', 'WAITING_STORE_CONFIRMATION'))).toMatchObject({ ok: false });
    expect(checkWoAction('ISSUE_PART', S('UNACCEPTED'))).toMatchObject({ ok: false });
    expect(checkWoAction('ISSUE_PART', S('COMPLETED', 'OTHER'))).toMatchObject({ ok: false });
  });
  it('刪除（W4）：只有未受理且沒連需求單；已受理或已連需求單提示強制結案', () => {
    expect(checkWoAction('DELETE', S('UNACCEPTED')).ok).toBe(true);
    expect((checkWoAction('DELETE', S('ACCEPTED', 'INITIAL_REVIEW')) as any).message).toContain('不處理，強制結案');
    expect((checkWoAction('DELETE', S('UNACCEPTED', null, true, 'IN_PROGRESS')) as any)).toMatchObject({ code: 'HAS_REQUEST' });
  });
  it('所有狀態×階段×動作：合法結果一定落在 4 種主狀態與 16 階段內；非法一定帶白話中文說明', () => {
    for (const st of allStates) for (const a of WO_ACTIONS) {
      const r = checkWoAction(a, st);
      if (r.ok) {
        expect(WO_STATUSES).toContain(r.next.status);
        if (r.next.stage) expect(WO_STAGES.map((s) => s.code)).toContain(r.next.stage);
      } else {
        expect([409, 422]).toContain(r.httpStatus);
        expect(r.message).toMatch(/[一-鿿]/);
        expect(r.code).toMatch(/^[A-Z_]+$/);
      }
    }
  });
});

describe('G18.unit abilities（缺哪個權限講清楚）', () => {
  it('沒有任何權限：不能進入；只有 view_all 三種：可看全部、唯讀、說明要補工單更新或管理', () => {
    expect(workOrderAbilities(has()).canEnter).toBe(false);
    for (const code of [WO.viewAll, WO.mrViewAll, WO.crossViewAll]) {
      const a = workOrderAbilities(has(code));
      expect(a).toMatchObject({ canEnter: true, canViewAll: true, gaSide: true, canUpdate: false, readOnly: true, canIssuePart: false, canForceClose: false, canDeleteAny: false });
      expect(a.readOnlyReason).toContain('只有查看工單的權限');
    }
  });
  it('四種更新碼都算可更新；只有 mr/cross 更新碼與管理可刪、work_order.update 不能刪（與 DB 刪除權限相同）', () => {
    for (const code of [WO.update, WO.manage, WO.mrUpdate, WO.crossUpdate]) expect(workOrderAbilities(has(code)).canUpdate, code).toBe(true);
    expect(workOrderAbilities(has(WO.update)).canDeleteAny).toBe(false);
    for (const code of [WO.manage, WO.mrUpdate, WO.crossUpdate]) expect(workOrderAbilities(has(code)).canDeleteAny, code).toBe(true);
  });
  it('強制結案：更新權限＋強制結案權限；缺強制結案講清楚；只有強制結案碼不算', () => {
    expect(workOrderAbilities(has(WO.update, WO.forceClose)).canForceClose).toBe(true);
    const a = workOrderAbilities(has(WO.update));
    expect(a.canForceClose).toBe(false);
    expect(a.forceCloseMissing).toBe('強制結案');
    expect(workOrderAbilities(has(WO.forceClose)).canForceClose).toBe(false);
  });
  it('領用料件：三個權限缺哪個講哪個', () => {
    expect(workOrderAbilities(has(WO.update, WO.txn, WO.partView)).canIssuePart).toBe(true);
    expect(workOrderAbilities(has(WO.update, WO.txn, WO.partManage)).canIssuePart).toBe(true);
    expect(workOrderAbilities(has(WO.update, WO.partView)).issuePartMissing).toEqual(['庫存交易管理']);
    expect(workOrderAbilities(has(WO.update, WO.txn)).issuePartMissing).toEqual(['料件查看']);
    expect(workOrderAbilities(has(WO.txn, WO.partView)).issuePartMissing).toEqual(['工單更新']);
    expect(workOrderAbilities(has()).issuePartMissing).toEqual(['工單更新', '庫存交易管理', '料件查看']);
    expect(workOrderAbilities(has(WO.update, WO.partView)).issuePartReason).toContain('缺少：庫存交易管理');
  });
  it('profiles.role=admin 沒有任何有效更新角色：只作唯讀並白話說明；有更新角色的管理員可改', () => {
    const noRole = workOrderAbilities(has(WO.viewAll), { isAdminProfile: true });
    expect(noRole.canUpdate).toBe(false);
    expect(noRole.readOnlyReason).toContain('只有查看工單的權限');
    const adminOnly = workOrderAbilities(has(WO.viewOwn), { isAdminProfile: true });
    expect(adminOnly.readOnlyReason).toBe('您的帳號沒有可修改工單的角色，請洽管理員授權');
    expect(workOrderAbilities(has(WO.manage), { isAdminProfile: true }).canUpdate).toBe(true);
    expect(workOrderAbilities(has(WO.viewOwn)).readOnlyReason).toBe('您沒有修改工單的權限');
  });
  it('只有自己門市（任一種 own 碼）：可進入但不是總務端、不看全部', () => {
    for (const code of [WO.viewOwn, WO.mrViewOwn, WO.mrCreate, WO.crossSubmit]) {
      const a = workOrderAbilities(has(code));
      expect(a).toMatchObject({ canEnter: true, canViewOwnOnly: true, gaSide: false, canViewAll: false });
    }
  });
  it('新增舊式回報：更新權限或店長回報碼（cross submit／maintenance_request.create）；維修分類編輯只認舊碼', () => {
    expect(workOrderAbilities(has(WO.crossSubmit)).canCreateLegacy).toBe(true);
    expect(workOrderAbilities(has(WO.mrCreate)).canCreateLegacy).toBe(true);
    expect(workOrderAbilities(has(WO.update)).canCreateLegacy).toBe(true);
    expect(workOrderAbilities(has(WO.viewAll)).canCreateLegacy).toBe(false);
    expect(workOrderAbilities(has(WO.crossCategoryEdit)).canEditCategories).toBe(true);
    expect(workOrderAbilities(has(WO.manage)).canEditCategories).toBe(false);
    expect(workOrderAbilities(has(WO.crossCategoryEdit)).canViewCategories).toBe(true);
  });
  it('權限碼與資料庫函式（ga_wo_can_update／view_all／own／delete）逐碼一致', () => {
    const sql = read('supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules.sql');
    const codesOf = (fn: string) => Array.from(new RegExp(`${fn}\\(p_uid uuid\\)[\\s\\S]*?\\$\\$;`).exec(sql)![0].matchAll(/has_permission\(p_uid, '([^']+)'\)/g)).map((m) => m[1]).sort();
    const sorted = (arr: readonly string[]) => [...arr].sort();
    expect(codesOf('ga_wo_can_update')).toEqual(sorted([WO.update, WO.manage, WO.mrUpdate, WO.crossUpdate]));
    expect(codesOf('ga_wo_can_view_all')).toEqual(sorted([WO.viewAll, WO.mrViewAll, WO.crossViewAll]));
    expect(codesOf('ga_wo_has_own_perm')).toEqual(sorted([WO.viewOwn, WO.mrViewOwn, WO.mrCreate, WO.crossSubmit]));
    expect(codesOf('ga_wo_can_delete_perm')).toEqual(sorted([WO.manage, WO.mrUpdate, WO.crossUpdate]));
  });
});

describe('G18.unit 搜尋與篩選', () => {
  it('搜尋字串整形：去控制字元、合併空白、最長 100；空字串回 null', () => {
    expect(normalizeSearch('  冷氣 \n  壞了\t ')).toBe('冷氣 壞了');
    expect(normalizeSearch('x'.repeat(300))).toHaveLength(100);
    expect(normalizeSearch('   ')).toBeNull();
    expect(normalizeSearch(null)).toBeNull();
    expect(normalizeSearch('a,b)"c')).toBe('a,b)"c');
  });
  it('LIKE 跳脫：% _ \\ 都當一般字元', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    expect(escapeLike('abc')).toBe('abc');
  });
  it('篩選解析：合法值通過、非法值丟白話錯誤', () => {
    const f = parseListFilters(new URLSearchParams({ store_id: U, status: 'processing', focus: 'Vendor', q: '  冷氣  ', source: 'legacy', category_id: U2 }));
    expect(f).toEqual({ store_id: U, status: 'PROCESSING', focus: 'vendor', q: '冷氣', source: 'LEGACY', category_id: U2 });
    expect(parseListFilters(new URLSearchParams({ focus: 'all', source: 'ALL' }))).toEqual({});
    expect(() => parseListFilters(new URLSearchParams({ store_id: 'bad' }))).toThrow('門市篩選格式錯誤');
    expect(() => parseListFilters(new URLSearchParams({ status: 'NOPE' }))).toThrow('狀態篩選錯誤');
    expect(() => parseListFilters(new URLSearchParams({ focus: 'NOPE' }))).toThrow('焦點篩選錯誤');
    expect(() => parseListFilters(new URLSearchParams({ source: 'NOPE' }))).toThrow('來源篩選錯誤');
    expect(() => parseListFilters(new URLSearchParams({ category_id: 'x' }))).toThrow('分類篩選格式錯誤');
  });
});

describe('G18.unit 輸入驗證（有填才更新）', () => {
  it('版本欄位必填且可解析；保留原字串（微秒）', () => {
    expect(() => parseExpected('')).toThrow('缺少版本資訊');
    expect(() => parseExpected('abc')).toThrow('格式錯誤');
    expect(parseExpected('2038-01-01T00:00:00.123456+00:00')).toBe('2038-01-01T00:00:00.123456+00:00');
  });
  it('存進度：處理說明必填；沒填的欄位不會出現在 payload（不覆蓋承辦人、處理方式、廠商）', () => {
    expect(() => validateProgressPayload({}, { notesRequired: true })).toThrow('請填寫處理說明');
    expect(validateProgressPayload({ notes: '  已聯絡 ' }, { notesRequired: true })).toEqual({ notes: '已聯絡' });
    expect(validateProgressPayload({ notes: 'x', assignee_name: '', handling_method: '  ', vendor_id: '', progress_stage: '' }, { notesRequired: true })).toEqual({ notes: 'x' });
    expect(validateProgressPayload({}, { notesRequired: false })).toEqual({});
    const full = validateProgressPayload({ notes: 'n', visibility: 'internal', progress_stage: 'waiting_parts', progress_date: '2038-02-03', category_id: U, assignee_id: U2, assignee_name: '王', handling_method: '換料', vendor_id: U }, { notesRequired: true });
    expect(full).toEqual({ notes: 'n', visibility: 'INTERNAL', progress_stage: 'WAITING_PARTS', progress_date: '2038-02-03', category_id: U, assignee_id: U2, assignee_name: '王', handling_method: '換料', vendor_id: U });
    expect(() => validateProgressPayload({ notes: 'x'.repeat(2001) }, { notesRequired: true })).toThrow('2000');
    expect(() => validateProgressPayload({ notes: 'x', visibility: 'SECRET' }, { notesRequired: true })).toThrow('公開範圍錯誤');
    expect(() => validateProgressPayload({ notes: 'x', progress_stage: 'NOPE' }, { notesRequired: true })).toThrow('進度階段錯誤');
    expect(() => validateProgressPayload({ notes: 'x', progress_date: '2038-13-45' }, { notesRequired: true })).toThrow('進度日期格式錯誤');
    expect(() => validateProgressPayload({ notes: 'x', progress_date: '3/4' }, { notesRequired: true })).toThrow('進度日期格式錯誤');
    expect(() => validateProgressPayload({ notes: 'x', vendor_id: 'bad' }, { notesRequired: true })).toThrow('識別碼格式錯誤');
  });
  it('強制結案：原因必填（reason 或 force_close_reason）；補資料：類型與說明必填', () => {
    expect(() => validateForceClose({})).toThrow('強制結案必須填寫原因');
    expect(validateForceClose({ reason: ' 重複回報 ' })).toEqual({ force_close_reason: '重複回報' });
    expect(() => validateForceClose({ force_close_reason: 'x'.repeat(2001) })).toThrow('2000');
    expect(() => validateSupplement({ supplement_note: 'x' })).toThrow('補資料類型錯誤');
    expect(() => validateSupplement({ supplement_type: 'OTHER' })).toThrow('必須填寫說明');
    expect(validateSupplement({ supplement_type: 'photo_unclear', note: '請重拍' })).toEqual({ supplement_type: 'PHOTO_UNCLEAR', supplement_note: '請重拍' });
  });
  it('領用料件：位置、料件、數量 > 0、單位類型、防重複識別碼', () => {
    const ok = { location_id: U, part_id: U2, quantity: '2', idempotency_key: ' k1 ' };
    expect(validateIssuePart(ok)).toMatchObject({ location_id: U, part_id: U2, quantity: 2, input_unit_type: 'BASE', key: 'k1', reason: null });
    expect(() => validateIssuePart({ ...ok, location_id: 'x' })).toThrow('請選擇領用位置與料件');
    expect(() => validateIssuePart({ ...ok, quantity: 0 })).toThrow('數量必須大於 0');
    expect(() => validateIssuePart({ ...ok, quantity: 'abc' })).toThrow('數量必須大於 0');
    expect(() => validateIssuePart({ ...ok, quantity: -1 })).toThrow('數量必須大於 0');
    expect(() => validateIssuePart({ ...ok, input_unit_type: 'BOX' })).toThrow('單位類型錯誤');
    expect(() => validateIssuePart({ ...ok, idempotency_key: ' ' })).toThrow('防重複識別碼');
    expect(() => validateIssuePart({ ...ok, reason: 'x'.repeat(501) })).toThrow('500');
  });
  it('新增舊式回報：標題必填、優先順序、識別碼；照片上限 5', () => {
    expect(LEGACY_MAX_PHOTOS).toBe(5);
    const ok = { store_id: U, title: ' 冷氣不冷 ', idempotency_key: 'k' };
    expect(validateLegacyReport(ok)).toMatchObject({ store_id: U, title: '冷氣不冷', priority: 'normal', key: 'k' });
    expect(() => validateLegacyReport({ ...ok, store_id: 'x' })).toThrow('請選擇門市');
    expect(() => validateLegacyReport({ ...ok, title: '' })).toThrow('請填寫標題');
    expect(() => validateLegacyReport({ ...ok, title: 'x'.repeat(201) })).toThrow('200');
    expect(() => validateLegacyReport({ ...ok, priority: 'asap' })).toThrow('優先順序錯誤');
    expect(() => validateLegacyReport({ ...ok, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateLegacyReport({ ...ok, category_id: 'bad' })).toThrow('分類識別碼格式錯誤');
    expect(validateLegacyReport({ ...ok, priority: 'URGENT' }).priority).toBe('urgent');
  });
});

describe('G18.unit 伺服端欄位遮蔽', () => {
  const row = { id: U, title: 't', status: 'PROCESSING', assignee_id: U2, assignee_name: '王工務', handling_method: '換零件', vendor_id: U2, accepted_by: U2, completed_by: U2, reported_by: U };
  it('店長端：看不到處理人、處理方式、廠商與受理／完成人；總務端原樣', () => {
    const m = maskWorkOrderRow(row, false);
    for (const k of ['assignee_id', 'assignee_name', 'handling_method', 'vendor_id', 'accepted_by', 'completed_by']) expect(m).not.toHaveProperty(k);
    expect(m).toMatchObject({ id: U, title: 't', reported_by: U });
    expect(maskWorkOrderRow(row, true)).toEqual(row);
  });
  it('時間軸：非總務端只留公開並移除處理人姓名；INTERNAL（含強制結案原因）全擋', () => {
    const items = [
      { kind: 'update', visibility: 'PUBLIC', text: '已聯絡廠商', by_name: '王工務' },
      { kind: 'update', visibility: 'INTERNAL', text: '不處理，強制結案。原因：重複' },
      { kind: 'event', visibility: 'INTERNAL', event_type: 'PART_ISSUED', text: '領用料件' },
      { kind: 'event', visibility: 'PUBLIC', event_type: 'FORCE_CLOSE_NOTICE', text: '總務已結案' },
    ];
    const open = maskTimeline(items, false);
    expect(open.map((x: any) => x.text)).toEqual(['已聯絡廠商', '總務已結案']);
    expect(JSON.stringify(open)).not.toContain('王工務');
    expect(JSON.stringify(open)).not.toContain('原因');
    expect(maskTimeline(items, true)).toHaveLength(4);
    expect(maskTimeline(null, false)).toEqual([]);
  });
  it('詳情：非總務端用料清單清空；總務端保留', () => {
    const d = { work_order: row, timeline: [{ visibility: 'INTERNAL', text: 'x' }], parts: [{ transaction_no: 'T1' }], ga_side: true };
    expect(maskWorkOrderDetail(d, false)).toMatchObject({ parts: [], timeline: [], ga_side: false });
    expect(maskWorkOrderDetail(d, false).work_order).not.toHaveProperty('assignee_name');
    expect(maskWorkOrderDetail(d, true)).toMatchObject({ parts: [{ transaction_no: 'T1' }], ga_side: true });
  });
});

describe('G18.unit 照片合併與圖片檢查', () => {
  const signed = (b: string, p: string) => `https://s/${b}/${p}`;
  it('新附件（回報照片、進度照片）與舊照片合併；舊照片標「舊版照片」、非圖片擋下、不外露儲存路徑', () => {
    const atts = [
      { id: 'a1', resource_type: 'MAINTENANCE_REQUEST', resource_id: U, storage_bucket: 'general-affairs-attachments', storage_path: 'maintenance_request/x/a.png', file_name: 'a.png', content_type: 'image/png', uploaded_at: '2038-01-02T00:00:00Z' },
      { id: 'a2', resource_type: 'MAINTENANCE_UPDATE', resource_id: U2, storage_bucket: 'general-affairs-attachments', storage_path: 'maintenance_update/x/b.jpg', file_name: 'b.jpg', content_type: 'image/jpeg', uploaded_at: '2038-01-03T00:00:00Z' },
      { id: 'a3', resource_type: 'MAINTENANCE_REQUEST', resource_id: U, storage_path: 'maintenance_request/x/c.pdf', file_name: 'c.pdf', content_type: 'application/pdf', uploaded_at: '2038-01-04T00:00:00Z' },
    ];
    const legacy = [
      { id: 'l1', storage_bucket: 'maintenance-photos', storage_path: 'old/1.jpg', file_name: '1.jpg', created_at: '2037-01-01T00:00:00Z' },
      { id: 'l2', storage_bucket: 'maintenance-photos', storage_path: 'old/2.txt', file_name: '2.txt', created_at: '2037-01-02T00:00:00Z' },
      { id: 'l3', storage_bucket: 'maintenance-photos', storage_path: 'old/3.png', file_name: '3.png', update_id: U2, created_at: '2037-01-03T00:00:00Z' },
    ];
    const out = mergePhotos(atts, legacy, signed);
    expect(out.map((p) => p.id)).toEqual(['l1', 'l3', 'a1', 'a2']);
    expect(out.filter((p) => p.legacy).map((p) => p.label)).toEqual(['舊版照片', '舊版照片']);
    expect(out.find((p) => p.id === 'a1')).toMatchObject({ label: '回報照片', legacy: false, signed_url: 'https://s/general-affairs-attachments/maintenance_request/x/a.png' });
    expect(out.find((p) => p.id === 'a2')).toMatchObject({ label: '進度照片', update_id: U2 });
    expect(out.find((p) => p.id === 'l3')).toMatchObject({ signed_url: 'https://s/maintenance-photos/old/3.png', update_id: U2 });
    expect(JSON.stringify(out)).not.toContain('storage_path');
    expect(out.find((p) => p.id === 'l2')).toBeUndefined();
    expect(out.find((p) => p.id === 'a3')).toBeUndefined();
  });
  it('圖片檔名判斷', () => {
    expect(isImageName('a.JPG')).toBe(true);
    expect(isImageName('a.pdf')).toBe(false);
    expect(isImageName('noext')).toBe(false);
  });
  it('檔頭檢查：JPEG、PNG、WebP、HEIC 通過；文字與 PDF 與假副檔名擋下', () => {
    const b = (...n: number[]) => new Uint8Array(n);
    const str = (s: string) => new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0)));
    expect(sniffImageType(b(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(sniffImageType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png');
    expect(sniffImageType(str('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(str('\0\0\0\x18ftypheic\0\0\0\0'))).toBe('image/heic');
    expect(sniffImageType(str('%PDF-1.7 hello world'))).toBeNull();
    expect(sniffImageType(str('<html>fake.png</html>'))).toBeNull();
    expect(sniffImageType(b())).toBeNull();
  });
});

describe('G18.unit 列印資料整形', () => {
  const data = {
    work_order: { id: U, title: 't', assignee_name: '王工務', handling_method: 'x' },
    public_timeline: [{ text: '公開' }], include_internal: true, internal_updates: [{ text: '內部備註' }], force_close_reason: '重複回報', printed_at: '2038-01-01',
  };
  it('預設不含內部；總務端勾選才出現內部備註與強制結案原因', () => {
    const def = shapePrint({ ...data, include_internal: false, internal_updates: [], force_close_reason: null }, [], true, false);
    expect(def).toMatchObject({ include_internal: false, internal_updates: [], force_close_reason: null });
    const inc = shapePrint(data, [], true, true);
    expect(inc).toMatchObject({ include_internal: true, internal_updates: [{ text: '內部備註' }], force_close_reason: '重複回報' });
  });
  it('非總務端：即使資料帶了內部也一律不給；工單欄位也遮蔽處理人', () => {
    const r = shapePrint(data, [], false, true);
    expect(r).toMatchObject({ include_internal: false, internal_updates: [], force_close_reason: null });
    expect(r.work_order).not.toHaveProperty('assignee_name');
    expect(JSON.stringify(r)).not.toContain('內部備註');
    expect(JSON.stringify(r)).not.toContain('重複回報');
  });
  it('總務端沒勾選時，即使資料庫帶了內部也不給', () => {
    expect(shapePrint(data, [], true, false)).toMatchObject({ include_internal: false, internal_updates: [], force_close_reason: null });
  });
});
