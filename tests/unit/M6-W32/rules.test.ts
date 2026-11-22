import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketFollowUp,
  buildTimeline,
  canAddFollowup,
  canAddRecord,
  capsFrom,
  caseDeletable,
  caseManageable,
  caseScopeFilter,
  caseVisible,
  childEditable,
  dbErrorInfo,
  escapeLike,
  isDateString,
  orContainsAny,
  planManageable,
  planScopeFilter,
  planVisible,
  statusFields,
  taipeiDate,
  visibilityTier,
  type Caps,
  type Viewer,
} from '../../../lib/supervisor-management-log/workspace-rules';
import { validateCasePayload, validateRecordPayload } from '../../../lib/supervisor-management-log/validation';

const none: Caps = { viewOwn: false, viewTeam: false, create: false, updateOwn: false, followUp: false, manage: false };
const viewer = (caps: Partial<Caps>, managed: string[] = [], userId = 'u-me'): Viewer => ({ userId, managedStoreIds: managed, caps: { ...none, ...caps } });
const kase = (o: Partial<{ owner_user_id: string; assigned_user_id: string | null; store_id: string | null; status: string; deleted_at: string | null }> = {}) => ({
  owner_user_id: 'u-other', assigned_user_id: null, store_id: 's1', status: 'OPEN', deleted_at: null, ...o,
});

describe('M6-W32 E1：三層可見範圍（同舊版資料庫政策、正式區 has_permission 語意）', () => {
  it('一般（view_own）只看自己建立或被指派的', () => {
    const v = viewer({ viewOwn: true });
    expect(caseVisible(kase({ owner_user_id: 'u-me' }), v)).toBe(true);
    expect(caseVisible(kase({ assigned_user_id: 'u-me' }), v)).toBe(true);
    expect(caseVisible(kase(), v)).toBe(false);
  });
  it('只有 create 也看得到自己建立與被指派的案件（舊版 insert 後要能讀回）', () => {
    const v = viewer({ create: true });
    expect(caseVisible(kase({ owner_user_id: 'u-me' }), v)).toBe(true);
    expect(caseVisible(kase(), v)).toBe(false);
  });
  it('看團隊（view_team）看自己管轄門市的案件，不含其他門市與沒有門市的案件', () => {
    const v = viewer({ viewTeam: true }, ['s1']);
    expect(caseVisible(kase({ store_id: 's1' }), v)).toBe(true);
    expect(caseVisible(kase({ store_id: 's2' }), v)).toBe(false);
    expect(caseVisible(kase({ store_id: null }), v)).toBe(false);
    // 只有看團隊不含「自己建立」的跨店案件
    expect(caseVisible(kase({ owner_user_id: 'u-me', store_id: 's2' }), v)).toBe(false);
  });
  it('管理（manage）看全部', () => {
    expect(caseVisible(kase({ store_id: null }), viewer({ manage: true }))).toBe(true);
  });
  it('follow_up 看被指派的與管轄門市的；update_own 看自己建立的', () => {
    expect(caseVisible(kase({ assigned_user_id: 'u-me' }), viewer({ followUp: true }))).toBe(true);
    expect(caseVisible(kase({ store_id: 's1' }), viewer({ followUp: true }, ['s1']))).toBe(true);
    expect(caseVisible(kase({ owner_user_id: 'u-me' }), viewer({ updateOwn: true }))).toBe(true);
    expect(caseVisible(kase(), viewer({ updateOwn: true }))).toBe(false);
  });
  it('已軟刪除的案件一律看不到（管理者也是，除非用 deleted=1 專用查詢）', () => {
    expect(caseVisible(kase({ deleted_at: '2038-01-01' }), viewer({ manage: true }))).toBe(false);
  });
  it('沒有任何權限看不到', () => {
    expect(caseVisible(kase({ owner_user_id: 'u-me' }), viewer({}))).toBe(false);
  });
  it('查詢條件 caseScopeFilter 與 caseVisible 逐列一致（所有權限組合）', () => {
    const keys: (keyof Caps)[] = ['viewOwn', 'viewTeam', 'create', 'updateOwn', 'followUp', 'manage'];
    const rows = [
      kase({ owner_user_id: 'u-me' }), kase({ assigned_user_id: 'u-me' }), kase({ store_id: 's1' }), kase({ store_id: 's2' }), kase({ store_id: null }),
      kase({ owner_user_id: 'u-me', store_id: 's2' }), kase({ assigned_user_id: 'u-me', store_id: 's1' }), kase({ owner_user_id: 'u-other', assigned_user_id: 'u-x', store_id: 's3' }),
    ];
    // 以最小的 PostgREST or() 解譯器驗證：條件字串逐項比對
    const matches = (filter: string | null, row: ReturnType<typeof kase>) => {
      if (filter === null) return true;
      return filter.split(/,(?![^()]*\))/).filter(Boolean).some((term) => {
        const m = /^(\w+)\.(eq|in)\.(.+)$/.exec(term)!;
        const val = (row as any)[m[1]];
        return m[2] === 'eq' ? val === m[3] : m[3].slice(1, -1).split(',').includes(val);
      });
    };
    for (let mask = 0; mask < 64; mask += 1) {
      const caps = { ...none };
      keys.forEach((k, i) => { if (mask & (1 << i)) caps[k] = true; });
      for (const managed of [[], ['s1'], ['s1', 's3']]) {
        const v = viewer(caps, managed);
        const filter = caseScopeFilter(v);
        for (const row of rows) {
          expect(matches(filter === '' ? 'owner_user_id.eq.__none__' : filter, row), `mask=${mask} managed=${managed} row=${JSON.stringify(row)}`).toBe(caseVisible(row, v));
        }
      }
    }
  });
  it('畫面用的層級：管理 > 看團隊 > 一般 > 無', () => {
    expect(visibilityTier({ ...none, manage: true, viewTeam: true })).toBe('all');
    expect(visibilityTier({ ...none, viewTeam: true, viewOwn: true })).toBe('team');
    expect(visibilityTier({ ...none, viewOwn: true })).toBe('own');
    expect(visibilityTier(none)).toBe('none');
  });
  it('capsFrom 依傳入的 has() 判斷，不另外加管理員繞過', () => {
    const has = (...codes: string[]) => codes.some((c) => c === 'supervisor.management_log.view_team');
    expect(capsFrom(has)).toEqual({ ...none, viewTeam: true });
  });
});

