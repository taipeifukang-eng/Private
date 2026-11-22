import { GET as read, POST as save } from "@/app/api/campaign-schedules/route";
import {
  CAMPAIGN_READ_CODES,
  CAMPAIGN_EDIT_CODES,
  checked,
  checkOrigin,
  context,
  failed,
  requireCapability,
  respond,
  WorkspaceError,
} from "@/lib/workspace/server";
import { assertCampaignNotHidden } from "@/lib/workspace/campaign-guard";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCapability(ctx, CAMPAIGN_READ_CODES);
    // M5 Q2：停用的活動對沒有編輯／發布權限的人隱藏（直接帶活動編號讀排程也一樣）。
    await assertCampaignNotHidden(ctx, new URL(request.url).searchParams.get("campaign_id"));
    const response = await read(request);
    if (!response.ok) return response;
    const stores = checked(
      await ctx.auth
        .from("stores")
        .select("id,store_code,store_name")
        .eq("is_active", true)
        .order("store_code"),
    );
    return respond({ ...(await response.json()), stores });
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCapability(ctx, CAMPAIGN_EDIT_CODES);
    const body = await request.clone().json();
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(body.activity_date || ""))
      throw new WorkspaceError(400, "請選擇活動日期");
    return await save(request);
  } catch (e) {
    return failed(e);
  }
}
