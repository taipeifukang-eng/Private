import {
  CAMPAIGN_EDIT_CODES,
  CAMPAIGN_READ_CODES,
  checked,
  checkOrigin,
  context,
  failed,
  requireCapability,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
import { GET as legacyCampaigns } from "@/app/api/campaigns/route";
export const dynamic = "force-dynamic";
const fields =
  "id,name,start_date,end_date,campaign_type,is_active,updated_at,workspace_version,published_to_supervisors,published_to_store_managers,published_to_inventory_team";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCapability(ctx, CAMPAIGN_READ_CODES);
    const p = new URL(request.url).searchParams;
    const id = p.get("id");
    // 可見活動由舊版 GET /api/campaigns 決定（lib/campaign-access.ts：權限閘門、發布閘門、
    // view_all／編輯權看全部），不在這裡另寫一份規則；本 API 只負責分頁、搜尋與欄位。
    const legacy = await legacyCampaigns();
    if (!legacy.ok) {
      const denied = await legacy.json().catch(() => ({}));
      throw new WorkspaceError(legacy.status === 401 ? 401 : legacy.status === 403 ? 403 : 503, legacy.status === 403 ? denied.error || "沒有活動查看權限" : "資料讀取或寫入失敗，請稍後重試");
    }
    const visibleIds: string[] = ((await legacy.json()).campaigns || []).map((c: any) => c.id);
    let query = ctx.admin.from("campaigns").select(fields, { count: "exact" }).in("id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]);
    if (id) {
      if (!uuid(id)) throw new WorkspaceError(400, "活動識別不正確");
      query = query.eq("id", id);
    }
    const page = Number(p.get("page") || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new WorkspaceError(400, "頁碼不正確");
    const q = (p.get("q") || "")
      .trim()
      .slice(0, 100)
      .replace(/[%_\\]/g, "");
    if (q) query = query.ilike("name", `%${q}%`);
    const result = await query
      .order("start_date", { ascending: false })
      .order("id")
      .range((page - 1) * 20, page * 20 - 1);
    return respond({
      records: checked(result),
      total: result.count || 0,
      canEdit: ctx.has(...CAMPAIGN_EDIT_CODES),
    });
  } catch (error) {
    return failed(error);
  }
}
function validate(body: any) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const validDate = (s: any) =>
    typeof s === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (
    !name ||
    name.length > 120 ||
    !validDate(body.start_date) ||
    !validDate(body.end_date) ||
    body.end_date < body.start_date ||
    !["promotion", "inventory"].includes(body.campaign_type) ||
    typeof body.is_active !== "boolean"
  )
    throw new WorkspaceError(400, "請確認活動名稱、有效日期區間與活動類型");
  return {
    name,
    start_date: body.start_date,
    end_date: body.end_date,
    campaign_type: body.campaign_type,
    is_active: body.is_active,
  };
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCapability(ctx, CAMPAIGN_EDIT_CODES);
    const body = await request.json();
    const values = validate(body);
    if (!uuid(body.requestId)) throw new WorkspaceError(400, "缺少送出識別");
    const existing = checked(
      await ctx.admin
        .from("campaigns")
        .select(fields)
        .eq("workspace_request_id", body.requestId)
        .eq("created_by", ctx.user.id)
        .maybeSingle(),
    );
    if (existing) {
      if (
        Object.entries(values).some(
          ([key, value]) => (existing as any)[key] !== value,
        )
      )
        throw new WorkspaceError(
          409,
          "上一次新增已完成，但內容與目前草稿不同。請保留草稿，從活動列表開啟已建立的活動再編輯。",
        );
      return respond({ record: existing });
    }
    const result = await ctx.admin
      .from("campaigns")
      .insert({
        ...values,
        workspace_request_id: body.requestId,
        created_by: ctx.user.id,
      })
      .select(fields)
      .single();
    if (result.error?.code === "23505") {
      const record = checked(
        await ctx.admin
          .from("campaigns")
          .select(fields)
          .eq("workspace_request_id", body.requestId)
          .eq("created_by", ctx.user.id)
          .single(),
      );
      if (
        Object.entries(values).some(
          ([key, value]) => (record as any)[key] !== value,
        )
      )
        throw new WorkspaceError(
          409,
          "上一次新增已完成，但內容與目前草稿不同。請保留草稿，從活動列表開啟已建立的活動再編輯。",
        );
      return respond({ record });
    }
    return respond({ record: checked(result) }, 201);
  } catch (error) {
    return failed(error);
  }
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCapability(ctx, CAMPAIGN_EDIT_CODES);
    const body = await request.json();
    const values = validate(body);
    if (
      !uuid(body.id) ||
      !Number.isSafeInteger(body.version) ||
      body.version < 1
    )
      throw new WorkspaceError(400, "活動版本不正確，請重新載入");
    const record = checked(
      await ctx.admin
        .from("campaigns")
        .update(values)
        .eq("id", body.id)
        .eq("workspace_version", body.version)
        .select(fields)
        .maybeSingle(),
    );
    if (!record)
      throw new WorkspaceError(
        409,
        "此活動已由其他頁籤或使用者更新。請重新載入比對，再儲存修改。",
      );
    return respond({ record });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,CAMPAIGN_EDIT_CODES);
 const p=new URL(request.url).searchParams,id=p.get('id'),version=Number(p.get('version'));
 if(!uuid(id)||!Number.isSafeInteger(version)||version<1)throw new WorkspaceError(400,'活動識別或版本不正確');
 const record=checked(await ctx.admin.from('campaigns').delete().eq('id',id).eq('workspace_version',version).select('id').maybeSingle());
 if(!record)throw new WorkspaceError(409,'活動已變更或刪除，請重新載入核對');return respond({success:true});
}catch(e){return failed(e);}}
