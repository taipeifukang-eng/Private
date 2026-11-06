import { describe, expect, it } from 'vitest';
import { isSupportMember, normalizeTaskTemplate } from '../../../lib/workspace/task-template';
import { applyTaskChanges, flattenTaskSteps, taskState } from '../../../lib/workspace/task-state';
import { taskSchedule } from '../../../lib/workspace/task-schedule';

// P03 單元層：建立／編輯任務的正規化（M3 A.6 部門限制與跨部門支援、上限、日期），以及共用元件背後的規則
// （TaskStepFields 的欄位格式由 normalizeTaskTemplate 驗證；TaskSchedule 的甘特計算 = taskSchedule；執行頁 = task-state）。

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = [
  { id: u(1), department: '營業部' },
  { id: u(2), department: '營業部' },
  { id: u(3), department: '總務' },
  { id: u(4), department: null },
];
const step = (id: string, over: Record<string, unknown> = {}) => ({ id, label: `步驟${id}`, description: '', required: true, planned_start_date: '', planned_end_date: '', subSteps: [], ...over });
const section = (over: Record<string, unknown> = {}) => ({ id: 's1', department: '營業部', assigned_users: [u(1)], steps: [step('a')], ...over });
const form = (sections: unknown[], over: Record<string, unknown> = {}) => ({ title: ' 標題 ', description: '', planned_start_date: '', planned_end_date: '', sections, ...over });
const fails = (raw: unknown, message: RegExp) => expect(() => normalizeTaskTemplate(raw, people)).toThrow(message);

describe('A.6 部門限制（預設嚴格）', () => {
  it('同部門人員：通過，support_users 為空陣列', () => {
    const r = normalizeTaskTemplate(form([section({ assigned_users: [u(1), u(2)] })]), people);
    expect(r.sections[0].assigned_users).toEqual([u(1), u(2)]);
    expect(r.sections[0].support_users).toEqual([]);
    expect(r.title).toBe('標題');
  });
  it('其他部門的人沒有明確勾選：拒絕並提示要勾跨部門支援', () => {
    fails(form([section({ assigned_users: [u(1), u(3)] })]), /不屬於所選部門.*跨部門支援/);
  });
  it('沒有部門的人（department 空）不能當支援人員', () => {
    fails(form([section({ assigned_users: [u(4)], support_users: [u(4)] })]), /不屬於所選部門/);
  });
  it('不存在的人：拒絕', () => {
    fails(form([section({ assigned_users: [u(99)] })]), /執行人員不存在/);
  });
});

describe('A.6 跨部門支援人員（明確勾選）', () => {
  it('勾選的其他部門的人：通過，並記在 support_users', () => {
    const r = normalizeTaskTemplate(form([section({ assigned_users: [u(1), u(3)], support_users: [u(3)] })]), people);
    expect(r.sections[0].assigned_users).toEqual([u(1), u(3)]);
    expect(r.sections[0].support_users).toEqual([u(3)]);
  });
  it('支援清單裡的同部門人：不算跨部門，不會被標記', () => {
    const r = normalizeTaskTemplate(form([section({ assigned_users: [u(1)], support_users: [u(1)] })]), people);
    expect(r.sections[0].support_users).toEqual([]);
  });
  it('支援人員必須同時在 assigned_users', () => {
    fails(form([section({ assigned_users: [u(1)], support_users: [u(3)] })]), /必須同時是執行人員/);
  });
  it('支援清單格式錯誤（非陣列、含非字串）', () => {
    fails(form([section({ support_users: 'x' })]), /跨部門支援人員格式不符/);
    fails(form([section({ support_users: [1] })]), /跨部門支援人員格式不符/);
  });
  it('換部門後舊的支援人員若已經是新部門的人就不標記；每個區段各自判斷', () => {
    const r = normalizeTaskTemplate(
      form([section({ id: 'a', department: '總務', assigned_users: [u(3), u(1)], support_users: [u(1)], steps: [step('x1')] }), section({ id: 'b', assigned_users: [u(3)], support_users: [u(3)], steps: [step('x2')] })]),
      people,
    );
    expect(r.sections[0].support_users).toEqual([u(1)]);
    expect(r.sections[1].support_users).toEqual([u(3)]);
  });
  it('isSupportMember：只認該區段明確標記的人', () => {
    const sections = [{ id: 's1', support_users: [u(3)] }, { id: 's2' }];
    expect(isSupportMember(sections, 's1', u(3))).toBe(true);
    expect(isSupportMember(sections, 's1', u(1))).toBe(false);
    expect(isSupportMember(sections, 's2', u(3))).toBe(false);
    expect(isSupportMember(sections, null, u(3))).toBe(false);
    expect(isSupportMember(undefined, 's1', u(3))).toBe(false);
  });
});

