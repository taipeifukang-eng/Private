import {
  context,
  checked,
  failed,
  respond,
  requireCapability,
} from "@/lib/workspace/server";
import { flattenTaskSteps, taskState } from "@/lib/workspace/task-state";
export const dynamic = "force-dynamic";
async function pages(query: () => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const part = checked<any[]>(await query().range(from, from + 499)) || [];
    rows.push(...part);
    if (part.length < 500) return rows;
  }
}
export async function GET() {
  try {
    const ctx = await context();
    requireCapability(ctx, ["task.view_own"]);
    const links = await pages(() =>
      ctx.admin
        .from("assignment_collaborators")
        .select("assignment_id,section_id")
        .eq("user_id", ctx.user.id)
        .order("id"),
    );
    const ids = Array.from(new Set(links.map((r) => r.assignment_id))),
      rows: any[] = [];
    for (let start = 0; start < ids.length; start += 200) {
      const batch = ids.slice(start, start + 200);
      const [records, logs, collaborators] = await Promise.all([
        pages(() =>
          ctx.admin
            .from("assignments")
            .select("*,template:templates(*)")
            .in("id", batch)
            .eq("archived", false)
            .order("id"),
        ),
        pages(() =>
          ctx.admin
            .from("logs")
            .select("id,assignment_id,step_id,action,note,created_at")
            .in("assignment_id", batch)
            .order("created_at")
            .order("id"),
        ),
        pages(() =>
          ctx.admin
            .from("assignment_collaborators")
            .select("assignment_id,user_id")
            .in("assignment_id", batch)
            .order("id"),
        ),
      ]);
      for (const record of records) {
        const sectionId = links.find(
          (l) => l.assignment_id === record.id,
        )?.section_id;
        const steps = sectionId
          ? (record.template?.sections || []).find(
              (s: any) => s.id === sectionId,
            )?.steps || []
          : record.template?.steps_schema || [];
        const flat = flattenTaskSteps(steps),
          state = taskState(logs.filter((l) => l.assignment_id === record.id));
        rows.push({
          ...record,
          sectionId,
          total: flat.length,
          done: flat.filter((s) => s.id in state).length,
          collaborators: collaborators.filter(
            (c) => c.assignment_id === record.id,
          ),
        });
      }
    }
    const profileIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [
            r.template?.created_by,
            ...r.collaborators.map((c: any) => c.user_id),
          ])
          .filter(Boolean),
      ),
    );
    const profiles: any[] = [];
    for (let start = 0; start < profileIds.length; start += 200)
      profiles.push(
        ...(await pages(() =>
          ctx.admin
            .from("profiles")
            .select("id,full_name")
            .in("id", profileIds.slice(start, start + 200))
            .order("id"),
        )),
      );
    for (const row of rows) {
      row.creator =
        profiles.find((p) => p.id === row.template?.created_by)?.full_name ||
        "未命名成員";
      row.collaborators = row.collaborators.map((c: any) => ({
        ...c,
        name:
          profiles.find((p) => p.id === c.user_id)?.full_name || "未命名成員",
      }));
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const seen = new Set<string>();
    return respond({
      records: rows.filter((r) => {
        const key = JSON.stringify([r.template_id, r.department, r.sectionId]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    });
  } catch (e) {
    return failed(e);
  }
}
