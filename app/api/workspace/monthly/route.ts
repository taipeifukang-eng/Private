import {
  checked,
  checkOrigin,
  failed,
  respond,
  WorkspaceError,
} from "@/lib/workspace/server";
import {
  isAssignedTo,
  moduleContext,
  moduleStores,
  monthValue,
  requireStore,
} from "@/lib/workspace/modules";
import { buildMonthlyMeta } from "@/lib/workspace/monthly-meta";
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
import { applyExternalHoursPrefix } from "@/lib/monthly-staff/external-hours-note";
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
const isAssigned = (ctx: any, store: string) => isAssignedTo(ctx, store);
const extractStoreCode = (raw: unknown) => {
  const text = String(raw || "").toUpperCase();
  const matched = text.match(/\d{4}[A-Z]?/);
  return matched ? matched[0] : text.trim();
};
// 名冊頁一次要的資料。名冊＋門市統計列用單一 RPC（以使用者身分執行，RLS 照舊，一趟往返），
// recheck／adjustments 是 service role 才讀得到的表，與 RPC 同時送出；RPC 還沒套用（或失敗）時，名冊與統計退回逐表查詢，結果相同。
async function rosterPage(ctx: any, month: string, store: string, since: string) {
  const [rpc, recheckRes, adjustmentsRes] = await Promise.all([
    ctx.auth.rpc("workspace_monthly_roster_page", { p_store: store, p_month: month }),
    ctx.admin
      .from("monthly_staff_recheck")
      .select("id,employee_code,employee_name,year_month,field,old_value,new_value,reason_label,source_type,created_at")
      .eq("store_id", store)
      .eq("status", "pending")
      .order("year_month")
      .order("employee_code")
      .limit(200),
    ctx.admin
      .from("monthly_staff_adjustment_log")
      .select("id,employee_code,employee_name,field,old_value,new_value,movement_label,created_at")
      .eq("store_id", store)
      .eq("year_month", month)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const recheck = checked(recheckRes) as any[];
  const adjustments = checked(adjustmentsRes) as any[];
  if (!rpc.error && rpc.data && Array.isArray(rpc.data.records))
    return { records: rpc.data.records as any[], summary: (rpc.data.summary || null) as any, recheck, adjustments };
  const caller = { user: ctx.user, supabase: ctx.auth };
  const [result, summary] = await Promise.all([
    getMonthlyStaffStatus(month, store, caller),
    getStoreMonthlySummary(month, store, caller),
  ]);
  if (!result.success) throw new WorkspaceError(400, result.error || "讀取失敗");
  if (!summary.success) throw new WorkspaceError(503, "月份狀態讀取失敗，請重試");
  return { records: (result.data || []) as any[], summary: summary.data as any, recheck, adjustments };
}
export async function GET(request: Request) {
  try {
    const ctx = await moduleContext("monthly", { profile: false, prefetchStores: true });
    const p = new URL(request.url).searchParams;
    // 含已停止門市（唯讀歷史）；寫入一律只認有效門市（見 POST）。
    const allStores = await moduleStores(ctx, "monthly", {
      includeInactive: true,
    });
    const stores = allStores.filter((s: any) => s.is_active !== false);
    const op = p.get("op");
    if (op === "staffDetails") {
      // 舊版 /api/staff-performance-details：展開列的各門市業績明細。
      // 規格 B.3：畫面照舊版（看得到名冊業績的人都能展開）；伺服器只保留登入與門市可見範圍檢查。
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
      // 舊版點員工姓名開啟的異動歷程（規格 B.4）：可查任何員編、顯示所有門市的異動；
      // 伺服器只保留登入檢查，並以使用者身分查詢（ctx.auth，受 RLS 限制），不用 service role 擴權。
      const code = p.get("employee_code") || "";
      if (!code || code.length > 50)
        throw new WorkspaceError(400, "缺少員工代號");
      const movements = checked(
        await ctx.auth
          .from("employee_movement_history")
          .select("*,stores:store_id(store_name)")
          .eq("employee_code", code)
          .not("store_id", "is", null)
          .order("movement_date", { ascending: false }),
      );
      return respond({ movements: movements || [] });
    }
    // 總覽用：各門市本月狀態（只含有效門市，與舊版 getMonthlyStoreSummaries 一致，且不帶統計欄位）。
    const fetchSummaries = async () =>
      (stores.length === 0
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
          ) || []) as { store_id: string; store_status: string }[];
    const statsOf = (summaries: { store_id: string; store_status: string }[]) =>
      ctx.has("monthly.status.view_stats")
        ? computeStoreStats(stores as any, summaries)
        : null;
    if (!store) {
      const summaries = await fetchSummaries();
      const stats = statsOf(summaries);
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
    }
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
    const storeActive = (stores as any[]).some((s) => s.id === store);
    // M2 A.2／A.3：需重新確認清單（該門市所有月份）與本月「近期因異動自動調整」清單。
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    // 速度規格 B／C：名冊頁資料（一支 RPC，或退回的並行查詢）、各門市總覽、刪除權限互不相依，一起並行；
    // 使用者已在 context 驗證，helper 不再各自 getUser。
    const [page, summaries, assigned] = await Promise.all([
      rosterPage(ctx, month, store, since),
      fetchSummaries(),
      storeActive && !ctx.isAdmin ? isAssigned(ctx, store) : Promise.resolve(false),
    ]);
    const stats = statsOf(summaries);
    const { recheck, adjustments } = page;
    // 速度規格 A：附上工具列需要的 meta（統計、capabilities、version），開頁不必再打 op=meta。
    // 與 tools?op=meta 同一支 buildMonthlyMeta；欄位權限（viewStats／viewSupport）在裡面過濾。
    // 已停止門市工具列停用（disabled），不附 meta，維持原行為。
    const meta = storeActive ? await buildMonthlyMeta(ctx, page.summary) : undefined;
    // 業績與獎金欄位只給有 view_performance 的角色；其他角色在伺服器端移除，不只在畫面隱藏。
    const canViewPerformance = ctx.has("monthly.status.view_performance");
    const records = canViewPerformance
      ? page.records
      : page.records.map((r: any) => {
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
      storeStatus: page.summary?.store_status || "not_started",
      options: {
        statuses: MONTHLY_STATUS_OPTIONS,
        positions: POSITION_OPTIONS,
        levels: [...NEWBIE_LEVEL_OPTIONS, ...ADMIN_LEVEL_OPTIONS],
        reasons: PARTIAL_MONTH_REASON_OPTIONS,
      },
      canEdit: storeActive && ctx.has("monthly.status.edit"),
      canSubmit: storeActive && ctx.has("monthly.status.submit"),
      canConfirm: ctx.has("monthly.status.confirm"),
      canRevert: ctx.has("monthly.status.revert"),
      canUnconfirm: ctx.has("monthly.status.unconfirm"),
      recheck,
      adjustments,
      canRecompute: storeActive && ctx.has("monthly.status.edit"),
      canViewStats: !!stats,
      canViewPerformance,
      // 刪除（規格 B.2）：管理員或該門市店長；實際只有草稿可刪（已送審回 409 需先退回）。
      canDelete: storeActive && (ctx.isAdmin || assigned),
      meta,
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await moduleContext("monthly", { profile: false });
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
    } else if (body.action === "delete") {
      // 規格 B.2：照舊版 deleteMonthlyStatusRecord，只認管理員或該門市店長，不另看 monthly.status.edit。
      if (!ctx.isAdmin && !(await isAssigned(ctx, body.store)))
        throw new WorkspaceError(403, "您沒有權限刪除此記錄");
    } else {
      if (!ctx.has(body.action === "submit" ? "monthly.status.submit" : "monthly.status.edit")) throw new WorkspaceError(403, "沒有此操作權限");
      if (!ctx.isAdmin && !(await isAssigned(ctx, body.store)))
        throw new WorkspaceError(403, "只有指派人員可編輯此門市");
    }
    if (body.action === "delete") {
      // 規格 B.2：只有草稿可刪（規則表 M1-x1，使用者接受）；已送審、已確認一律 409，需先退回。
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
          .select("id,status,position,updated_at")
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
        // 舊版職位下拉只有 POSITION_OPTIONS；紀錄原本就是特殊職位時，維持原值才放行（避免資料遺失）。
        if (
          !(
            POSITION_OPTIONS.includes(u.position) ||
            (u.position === before.position &&
              SPECIAL_ROLE_OPTIONS.includes(u.position))
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
          !u.newbie_level
        )
          throw new WorkspaceError(400, "職位為行政時，請標註「過階」或「未過階」");
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
        // 規格 C.2／G.3：有外務時數（>0）時，把「外務時數: N小時」加在 partial_month_notes 前面（原備註以「; 」接在後面）；
        // 先移除既有前綴避免重複儲存疊加（與舊版不同）；外務時數為 0 或空時只移除前綴、保留原備註。
        updates.partial_month_notes = applyExternalHoursPrefix(
          u.partial_month_notes,
          u.extra_tasks.length ? u.extra_task_external_hours : null,
        );
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
      // 舊版 updateStaffStatus 後寫覆蓋（W03-q3 同一決定）：不再用 updated_at 樂觀鎖；仍只允許草稿。
      const row = checked(
        await ctx.auth
          .from("monthly_staff_status")
          .update(updates)
          .eq("id", body.id)
          .eq("status", "draft")
          .select()
          .maybeSingle(),
      );
      if (!row)
        throw new WorkspaceError(409, "此筆已送出或已變更，請重新查詢");
      return respond({ record: row });
    }
    if (body.action === "recompute") {
      // M2 A.2：月份退回草稿後，一鍵依異動重算；仍有已送審／已確認的列時拒絕（要先退回草稿）。
      const rows = (checked(
        await ctx.auth
          .from("monthly_staff_status")
          .select("id,status")
          .eq("store_id", body.store)
          .eq("year_month", month),
      ) || []) as any[];
      const summary = await getStoreMonthlySummary(month, body.store);
      const storeStatus = String(summary.data?.store_status || "");
      if (
        rows.some((r) => !canDoMonthlyAction(r.status, "edit")) ||
        ["submitted", "confirmed"].includes(storeStatus)
      )
        throw new WorkspaceError(409, "此月份已送審或已確認，請先退回草稿再依異動重算");
      const applied = checked(
        await ctx.admin.rpc("workspace_roster_apply_store_month", {
          p_actor: ctx.user.id,
          p_store: body.store,
          p_month: month,
          p_log: true,
          p_apply_locked: false,
          p_label: "依異動重算",
        }),
      );
      return respond({ success: true, recomputed: applied });
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
    if (result.success && body.action === "initialize" && result.initialized) {
      // M2 A.1：初始化後套用異動回寫的同一套計算，確保「先初始化後登錄」與「先登錄後初始化」結果相同。
      const applied = await ctx.admin.rpc("workspace_roster_apply_store_month", {
        p_actor: ctx.user.id,
        p_store: body.store,
        p_month: month,
        p_log: false,
        p_apply_locked: false,
        p_label: "初始化",
      });
      if (applied.error)
        throw new WorkspaceError(503, "名冊已初始化，但依異動套用失敗，請按「依異動重算」重試");
    }
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
