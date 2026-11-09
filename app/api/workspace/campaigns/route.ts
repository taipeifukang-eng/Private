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
import {
  CAMPAIGN_DELETE_TABLES,
  CAMPAIGN_INACTIVE_VISIBLE_CODES,
  deleteNameMatches,
  schedulesOutsideRange,
} from "@/lib/workspace/campaign-rules";
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
    // M5 Q2：停用的活動只對持有活動編輯／發布權限者顯示（列表標「停用」），督導、店長、檢視端一律看不到。
    const canSeeInactive = ctx.has(...CAMPAIGN_INACTIVE_VISIBLE_CODES);
    let query = ctx.admin.from("campaigns").select(fields, { count: "exact" }).in("id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]);
    if (!canSeeInactive) query = query.or("is_active.is.null,is_active.eq.true");
    if (id) {
      if (!uuid(id)) throw new WorkspaceError(400, "活動識別不正確");
      query = query.eq("id", id);
      // M5 Q3：刪除前顯示將一併刪除的資料筆數（只給有編輯權的人）。
      if (p.get("preview") === "delete") {
        requireCapability(ctx, CAMPAIGN_EDIT_CODES);
        const found = checked(await query.maybeSingle()) as any;
        if (!found) throw new WorkspaceError(404, "此活動已不存在或無法查看");
        return respond({ campaign: found, counts: await deleteCounts(ctx, id) });
      }
      // M5 Q4：改期前列出會落在新期間外的門市排程。
      if (p.get("preview") === "outside") {
        requireCapability(ctx, CAMPAIGN_EDIT_CODES);
        const start = p.get("start") || "", end = p.get("end") || "";
        if (!validDate(start) || !validDate(end) || end < start) throw new WorkspaceError(400, "請確認活動日期區間");
        return respond({ outside: await outsideSchedules(ctx, id, start, end) });
      }
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
      canSeeInactive,
    });
  } catch (error) {
    return failed(error);
  }
}
const validDate = (s: any) =>
  typeof s === "string" &&
  /^20\d{2}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
type Ctx = Awaited<ReturnType<typeof context>>;
async function deleteCounts(ctx: Ctx, id: string) {
  const out: { key: string; label: string; count: number }[] = [];
  for (const t of CAMPAIGN_DELETE_TABLES) {
    if (t.key === "completions") {
      // 勾選紀錄掛在 Check List 項目底下，沒有 campaign_id。
      const items = checked(await ctx.admin.from("campaign_checklist_items").select("id").eq("campaign_id", id)) as any[];
      const ids = (items || []).map((r) => r.id);
      const r = ids.length ? await ctx.admin.from(t.table).select("id", { count: "exact", head: true }).in("checklist_item_id", ids) : { count: 0, error: null };
      if ((r as any).error) throw new WorkspaceError(503, "資料讀取失敗，請稍後重試");
      out.push({ key: t.key, label: t.label, count: (r as any).count || 0 });
      continue;
    }
    const r = await ctx.admin.from(t.table).select("id", { count: "exact", head: true }).eq("campaign_id", id);
    if (r.error) throw new WorkspaceError(503, "資料讀取失敗，請稍後重試");
    out.push({ key: t.key, label: t.label, count: r.count || 0 });
  }
  return out;
}
async function outsideSchedules(ctx: Ctx, id: string, start: string, end: string) {
  const rows = (checked(await ctx.admin.from("campaign_schedules").select("store_id,activity_date,stores(store_code,store_name)").eq("campaign_id", id)) || []) as any[];
  return schedulesOutsideRange(rows, start, end).map((r) => ({
    store_id: r.store_id as string,
    activity_date: String(r.activity_date).slice(0, 10),
    store_code: r.stores?.store_code ?? "",
    store_name: r.stores?.store_name ?? "",
  }));
}
function validate(body: any) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
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
    // M5 Q4：期間外有排程時，必須明確確認「移回尚未安排」才能儲存，不留隱形資料。
    // 只在開始或結束日實際變動時才檢查；僅改名稱或狀態時，既有的期間外舊排程維持原樣（與舊版一致）。
    const current = checked(await ctx.admin.from("campaigns").select("start_date,end_date").eq("id", body.id).maybeSingle()) as any;
    const datesChanged = !current || String(current.start_date).slice(0, 10) !== values.start_date || String(current.end_date).slice(0, 10) !== values.end_date;
    const outside = datesChanged ? await outsideSchedules(ctx, body.id, values.start_date, values.end_date) : [];
    if (outside.length && body.moveOutside !== true)
      throw new WorkspaceError(409, `有 ${outside.length} 間門市的排程落在新的活動期間外，請確認後移回尚未安排再儲存。`);
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
    let moved = 0;
    if (outside.length) {
      // 只移除剛才列給使用者確認的那幾間門市（不用日期條件大量刪除）。
      const gone = await ctx.admin.from("campaign_schedules").delete().eq("campaign_id", body.id).in("store_id", outside.map((o) => o.store_id)).select("store_id");
      if (gone.error) throw new WorkspaceError(500, "活動期間已更新，但移回尚未安排未完成，請重新整理後再按一次儲存。");
      moved = (gone.data || []).length;
    }
    return respond({ record, moved });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,CAMPAIGN_EDIT_CODES);
 const p=new URL(request.url).searchParams,id=p.get('id'),version=Number(p.get('version'));
 if(!uuid(id)||!Number.isSafeInteger(version)||version<1)throw new WorkspaceError(400,'活動識別或版本不正確');
 // M5 Q3：所有活動刪除前都要輸入完整活動名稱（伺服器端同樣檢查，不只靠畫面）。
 const target=checked(await ctx.admin.from('campaigns').select('name').eq('id',id).maybeSingle()) as any;
 if(!target)throw new WorkspaceError(409,'活動已變更或刪除，請重新載入核對');
 if(!deleteNameMatches(p.get('confirmName')||'',target.name))throw new WorkspaceError(400,'請輸入完整的活動名稱以確認刪除');
 const record=checked(await ctx.admin.from('campaigns').delete().eq('id',id).eq('workspace_version',version).select('id').maybeSingle());
 if(!record)throw new WorkspaceError(409,'活動已變更或刪除，請重新載入核對');return respond({success:true});
}catch(e){return failed(e);}}
