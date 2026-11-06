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
  canDeleteTemplate,
  canDeleteAssignments,
  templateTitleMatches,
  templateListRow,
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
        canDeleteAssignment: canDeleteAssignments(scope),
        canDeleteTemplate: canDeleteTemplate({
          all: scope.all,
          createdBy: template.created_by,
          userId: ctx.user.id,
          hasDelete: ctx.has("task.template.delete"),
        }),
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
      records: templates.map((t) => ({
        ...templateListRow(
          t,
          records.filter((r) => r.template_id === t.id),
        ),
        canDelete: canDeleteTemplate({
          all: scope.all,
          createdBy: t.created_by,
          userId: ctx.user.id,
          hasDelete: ctx.has("task.template.delete"),
        }),
        completedAssignments: records.filter(
          (r) => r.template_id === t.id && r.status === "completed",
        ).length,
      })),
      canDeleteAssignment: canDeleteAssignments(scope),
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

/** A.1 / A.2：刪除流程模板（要輸入標題）與刪除已完成任務（寫稽核紀錄）。 */
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(),
      b = await request.json();
    if (
      !b ||
      !["template", "assignment", "completed"].includes(b.kind) ||
      !uuid(b.id)
    )
      throw new WorkspaceError(400, "刪除資料格式不符");
    if (b.kind === "assignment") {
      const a = (
        await ctx.admin
          .from("assignments")
          .select("id,template_id,status")
          .eq("id", b.id)
          .maybeSingle()
      ).data as any;
      if (!a) throw new WorkspaceError(404, "任務不存在或已被刪除");
      const { scope } = await managedTemplate(ctx, a.template_id);
      if (!canDeleteAssignments(scope))
        throw new WorkspaceError(403, "權限不足，需要刪除任務範本的權限");
      if (a.status !== "completed")
        throw new WorkspaceError(409, "只能刪除已完成的任務");
      const r = await ctx.admin.rpc("workspace_delete_assignment", {
        p_assignment: b.id,
        p_actor: ctx.user.id,
      });
      if (r.error) {
        if (/NOT_FOUND/.test(r.error.message))
          throw new WorkspaceError(404, "任務不存在或已被刪除");
        if (/NOT_COMPLETED/.test(r.error.message))
          throw new WorkspaceError(409, "只能刪除已完成的任務");
        throw new WorkspaceError(503, "刪除失敗，請稍後重試");
      }
      return respond({ deleted: 1, audit: r.data });
    }
    const { template, scope } = await managedTemplate(ctx, b.id);
    if (b.kind === "completed") {
      if (!canDeleteAssignments(scope))
        throw new WorkspaceError(403, "權限不足，需要刪除任務範本的權限");
      const ids = await taskRows(() =>
        ctx.admin
          .from("assignments")
          .select("id")
          .eq("template_id", b.id)
          .eq("archived", false)
          .eq("status", "completed")
          .order("id"),
      );
      let deleted = 0,
        failed = 0;
      for (const row of ids) {
        const r = await ctx.admin.rpc("workspace_delete_assignment", {
          p_assignment: row.id,
          p_actor: ctx.user.id,
        });
        if (r.error) failed++;
        else deleted++;
      }
      return respond({ deleted, failed });
    }
    if (
      !canDeleteTemplate({
        all: scope.all,
        createdBy: template.created_by,
        userId: ctx.user.id,
        hasDelete: ctx.has("task.template.delete"),
      })
    )
      throw new WorkspaceError(
        403,
        "權限不足，只有管理員、主管或模板創建者可以刪除流程模板",
      );
    if (!templateTitleMatches(template.title, b.title))
      throw new WorkspaceError(400, "請輸入與模板標題完全相同的文字才能刪除");
    const r = await ctx.admin.rpc("workspace_delete_template", {
      p_template: b.id,
      p_actor: ctx.user.id,
      p_title: b.title,
    });
    if (r.error) {
      if (/HAS_ACTIVE/.test(r.error.message))
        throw new WorkspaceError(
          409,
          "此模板底下還有待處理或進行中的任務，請先完成或封存後再刪除",
        );
      if (/NOT_FOUND/.test(r.error.message))
        throw new WorkspaceError(404, "流程模板不存在或已被刪除");
      if (/TITLE_MISMATCH/.test(r.error.message))
        throw new WorkspaceError(409, "模板標題已變更，請重新載入後再確認");
      throw new WorkspaceError(503, "刪除失敗，請稍後重試");
    }
    return respond({ deleted: true, audit: r.data });
  } catch (e) {
    return failed(e);
  }
}
