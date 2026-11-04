import { NextRequest } from "next/server";
import { GET as read } from "@/app/api/performance-data/route";
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
  requireStore,
} from "@/lib/workspace/modules";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const ctx = await moduleContext("performance");
    const stores = await moduleStores(ctx, "performance");
    const url = new URL(request.url);
    const store = url.searchParams.get("store_id") || stores[0]?.id;
    const year = Number(url.searchParams.get("year"));
    if (!Number.isInteger(year) || year < 2000 || year > 2099)
      throw new WorkspaceError(400, "年度不正確");
    // 沒有可看的門市時仍要回傳權限旗標：舊版分頁（匯入每月獎金、匯入業績）依權限顯示，與門市指派無關。
    const access = {
      canEdit: ctx.has("performance.edit"),
      canViewBonus: ctx.has("performance.bonus.view"),
      canImportBonus: ctx.has("performance.bonus.import"),
    };
    if (!store) return respond({ stores, records: [], ...access });
    await requireStore(ctx, "performance", store);
    url.searchParams.set("store_id", store);
    const response = await read(
      new NextRequest(url, { headers: request.headers }),
    );
    if (!response.ok) return response;
    const data = await response.json();
    return respond({
      ...data,
      stores,
      store,
      ...access,
    });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const ctx = await moduleContext("performance");
    if (!ctx.has("performance.edit"))
      throw new WorkspaceError(403, "沒有編輯業績權限");
    const body = await request.clone().json();
    // W03-q 規格 D.1：有 performance.edit 即可存任何門市，不看門市指派（照舊版）。
    if (
      !Number.isInteger(body.year) ||
      body.year < 2000 ||
      body.year > 2099 ||
      !Number.isInteger(body.month) ||
      body.month < 1 ||
      body.month > 12
    )
      throw new WorkspaceError(400, "年月不正確");
    const days = body.business_days;
    if (
      typeof days !== "number" ||
      !Number.isFinite(days) ||
      days < 0.5 ||
      days > 31 ||
      !Number.isInteger(days * 2)
    )
      throw new WorkspaceError(
        400,
        "營業天數需介於 0.5 至 31 天，並以 0.5 天為單位",
      );
    const fields = [
      "monthly_gross_profit_target",
      "monthly_revenue_target",
      "monthly_customer_count_target",
      "last_month_rx_target",
      "monthly_gross_profit_actual",
      "activity_day_gross_profit",
      "monthly_revenue_actual",
      "monthly_customer_count_actual",
      "last_month_rx_actual",
      "system_monthly_revenue",
      "self_pay_monthly_revenue",
      "monthly_true_gross_profit",
      "system_monthly_gross_profit",
      "monthly_long_term_care_gross_profit",
      "monthly_rx_addon_makeup_gross_profit",
      "monthly_theft_compensation_makeup_gross_profit",
      "monthly_kamedis_deduction_gross_profit",
    ];
    const values: Record<string, unknown> = {
      store_id: body.store_id,
      year: body.year,
      month: body.month,
      business_days: days,
      updated_at: new Date().toISOString(),
    };
    for (const field of fields) {
      if (
        body[field] !== null &&
        (typeof body[field] !== "number" || !Number.isFinite(body[field]))
      )
        throw new WorkspaceError(400, "業績數值格式不正確");
      // 照舊版 setField：非營業天數欄位 0 以 NULL 儲存。
      values[field] = body[field] === 0 ? null : body[field];
    }
    // W03-q3：照舊版後寫覆蓋（舊 /api/performance-data 為 upsert，沒有版本檢查）。
    // 以 store_id+year+month 為衝突鍵，不再比對 updated_at。
    const record = checked(
      await ctx.auth
        .from("store_performance")
        .upsert(
          { ...values, created_by: ctx.user.id },
          { onConflict: "store_id,year,month" },
        )
        .select()
        .single(),
    );
    return respond({ success: true, record });
  } catch (e) {
    return failed(e);
  }
}
