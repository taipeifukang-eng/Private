import {
  context,
  failed,
  respond,
  checked,
  checkOrigin,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  archiveScope,
  archivedDetail,
  taskRows,
} from "@/lib/workspace/task-archive";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!uuid(id)) throw new WorkspaceError(400, "任務編號無效");
      return respond(await archivedDetail(ctx, id));
    }
    const scope = await archiveScope(ctx);
    const records = await taskRows(() => {
      let q = ctx.admin
        .from("assignments")
        .select(
          "id,created_at,completed_at,archived_at,department,template:templates(title,description)",
        )
        .eq("archived", true)
        .order("archived_at", { ascending: false })
        .order("id");
      if (!scope.all)
        q = q.or(`created_by.eq.${ctx.user.id},archived_by.eq.${ctx.user.id}`);
      return q;
    });
    return respond({ records });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(),
      b = await request.json();
    if (!uuid(b.id) || !uuid(b.writeId) || !Number.isSafeInteger(b.version))
      throw new WorkspaceError(400, "複製資料格式不符");
    const scope = await archiveScope(ctx);
    await archivedDetail(ctx, b.id);
    const result = await ctx.admin.rpc("workspace_copy_archived_task", {
      p_id: b.id,
      p_actor: ctx.user.id,
      p_version: b.version,
      p_write: b.writeId,
      p_department: scope.department,
    });
    if (result.error) {
      if (/CONFLICT/.test(result.error.message))
        throw new WorkspaceError(
          409,
          "來源已變更或重試內容不符，請重新載入核對",
        );
      throw new WorkspaceError(503, "複製失敗，請保留視窗重試");
    }
    return respond({ id: result.data });
  } catch (e) {
    return failed(e);
  }
}
