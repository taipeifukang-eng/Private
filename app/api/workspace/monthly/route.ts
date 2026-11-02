import {
  checked,
  checkOrigin,
  failed,
  respond,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  moduleContext,
  moduleStores,
  monthValue,
  requireStore,
} from "@/lib/workspace/modules";
import {
  getMonthlyStaffStatus,
  getStoreMonthlySummary,
  initializeMonthlyStatus,
  submitStoreStatus,
  confirmStoreStatus,
  revertSubmitStatus,
  unconfirmStoreStatus,
} from "@/app/store/actions";
import {
  MONTHLY_STATUS_OPTIONS,
  POSITION_OPTIONS,
  NEWBIE_LEVEL_OPTIONS,
  ADMIN_LEVEL_OPTIONS,
  PARTIAL_MONTH_REASON_OPTIONS,
  SPECIAL_ROLE_OPTIONS,
} from "@/types/workflow";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await moduleContext("monthly");
    const p = new URL(request.url).searchParams;
    const stores = await moduleStores(ctx, "monthly");
    const month = monthValue(p.get("month"));
    const store = p.get("store") || stores[0]?.id;
    if (!store) return respond({ stores, records: [], canEdit: false });
    await requireStore(ctx, "monthly", store);
    const result = await getMonthlyStaffStatus(month, store);
    if (!result.success)
      throw new WorkspaceError(400, result.error || "讀取失敗");
    const summary = await getStoreMonthlySummary(month,store);
    if (!summary.success) throw new WorkspaceError(503, "月份狀態讀取失敗，請重試");
    return respond({
      stores,
      store,
      records: result.data,
      storeStatus: summary.data?.store_status || "not_started",
      options: {
        statuses: MONTHLY_STATUS_OPTIONS,
        positions: [...POSITION_OPTIONS, ...SPECIAL_ROLE_OPTIONS],
        levels: [...NEWBIE_LEVEL_OPTIONS, ...ADMIN_LEVEL_OPTIONS],
        reasons: PARTIAL_MONTH_REASON_OPTIONS,
      },
      canEdit: ctx.has("monthly.status.edit"),
      canSubmit: ctx.has("monthly.status.submit"),
      canConfirm: ctx.has("monthly.status.confirm"),
      canRevert: ctx.has("monthly.status.revert"),
      canUnconfirm: ctx.has("monthly.status.unconfirm"),
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await moduleContext("monthly");
    const body = await request.json();
    const month = monthValue(body.month);
    await requireStore(ctx, "monthly", body.store);
    const elevated: Record<string, string> = {
      confirm: "monthly.status.confirm",
      revert: "monthly.status.revert",
      unconfirm: "monthly.status.unconfirm",
    };
    if (elevated[body.action]) {
      if (!ctx.has(elevated[body.action]))
        throw new WorkspaceError(403, "沒有此操作權限");
    } else {
      if (!ctx.has(body.action === "submit" ? "monthly.status.submit" : "monthly.status.edit")) throw new WorkspaceError(403, "沒有此操作權限");
      const assigned = checked(
        await ctx.auth
          .from("store_managers")
          .select("id")
          .eq("user_id", ctx.user.id)
          .eq("store_id", body.store),
      );
      if (!ctx.isAdmin && !assigned?.length)
        throw new WorkspaceError(403, "只有指派人員可編輯此門市");
    }
    if (body.action === "save") {
      const before = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select("id,status,updated_at")
          .eq("id", body.id)
          .eq("store_id", body.store)
          .eq("year_month", month)
          .maybeSingle(),
      );
      if (!before || before.status !== "draft")
        throw new WorkspaceError(409, "此筆已送出或已變更，請重新查詢");
      const updates: Record<string, unknown> = {};
      for (const key of ["work_days", "work_hours"]) {
        const value = body.updates?.[key];
        if (
          value !== null &&
          (typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > (key === "work_days" ? 31 : 744))
        )
          throw new WorkspaceError(400, "工作天數或時數不正確");
        updates[key] = value;
      }
      if (
        typeof body.updates?.notes !== "string" ||
        body.updates.notes.length > 4000
      )
        throw new WorkspaceError(400, "備註最多 4000 字");
      updates.notes = body.updates.notes;
      const u = body.updates;
      if ("position" in u) {
        if (
          ![...POSITION_OPTIONS, ...SPECIAL_ROLE_OPTIONS].includes(
            u.position,
          ) ||
          !["full_time", "part_time"].includes(u.employment_type) ||
          !MONTHLY_STATUS_OPTIONS.some((o) => o.value === u.monthly_status)
        )
          throw new WorkspaceError(400, "職位、任職類型或本月狀態不正確");
        if (
          u.newbie_level &&
          ![...NEWBIE_LEVEL_OPTIONS, ...ADMIN_LEVEL_OPTIONS].some(
            (o) => o.value === u.newbie_level,
          )
        )
          throw new WorkspaceError(400, "階段資料不正確");
        if (
          u.position === "行政" &&
          !ADMIN_LEVEL_OPTIONS.some((o) => o.value === u.newbie_level)
        )
          throw new WorkspaceError(400, "行政人員須選擇行政階段");
        if (
          u.partial_month_reason &&
          !PARTIAL_MONTH_REASON_OPTIONS.some(
            (o) => o.value === u.partial_month_reason,
          )
        )
          throw new WorkspaceError(400, "未滿月原因不正確");
        if (
          u.start_date &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(u.start_date) ||
            !Number.isFinite(Date.parse(u.start_date)))
        )
          throw new WorkspaceError(400, "到職日期不正確");
        for (const key of [
          "position",
          "employment_type",
          "monthly_status",
          "start_date",
          "newbie_level",
          "partial_month_reason",
        ])
          updates[key] = u[key] || null;
        for (const key of [
          "is_dual_position",
          "has_manager_bonus",
          "is_supervisor_rotation",
          "is_pharmacist",
          "is_acting_manager",
        ]) {
          if (typeof u[key] !== "boolean")
            throw new WorkspaceError(400, "身分資料不正確");
          updates[key] = u[key];
        }
        for (const key of [
          "supervisor_employee_code",
          "supervisor_name",
          "supervisor_position",
          "partial_month_notes",
        ]) {
          if (typeof u[key] !== "string" || u[key].length > 1000)
            throw new WorkspaceError(400, "支援或未滿月備註過長");
          updates[key] = u[key] || null;
        }
        for (const key of [
          "supervisor_shift_hours",
          "extra_task_external_hours",
        ]) {
          if (
            u[key] !== null &&
            (typeof u[key] !== "number" ||
              !Number.isFinite(u[key]) ||
              u[key] < 0 ||
              u[key] > 744)
          )
            throw new WorkspaceError(400, "支援或外務時數不正確");
          updates[key] = u[key];
        }
        if (
          !Array.isArray(u.extra_tasks) ||
          u.extra_tasks.some(
            (s: unknown) => !["長照外務", "診所業務"].includes(String(s)),
          )
        )
          throw new WorkspaceError(400, "外務類型不正確");
        const dual =
          u.position.includes("督導") &&
          u.position.includes("代理店長") &&
          u.is_dual_position;
        updates.work_days =
          !dual && u.employment_type === "full_time" ? u.work_days : null;
        updates.work_hours =
          dual || u.employment_type === "part_time" ? u.work_hours : null;
        updates.partial_month_days =
          u.employment_type === "full_time" && u.work_days > 0
            ? u.work_days
            : null;
        updates.supervisor_shift_hours = u.is_supervisor_rotation
          ? dual
            ? u.work_hours
            : u.supervisor_shift_hours
          : null;
        if (!u.is_supervisor_rotation)
          for (const key of [
            "supervisor_employee_code",
            "supervisor_name",
            "supervisor_position",
          ])
            updates[key] = null;
        updates.extra_tasks = u.extra_tasks.length ? u.extra_tasks : null;
        updates.extra_task_external_hours = u.extra_tasks.length
          ? u.extra_task_external_hours
          : null;
        updates.extra_task_planned_hours = u.extra_tasks.length
          ? dual
            ? u.work_hours
            : u.employment_type === "full_time"
              ? u.monthly_status === "full_month"
                ? 160
                : Math.round(((u.work_days || 0) / 5) * 32 * 10) / 10
              : null
          : null;
      }
      updates.updated_at = new Date().toISOString();
      let q = ctx.auth
        .from("monthly_staff_status")
        .update(updates)
        .eq("id", body.id)
        .eq("status", "draft");
      q = body.version
        ? q.eq("updated_at", body.version)
        : q.is("updated_at", null);
      const row = checked(await q.select().maybeSingle());
      if (!row)
        throw new WorkspaceError(
          409,
          "另一頁或其他人已更新，請保留草稿後重新查詢",
        );
      return respond({ record: row });
    }
    const actions: Record<string, (m: string, s: string) => Promise<any>> = {
      initialize: initializeMonthlyStatus,
      submit: submitStoreStatus,
      confirm: confirmStoreStatus,
      revert: revertSubmitStatus,
      unconfirm: unconfirmStoreStatus,
    };
    if (!actions[body.action]) throw new WorkspaceError(400, "不支援的操作");
    const result = await actions[body.action](month, body.store);
    if (!result.success)
      throw new WorkspaceError(
        400,
        result.error ||
          (result.needNewbieCheck
            ? "請先確認新人階段資料，再提交"
            : "操作未完成"),
      );
    return respond(result);
  } catch (e) {
    return failed(e);
  }
}
