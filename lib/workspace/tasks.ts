import { checked, Context, requireCapability, WorkspaceError } from "./server";
import { flattenTaskSteps, taskState, type TaskStep } from "./task-state";
import { isSupportMember } from "./task-template";
import { taskManagementScope } from "./task-management";
import { progressOf } from "./task-progress";
/** M3 B.1：非參與者只有「任務管理權限」者（含系統管理員）能打開，並代為勾選。 */
async function canProxy(ctx: Context) {
  try {
    await taskManagementScope(ctx);
    return true;
  } catch (e) {
    if (e instanceof WorkspaceError && e.status === 403) return false;
    throw e;
  }
}
export async function taskDetail(ctx: Context, id: string) {
  requireCapability(ctx, ["task.view_own"]);
  const record = checked(
    await ctx.admin
      .from("assignments")
      .select("*,template:templates(*)")
      .eq("id", id)
      .maybeSingle(),
  ) as any;
  if (!record || record.archived)
    throw new WorkspaceError(404, "找不到可操作的任務");
  const collaborators =
    checked(
      await ctx.admin
        .from("assignment_collaborators")
        .select("user_id,section_id")
        .eq("assignment_id", id),
    ) || [];
  const mine = collaborators.find((c) => c.user_id === ctx.user.id);
  const proxy = !mine;
  if (proxy && !(await canProxy(ctx)))
    throw new WorkspaceError(404, "找不到指派給你的任務");
  const template = record.template;
  if (!template) throw new WorkspaceError(409, "任務範本已不存在");
  const sections = Array.isArray(template.sections) ? template.sections : [];
  const section = mine?.section_id
    ? sections.find((s: any) => s.id === mine.section_id)
    : null;
  if (mine?.section_id && !section)
    throw new WorkspaceError(409, "指派區段已變更，請聯絡派發人員");
  // 代做者看到全部區段（舊版 admin/manager 檢視不限區段）；參與者只看自己的區段。
  const groups: { sectionId: string | null; department: string; steps: TaskStep[] }[] = proxy
    ? sections.length
      ? sections.map((s: any) => ({ sectionId: s.id, department: s.department || "", steps: s.steps || [] }))
      : [{ sectionId: null, department: "", steps: template.steps_schema || [] }]
    : [{ sectionId: mine!.section_id || null, department: section?.department || "", steps: section ? section.steps || [] : template.steps_schema || [] }];
  const steps: TaskStep[] = groups.flatMap((g) => g.steps);
  const logs: any[] = [];
  for (let from = 0; ; from += 500) {
    const part =
      checked(
        await ctx.admin
          .from("logs")
          .select("id,step_id,action,note,created_at,user_id,proxy")
          .eq("assignment_id", id)
          .order("created_at")
          .order("id")
          .range(from, from + 499),
      ) || [];
    logs.push(...part);
    if (part.length < 500) break;
  }
  const ids = Array.from(
    new Set(
      [
        ...collaborators.map((c) => c.user_id),
        ...logs.map((l) => l.user_id),
        template.created_by,
      ].filter(Boolean),
    ),
  );
  const profiles = ids.length
    ? checked(
        await ctx.admin
          .from("profiles")
          .select("id,full_name,department")
          .in("id", ids),
      ) || []
    : [];
  const latest = checked(
    await ctx.admin
      .from("assignments")
      .select("workspace_version")
      .eq("id", id)
      .single(),
  );
  if (!latest || latest.workspace_version !== record.workspace_version)
    throw new WorkspaceError(409, "任務已更新，請重新載入");
  const state = taskState(logs),
    flat = flattenTaskSteps(steps);
  return {
    ...record,
    steps,
    sections,
    sectionId: mine?.section_id ?? null,
    proxy,
    groups,
    overall: progressOf(template, mine?.section_id ?? null, state),
    state,
    logs: logs.map((l) => ({
      ...l,
      proxy: !!l.proxy,
      actorName: profiles.find((p) => p.id === l.user_id)?.full_name || "未命名成員",
    })),
    collaborators: collaborators.map((c) => ({
      ...c,
      name: profiles.find((p) => p.id === c.user_id)?.full_name || "未命名成員",
      support: isSupportMember(sections, c.section_id, c.user_id),
    })),
    creator:
      profiles.find((p) => p.id === template.created_by)?.full_name ||
      "未命名成員",
    total: flat.length,
    done: flat.filter((s) => s.id in state).length,
  };
}
