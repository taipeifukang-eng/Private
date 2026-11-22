import { describe, expect, it } from 'vitest';
import {
  canDoMonthlyAction,
  canExpandPerformance,
  computeStoreStats,
  deriveMonthState,
  levelSuffix,
  MONTHLY_ACTIONS,
  MONTHLY_STATUS_RULES,
  MONTHLY_STATUSES,
  monthlyActionBlockedMessage,
  movementTypeLabel,
  newbiesNeedCheck,
  nextUnconfirmedStore,
  normalizeSummaryStatus,
  partTimeMissingHours,
  preSubmitReport,
  resolveMonthState,
  rowsAllow,
  rowsAllowAll,
  staffTags,
  summaryStatusToMonthly,
  workloadText,
  type MonthlyAction,
  type MonthlyStatus,
} from '../../../lib/workspace/monthly-status-rules';

// W01a / M1-x1：規則表。舊版來源：app/store/actions.ts（submit/confirm/revert/unconfirm/checkNewbieStatus）與
// app/monthly-status/page.tsx（統計卡片、loadStoreSummaries moveToNext、特殊標記、handleSubmit）。

describe('M1-x1 狀態 × 動作規則表', () => {
  // 完整 3 × 8 矩陣，逐格釘住，避免有人悄悄改規則。
  const expected: Record<MonthlyStatus, MonthlyAction[]> = {
    draft: ['add', 'edit', 'delete', 'submit'],
    submitted: ['confirm', 'revert', 'export'],
    confirmed: ['unconfirm', 'export'],
  };
  for (const status of MONTHLY_STATUSES) {
    for (const action of MONTHLY_ACTIONS) {
      it(`${status} × ${action} = ${expected[status].includes(action)}`, () => {
        expect(canDoMonthlyAction(status, action)).toBe(expected[status].includes(action));
        expect(MONTHLY_STATUS_RULES[status][action]).toBe(expected[status].includes(action));
      });
    }
  }

  it('未知狀態、null、undefined 一律不允許任何動作', () => {
    for (const bad of ['', 'DRAFT', 'in_progress', null, undefined, 1, '__proto__', 'toString']) {
      for (const action of MONTHLY_ACTIONS) expect(canDoMonthlyAction(bad, action)).toBe(false);
    }
  });

  it('W01a-q1：只有草稿可刪，已送審與已確認提示需先退回', () => {
    expect(canDoMonthlyAction('draft', 'delete')).toBe(true);
    expect(canDoMonthlyAction('submitted', 'delete')).toBe(false);
    expect(canDoMonthlyAction('confirmed', 'delete')).toBe(false);
    expect(monthlyActionBlockedMessage('submitted', 'delete')).toContain('退回草稿');
    expect(monthlyActionBlockedMessage('confirmed', 'delete')).toContain('退回草稿');
    expect(monthlyActionBlockedMessage('draft', 'delete')).toBe('');
  });

  it('被拒的動作都有說明，允許的動作沒有訊息', () => {
    for (const status of MONTHLY_STATUSES)
      for (const action of MONTHLY_ACTIONS)
        expect(monthlyActionBlockedMessage(status, action) === '').toBe(canDoMonthlyAction(status, action));
  });
});