describe('上限維持新版（50 區段、1000 項目）與欄位格式（TaskStepFields 的資料）', () => {
  it('區段 0 或 51 拒絕，50 通過', () => {
    fails(form([]), /1 至 50/);
    fails(form(Array.from({ length: 51 }, (_, i) => section({ id: `s${i}` }))), /1 至 50/);
    expect(normalizeTaskTemplate(form(Array.from({ length: 50 }, (_, i) => section({ id: `s${i}`, steps: [step(`x${i}`)] }))), people).sections).toHaveLength(50);
  });
  it('項目（含子項）1000 通過、1001 拒絕', () => {
    const many = (n: number) => [section({ steps: Array.from({ length: n }, (_, i) => step(`p${i}`)) })];
    expect(normalizeTaskTemplate(form(many(1000)), people).sections[0].steps).toHaveLength(1000);
    fails(form(many(1001)), /項目數量/);
    const withSubs = [section({ steps: Array.from({ length: 500 }, (_, i) => step(`p${i}`, { subSteps: [step(`c${i}`)] })) })];
    expect(normalizeTaskTemplate(form(withSubs), people).sections[0].steps).toHaveLength(500);
    fails(form([section({ steps: [...Array.from({ length: 500 }, (_, i) => step(`p${i}`, { subSteps: [step(`c${i}`)] })), step('extra')] })]), /項目數量/);
  });
  it('名稱必填且不超過 300 字、說明不超過 5000 字、項目 id 不可重複', () => {
    fails(form([section({ steps: [step('a', { label: '   ' })] })]), /名稱或說明格式不符/);
    fails(form([section({ steps: [step('a', { label: 'x'.repeat(301) })] })]), /名稱或說明格式不符/);
    fails(form([section({ steps: [step('a', { description: 'x'.repeat(5001) })] })]), /名稱或說明格式不符/);
    fails(form([section({ steps: [step('a'), step('a')] })]), /重複或無效/);
    fails(form([section({ steps: [step('__proto__')] })]), /重複或無效/);
  });
  it('日期：格式、不存在的日子、起訖顛倒（項目與整體）', () => {
    fails(form([section({ steps: [step('a', { planned_start_date: '2026-02-30' })] })]), /日期格式不符/);
    fails(form([section({ steps: [step('a', { planned_start_date: 'abc' })] })]), /日期格式不符/);
    fails(form([section({ steps: [step('a', { planned_start_date: '2026-03-02', planned_end_date: '2026-03-01' })] })]), /不可晚於/);
    fails(form([section()], { planned_start_date: '2026-03-02', planned_end_date: '2026-03-01' }), /不可晚於/);
    const ok = normalizeTaskTemplate(form([section({ steps: [step('a', { planned_start_date: '2026-03-01', planned_end_date: '2026-03-01' })] })]), people);
    expect(ok.sections[0].steps[0]).toMatchObject({ planned_start_date: '2026-03-01', planned_end_date: '2026-03-01' });
  });
  it('每區段至少要有執行人員與工作項目；必填旗標只認 true', () => {
    fails(form([section({ assigned_users: [] })]), /需要執行人員及工作項目/);
    fails(form([section({ steps: [] })]), /需要執行人員及工作項目/);
    expect(normalizeTaskTemplate(form([section({ steps: [step('a', { required: 'yes' })] })]), people).sections[0].steps[0].required).toBe(false);
  });
});

