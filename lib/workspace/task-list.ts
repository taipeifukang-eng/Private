// 我的任務與儀表板共用的資料載入（M3 B.2–B.4）：範圍是「我參與的未封存任務」，
// 進度、狀態一律由勾選紀錄推算（task-progress.ts），去重保留有進度者。
import { checked, type Context } from "./server";
import { taskState } from "./task-state";
import { dedupeKeepProgress, progressOf } from "./task-progress";

async function pages(query: () => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const part = checked<any[]>(await query().range(from, from + 499)) || [];
    rows.push(...part);
    if (part.length < 500) return rows;
  }
}

export async function myTaskRows(ctx: Context) {
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
        ctx.admin.from("assignments").select("*,template:templates(*)").in("id", batch).eq("archived", false).order("id"),
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
        ctx.admin.from("assignment_collaborators").select("assignment_id,user_id").in("assignment_id", batch).order("id"),
      ),
    ]);
    for (const record of records) {
      const sectionId = links.find((l) => l.assignment_id === record.id)?.section_id ?? null;
      const own = logs.filter((l) => l.assignment_id === record.id);
      const state = taskState(own);
      const p = progressOf(record.template, sectionId, state);
      rows.push({
        ...record,
        sectionId,
        total: p.total,
        done: p.done,
        overallTotal: p.overallTotal,
        overallDone: p.overallDone,
        percent: p.percent,
        sectionChanged: p.sectionChanged,
        dbStatus: record.status,
        status: p.status,
        lastActivity: own.length ? own[own.length - 1].created_at : null,
        collaborators: collaborators.filter((c) => c.assignment_id === record.id),
      });
    }
  }
  const profileIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.template?.created_by, r.assigned_to, ...r.collaborators.map((c: any) => c.user_id)])
        .filter(Boolean),
    ),
  );
  const profiles: any[] = [];
  for (let start = 0; start < profileIds.length; start += 200)
    profiles.push(
      ...(await pages(() =>
        ctx.admin.from("profiles").select("id,full_name").in("id", profileIds.slice(start, start + 200)).order("id"),
      )),
    );
  const name = (id: string) => profiles.find((p) => p.id === id)?.full_name || "未命名成員";
  for (const row of rows) {
    row.creator = name(row.template?.created_by);
    row.assignedName = row.assigned_to ? name(row.assigned_to) : "";
    row.collaborators = row.collaborators.map((c: any) => ({ ...c, name: name(c.user_id) }));
  }
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return dedupeKeepProgress(rows);
}