describe('M6-W32 E2：修改與刪除（自己的可改、管理者全部、刪除只標記）', () => {
  it('案件可修改：管理者全部；update_own 只有自己建立且未結案；follow_up 只有被指派或管轄門市且未結案', () => {
    expect(caseManageable(kase({ status: 'CLOSED' }), viewer({ manage: true }))).toBe(true);
    expect(caseManageable(kase({ owner_user_id: 'u-me' }), viewer({ updateOwn: true }))).toBe(true);
    expect(caseManageable(kase({ owner_user_id: 'u-me', status: 'CLOSED' }), viewer({ updateOwn: true }))).toBe(false);
    expect(caseManageable(kase({ owner_user_id: 'u-me', status: 'CANCELLED' }), viewer({ updateOwn: true }))).toBe(false);
    expect(caseManageable(kase(), viewer({ updateOwn: true }))).toBe(false);
    expect(caseManageable(kase({ store_id: 's1' }), viewer({ followUp: true }, ['s1']))).toBe(true);
    expect(caseManageable(kase({ store_id: 's2' }), viewer({ followUp: true }, ['s1']))).toBe(false);
    expect(caseManageable(kase({ owner_user_id: 'u-me' }), viewer({ create: true }))).toBe(false);
  });
  it('案件可刪除：管理者全部；其他人只有自己建立且未結案、且有 update_own', () => {
    expect(caseDeletable(kase({ status: 'CLOSED' }), viewer({ manage: true }))).toBe(true);
    expect(caseDeletable(kase({ owner_user_id: 'u-me' }), viewer({ updateOwn: true }))).toBe(true);
    expect(caseDeletable(kase({ owner_user_id: 'u-me', status: 'CLOSED' }), viewer({ updateOwn: true }))).toBe(false);
    expect(caseDeletable(kase({ owner_user_id: 'u-me' }), viewer({ create: true }))).toBe(false);
    expect(caseDeletable(kase({ store_id: 's1' }), viewer({ followUp: true }, ['s1']))).toBe(false);
    expect(caseDeletable(kase({ owner_user_id: 'u-me', deleted_at: 'x' }), viewer({ manage: true }))).toBe(false);
  });
  it('新增追蹤需要 follow_up 權限（舊版資料表政策；manage 單獨不夠），新增紀錄需案件可修改', () => {
    expect(canAddFollowup(kase(), viewer({ manage: true }))).toBe(false);
    expect(canAddFollowup(kase(), viewer({ manage: true, followUp: true }))).toBe(true);
    expect(canAddRecord(kase(), viewer({ manage: true }))).toBe(true);
    expect(canAddRecord(kase({ owner_user_id: 'u-me' }), viewer({ create: true }))).toBe(false);
  });
  it('紀錄與追蹤：管理者全部；其他人只動自己建立的且案件仍可修改', () => {
    const own = viewer({ updateOwn: true });
    expect(childEditable('u-me', kase({ owner_user_id: 'u-me' }), own)).toBe(true);
    expect(childEditable('u-other', kase({ owner_user_id: 'u-me' }), own)).toBe(false);
    expect(childEditable('u-me', kase({ owner_user_id: 'u-me', status: 'CLOSED' }), own)).toBe(false);
    expect(childEditable('u-other', kase({ status: 'CLOSED' }), viewer({ manage: true }))).toBe(true);
    expect(childEditable(null, kase(), own)).toBe(false);
  });
  it('今日規劃：可見範圍（本人、管轄門市的看團隊者、管理者）與可修改（本人未完成、管理者）', () => {
    const p = (o: Partial<{ owner_user_id: string; store_id: string | null; status: string }> = {}) => ({ owner_user_id: 'u-other', store_id: 's1', status: 'PLANNED', deleted_at: null, ...o });
    expect(planVisible(p({ owner_user_id: 'u-me' }), viewer({ create: true }))).toBe(true);
    expect(planVisible(p(), viewer({ viewOwn: true }))).toBe(false);
    expect(planVisible(p(), viewer({ viewTeam: true }, ['s1']))).toBe(true);
    expect(planVisible(p(), viewer({ manage: true }))).toBe(true);
    expect(planManageable(p({ owner_user_id: 'u-me' }), viewer({ create: true }))).toBe(true);
    expect(planManageable(p({ owner_user_id: 'u-me', status: 'DONE' }), viewer({ create: true }))).toBe(false);
    expect(planManageable(p({ owner_user_id: 'u-me' }), viewer({ viewOwn: true }))).toBe(false);
    expect(planManageable(p({ status: 'DONE' }), viewer({ manage: true }))).toBe(true);
    expect(planScopeFilter(viewer({ manage: true }))).toBeNull();
    expect(planScopeFilter(viewer({ create: true }, []))).toBe('owner_user_id.eq.u-me');
    expect(planScopeFilter(viewer({ viewTeam: true }, ['s1']))).toBe('store_id.in.(s1)');
    expect(planScopeFilter(viewer({}))).toBe('');
  });
});

