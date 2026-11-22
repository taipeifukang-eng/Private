import { checked, context, uuid, WorkspaceError } from "@/lib/workspace/server";
import { CAMPAIGN_INACTIVE_VISIBLE_CODES } from "@/lib/workspace/campaign-rules";

/**
 * M5 Q2：停用的活動對沒有編輯／發布權限的人等於下架。
 * 讀取（query campaign_id）與填報寫入（body campaign_id）都用這個檢查，找不到與停用回同樣的 404。
 */
type Ctx = Awaited<ReturnType<typeof context>>;
export async function assertCampaignNotHidden(ctx: Ctx, campaignId: unknown) {
  if (!uuid(campaignId) || ctx.has(...CAMPAIGN_INACTIVE_VISIBLE_CODES)) return;
  const row = checked(await ctx.admin.from("campaigns").select("is_active").eq("id", campaignId).maybeSingle()) as any;
  if (row && row.is_active === false) throw new WorkspaceError(404, "找不到此活動，或活動已停用");
}
export async function bodyCampaignId(request: Request): Promise<unknown> {
  try {
    const body = await request.clone().json();
    return body && typeof body === "object" ? (body as any).campaign_id : undefined;
  } catch {
    return undefined;
  }
}
