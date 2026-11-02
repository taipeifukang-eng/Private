import {
  type Context,
  checked,
  WorkspaceError,
  requireCapability,
} from "./server";
import { flattenTaskSteps, taskState } from "./task-state";
export async function archiveScope(ctx: Context) {
  const profile = checked(
    await ctx.admin
      .from("profiles")
      .select("role,department")
      .eq("id", ctx.user.id)
      .single(),
  );
  if (profile?.role !== "admin") requireCapability(ctx, ["task.view_archived"]);
  if (!ctx.isAdmin && !["admin", "manager"].includes(profile?.role || ""))
    throw new WorkspaceError(403, "只有管理員或主管可查看封存任務");
  return {
    all: ctx.isAdmin || profile?.role === "admin",
    department: profile?.department || null,
  };
}
export async function taskRows(query: () => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const part = checked<any[]>(await query().range(from, from + 499)) || [];
    rows.push(...part);
    if (part.length < 500) return rows;
  }
}
export async function archivedDetail(ctx: Context, id: string) {
  const scope = await archiveScope(ctx);
  let query = ctx.admin
    .from("assignments")
    .select("*,template:templates(*)")
    .eq("id", id)
    .eq("archived", true);
  if (!scope.all)
    query = query.or(
      `created_by.eq.${ctx.user.id},archived_by.eq.${ctx.user.id}`,
    );
  const record = checked(await query.maybeSingle()) as any;
  if (!record) throw new WorkspaceError(404, "找不到可查看的封存任務");
  const [logs, collaborators] = await Promise.all([
    taskRows(() =>
      ctx.admin
        .from("logs")
        .select("id,user_id,step_id,action,note,created_at")
        .eq("assignment_id", id)
        .order("created_at")
        .order("id"),
    ),
    taskRows(() =>
      ctx.admin
        .from("assignment_collaborators")
        .select("user_id,section_id")
        .eq("assignment_id", id)
        .order("id"),
    ),
  ]);
  const ids = Array.from(
    new Set(
      [
        record.created_by,
        record.assigned_to,
        record.archived_by,
        ...logs.map((l) => l.user_id),
        ...collaborators.map((c) => c.user_id),
      ].filter(Boolean),
    ),
  );
  const people: any[] = [];
  for (let start = 0; start < ids.length; start += 200)
    people.push(
      ...(await taskRows(() =>
        ctx.admin
          .from("profiles")
          .select("id,full_name")
          .in("id", ids.slice(start, start + 200))
          .order("id"),
      )),
    );
  const name = (id: string) =>
    people.find((p) => p.id === id)?.full_name || "未命名成員";
  const sections = record.template?.sections || [],
    steps = sections.length
      ? sections.flatMap((s: any) => s.steps || [])
      : record.template?.steps_schema || [];
  const state = taskState(logs),
    flat = flattenTaskSteps(steps);
  const latest = checked(
    await ctx.admin
      .from("assignments")
      .select("workspace_version")
      .eq("id", id)
      .single(),
  );
  if (!latest || latest.workspace_version !== record.workspace_version)
    throw new WorkspaceError(409, "封存資料已變更，請重新載入");
  return {
    ...record,
    sections,
    steps,
    state,
    total: flat.length,
    done: flat.filter((s) => s.id in state).length,
    creator: name(record.created_by),
    assignee: name(record.assigned_to),
    archiver: name(record.archived_by),
    collaborators: collaborators.map((c) => ({ ...c, name: name(c.user_id) })),
    logs: logs.map((l) => ({
      ...l,
      name: name(l.user_id),
      label: flat.find((s) => s.id === l.step_id)?.label || l.step_id,
    })),
  };
}
