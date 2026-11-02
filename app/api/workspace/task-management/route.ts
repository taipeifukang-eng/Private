import { createHash } from "crypto";
import {
  context,
  failed,
  respond,
  checkOrigin,
  WorkspaceError,
  uuid,
} from "@/lib/workspace/server";
import {
  taskManagementScope,
  managedTemplate,
  templateAssignments,
} from "@/lib/workspace/task-management";
import { taskRows } from "@/lib/workspace/task-archive";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!uuid(id)) throw new WorkspaceError(400, "範本編號無效");
      const { template, scope } = await managedTemplate(ctx, id);
      return respond({
        template,
        records: await templateAssignments(ctx, [id]),
        canArchive: scope.canArchive,
        canEdit: scope.all || ctx.has("task.template.edit"),
      });
    }
    const scope = await taskManagementScope(ctx);
    const templates = await taskRows(() => {
      let q = ctx.admin
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id");
      if (!scope.all) q = q.eq("created_by", ctx.user.id);
      return q;
    });
    const records: any[] = [];
    for (let start = 0; start < templates.length; start += 200)
      records.push(
        ...(await templateAssignments(
          ctx,
          templates.slice(start, start + 200).map((t) => t.id),
        )),
      );
    return respond({
      records: templates
        .map((t) => {
          const items = records.filter((r) => r.template_id === t.id);
          return {
            id: t.id,
            title: t.title,
            description: t.description,
            created_at: t.created_at,
            count: items.length,
            total: items.reduce((n, r) => n + r.total, 0),
            done: items.reduce((n, r) => n + r.done, 0),
            completed: items.filter((r) => r.total > 0 && r.total === r.done)
              .length,
          };
        })
        .filter((t) => t.count > 0),
      canArchive: scope.canArchive,
      canEdit: scope.all || ctx.has("task.template.edit"),
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(),
      b = await request.json();
    if (
      !uuid(b.id) ||
      !uuid(b.writeId) ||
      !Array.isArray(b.versions) ||
      !b.versions.length ||
      b.versions.length > 2000 ||
      b.versions.some(
        (v: any) => !v || !uuid(v.id) || !Number.isSafeInteger(v.version),
      )
    )
      throw new WorkspaceError(400, "封存資料格式不符");
    const { scope } = await managedTemplate(ctx, b.id);
    if (!scope.canArchive) throw new WorkspaceError(403, "沒有封存任務的權限");
    const versions = [...b.versions].sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(versions.map((v) => v.id)).size !== versions.length)
      throw new WorkspaceError(400, "任務清單重複");
    const hash = createHash("sha256")
      .update(JSON.stringify({ id: b.id, versions }))
      .digest("hex");
    const r = await ctx.admin.rpc("workspace_archive_template_tasks", {
      p_template: b.id,
      p_actor: ctx.user.id,
      p_write: b.writeId,
      p_hash: hash,
      p_versions: versions,
    });
    if (r.error) {
      if (/INCOMPLETE/.test(r.error.message))
        throw new WorkspaceError(409, "所有主項與子項完成後才能封存");
      if (/CONFLICT/.test(r.error.message))
        throw new WorkspaceError(409, "任務已變更，請重新載入後核對再封存");
      throw new WorkspaceError(503, "封存失敗，請保留視窗重試");
    }
    return respond({ count: r.data });
  } catch (e) {
    return failed(e);
  }
}