describe('TaskSchedule 背後的 taskSchedule（甘特）回歸', () => {
  it('沒有 sections：退回單一 main 區段，部門取指派部門或「未分部門」', () => {
    const r = taskSchedule({ steps: [step('a')], department: null, created_at: '2026-03-04T00:00:00Z' });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].id).toBe('main');
    expect(r.sections[0].department).toBe('未分部門');
  });
  it('週起點對齊週一；非法日期被忽略；子項標 sub', () => {
    const r = taskSchedule({
      sections: [{ id: 's', department: 'D', assigned_users: [], steps: [step('a', { planned_start_date: '2026-03-04', planned_end_date: '2026-03-18', subSteps: [step('b', { planned_start_date: '2026-02-30' })] })] }],
      created_at: '2026-03-01T00:00:00Z',
    });
    expect(r.weeks[0].start).toBe('2026-03-02');
    expect(r.count).toBe(3);
    expect(r.sections[0].items.map((i: any) => [i.id, i.sub])).toEqual([['a', false], ['b', true]]);
    expect(r.sections[0].items[1].estimated).toBe(true);
  });
  it('整體預計起訖優先；起訖顛倒時不採用', () => {
    const base = { sections: [{ id: 's', department: 'D', assigned_users: [], steps: [step('a')] }], created_at: '2026-03-01T00:00:00Z' };
    expect(taskSchedule({ ...base, planned_start_date: '2026-03-02', planned_end_date: '2026-03-30' })).toMatchObject({ explicit: true, count: 5 });
    expect(taskSchedule({ ...base, planned_start_date: '2026-03-30', planned_end_date: '2026-03-02' })).toMatchObject({ explicit: false });
  });
  it('狀態：已完成、第一個未完成為進行中、其餘待處理；人員名單以協作者姓名帶出', () => {
    const r = taskSchedule({
      sections: [{ id: 's', department: 'D', assigned_users: [u(1), u(2)], steps: [step('a'), step('b'), step('c')] }],
      state: { a: '' },
      collaborators: [{ user_id: u(1), name: '甲' }],
      created_at: '2026-03-01T00:00:00Z',
    });
    expect(r.sections[0].items.map((i: any) => i.status)).toEqual(['已完成', '進行中', '待處理']);
    expect(r.sections[0].people).toEqual(['甲', '未指定']);
  });
});

describe('task-state 回歸（執行頁勾選規則）', () => {
  it('展平順序為主項、子項、下一主項', () => {
    expect(flattenTaskSteps([step('a', { subSteps: [step('a1'), step('a2')] }), step('b')]).map((s) => s.id)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(flattenTaskSteps([])).toEqual([]);
  });
  it('taskState：取消勾選會移除；備註 null 存成空字串；同時間依 id 決定', () => {
    const logs = [
      { id: '2', step_id: 'a', action: 'uncomplete', created_at: '2026-01-01T00:00:00Z' },
      { id: '1', step_id: 'a', action: 'complete', note: null, created_at: '2026-01-01T00:00:00Z' },
      { id: '3', step_id: 'b', action: 'complete', note: '備註', created_at: '2026-01-01T00:00:01Z' },
    ];
    expect(taskState(logs)).toEqual({ b: '備註' });
    expect(taskState([...logs].reverse())).toEqual({ b: '備註' });
    expect(taskState([logs[1]])).toEqual({ a: '' });
  });
  it('勾主項會帶出全部子項；子項全部勾選會自動勾主項；取消子項會取消主項', () => {
    const steps = [step('a', { subSteps: [step('a1'), step('a2')] })];
    let r = applyTaskChanges(steps, {}, [{ stepId: 'a', checked: true }]);
    expect(Object.keys(r.state).sort()).toEqual(['a', 'a1', 'a2']);
    r = applyTaskChanges(steps, r.state, [{ stepId: 'a1', checked: false }]);
    expect(Object.keys(r.state).sort()).toEqual(['a2']);
    r = applyTaskChanges(steps, r.state, [{ stepId: 'a1', checked: true }]);
    expect(Object.keys(r.state).sort()).toEqual(['a', 'a1', 'a2']);
    expect(() => applyTaskChanges(steps, {}, [{ stepId: 'zzz', checked: true }])).toThrow(/不屬於可操作區段/);
    expect(() => applyTaskChanges(steps, {}, [{ stepId: 'a', checked: true, note: 'x'.repeat(5001) }])).toThrow(/格式不符/);
  });
});
