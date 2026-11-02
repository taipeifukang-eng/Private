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
  canDoMonthlyAction,
  computeStoreStats,
  monthlyActionBlockedMessage,
  preSubmitReport,
  rowsAllow,
  rowsAllowAll,
  STORE_WIDE_ACTIONS,
  type MonthlyAction,
} from "@/lib/workspace/monthly-status-rules";
import { isSupervisorActingManagerDual } from "@/lib/monthly-staff/block";
import { plannedExtraTaskHours } from "@/lib/monthly-staff/hours";
import {
  MONTHLY_STATUS_OPTIONS,
  POSITION_OPTIONS,
  NEWBIE_LEVEL_OPTIONS,
  ADMIN_LEVEL_OPTIONS,
  PARTIAL_MONTH_REASON_OPTIONS,
  SPECIAL_ROLE_OPTIONS,
} from "@/types/workflow";
export const dynamic = "force-dynamic";
const PERFORMANCE_FIELDS = [
  "transaction_count",
  "sales_amount",
  "gross_profit",
  "gross_profit_rate",
  "last_month_single_item_bonus",
] as const;
const STAFF_CHECK_COLUMNS =
  "id,status,employee_code,employee_name,employment_type,work_hours,start_date,position,monthly_status,newbie_level";
async function isAssigned(ctx: any, store: string) {
  const assigned = checked(
    await ctx.auth
      .from("store_managers")
      .select("id")
      .eq("user_id", ctx.user.id)
      .eq("store_id", store),
  ) as unknown[] | null;
  return !!assigned?.length;
}
const extractStoreCode = (raw: unknown) => {
  const text = String(raw || "").toUpperCase();
  const matched = text.match(/\d{4}[A-Z]?/);
  return matched ? matched[0] : text.trim();
};
export async function GET(request: Request) {
  try {
    const ctx = await moduleContext("monthly");
    const p = new URL(request.url).searchParams;
    // 含已停止門市（唯讀歷史）；寫入一律只認有效門市（見 POST）。
    const allStores = await moduleStores(ctx, "monthly", {
      includeInactive: true,
    });
    const stores = allStores.filter((s: any) => s.is_active !== false);
    const op = p.get("op");
    if (op === "staffDetails") {
      // 舊版 /api/staff-performance-details：展開列的各門市業績明細（需 view_performance）。
      if (!ctx.has("monthly.status.view_performance"))
        throw new WorkspaceError(403, "沒有此操作權限");
      const id = p.get("id") || "";
      if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new WorkspaceError(400, "缺少員工狀態ID");
      const staff = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select("id,store_id,stores:store_id(store_code)")
          .eq("id", id)
          .maybeSingle(),
      ) as any;
      if (!staff) throw new WorkspaceError(404, "找不到該記錄");
      if (!allStores.some((s: any) => s.id === staff.store_id))
        throw new WorkspaceError(403, "沒有此門市操作權限");
      const franchise =
        checked(
          await ctx.auth
            .from("stores")
            .select("store_code")
            .eq("is_franchise", true),
        ) || [];
      const franchiseCodes = new Set(
        (franchise as any[]).map((s) => extractStoreCode(s.store_code)).filter(Boolean),
      );
      const rel = Array.isArray(staff.stores) ? staff.stores[0] : staff.stores;
      const currentCode = extractStoreCode(rel?.store_code);
      const details =
        checked(
          await ctx.auth
            .from("monthly_performance_details")
            .select("*")
            .eq("staff_status_id", id)
            .order("store_code"),
        ) || [];
      return respond({
        details: (details as any[]).filter((row) => {
          const code = extractStoreCode(row.store_code);
          return !(franchiseCodes.has(code) && code !== currentCode);
        }),
      });
    }
    const month = monthValue(p.get("month"));
    const store = p.get("store") || stores[0]?.id || allStores[0]?.id;
    if (op === "movements") {
      // 舊版點員工姓名開啟的異動歷程；只能查「該門市本月名冊」上的人員，且只回該門市的異動（不跨店、不外洩他店 notes）。
      const code = p.get("employee_code") || "";
      if (!code || code.length > 50)
        throw new WorkspaceError(400, "缺少員工代號");
      if (!store || !allStores.some((s: any) => s.id === store))
        throw new WorkspaceError(403, "沒有此門市操作權限");
      const onRoster = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select("id")
          .eq("store_id", store)
          .eq("year_month", month)
          .eq("employee_code", code)
          .limit(1),
      );
      if (!onRoster?.length) throw new WorkspaceError(404, "本月名冊沒有此人員");
      const movements = checked(
        await ctx.auth
          .from("employee_movement_history")
          .select(
            "id,movement_type,movement_date,old_value,new_value,notes,stores:store_id(store_name)",
          )
          .eq("employee_code", code)
          .eq("store_id", store)
          .order("movement_date", { ascending: false }),
      );
      return respond({ movements: movements || [] });
    }
    // 總覽用：各門市本月狀態（只含有效門市，與舊版 getMonthlyStoreSummaries 一致，且不帶統計欄位）。
    const summaryRows =
      stores.length === 0
        ? []
        : checked(
            await ctx.auth
              .from("monthly_store_summary")
              .select("store_id,store_status")
              .eq("year_month", month)
              .in(
                "store_id",
                stores.map((s: any) => s.id),
              ),
          ) || [];
    const summaries = summaryRows as { store_id: string; store_status: string }[];
    const stats = ctx.has("monthly.status.view_stats")
      ? computeStoreStats(stores as any, summaries)
      : null;
    if (!store)
      return respond({
        stores,
        allStores,
        summaries,
        stats,
        records: [],
        canEdit: false,
        canViewStats: !!stats,
        canViewPerformance: ctx.has("monthly.status.view_performance"),
      });
    if (!allStores.some((s: any) => s.id === store))
      throw new WorkspaceError(403, "沒有此門市操作權限");
    if (op === "precheck") {
      // 送審前檢查（W01a-q2）：兼職缺時數 + 新人階段，同一份報告。
      const rows = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select(STAFF_CHECK_COLUMNS)
          .eq("store_id", store)
          .eq("year_month", month),
      );
      return respond({ report: preSubmitReport((rows || []) as any, month) });
    }
    const result = await getMonthlyStaffStatus(month, store);
    if (!result.success)
      throw new WorkspaceError(400, result.error || "讀取失敗");
    const summary = await getStoreMonthlySummary(month,store);
    if (!summary.success) throw new WorkspaceError(503, "月份狀態讀取失敗，請重試");
    const storeActive = (stores as any[]).some((s) => s.id === store);
    // 業績與獎金欄位只給有 view_performance 的角色；其他角色在伺服器端移除，不只在畫面隱藏。
    const canViewPerformance = ctx.has("monthly.status.view_performance");
    const records = canViewPerformance
      ? result.data
      : (result.data || []).map((r: any) => {
          const copy = { ...r };
          for (const key of PERFORMANCE_FIELDS) delete copy[key];
          return copy;
        });
    return respond({
      stores,
      allStores,
      summaries,
      stats,
      store,
      storeActive,
      records,
      storeStatus: summary.data?.store_status || "not_started",
      options: {
        statuses: MONTHLY_STATUS_OPTIONS,
        positions: [...POSITION_OPTIONS, ...SPECIAL_ROLE_OPTIONS],
        levels: [...NEWBIE_LEVEL_OPTIONS, ...ADMIN_LEVEL_OPTIONS],
        reasons: PARTIAL_MONTH_REASON_OPTIONS,
      },
      canEdit: storeActive && ctx.has("monthly.status.edit"),
      canSubmit: storeActive && ctx.has("monthly.status.submit"),
      canConfirm: ctx.has("monthly.status.confirm"),
      canRevert: ctx.has("monthly.status.revert"),
      canUnconfirm: ctx.has("monthly.status.unconfirm"),
      canViewStats: !!stats,
      canViewPerformance,
      // 刪除（W01a-q1）：需 monthly.status.edit 且被指派該門市（管理員除外）；是否可刪仍依各列狀態（只有草稿）。
      canDelete:
        storeActive &&
        ctx.has("monthly.status.edit") &&
        (ctx.isAdmin || (await isAssigned(ctx, store))),
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
      if (!ctx.isAdmin && !(await isAssigned(ctx, body.store)))
        throw new WorkspaceError(403, "只有指派人員可編輯此門市");
    }
    if (body.action === "delete") {
      // W01a-q1：只有草稿可刪（規則表 M1-x1）；已送審、已確認一律 409，需先退回。
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
        throw new WorkspaceError(400, "缺少人員資料");
      const target = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select("id,status")
          .eq("id", body.id)
          .eq("store_id", body.store)
          .eq("year_month", month)
          .maybeSingle(),
      );
      if (!target) throw new WorkspaceError(404, "找不到該人員，請重新查詢");
      if (!canDoMonthlyAction(target.status, "delete"))
        throw new WorkspaceError(409, monthlyActionBlockedMessage(target.status, "delete"));
      const removed = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .delete()
          .eq("id", body.id)
          .eq("store_id", body.store)
          .eq("status", "draft")
          .select("id"),
      );
      if (!removed?.length)
        throw new WorkspaceError(409, "此筆已送出或已變更，請重新查詢");
      return respond({ success: true, deleted: body.id });
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
      if (!before || !canDoMonthlyAction(before.status, "edit"))
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
        const dual = isSupervisorActingManagerDual(u.position, u.is_dual_position);
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
        // W01b：外務時數與規劃時數照舊版（`|| null`）；規劃時數公式與 Vue 預覽共用 lib/monthly-staff/hours.ts。
        updates.extra_task_external_hours = u.extra_tasks.length
          ? u.extra_task_external_hours || null
          : null;
        updates.extra_task_planned_hours = u.extra_tasks.length
          ? plannedExtraTaskHours({
              position: u.position,
              employment_type: u.employment_type,
              is_dual_position: u.is_dual_position,
              monthly_status: u.monthly_status,
              work_days: u.work_days,
              work_hours: u.work_hours,
            })
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
    const actions: Record<string, (m: string, s: string, skip?: boolean) => Promise<any>> = {
      initialize: initializeMonthlyStatus,
      submit: submitStoreStatus,
      confirm: confirmStoreStatus,
      revert: revertSubmitStatus,
      unconfirm: unconfirmStoreStatus,
    };
    if (!actions[body.action]) throw new WorkspaceError(400, "不支援的操作");
    let skipChecks = false;
    if (body.action !== "initialize") {
      // M1-x1：以各列狀態套用「狀態 × 動作」規則表，不符合一律 409。
      const rows = (checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select(STAFF_CHECK_COLUMNS)
          .eq("store_id", body.store)
          .eq("year_month", month),
      ) || []) as any[];
      const action = body.action as MonthlyAction;
      // 確認／退回／取消確認是整間門市動作：每一列都要符合，混合狀態回 409；其餘動作任一列符合即可。
      const storeWide = STORE_WIDE_ACTIONS.includes(action);
      if (!(storeWide ? rowsAllowAll(rows, action) : rowsAllow(rows, action)))
        throw new WorkspaceError(
          409,
          !rows.length
            ? "此門市本月尚無人員資料"
            : storeWide && rows.some((r) => canDoMonthlyAction(r.status, action))
              ? "此門市人員狀態不一致（部分尚未符合條件），請先處理後再操作"
              : monthlyActionBlockedMessage("none", action),
        );
      if (body.action === "submit") {
        const report = preSubmitReport(rows, month);
        skipChecks = body.skipChecks === true;
        // 舊版 submitStoreStatus：新人階段未確認不得送出（需 skipChecks）；兼職缺時數只是提醒，由畫面同一視窗處理。
        if (report.newbiesNeedCheck.length && !skipChecks)
          throw new WorkspaceError(
            409,
            `尚有 ${report.newbiesNeedCheck.length} 位新人階段需確認，請先完成送審前檢查`,
          );
      }
    }
    const result = await actions[body.action](month, body.store, skipChecks);
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
