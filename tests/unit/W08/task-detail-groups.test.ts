import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { taskDetail } from '../../../lib/workspace/tasks';

// 審查發現：參與者兼管理者且 section_id 為 null、範本有區段時，groups 不可重複出現全部項目。
const ME = '11111111-1111-4111-8111-111111111111';
const step = (id: string) => ({ id, title: id });
const secA = { id: 'sa', department: 'A', steps: [step('a1')] };
const secB = { id: 'sb', department: 'B', steps: [step('b1')] };
const template = { id: 't1', created_by: null, sections: [secA, secB], steps_schema: [step('a1'), step('b1')] };

function ctxOf(sectionId: string | null) {
  const tables: Record<string, any> = {
    assignments: { data: { id: 'x1', archived: false, workspace_version: 1, template }, error: null },
    assignment_collaborators: { data: [{ user_id: ME, section_id: sectionId }], error: null },
    logs: { data: [], error: null },
    profiles: { data: { role: 'manager' }, error: null },
  };
  const q = (t: string): any => {
    const r = tables[t];
    const o: any = {
      select: () => o, eq: () => o, in: () => o, order: () => o, range: () => o,
      maybeSingle: async () => r, single: async () => ({ data: { workspace_version: 1 }, error: null }),
      then: (res: any) => res(t === 'profiles' ? { data: [], error: null } : r),
    };
    return o;
  };
  return { isAdmin: false, user: { id: ME }, has: () => true, admin: { from: q } } as any;
}

describe('taskDetail groups', () => {
  it('管理者參與者 section_id 為 null：只回自己的 steps_schema 一組，不重複、不提示代勾', async () => {
    const d: any = await taskDetail(ctxOf(null), 'x1');
    expect(d.groups).toHaveLength(1);
    expect(d.steps.map((s: any) => s.id)).toEqual(['a1', 'b1']);
    expect(d.canProxyOthers).toBe(false);
  });
  it('管理者參與者有區段：看到全部區段並可代勾他區段', async () => {
    const d: any = await taskDetail(ctxOf('sa'), 'x1');
    expect(d.groups).toHaveLength(2);
    expect(d.ownStepIds).toEqual(['a1']);
    expect(d.canProxyOthers).toBe(true);
  });
});

describe('m3-sql 審查修正', () => {
  const dir = 'docs/vue-workspace/parity-plan/m3-sql/';
  const f = (n: string) => readFileSync(dir + n, 'utf8');
  it('備份表開啟 RLS 並收回 anon/authenticated', () => {
    for (const [file, tbl] of [['grant_task_manage_B_grant.sql', 'm3_task_manage_grants'], ['grant_task_view_archived_B_grant.sql', 'm3_task_view_archived_grants']]) {
      expect(f(file)).toContain(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY`);
      expect(f(file)).toMatch(new RegExp(`REVOKE ALL ON public\.${tbl} FROM anon, authenticated`));
    }
  });
  it('compare／A／B 都檢查 task.view_own', () => {
    for (const n of ['compare_task_proxy_access.sql', 'grant_task_manage_A_preview.sql', 'grant_task_manage_B_grant.sql']) expect(f(n)).toContain('task.view_own');
  });
  it('A 用 IS DISTINCT FROM 處理 NULL 身分', () => {
    expect(f('grant_task_manage_A_preview.sql')).toContain("r.role IS DISTINCT FROM 'manager'");
    expect(f('grant_task_manage_A_preview.sql')).not.toContain("r.role <> 'manager'");
  });
});
