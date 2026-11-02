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
    if (!store) return respond({ stores, records: [], canEdit: false });
    await requireStore(ctx, "performance", store);
    url.searchParams.set("store_id", store);
    const response = await read(
      new NextRequest(url, { headers: request.headers }),
    );
    if (!response.ok) return response;
    const data = await response.json();
    const versions =
      checked(
        await ctx.auth
          .from("store_performance")
          .select("id,updated_at")
          .eq("store_id", store)
          .eq("year", year),
      ) || [];
    return respond({
      ...data,
      records: data.records.map((r: any) => ({
        ...r,
        updated_at: versions.find((v) => v.id === r.id)?.updated_at,
      })),
      stores,
      store,
      canEdit: ctx.has("performance.edit"),
      canViewBonus: ctx.has("performance.bonus.view"),
      canImportBonus: ctx.has("performance.bonus.import"),
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
    await requireStore(ctx, "performance", body.store_id);
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
      values[field] = body[field];
    }
    if (body.id) {
      let q = ctx.auth
        .from("store_performance")
        .update(values)
        .eq("id", body.id)
        .eq("store_id", body.store_id)
        .eq("year", body.year)
        .eq("month", body.month);
      q = body.updated_at
        ? q.eq("updated_at", body.updated_at)
        : q.is("updated_at", null);
      const record = checked(await q.select().maybeSingle());
      if (!record)
        throw new WorkspaceError(
          409,
          "此月業績已由其他頁面更新，請保留草稿並重新查詢",
        );
      return respond({ success: true, record });
    }
    const result = await ctx.auth
      .from("store_performance")
      .insert({ ...values, created_by: ctx.user.id })
      .select()
      .single();
    if (result.error?.code === "23505")
      throw new WorkspaceError(409, "此月已有資料，請重新查詢後編輯");
    return respond({ success: true, record: checked(result) });
  } catch (e) {
    return failed(e);
  }
}