describe('整間門市狀態推導（與舊版 loadStaffStatus 一致）', () => {
  it('沒有人員列為 null', () => expect(deriveMonthState([])).toBeNull());
  it('全部已確認 → confirmed', () => expect(deriveMonthState([{ status: 'confirmed' }, { status: 'confirmed' }])).toBe('confirmed'));
  it('已送審與已確認混合 → submitted', () => expect(deriveMonthState([{ status: 'confirmed' }, { status: 'submitted' }])).toBe('submitted'));
  it('只要有一列草稿 → draft', () => expect(deriveMonthState([{ status: 'submitted' }, { status: 'draft' }])).toBe('draft'));
  it('摘要狀態對應：in_progress → draft、未知 → null', () => {
    expect(summaryStatusToMonthly('in_progress')).toBe('draft');
    expect(summaryStatusToMonthly('submitted')).toBe('submitted');
    expect(summaryStatusToMonthly('confirmed')).toBe('confirmed');
    expect(summaryStatusToMonthly('not_started')).toBeNull();
  });
  it('沒有人員列時退回摘要狀態', () => {
    expect(resolveMonthState([], 'submitted')).toBe('submitted');
    expect(resolveMonthState([{ status: 'draft' }], 'confirmed')).toBe('draft');
    expect(resolveMonthState([], undefined)).toBeNull();
  });
  it('rowsAllowAll：每一列都要符合；混合狀態與沒有列一律不可', () => {
    expect(rowsAllowAll([], 'confirm')).toBe(false);
    expect(rowsAllowAll([{ status: 'submitted' }, { status: 'submitted' }], 'confirm')).toBe(true);
    expect(rowsAllowAll([{ status: 'submitted' }, { status: 'draft' }], 'confirm')).toBe(false);
    expect(rowsAllowAll([{ status: 'submitted' }, { status: 'confirmed' }], 'revert')).toBe(false);
    expect(rowsAllowAll([{ status: 'confirmed' }, { status: 'submitted' }], 'unconfirm')).toBe(false);
    expect(rowsAllowAll([{ status: 'confirmed' }], 'unconfirm')).toBe(true);
  });

  it('rowsAllow：任一列可執行即可；沒有列一律不可', () => {
    expect(rowsAllow([], 'submit')).toBe(false);
    expect(rowsAllow([{ status: 'submitted' }, { status: 'draft' }], 'submit')).toBe(true);
    expect(rowsAllow([{ status: 'submitted' }], 'submit')).toBe(false);
    expect(rowsAllow([{ status: 'submitted' }], 'confirm')).toBe(true);
    expect(rowsAllow([{ status: 'confirmed' }], 'unconfirm')).toBe(true);
    expect(rowsAllow([{ status: 'confirmed' }], 'revert')).toBe(false);
  });
});

describe('統計卡片（舊版：總門市數／已確認／已提交／待填寫）', () => {
  const stores = [
    { id: 'a', is_active: true },
    { id: 'b', is_active: true },
    { id: 'c', is_active: true },
    { id: 'd', is_active: true },
    { id: 'x', is_active: false },
  ];
  it('待填寫 = 總數 - 已確認 - 已提交；已停止門市不計入', () => {
    const summaries = [
      { store_id: 'a', store_status: 'confirmed' },
      { store_id: 'b', store_status: 'submitted' },
      { store_id: 'c', store_status: 'in_progress' },
      { store_id: 'x', store_status: 'confirmed' },
    ];
    expect(computeStoreStats(stores, summaries)).toEqual({ total: 4, confirmed: 1, submitted: 1, pending: 2 });
  });
  it('沒有任何摘要時全部待填寫', () => expect(computeStoreStats(stores, [])).toEqual({ total: 4, confirmed: 0, submitted: 0, pending: 4 }));
  it('沒有門市時全為 0', () => expect(computeStoreStats([], [])).toEqual({ total: 0, confirmed: 0, submitted: 0, pending: 0 }));
  it('is_active 缺漏視為有效', () => expect(computeStoreStats([{ id: 'a' }], [{ store_id: 'a', store_status: 'confirmed' }]).confirmed).toBe(1));
  it('摘要狀態標準化', () => {
    expect(normalizeSummaryStatus('confirmed')).toBe('confirmed');
    expect(normalizeSummaryStatus('whatever')).toBe('pending');
    expect(normalizeSummaryStatus(undefined)).toBe('pending');
  });
});

describe('確認後自動跳下一間（舊版 moveToNext）', () => {
  const active = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }];
  const st = (m: Record<string, string>) => Object.entries(m).map(([store_id, store_status]) => ({ store_id, store_status }));
  it('跳到目前之後第一間未確認', () => {
    expect(nextUnconfirmedStore(active, 's1', st({ s1: 'confirmed', s2: 'confirmed', s3: 'submitted' }))).toBe('s3');
  });
  it('沒有摘要的門市也算未確認', () => expect(nextUnconfirmedStore(active, 's1', st({ s1: 'confirmed' }))).toBe('s2'));
  it('之後全已確認 → 不跳（不繞回頭）', () => {
    expect(nextUnconfirmedStore(active, 's3', st({ s1: 'submitted', s2: 'submitted', s3: 'confirmed', s4: 'confirmed' }))).toBeNull();
  });
  it('最後一間 → 不跳', () => expect(nextUnconfirmedStore(active, 's4', st({}))).toBeNull());
  it('目前門市不在有效清單（已停止）→ 不跳', () => expect(nextUnconfirmedStore(active, 'inactive', st({}))).toBeNull());
  it('空清單 → 不跳', () => expect(nextUnconfirmedStore([], 's1', [])).toBeNull());
});

