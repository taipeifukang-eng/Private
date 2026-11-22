import { context, checked, failed, respond, requireCapability } from "@/lib/workspace/server";
import { myTaskRows } from "@/lib/workspace/task-list";
import { statusCounts } from "@/lib/workspace/task-progress";
import { GA_REQUEST_CREATE_ANY_STORE_PERMISSIONS } from "@/lib/general-affairs/service-requests/access";
export const dynamic = "force-dynamic";
/**
 * M3 W10 儀表板。範圍照舊版（我參與的未封存任務）；統計卡只給有管理門市者
 * （舊版 /api/user/managed-stores：能替任何門市建需求單者，或 store_managers 有紀錄），其他人顯示本月人員狀態捷徑。
 * 統計與進度一律以勾選紀錄推算的整體進度為準（M3 B.4）。
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCapability(ctx, ["dashboard.view"]);
    const records = await myTaskRows(ctx);
    let managesStores = ctx.has(...GA_REQUEST_CREATE_ANY_STORE_PERMISSIONS);
    if (!managesStores) {
      const rows = checked(
        await ctx.admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id).limit(1),
      ) as any[];
      managesStores = !!rows?.length;
    }
    return respond({
      name: ctx.profile?.full_name || "使用者",
      managesStores,
      stats: managesStores ? statusCounts(records) : null,
      records: records.map((r: any) => ({
        id: r.id,
        title: r.template?.title || "未知專案",
        description: r.template?.description || "",
        department: r.department || "",
        assignedName: r.assignedName,
        status: r.status,
        percent: r.percent,
        overallDone: r.overallDone,
        overallTotal: r.overallTotal,
        lastActivity: r.lastActivity,
        created_at: r.created_at,
        sectionChanged: r.sectionChanged,
        multiple: r.multiple,
      })),
      refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    return failed(e);
  }
}
