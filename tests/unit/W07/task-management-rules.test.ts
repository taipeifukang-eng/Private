import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canDeleteAssignments, canDeleteTemplate, taskManagementScope, templateListRow, templateTitleMatches } from '../../../lib/workspace/task-management';

// W07 單元層（M3 A.1、A.2、A.3）：刪除權限矩陣、標題確認、列表列（尚未指派標示、不出現 NaN）、任務管理範圍。

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('A.1 刪除模板權限：建立者或有 task.template.delete 者；管理員範圍可刪全部', () => {
  const rows: Array<[string, Parameters<typeof canDeleteTemplate>[0], boolean]> = [
    ['管理員範圍（全部）', { all: true, createdBy: OTHER, userId: ME, hasDelete: false }, true],
    ['建立者本人', { all: false, createdBy: ME, userId: ME, hasDelete: false }, true],
    ['有 task.template.delete 的非建立者', { all: false, createdBy: OTHER, userId: ME, hasDelete: true }, true],
    ['既非建立者也沒有刪除權限', { all: false, createdBy: OTHER, userId: ME, hasDelete: false }, false],
    ['建立者欄位為空且沒有權限', { all: false, createdBy: null, userId: ME, hasDelete: false }, false],
    ['建立者欄位為空但有刪除權限', { all: false, createdBy: undefined, userId: ME, hasDelete: true }, true],
  ];
  for (const [name, input, expected] of rows) it(name, () => expect(canDeleteTemplate(input)).toBe(expected));
});

describe('A.2 刪除已完成任務需要 task.template.delete（管理員範圍視同擁有）', () => {
  it('矩陣', () => {
    expect(canDeleteAssignments({ all: true, canArchive: true })).toBe(true);
    expect(canDeleteAssignments({ all: false, canArchive: true })).toBe(true);
    expect(canDeleteAssignments({ all: false, canArchive: false })).toBe(false);
  });
});

describe('A.1 確認視窗：標題必須完全相符', () => {
  it('完全相符才通過；多空白、大小寫不同、空字串、非字串、空標題都不通過', () => {
    expect(templateTitleMatches('每月盤點', '每月盤點')).toBe(true);
    expect(templateTitleMatches('Monthly Check', 'monthly check')).toBe(false);
    expect(templateTitleMatches('每月盤點', '每月盤點 ')).toBe(false);
    expect(templateTitleMatches('每月盤點', ' 每月盤點')).toBe(false);
    expect(templateTitleMatches('每月盤點', '')).toBe(false);
    expect(templateTitleMatches('每月盤點', undefined)).toBe(false);
    expect(templateTitleMatches('每月盤點', 123)).toBe(false);
    expect(templateTitleMatches('', '')).toBe(false);
    expect(templateTitleMatches(null, 'x')).toBe(false);
  });
});

describe('A.3 模板列表列', () => {
  const t = { id: 't1', title: 'T', description: 'D', created_at: '2026-01-01', created_by: ME };
  it('沒有未封存任務：標示尚未指派，數字為 0（沒有 NaN）', () => {
    const row = templateListRow(t, []);
    expect(row).toMatchObject({ count: 0, unassigned: true, total: 0, done: 0, completed: 0 });
  });
  it('有任務：不標尚未指派；完成指派只算有項目且全部完成者', () => {
    const row = templateListRow(t, [
      { total: 4, done: 4 },
      { total: 4, done: 1 },
      { total: 0, done: 0 },
    ]);
    expect(row).toMatchObject({ count: 3, unassigned: false, total: 8, done: 5, completed: 1 });
  });
});

describe('任務管理範圍（taskManagementScope）', () => {
  const ctxOf = (o: { isAdmin?: boolean; role?: string | null; caps?: string[] }) =>
    ({
      isAdmin: !!o.isAdmin,
      user: { id: ME },
      has: (...codes: string[]) => !!o.isAdmin || codes.some((c) => (o.caps || []).includes(c)),
      admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: o.role ?? null }, error: null }) }) }) }) },
    }) as any;
  it('管理員：全部範圍，可封存與刪除', async () => {
    expect(await taskManagementScope(ctxOf({ role: 'admin' }))).toEqual({ all: true, canArchive: true });
    expect(await taskManagementScope(ctxOf({ isAdmin: true, role: 'member' }))).toEqual({ all: true, canArchive: true });
  });
  it('主管有 task.manage：只看自己建立的；有 task.template.delete 才能封存／刪除', async () => {
    expect(await taskManagementScope(ctxOf({ role: 'manager', caps: ['task.manage'] }))).toEqual({ all: false, canArchive: false });
    expect(await taskManagementScope(ctxOf({ role: 'manager', caps: ['task.manage', 'task.template.delete'] }))).toEqual({ all: false, canArchive: true });
  });
  it('主管沒有 task.manage、非主管有 task.manage：403', async () => {
    await expect(taskManagementScope(ctxOf({ role: 'manager' }))).rejects.toMatchObject({ status: 403 });
    await expect(taskManagementScope(ctxOf({ role: 'member', caps: ['task.manage'] }))).rejects.toMatchObject({ status: 403 });
  });
});

describe('B.3 管理明細每筆任務的狀態徽章由勾選紀錄推導', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'vue-workspace/src/pages/TaskManagementDetail.vue'), 'utf8');
  const tpl = src.slice(src.indexOf('<template>'));
  it('徽章與刪除按鈕不讀 r.status，改用 overallStatus / overallDone（done、total）', () => {
    expect(tpl).not.toMatch(/r\.status/);
    expect(tpl).toContain(':data-status="overallStatus(r)"');
    expect(src).toMatch(/overallDone = \(r: any\) => r\.total > 0 && r\.total === r\.done/);
    expect(src).toMatch(/r\.done > 0 \? "in_progress" : "pending"/);
  });
});

