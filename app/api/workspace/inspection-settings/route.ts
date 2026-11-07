import { createHash } from "crypto";
import {
  checked,
  checkOrigin,
  context,
  failed,
  requireCapability,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const ctx = await context();
    requireCapability(ctx, ["inspection.template.manage"]);
    for (let retry = 0; retry < 3; retry++) {
      const revision = checked(
        await ctx.admin
          .from("workspace_inspection_settings_revision")
          .select("version")
          .eq("singleton", true)
          .single(),
      );
      const [a, b, c, d] = await Promise.all([
        ctx.admin
          .from("inspection_templates")
          .select("*")
          .order("section_order")
          .order("item_order"),
        ctx.admin
          .from("inspection_grade_mapping")
          .select("grade,min_score")
          .order("grade", { ascending: false }),
        ctx.admin
          .from("inspection_bonus_config")
          .select("*")
          .order("sort_order"),
        // M4 Q6：目前等待改善的項目數（回補規則儲存前顯示「會受影響的筆數」）。
        ctx.admin
          .from("inspection_improvements")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
      if (d.error) throw d.error;
      const templates = checked(a) || [],
        grades = checked(b) || [],
        bonus = checked(c) || [];
      const after = checked(
        await ctx.admin
          .from("workspace_inspection_settings_revision")
          .select("version")
          .eq("singleton", true)
          .single(),
      );
      if (!revision || !after)
        throw new WorkspaceError(409, "設定版本尚未建立");
      if (revision.version === after.version)
        return respond({
          version: revision.version,
          templates,
          grades,
          bonus,
          pendingImprovements: d.count || 0,
        });
    }
    throw new WorkspaceError(409, "設定正在更新，請重新載入");
  } catch (e) {
    return failed(e);
  }
}
const invalid = (message: string): never => {
  throw new WorkspaceError(400, message);
};
function text(v: unknown, label: string, max: number, required = true) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    invalid(label + "格式不正確");
  return (v as string).trim();
}
function number(
  v: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer
      ? !Number.isInteger(v)
      : Math.abs(v * 10 - Math.round(v * 10)) > 0.000001)
  )
    invalid(label + "格式不正確");
  return v as number;
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCapability(ctx, ["inspection.template.manage"]);
    const raw = await request.text();
    if (raw.length > 200000) throw new WorkspaceError(413, "設定內容過大");
    const body = JSON.parse(raw);
    if (
      !uuid(body.writeId) ||
      !Number.isSafeInteger(body.version) ||
      body.version < 1 ||
      (body.id && !uuid(body.id))
    )
      invalid("設定版本不正確");
    const row = body.data;
    let data: any;
    if (body.kind === "template") {
      if (
        !row ||
        !Array.isArray(row.checklist_items) ||
        row.checklist_items.length > 100 ||
        typeof row.is_active !== "boolean"
      )
        invalid("範本格式不正確");
      data = {
        section: text(row.section, "區塊代碼", 50),
        section_name: text(row.section_name, "區塊名稱", 100),
        section_order: number(row.section_order, "區塊排序", 1, 5, true),
        item_name: text(row.item_name, "項目名稱", 200),
        item_description: text(row.item_description || "", "說明", 4000, false),
        item_order: number(row.item_order, "項目排序", 0, 9999, true),
        max_score: number(row.max_score, "滿分", 0.1, 220),
        is_active: row.is_active,
        checklist_items: row.checklist_items.map((x: any) => ({
          label: text(x.label, "缺失名稱", 300),
          deduction: number(x.deduction, "扣分", 0, 220),
          requires_quantity: x.requires_quantity === true,
          unit: text(x.unit || "", "數量單位", 30, false),
        })),
      };
      if (
        new Set(data.checklist_items.map((x: any) => x.label)).size !==
        data.checklist_items.length
      )
        invalid("缺失名稱不能重複");
      if (data.checklist_items.some((x: any) => x.deduction > data.max_score))
        invalid("單項缺失扣分不能超過該項滿分");
    } else if (body.kind === "bonus") {
      if (!row || typeof row.is_active !== "boolean")
        invalid("回補規則格式不正確");
      data = {
        day_from: number(row.day_from, "起始天數", 0, 3650, true),
        day_to: number(row.day_to, "結束天數", 0, 3650, true),
        bonus_score: number(row.bonus_score, "回補比例", 0, 100),
        description: text(row.description || "", "規則說明", 200, false),
        sort_order: number(row.sort_order, "排序", 0, 9999, true),
        is_active: row.is_active,
      };
      if (data.day_to < data.day_from) invalid("結束天數不能小於起始天數");
    } else if (body.kind === "grades") {
      if (!Array.isArray(row) || row.length !== 11)
        invalid("需要完整的 0–10 評級");
      data = row
        .map((r: any) => ({
          grade: number(r.grade, "評級", 0, 10, true),
          min_score: number(r.min_score, "最低分數", 0, 220),
        }))
        .sort((a: any, b: any) => a.grade - b.grade);
      if (
        data.some(
          (r: any, i: number) =>
            r.grade !== i ||
            (i === 0
              ? r.min_score !== 0
              : r.min_score <= data[i - 1].min_score),
        )
      )
        invalid("評級需完整且最低分數隨評級遞增，0 級最低分為 0");
    } else invalid("未知設定類型");
    const result = await ctx.admin.rpc("workspace_save_inspection_settings", {
      p_actor: ctx.user.id,
      p_version: body.version,
      p_write: body.writeId,
      p_hash: createHash("sha256").update(raw).digest("hex"),
      p_kind: body.kind,
      p_id: body.id || null,
      p_data: data,
    });
    if (result.error) {
      if (/SETTINGS_CONFLICT|WRITE_REPLAY_MISMATCH/.test(result.error.message))
        throw new WorkspaceError(409, "設定已被更新，請保留草稿並重新開啟核對");
      if (result.error.message.includes("BONUS_OVERLAP"))
        invalid("啟用中的回補天數範圍不能重疊");
      if (result.error.message.includes("SETTING_NOT_FOUND"))
        throw new WorkspaceError(404, "找不到設定項目");
      throw result.error;
    }
    return respond(result.data);
  } catch (e) {
    return failed(e);
  }
}
