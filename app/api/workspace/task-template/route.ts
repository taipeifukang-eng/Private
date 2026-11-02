import { createHash } from "crypto";
import {
  context,
  checked,
  failed,
  respond,
  uuid,
  WorkspaceError,
  checkOrigin,
} from "@/lib/workspace/server";
import {
  managedTemplate,
  taskManagementScope,
} from "@/lib/workspace/task-management";
import { taskRows } from "@/lib/workspace/task-archive";
import { normalizeTaskTemplate } from "@/lib/workspace/task-template";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      scope = await taskManagementScope(ctx),
      id = new URL(request.url).searchParams.get("id");
    if (id && !uuid(id)) throw new WorkspaceError(400, "範本編號無效");
    if (id && !scope.all && !ctx.has("task.template.edit"))
      throw new WorkspaceError(403, "沒有編輯範本的權限");
    const template = id ? (await managedTemplate(ctx, id)).template : null;
    const people = await taskRows(() =>
      ctx.admin
        .from("profiles")
        .select("id,full_name,department,job_title,employee_code")
        .not("department", "is", null)
        .neq("department", "")
        .order("full_name")
        .order("id"),
    );
    const assignments = id
      ? await taskRows(() =>
          ctx.admin
            .from("assignments")
            .select(
              "id,workspace_version,status,archived,planned_start_date,planned_end_date,created_at",
            )
            .eq("template_id", id)
            .order("created_at", { ascending: false })
            .order("id"),
        )
      : [];
    if (id) {
      const latest = checked(
        await ctx.admin
          .from("templates")
          .select("workspace_version")
          .eq("id", id)
          .single(),
      );
      if (!latest || latest.workspace_version !== template?.workspace_version)
        throw new WorkspaceError(409, "範本已變更，請重新載入");
    }
    return respond({
      canEdit: scope.all || ctx.has("task.template.edit"),
      template,
      people,
      versions: assignments.map((a) => ({
        id: a.id,
        version: a.workspace_version,
      })),
      locked: assignments.some((a) => a.status === "completed"),
      inProgress: assignments.some((a) => a.status === "in_progress"),
      planned_start_date: assignments[0]?.planned_start_date || null,
      planned_end_date: assignments[0]?.planned_end_date || null,
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(),
      scope = await taskManagementScope(ctx),
      b = await request.json();
    if (
      !uuid(b.writeId) ||
      (b.id !== null && !uuid(b.id)) ||
      !Number.isSafeInteger(b.version) ||
      !Array.isArray(b.versions) ||
      b.versions.some(
        (r: any) => !r || !uuid(r.id) || !Number.isSafeInteger(r.version),
      )
    )
      throw new WorkspaceError(400, "範本儲存資料格式不符");
    if (b.id) {
      await managedTemplate(ctx, b.id);
      if (!scope.all && !ctx.has("task.template.edit"))
        throw new WorkspaceError(403, "沒有編輯範本的權限");
    }
    const people = await taskRows(() =>
      ctx.admin.from("profiles").select("id,department").order("id"),
    );
    const form = normalizeTaskTemplate(b.form, people);
    const versions = [...b.versions].sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(versions.map((v) => v.id)).size !== versions.length)
      throw new WorkspaceError(400, "指派清單重複");
    const hash = createHash("sha256")
      .update(JSON.stringify({ id: b.id, version: b.version, versions, form }))
      .digest("hex");
    const r = await ctx.admin.rpc("workspace_save_task_template", {
      p_id: b.id,
      p_actor: ctx.user.id,
      p_version: b.version,
      p_versions: versions,
      p_write: b.writeId,
      p_hash: hash,
      p_form: form,
    });
    if (r.error) {
      if (/COMPLETED/.test(r.error.message))
        throw new WorkspaceError(409, "已有完成的指派紀錄，不能編輯範本");
      if (/CONFLICT/.test(r.error.message))
        throw new WorkspaceError(
          409,
          "範本或指派已變更，草稿保留，請另開最新版本核對",
        );
      if (/INVALID_MEMBER/.test(r.error.message))
        throw new WorkspaceError(400, "執行人員的部門已變更，請重新選擇");
      throw new WorkspaceError(503, "範本儲存失敗，請重試");
    }
    return respond({ id: r.data });
  } catch (e) {
    return failed(e);
  }
}