describe('M6-W32：結案欄位、日期、追蹤佇列、搜尋', () => {
  it('statusFields：RESOLVED／CLOSED 寫 resolved_at，CLOSED 另寫 closed_at；離開時清空；已有的時間保留', () => {
    const t = '2038-01-02T00:00:00.000Z';
    expect(statusFields('OPEN', 'RESOLVED', { resolved_at: null, closed_at: null }, t)).toEqual({ resolved_at: t, closed_at: null });
    expect(statusFields('OPEN', 'CLOSED', { resolved_at: null, closed_at: null }, t)).toEqual({ resolved_at: t, closed_at: t });
    expect(statusFields('RESOLVED', 'CLOSED', { resolved_at: 'old', closed_at: null }, t)).toEqual({ resolved_at: 'old', closed_at: t });
    expect(statusFields('CLOSED', 'OPEN', { resolved_at: 'old', closed_at: 'old' }, t)).toEqual({ resolved_at: null, closed_at: null });
    expect(statusFields('OPEN', 'IMPROVING', { resolved_at: null, closed_at: null }, t)).toEqual({ resolved_at: null, closed_at: null });
  });
  it('日期一律台北：UTC 16:00 後已是台北隔天（舊版用 UTC 日期）', () => {
    expect(taipeiDate('2038-03-01T15:59:59Z')).toBe('2038-03-01');
    expect(taipeiDate('2038-03-01T16:00:00Z')).toBe('2038-03-02');
    expect(addDays('2038-02-28', 1)).toBe('2038-03-01');
    expect(addDays('2038-03-01', -1)).toBe('2038-02-28');
    expect(isDateString('2038-03-01')).toBe(true);
    expect(isDateString('2038-3-1')).toBe(false);
    expect(isDateString('2038-13-45')).toBe(false);
  });
  it('追蹤佇列分桶：逾期、今天、近期（沒有日期歸近期；E4 逾期只標示）', () => {
    expect(bucketFollowUp('2038-03-01', '2038-03-02')).toBe('overdue');
    expect(bucketFollowUp('2038-03-02', '2038-03-02')).toBe('today');
    expect(bucketFollowUp('2038-03-03', '2038-03-02')).toBe('upcoming');
    expect(bucketFollowUp(null, '2038-03-02')).toBe('upcoming');
  });
  it('搜尋字串跳脫：逗號、括號、百分比、底線、引號都是一般文字', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    const cond = orContainsAny(['title', 'summary'], escapeLike('x,y)"z'));
    expect(cond).toBe('title.ilike."%x,y)\\"z%",summary.ilike."%x,y)\\"z%"');
  });
  it('時間線：建立、紀錄、追蹤與事件合併，新到舊；刪除事件保留', () => {
    const items = buildTimeline(
      { created_at: '2038-01-01T00:00:00Z', owner_user_id: 'u1', title: 'T' },
      [{ id: 'r1', created_at: '2038-01-02T00:00:00Z', created_by: 'u1', record_type: 'MANAGEMENT', action_summary: 'A' }],
      [{ id: 'f1', created_at: '2038-01-03T00:00:00Z', created_by: 'u1', result_status: 'IMPROVED', result_notes: 'N' }],
      [{ event_type: 'RECORD_SOFT_DELETE', event_at: '2038-01-04T00:00:00+00:00', title: '刪除督導管理紀錄', body: '原因', actor_user_id: 'u2', record_id: 'r1' }],
    );
    expect(items.map((i) => i.type)).toEqual(['RECORD_SOFT_DELETE', 'FOLLOWUP_ADDED', 'RECORD_ADDED', 'CASE_CREATED']);
    expect(items[0]).toMatchObject({ body: '原因', actor_user_id: 'u2', record_id: 'r1' });
  });
  it('資料庫錯誤文字轉成狀態碼與訊息', () => {
    expect(dbErrorInfo({ message: 'SUPERVISOR_CASE_PERMISSION_DENIED: 沒有編輯督導管理日誌權限' })).toEqual({ status: 403, message: '沒有編輯督導管理日誌權限' });
    expect(dbErrorInfo({ message: 'WORKSPACE_SUPERVISOR_NOT_FOUND: 督導管理案件不存在' })).toEqual({ status: 404, message: '督導管理案件不存在' });
    expect(dbErrorInfo({ message: 'WORKSPACE_SUPERVISOR_ALREADY_DELETED: 此督導管理案件已被刪除' }).status).toBe(409);
    expect(dbErrorInfo({ code: '23505', message: 'dup' }).status).toBe(409);
    expect(dbErrorInfo({ code: '23503', message: 'fk' }).status).toBe(400);
    expect(dbErrorInfo({ code: 'XX000', message: 'boom' }).status).toBe(503);
  });
});

describe('M6-W32：重用舊版 validation（不重寫商業規則）', () => {
  it('管理紀錄：發現、判斷、動作三欄缺一不可儲存', () => {
    const base = { observation: 'o', judgment: 'j', action_summary: 'a', target_name_snapshot: 't' };
    expect(() => validateRecordPayload(base)).not.toThrow();
    for (const k of ['observation', 'judgment', 'action_summary'] as const) {
      expect(() => validateRecordPayload({ ...base, [k]: '  ' }), k).toThrow(/請輸入/);
    }
  });
  it('案件：門市目標必須選門市、人員目標必須選員工、系統欄位不可由前端指定', () => {
    expect(() => validateCasePayload({ title: 't', target_type: 'STORE', target_name_snapshot: 'x' })).toThrow('門市目標必須選擇門市');
    expect(() => validateCasePayload({ title: 't', target_type: 'EMPLOYEE', target_name_snapshot: 'x' })).toThrow('人員目標必須選擇員工');
    expect(() => validateCasePayload({ title: 't', target_type: 'OTHER', target_name_snapshot: 'x', created_by: 'u' })).toThrow(/不可由 Client 指定/);
  });
});
