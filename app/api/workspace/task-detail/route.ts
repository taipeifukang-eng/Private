import { createHash } from "crypto";
import {
  context,
  failed,
  respond,
  WorkspaceError,
  uuid,
  checkOrigin,
} from "@/lib/workspace/server";
import { taskDetail } from "@/lib/workspace/tasks";
import { applyTaskChanges, flattenTaskSteps } from "@/lib/workspace/task-state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!uuid(id)) throw new WorkspaceError(400, "任務編號無效");
    return respond(await taskDetail(await context(), id));
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context(),
      body = await request.json();
    if (
      !uuid(body.id) ||
      !uuid(body.writeId) ||
      !Number.isSafeInteger(body.version) ||
      !Array.isArray(body.changes) ||
      !body.changes.length ||
      body.changes.length > 500
    )
      throw new WorkspaceError(400, "儲存內容格式不符");
    const data = await taskDetail(ctx, body.id);
    let result;
    try {
      result = applyTaskChanges(data.steps, data.state, body.changes);
    } catch (e) {
      throw new WorkspaceError(400, (e as Error).message);
    }
    const allSteps = data.sections.length
      ? data.sections.flatMap((s: any) => s.steps || [])
      : data.steps;
    const flat = flattenTaskSteps(allSteps);
    const status =
      flat.length && flat.every((s) => s.id in result.state)
        ? "completed"
        : "in_progress";
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          id: body.id,
          version: body.version,
          changes: body.changes,
        }),
      )
      .digest("hex");
    const saved = await ctx.admin.rpc("workspace_save_task", {
      p_id: body.id,
      p_actor: ctx.user.id,
      p_version: body.version,
      p_write: body.writeId,
      p_hash: hash,
      p_actions: result.actions,
      p_status: status,
    });
    if (saved.error) {
      if (/CONFLICT/.test(saved.error.message))
        throw new WorkspaceError(
          409,
          "任務已被更新；你的修改仍保留，請重新載入後核對",
        );
      throw new WorkspaceError(503, "任務儲存失敗，請重試");
    }
    return respond({ saved: true });
  } catch (e) {
    return failed(e);
  }
}