describe('送審前檢查：兼職時數（W01a-q2，舊版 handleSubmit 規則）', () => {
  const row = (employment_type: string, work_hours: unknown, extra: object = {}) => ({ id: `${employment_type}-${String(work_hours)}`, employee_code: 'E1', employee_name: '甲', employment_type, work_hours: work_hours as never, status: 'draft', ...extra });
  it.each([
    [null, true],
    [undefined, true],
    ['', true],
    [0, true],
    ['0', true],
    [-1, true],
    ['abc', true],
    [0.5, false],
    [8, false],
    ['12', false],
  ])('兼職 work_hours=%j → 缺漏=%s', (hours, missing) => {
    expect(partTimeMissingHours([row('part_time', hours)]).length).toBe(missing ? 1 : 0);
  });
  it('正職不看時數', () => expect(partTimeMissingHours([row('full_time', null)])).toEqual([]));
  it('輸出含員編與姓名', () => expect(partTimeMissingHours([row('part_time', 0)])[0]).toMatchObject({ employee_code: 'E1', employee_name: '甲' }));
});

describe('送審前檢查：新人階段（舊版 checkNewbieStatus 規則）', () => {
  const n = (start_date: string, extra: object = {}) => ({ id: start_date, employee_code: 'N1', employee_name: '新', start_date, position: '新人', monthly_status: 'full_month', newbie_level: null as string | null, status: 'draft', ...extra });
  const ym = '2026-10';
  it('到職當月 → 不提示', () => expect(newbiesNeedCheck([n('2026-10-01')], ym)).toEqual([]));
  it('到職第二個月且未標註階段 → 應該過一階段', () => {
    const r = newbiesNeedCheck([n('2026-09-15')], ym);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ suggested_action: '應該過一階段', current_level: '未設定' });
  });
  it('到職第二個月且已是一階 → 不提示', () => expect(newbiesNeedCheck([n('2026-09-15', { newbie_level: '一階新人' })], ym)).toEqual([]));
  it('到職第三個月且仍一階 → 應該過二階段', () => {
    expect(newbiesNeedCheck([n('2026-08-01', { newbie_level: '一階新人' })], ym)[0].suggested_action).toBe('應該過二階段');
  });
  it('到職第三個月且已二階 → 不提示', () => expect(newbiesNeedCheck([n('2026-08-01', { newbie_level: '二階新人' })], ym)).toEqual([]));
  it('滿 6 個月仍是新人 → 應該要過專員考試（覆蓋階段提示）', () => {
    expect(newbiesNeedCheck([n('2026-04-01', { newbie_level: '二階新人' })], ym)[0].suggested_action).toBe('應該要過專員考試');
  });
  it('職位已是專員 → 不提示', () => expect(newbiesNeedCheck([n('2026-04-01', { position: '專員' })], ym)).toEqual([]));
  it('職位非新人但本月狀態為本月新進 → 仍檢查', () => {
    expect(newbiesNeedCheck([n('2026-09-15', { position: '專員', monthly_status: 'new_hire' })], ym)).toHaveLength(1);
  });
  it('跨年：到職 2025-12-01、月份 2026-01 → 差 1 個月', () => {
    expect(newbiesNeedCheck([n('2025-12-01')], '2026-01')[0].suggested_action).toBe('應該過一階段');
  });
  it('沒有到職日、非草稿、壞月份 → 不提示', () => {
    expect(newbiesNeedCheck([n('2026-09-15', { start_date: null })], ym)).toEqual([]);
    expect(newbiesNeedCheck([n('2026-09-15', { status: 'submitted' })], ym)).toEqual([]);
    expect(newbiesNeedCheck([n('2026-09-15')], 'bad')).toEqual([]);
    expect(newbiesNeedCheck([n('壞日期')], ym)).toEqual([]);
  });
});

