import {
  checked,
  checkOrigin,
  context,
  failed,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  improvementRecord,
  improvementToday,
} from "@/lib/workspace/improvements";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      id = new URL(request.url).searchParams.get("id");
    if (!uuid(id)) throw new WorkspaceError(400, "改善項目識別不正確");
    const { row, master, canSubmit } = await improvementRecord(ctx, id);
    const store = checked(
      await ctx.admin
        .from("stores")
        .select("store_name,store_code")
        .eq("id", row.store_id)
        .maybeSingle(),
    );
    const inspector = master?.inspector_id
      ? checked(
          await ctx.admin
            .from("profiles")
            .select("full_name")
            .eq("id", master.inspector_id)
            .maybeSingle(),
        )
      : null;
    const bonus =
      checked(
        await ctx.admin
          .from("inspection_bonus_config")
          .select("day_from,day_to,bonus_score,description")
          .eq("is_active", true)
          .order("sort_order"),
      ) || [];
    return respond({
      record: row,
      master,
      store,
      inspector: inspector?.full_name || "未知",
      bonus,
      today: improvementToday(),
      canSubmit: canSubmit && row.status === "pending",
      displayStatus:
        row.status === "pending" && row.deadline < improvementToday()
          ? "overdue"
          : row.status,
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const raw = await request.text();
    if (raw.length > 8000000) throw new WorkspaceError(413, "照片容量過大");
    const body = JSON.parse(raw);
    if (!uuid(body.id) || typeof body.version !== "string")
      throw new WorkspaceError(400, "改善項目版本不正確");
    if (
      typeof body.description !== "string" ||
      !body.description.trim() ||
      body.description.length > 8000
    )
      throw new WorkspaceError(400, "請填寫改善說明（最多 8000 字）");
    if (
      !Array.isArray(body.photos) ||
      body.photos.length < 1 ||
      body.photos.length > 5 ||
      body.photos.some(
        (u: unknown) =>
          typeof u !== "string" ||
          u.length > 1500000 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u),
      )
    )
      throw new WorkspaceError(400, "請上傳 1 至 5 張有效改善照片");
    const { row, canSubmit } = await improvementRecord(ctx, body.id);
    if (!canSubmit) throw new WorkspaceError(403, "沒有此門市的改善回報權限");
    if (
      row.status === "improved" &&
      row.improved_by === ctx.user.id &&
      row.improvement_description === body.description.trim() &&
      JSON.stringify(row.improvement_photo_urls) === JSON.stringify(body.photos)
    )
      return respond({ record: row });
    if (row.status !== "pending" || row.updated_at !== body.version)
      throw new WorkspaceError(
        409,
        "改善項目已更新或已結案，請重新開啟核對；目前填寫內容仍保留",
      );
    const saved = checked(
      await ctx.admin
        .from("inspection_improvements")
        .update({
          improvement_description: body.description.trim(),
          improvement_photo_urls: body.photos,
          improved_by: ctx.user.id,
          improved_at: new Date().toISOString(),
          status: "improved",
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .eq("updated_at", body.version)
        .select("*")
        .maybeSingle(),
    );
    if (!saved)
      throw new WorkspaceError(409, "另一個工作頁已更新此項目，請重新開啟核對");
    return respond({ record: saved });
  } catch (e) {
    return failed(e);
  }
}
