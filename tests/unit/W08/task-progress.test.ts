import { describe, expect, it } from 'vitest';
import { allTemplateSteps, dedupeKeepProgress, overallStatus, progressOf, sectionSteps, statusCounts } from '../../../lib/workspace/task-progress';

// W08 / W10 單元層（M3 B.2、B.3、B.4）：進度、整體狀態與我的任務去重的純規則。

const step = (id: string, subs: string[] = []) => ({ id, label: id, subSteps: subs.map((s) => ({ id: s, label: s })) });
const template = {
  sections: [
    { id: 'sec-a', department: '營業部', steps: [step('a1'), step('a2', ['a2x'])] },
    { id: 'sec-b', department: '總務部', steps: [step('b1')] },
  ],
  steps_schema: [],
};

describe('overallStatus（B.3：所有區段所有步驟完成才算已完成）', () => {
  it('沒有步驟 = 待處理；有勾選 = 進行中；全部勾選 = 已完成', () => {
    expect(overallStatus(0, 0)).toBe('pending');
    expect(overallStatus(4, 0)).toBe('pending');
    expect(overallStatus(4, 1)).toBe('in_progress');
    expect(overallStatus(4, 3)).toBe('in_progress');
    expect(overallStatus(4, 4)).toBe('completed');
  });
});

describe('progressOf', () => {
  it('列出範本全部區段的步驟（含子步驟）', () => {
    expect(allTemplateSteps(template).map((s) => s.id)).toEqual(['a1', 'a2', 'a2x', 'b1']);
    expect(allTemplateSteps({ steps_schema: [step('x')] }).map((s) => s.id)).toEqual(['x']);
  });
  it('自己的區段做完，整體仍是進行中（舊版會算成已完成）；我的進度只算自己區段', () => {
    const p = progressOf(template, 'sec-a', { a1: '', a2: '', a2x: '' });
    expect(p).toMatchObject({ total: 3, done: 3, overallTotal: 4, overallDone: 3, status: 'in_progress', percent: 75, sectionChanged: false });
  });
  it('所有區段都做完才是已完成；取消任何一個勾選就退回進行中', () => {
    const all: Record<string, string> = { a1: '', a2: '', a2x: '', b1: '' };
    expect(progressOf(template, 'sec-a', all).status).toBe('completed');
    const less = { ...all };
    delete less.b1;
    expect(progressOf(template, 'sec-a', less).status).toBe('in_progress');
    expect(progressOf(template, 'sec-b', {}).status).toBe('pending');
  });
  it('區段被改掉或刪除：標 sectionChanged，我的進度為 0，整體仍可算', () => {
    const p = progressOf(template, 'sec-gone', { a1: '' });
    expect(p).toMatchObject({ sectionChanged: true, total: 0, done: 0, overallTotal: 4, overallDone: 1 });
    expect(sectionSteps(template, 'sec-gone')).toBeNull();
  });
  it('沒有區段的舊範本：用 steps_schema，區段為空', () => {
    const legacy = { sections: [], steps_schema: [step('x'), step('y')] };
    expect(progressOf(legacy, null, { x: '' })).toMatchObject({ total: 2, done: 1, overallTotal: 2, status: 'in_progress', percent: 50 });
  });
  it('不看資料庫 status 欄位：只認勾選紀錄推算的 state', () => {
    expect(progressOf(template, 'sec-a', {}).status).toBe('pending');
  });
});

describe('dedupeKeepProgress（B.2）', () => {
  const row = (id: string, created: string, overallDone: number, over: Record<string, unknown> = {}) => ({
    id, created_at: created, overallDone, template_id: 't1', department: '營業部', sectionId: 'sec-a', ...over,
  });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it('沒有任何進度：只留最新一筆（輸入已新到舊）', () => {
    const out = dedupeKeepProgress([row('c', '2038-03', 0), row('b', '2038-02', 0), row('a', '2038-01', 0)]);
    expect(ids(out)).toEqual(['c']);
    expect(out[0].multiple).toBe(false);
  });
  it('只有舊的那筆有進度：保留有進度的，收起沒動過的新卡片（舊版會留下最新那筆而藏掉進度）', () => {
    const out = dedupeKeepProgress([row('c', '2038-03', 0), row('a', '2038-01', 2)]);
    expect(ids(out)).toEqual(['a']);
  });
  it('多筆都有進度：全部顯示並標 multiple；沒動過的仍收起', () => {
    const out = dedupeKeepProgress([row('d', '2038-04', 0), row('c', '2038-03', 1), row('a', '2038-01', 2)]);
    expect(ids(out)).toEqual(['c', 'a']);
    expect(out.every((r) => r.multiple)).toBe(true);
  });
  it('去重鍵是同範本、同部門、同區段：任一不同就各自獨立', () => {
    const out = dedupeKeepProgress([
      row('x1', '2038-05', 0),
      row('x2', '2038-04', 0, { department: '總務部' }),
      row('x3', '2038-03', 0, { sectionId: 'sec-b' }),
      row('x4', '2038-02', 0, { template_id: 't2' }),
    ]);
    expect(ids(out)).toEqual(['x1', 'x2', 'x3', 'x4']);
    expect(out.every((r) => !r.multiple)).toBe(true);
  });
  it('單筆有進度不標 multiple；空輸入回空', () => {
    expect(dedupeKeepProgress([row('a', '2038-01', 1)])[0].multiple).toBe(false);
    expect(dedupeKeepProgress([])).toEqual([]);
  });
});

describe('statusCounts（B.4：儀表板統計卡）', () => {
  it('依整體狀態計數', () => {
    expect(statusCounts([{ status: 'pending' }, { status: 'in_progress' }, { status: 'in_progress' }, { status: 'completed' }])).toEqual({
      total: 4, pending: 1, in_progress: 2, completed: 1,
    });
    expect(statusCounts([])).toEqual({ total: 0, pending: 0, in_progress: 0, completed: 0 });
  });
});
