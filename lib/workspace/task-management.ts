import {
  type Context,
  checked,
  requireCapability,
  WorkspaceError,
} from "./server";
import { taskRows } from "./task-archive";
import { flattenTaskSteps, taskState } from "./task-state";
import { isSupportMember } from "./task-template";
export async function taskManagementScope(ctx: Context) {
  const profile = checked(
    await ctx.admin
      .from("profiles")
      .select("role")
      .eq("id", ctx.user.id)
      .maybeSingle(),
  );
  const all = ctx.isAdmin || profile?.role === "admin";
  if (!all) {
    requireCapability(ctx, ["task.manage"]);
    if (profile?.role !== "manager")
      throw new WorkspaceError(403, "只有管理員或主管可管理任務");
  }
  return { all, canArchive: all || ctx.has("task.template.delete") };
}
/** 舊版 deleteTemplate：建立者或有 task.template.delete 者可刪；管理員（全部範圍）可刪全部。 */
export function canDeleteTemplate(o: {
  all: boolean;
  createdBy: string | null | undefined;
  userId: string;
  hasDelete: boolean;
}) {
  return o.all || o.hasDelete || (!!o.createdBy && o.createdBy === o.userId);
}
/** 舊版 deleteAssignment：需要 task.template.delete（管理員範圍視同擁有）。 */
export function canDeleteAssignments(scope: { all: boolean; canArchive: boolean }) {
  return scope.all || scope.canArchive;
}
/** A.1：刪除確認要輸入模板標題，完全相符（不 trim、不分大小寫以外的寬鬆）才能刪。 */
export function templateTitleMatches(title: unknown, typed: unknown) {
  return typeof title === "string" && typeof typed === "string" && title.length > 0 && title === typed;
}
/** A.3：範圍內模板全部列出；沒有未封存任務的標示尚未指派。 */
export function templateListRow(
  t: any,
  items: { total: number; done: number; status?: string | null }[],
) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    created_at: t.created_at,
    created_by: t.created_by,
    count: items.length,
    unassigned: items.length === 0,
    total: items.reduce((n, r) => n + r.total, 0),
    done: items.reduce((n, r) => n + r.done, 0),
    completed: items.filter((r) => r.total > 0 && r.total === r.done).length,
  };
}
export async function managedTemplate(ctx: Context, id: string) {
  const scope = await taskManagementScope(ctx);
  let q = ctx.admin.from("templates").select("*").eq("id", id);
  if (!scope.all) q = q.eq("created_by", ctx.user.id);
  const template = checked(await q.maybeSingle());
  if (!template) throw new WorkspaceError(404, "找不到可管理的任務範本");
  return { template, scope };
}
export async function templateAssignments(ctx: Context, ids: string[]) {
  if (!ids.length) return [];
  const records = await taskRows(() =>
    ctx.admin
      .from("assignments")
      .select("*,template:templates(*)")
      .in("template_id", ids)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .order("id"),
  );
  const logs: any[] = [],
    collaborators: any[] = [];
  for (let start = 0; start < records.length; start += 200) {
    const batch = records.slice(start, start + 200).map((r) => r.id);
    const [l, c] = await Promise.all([
      taskRows(() =>
        ctx.admin
          .from("logs")
          .select("id,assignment_id,user_id,step_id,action,note,created_at")
          .in("assignment_id", batch)
          .order("created_at")
          .order("id"),
      ),
      taskRows(() =>
        ctx.admin
          .from("assignment_collaborators")
          .select("assignment_id,user_id,section_id")
          .in("assignment_id", batch)
          .order("id"),
      ),
    ]);
    logs.push(...l);
    collaborators.push(...c);
  }
  const people: any[] = [],
    personIds = Array.from(
      new Set(
        [
          ...records.map((r) => r.assigned_to),
          ...collaborators.map((c) => c.user_id),
          ...logs.map((l) => l.user_id),
        ].filter(Boolean),
      ),
    );
  for (let start = 0; start < personIds.length; start += 200)
    people.push(
      ...(await taskRows(() =>
        ctx.admin
          .from("profiles")
          .select("id,full_name")
          .in("id", personIds.slice(start, start + 200))
          .order("id"),
      )),
    );
  const name = (id: string) =>
    people.find((p) => p.id === id)?.full_name || "未命名成員";
  return records.map((r) => {
    const recordLogs = logs.filter((l) => l.assignment_id === r.id),
      sections = r.template?.sections || [],
      steps = sections.length
        ? sections.flatMap((s: any) => s.steps || [])
        : r.template?.steps_schema || [],
      state = taskState(recordLogs),
      flat = flattenTaskSteps(steps);
    return {
      ...r,
      sections,
      steps,
      state,
      total: flat.length,
      done: flat.filter((s) => s.id in state).length,
      assignee: name(r.assigned_to),
      collaborators: collaborators
        .filter((c) => c.assignment_id === r.id)
        .map((c) => ({
          ...c,
          name: name(c.user_id),
          support: isSupportMember(sections, c.section_id, c.user_id),
        })),
      logs: recordLogs.map((l) => ({
        ...l,
        name: name(l.user_id),
        label: flat.find((s) => s.id === l.step_id)?.label || l.step_id,
      })),
    };
  });
}
