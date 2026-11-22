import {
  checked,
  checkOrigin,
  requireCapability,
  context,
  failed,
  inspectionScope,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
import { followupNotice } from "@/lib/workspace/inspection-print";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(),
      scope = await inspectionScope(ctx),
      id = new URL(request.url).searchParams.get("id");
    if (!uuid(id)) throw new WorkspaceError(400, "巡店識別不正確");
    const row = checked(
      await ctx.admin
        .from("inspection_masters")
        .select(
          "id,workspace_version,inspection_date,store_id,inspector_id,inspection_type,status,total_score,max_possible_score,improvement_bonus,inspection_no,grade,indoor_temperature,supervisor_notes,gps_latitude,gps_longitude,gps_accuracy,gps_timestamp,created_at,signature_photo_url,supervisor_signature_url",
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (
      !row ||
      (!scope.all &&
        !(scope.own && row.inspector_id === ctx.user.id) &&
        !scope.assigned.includes(row.store_id))
    )
      throw new WorkspaceError(404, "找不到可查看的巡店記錄");
    if (row.inspection_type === "manager" && !ctx.has("inspection.manager_tab"))
      throw new WorkspaceError(403, "沒有經理巡店查看權限");
    const results =
      checked(
        await ctx.admin
          .from("inspection_results")
          .select(
            "id,template_id,max_score,given_score,deduction_amount,is_improvement,notes,photo_urls,selected_items,workspace_quantities",
          )
          .eq("inspection_id", id),
      ) || [];
    const ids = results.map((r) => r.template_id).filter(Boolean);
    const templates = ids.length
      ? checked(
          await ctx.admin
            .from("inspection_templates")
            .select(
              "id,section_name,section_order,item_name,item_description,item_order",
            )
            .in("id", ids),
        )
      : [];
    const store = checked(
      await ctx.admin
        .from("stores")
        .select("store_name,store_code,short_name,address")
        .eq("id", row.store_id)
        .maybeSingle(),
    );
    const staff =
      checked(
        await ctx.admin
          .from("inspection_on_duty_staff")
          .select("employee_code,employee_name,position,is_duty_supervisor")
          .eq("inspection_id", id),
      ) || [];
    const improvements =
      checked(
        await ctx.admin
          .from("inspection_improvements")
          .select(
            "id,inspection_result_id,template_id,section_name,item_name,deduction_amount,issue_description,issue_photo_urls,status,deadline,improvement_description,improvement_photo_urls,improved_at,days_taken,bonus_score",
          )
          .eq("inspection_id", id),
      ) || [];
    const bonusRules =
      checked(
        await ctx.admin
          .from("inspection_bonus_config")
          .select("day_from,day_to,bonus_score,description,sort_order,is_active")
          .eq("is_active", true)
          .order("sort_order"),
      ) || [];
    // Q21：列印報表上的期限與回補級距用系統實際的規則，不再寫死「3 個工作日」。
    const deadlines = improvements.map((i) => i.deadline).filter(Boolean).sort();
    const followup = followupNotice({
      inspectionDate: row.inspection_date,
      deadline: deadlines[0] || null,
      rules: bonusRules,
    });
    const inspector = checked(
      await ctx.admin
        .from("profiles")
        .select("full_name")
        .eq("id", row.inspector_id)
        .maybeSingle(),
    );
    return respond({
      inspector: inspector?.full_name || "未知",
      bonusRules,
      followup,
      // Q22：刪除需「刪除巡店」權限；經理巡店另需「經理巡店」權限（範圍已在上方限制為可見範圍）。
      canDelete:
        ctx.has("inspection.delete") &&
        (row.inspection_type !== "manager" || ctx.has("inspection.manager_tab")),
      counts: {
        results: results.length,
        staff: staff.length,
        improvements: improvements.length,
        improvedBonus: Number(row.improvement_bonus) || 0,
      },
      improvements,
      staff,
      record: row,
      canEdit:
        row.inspector_id === ctx.user.id &&
        ["draft", "in_progress"].includes(row.status),
      store,
      results: results
        .map((r) => ({
          ...r,
          template: templates?.find((t) => t.id === r.template_id),
        }))
        .sort(
          (a, b) =>
            (a.template?.section_order || 0) -
              (b.template?.section_order || 0) ||
            (a.template?.item_order || 0) - (b.template?.item_order || 0),
        ),
    });
  } catch (e) {
    return failed(e);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCapability(ctx, ["inspection.delete"]);
    const scope = await inspectionScope(ctx),
      body = await request.json();
    if (
      !uuid(body.id) ||
      !Number.isSafeInteger(body.version) ||
      body.version < 0
    )
      throw new WorkspaceError(400, "巡店識別或版本不正確");
    const row = checked(
      await ctx.admin
        .from("inspection_masters")
        .select("id,store_id,inspector_id,inspection_type,workspace_version")
        .eq("id", body.id)
        .maybeSingle(),
    );
    if (!row) return respond({ deleted: true, alreadyRemoved: true });
    if (
      !scope.all &&
      !(scope.own && row.inspector_id === ctx.user.id) &&
      !scope.assigned.includes(row.store_id)
    )
      throw new WorkspaceError(404, "找不到可操作的巡店記錄");
    if (row.inspection_type === "manager" && !ctx.has("inspection.manager_tab"))
      throw new WorkspaceError(403, "沒有經理巡店操作權限");
    if (row.workspace_version !== body.version)
      throw new WorkspaceError(409, "巡店記錄已更新，請重新整理核對後再刪除");
    // One statement: FK cascades remove results, staff and improvement reports atomically.
    const deleted =
      checked(
        await ctx.admin
          .from("inspection_masters")
          .delete()
          .eq("id", body.id)
          .eq("workspace_version", body.version)
          .select("id"),
      ) || [];
    if (!deleted.length)
      throw new WorkspaceError(409, "巡店記錄已更新，請重新整理核對後再刪除");
    return respond({ deleted: true });
  } catch (e) {
    return failed(e);
  }
}