describe('送審前檢查：同一份報告（W01a-q2）', () => {
  it('兼職缺時數與新人需確認並列，hasIssues 為 true', () => {
    const rows = [
      { id: 'p', employee_code: 'P1', employee_name: '兼', employment_type: 'part_time', work_hours: null, status: 'draft', position: '兼職' },
      { id: 'n', employee_code: 'N1', employee_name: '新', employment_type: 'full_time', start_date: '2026-09-05', position: '新人', status: 'draft', newbie_level: null },
    ];
    const r = preSubmitReport(rows, '2026-10');
    expect(r.partTimeMissingHours.map((x) => x.id)).toEqual(['p']);
    expect(r.newbiesNeedCheck.map((x) => x.id)).toEqual(['n']);
    expect(r.hasIssues).toBe(true);
  });
  it('都沒有問題 → hasIssues false', () => {
    expect(preSubmitReport([{ id: 'a', employment_type: 'full_time', status: 'draft', position: '專員' }], '2026-10').hasIssues).toBe(false);
  });
  it('已送審的兼職列不列入（不能再補填）', () => {
    expect(preSubmitReport([{ id: 'a', employment_type: 'part_time', work_hours: 0, status: 'submitted' }], '2026-10').hasIssues).toBe(false);
  });
});

describe('細節標籤與顯示（舊版特殊標記欄）', () => {
  it('依舊版順序輸出標籤', () => {
    const tags = staffTags({ is_dual_position: true, has_manager_bonus: true, is_supervisor_rotation: true, is_acting_manager: true, special_role: '特助', extra_tasks: ['長照外務', '診所業務'], extra_task_external_hours: 12 });
    expect(tags.map((t) => t.label)).toEqual(['雙職務', '店長加成', '督導卡班', '代理店長', '特助', '長照外務, 診所業務(12h)']);
  });
  it('沒有標記為空陣列；外務時數為 0 不顯示 h', () => {
    expect(staffTags({})).toEqual([]);
    expect(staffTags({ extra_tasks: ['長照外務'], extra_task_external_hours: 0 })[0].label).toBe('長照外務');
  });
  it('新人與行政顯示階段，缺漏顯示未標註', () => {
    expect(levelSuffix('新人', '一階新人')).toEqual({ text: '一階', missing: false });
    expect(levelSuffix('行政', '二階行政')).toEqual({ text: '二階', missing: false });
    expect(levelSuffix('新人', null)).toEqual({ text: '未標註', missing: true });
    expect(levelSuffix('專員', null)).toBeNull();
  });
  it('天數/時數欄（舊版格式）', () => {
    expect(workloadText({ employment_type: 'full_time', work_days: 20, total_days_in_month: 31 })).toBe('20/31 天');
    expect(workloadText({ employment_type: 'full_time', work_days: null, total_days_in_month: 30 })).toBe('0/30 天');
    expect(workloadText({ employment_type: 'part_time', work_hours: 36 })).toBe('36 小時');
    expect(workloadText({ employment_type: 'part_time', work_hours: null })).toBe('0 小時');
    expect(workloadText({ employment_type: 'full_time', work_days: 20, total_days_in_month: 31, supervisor_shift_hours: 12 })).toBe('12 小時');
    expect(workloadText({ employment_type: 'full_time', work_days: 20, total_days_in_month: 31, extra_task_planned_hours: 160 })).toBe('160 小時');
    expect(workloadText({ employment_type: 'full_time', work_days: 20, total_days_in_month: 31, supervisor_shift_hours: 0, extra_task_planned_hours: 0 })).toBe('20/31 天');
  });
  it('有交易次數且可看業績才可展開', () => {
    expect(canExpandPerformance({ transaction_count: 3 }, true)).toBe(true);
    expect(canExpandPerformance({ transaction_count: 3 }, false)).toBe(false);
    expect(canExpandPerformance({ transaction_count: 0 }, true)).toBe(false);
    expect(canExpandPerformance({ transaction_count: null }, true)).toBe(false);
  });
  it('異動類型標籤', () => {
    expect(movementTypeLabel('onboarding')).toBe('入職');
    expect(movementTypeLabel('store_transfer')).toBe('調店');
    expect(movementTypeLabel('promotion', '代理店長')).toBe('代理（舊紀錄）');
    expect(movementTypeLabel('xxx')).toBe('xxx');
  });
});
