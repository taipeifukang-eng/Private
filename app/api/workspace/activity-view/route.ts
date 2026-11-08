import { context, failed, uuid, WorkspaceError } from '@/lib/workspace/server';
import { activityDetailResponse, activityListResponse } from '@/lib/workspace/activity-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// M5 W20：活動檢視獨立入口（取代 /activity-management 與 /activity-view/[id] 兩個舊頁）。
// GET            -> 已發布活動列表（依舊 GET /api/campaigns/published 的受眾規則，停用的隱藏）
// GET ?id=<uuid> -> 單一活動與規劃資料（依舊 GET /api/campaigns/[id]/view 的範圍）
// 寫入（填報）走既有 /api/workspace/campaign-tools（由舊 handler 與 authorizeCampaignStoreWrite 判斷）。
export async function GET(request: Request) {
  try {
    const ctx = await context({ profile: false });
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id === null) return await activityListResponse(ctx);
    if (!uuid(id)) throw new WorkspaceError(400, '活動識別不正確');
    return await activityDetailResponse(ctx, url, id);
  } catch (e) {
    return failed(e);
  }
}
