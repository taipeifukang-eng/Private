import { checked, respond, uuid, WorkspaceError, type Context } from "./server";
import { cleanSearch, escapeLike, orContains } from "../products-master/rules";
import {
  activeCodeSet,
  addDays,
  canDeleteReport,
  canReportForStore,
  canRespondTo,
  canSeeAll,
  canSubmitAny,
  clampPage,
  clampPageSize,
  defaultTab,
  deriveStatus,
  DUPLICATE_WINDOW_DAYS,
  findRecentDuplicate,
  HISTORY_PAGE_MAX,
  HISTORY_PAGE_SIZE,
  isResponseActive,
  monthRange,
  recentStart,
  REPORT_PAGE_MAX,
  REPORT_PAGE_SIZE,
  shouldShowReminder,
  taipeiDate,
  taipeiMonthKey,
  validateReport,
  validateResponse,
  type Caps,
} from "../stockout/response";

// M6 W29：workspace 缺貨回報 API 的伺服端邏輯（路由在 app/api/workspace/stockout/[[...path]]）。
// 權限碼沿用舊版三個：cross_dept.stockout.submit／view_all／respond，由 caps() 轉成 capabilities 回傳。
// 讀寫一律用 admin client，權限與門市範圍在這一層判斷（正式區 has_permission 語意，見 context()）。
export const STOCKOUT_CODES = {
  submit: "cross_dept.stockout.submit",
  viewAll: "cross_dept.stockout.view_all",
  respond: "cross_dept.stockout.respond",
} as const;
export const stockoutCaps = (ctx: Context): Caps => ({
  submit: ctx.has(STOCKOUT_CODES.submit),
  viewAll: ctx.has(STOCKOUT_CODES.viewAll),
  respond: ctx.has(STOCKOUT_CODES.respond),
});
const RESPONSE_COLUMNS = "id,product_code,product_name,response_content,responded_by,responded_at,eta_date";
const MAX_CODES = 100;
const LIGHT_PAGE = 1000;

type Body = Record<string, unknown>;
async function readBody(request: Request): Promise<Body> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkspaceError(400, "請求內容格式不正確");
  return body as Body;
}
const today = () => taipeiDate(new Date());

type StoreRow = { id: string; store_code: string; store_name: string };
/** 登入者管轄的門市（store_managers），依門市代號排序。 */
async function managedStores(ctx: Context): Promise<StoreRow[]> {
  const rows = checked(await ctx.admin.from("store_managers").select("store_id, stores(id, store_code, store_name)").eq("user_id", ctx.user.id)) as any[] | null;
  const out: StoreRow[] = [];
  for (const r of rows || []) {
    const s = Array.isArray(r.stores) ? r.stores[0] : r.stores;
    if (s) out.push({ id: s.id, store_code: s.store_code, store_name: s.store_name });
  }
  return out.sort((a, b) => a.store_code.localeCompare(b.store_code));
}
const noAccess = () => new WorkspaceError(403, "沒有權限");

async function allResponses(ctx: Context) {
  return (checked(await ctx.admin.from("stockout_product_responses").select(RESPONSE_COLUMNS).order("responded_at", { ascending: false })) as any[] | null) || [];
}
/** 回覆加上即時判斷：active（算已回覆）、reminder（仍顯示提醒）。 */
const flag = (r: any, t: string) => ({ ...r, active: isResponseActive(r, t), reminder: shouldShowReminder(r, t) });

/** GET ?tab=&store_id=&q=&status=&month=&date_range=&page=&pageSize=：回報清單（每頁 30、上限 100），狀態由目前有效回覆即時算出。 */
export async function listReports(ctx: Context, params: URLSearchParams) {
  const caps = stockoutCaps(ctx);
  if (!canSubmitAny(caps)) throw noAccess();
  const t = today();
  const stores = await managedStores(ctx);
  const managedIds = stores.map((s) => s.id);
  const tab = params.get("tab") === "my-store" ? "my-store" : params.get("tab") === "all" ? "all" : defaultTab(caps);
  const storeId = params.get("store_id");
  if (storeId && !uuid(storeId)) throw new WorkspaceError(400, "門市識別碼不正確");
  if (tab === "all" && !canSeeAll(caps)) throw new WorkspaceError(403, "沒有查看所有門市回報的權限");
  // 門市範圍（與舊版不同，m6-w29-list-store-scope）：只有提交權限的人只能看自己管轄的門市。
  if (storeId && !canSeeAll(caps) && !managedIds.includes(storeId)) throw new WorkspaceError(403, "沒有權限查看這間門市的回報");
  const q = cleanSearch(params.get("q"));
  const status = params.get("status");
  const month = params.get("month");
  const useRecent = params.get("date_range") === "recent_30";
  const range = month ? monthRange(month) : null;
  const page = clampPage(params.get("page"));
  const pageSize = clampPageSize(params.get("pageSize"), REPORT_PAGE_SIZE, REPORT_PAGE_MAX);
  const base = { capabilities: caps, defaultTab: defaultTab(caps), tab, stores, today: t };

  const scopeIds = storeId ? [storeId] : tab === "my-store" ? managedIds : null;
  if (scopeIds && scopeIds.length === 0) {
    return respond({ success: true, ...base, items: [], responses: {}, pagination: { page: 1, pageSize, total: 0, totalPages: 1 }, monthBuckets: [], stats: { reports: 0, pendingProducts: 0, respondedProducts: 0 } });
  }

  // 1) 符合門市與關鍵字的輕量資料（編號、時間、門市），分段讀完（每段 1000 筆）
  const light: { id: string; product_code: string; created_at: string; store_id: string }[] = [];
  for (let from = 0; ; from += LIGHT_PAGE) {
    let query = ctx.admin.from("stockout_reports").select("id,product_code,created_at,store_id").order("created_at", { ascending: false }).order("id", { ascending: false });
    if (scopeIds) query = scopeIds.length === 1 ? query.eq("store_id", scopeIds[0]) : query.in("store_id", scopeIds);
    if (q) query = query.or(orContains(escapeLike(q)));
    const part = checked(await query.range(from, from + LIGHT_PAGE - 1)) as any[] | null;
    light.push(...(part || []));
    if (!part || part.length < LIGHT_PAGE) break;
  }
  const responses = await allResponses(ctx);
  const active = activeCodeSet(responses, t);
  const byStatus = status === "pending" || status === "responded" ? light.filter((r) => deriveStatus(r.product_code, active) === status) : light;
  const inDate = (r: { created_at: string }) => {
    const at = Date.parse(r.created_at);
    if (useRecent) return at >= Date.parse(recentStart(t));
    if (range) return at >= Date.parse(range.start) && at < Date.parse(range.end);
    return true;
  };
  // 月份彙總（歷史月份折疊）：套用門市、關鍵字、狀態，不套日期；月份一律用台北時間
  const bucketMap = new Map<string, number>();
  for (const r of byStatus) bucketMap.set(taipeiMonthKey(r.created_at), (bucketMap.get(taipeiMonthKey(r.created_at)) ?? 0) + 1);
  const monthBuckets = Array.from(bucketMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([m, count]) => ({ month: m, count }));
  // 統計：套用門市、關鍵字、日期，不套狀態；待回覆與已回覆都是「品項數」，由目前有效回覆算出
  const forStats = light.filter(inDate);
  const codes = new Set(forStats.map((r) => r.product_code));
  const stats = { reports: forStats.length, pendingProducts: Array.from(codes).filter((c) => !active.has(c)).length, respondedProducts: Array.from(codes).filter((c) => active.has(c)).length };

  const matched = byStatus.filter(inDate);
  const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
  const slice = matched.slice((page - 1) * pageSize, page * pageSize);
  let items: any[] = [];
  if (slice.length) {
    const rows = (checked(await ctx.admin.from("stockout_reports").select("id,store_id,product_code,product_name,required_qty,reported_by,status,created_at,store:stores(id,store_code,store_name)").in("id", slice.map((r) => r.id))) as any[] | null) || [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    items = slice.map((l) => byId.get(l.id)).filter(Boolean).map((r) => ({ ...r, store: Array.isArray(r.store) ? r.store[0] ?? null : r.store ?? null, status: deriveStatus(r.product_code, active) }));
  }
  const pageCodes = new Set(items.map((r) => r.product_code));
  const responseMap: Record<string, unknown> = {};
  for (const r of responses) if (pageCodes.has(r.product_code)) responseMap[r.product_code] = flag(r, t);
  return respond({ success: true, ...base, items, responses: responseMap, pagination: { page, pageSize, total: matched.length, totalPages }, monthBuckets, stats });
}

/** GET responses?product_codes=a,b：商品部回覆（任何有權限者；不帶 product_codes 回全部，與舊版相同）。 */
export async function getResponses(ctx: Context, params: URLSearchParams) {
  if (!canSubmitAny(stockoutCaps(ctx))) throw noAccess();
  const t = today();
  const codesParam = params.get("product_codes");
  let rows: any[];
  if (codesParam) {
    const codes = Array.from(new Set(codesParam.split(",").map((c) => c.trim()).filter(Boolean))).slice(0, MAX_CODES);
    rows = codes.length ? ((checked(await ctx.admin.from("stockout_product_responses").select(RESPONSE_COLUMNS).in("product_code", codes).order("responded_at", { ascending: false })) as any[] | null) || []) : [];
  } else rows = await allResponses(ctx);
  return respond({ success: true, data: rows.map((r) => flag(r, t)) });
}

/** GET history?product_code=&page=&pageSize=：回覆歷程（每頁 10、上限 50）。 */
export async function getHistory(ctx: Context, params: URLSearchParams) {
  if (!canSubmitAny(stockoutCaps(ctx))) throw noAccess();
  const code = params.get("product_code")?.trim();
  if (!code) throw new WorkspaceError(400, "缺少 product_code");
  const page = clampPage(params.get("page"));
  const pageSize = clampPageSize(params.get("pageSize"), HISTORY_PAGE_SIZE, HISTORY_PAGE_MAX);
  const res = await ctx.admin
    .from("stockout_product_response_history")
    .select("id,product_code,product_name,response_content,responded_by,responded_at,eta_date", { count: "exact" })
    .eq("product_code", code)
    .order("responded_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  const data = checked(res as any) as any[] | null;
  const total = (res as any).count ?? 0;
  return respond({ success: true, data: data || [], pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}

/** POST：新增缺貨回報。伺服端驗證門市範圍（b）；同門市同商品 7 天內已回報過時回 409，帶 confirm_duplicate:true 才會送出（C6）。 */
export async function submitReport(ctx: Context, request: Request) {
  const caps = stockoutCaps(ctx);
  if (!canSubmitAny(caps)) throw new WorkspaceError(403, "沒有提交缺貨回報的權限");
  const body = await readBody(request);
  const v = validateReport(body as any);
  if (!v.ok) throw new WorkspaceError(400, v.message);
  const r = v.value;
  if (!uuid(r.store_id)) throw new WorkspaceError(400, "門市識別碼不正確");
  if (!canSeeAll(caps)) {
    const managed = (await managedStores(ctx)).map((s) => s.id);
    if (!canReportForStore(caps, r.store_id, managed)) throw new WorkspaceError(403, "只能回報自己管轄的門市");
  } else {
    const store = checked(await ctx.admin.from("stores").select("id").eq("id", r.store_id).maybeSingle());
    if (!store) throw new WorkspaceError(400, "找不到這間門市");
  }
  const t = today();
  const sinceIso = `${addDays(t, -DUPLICATE_WINDOW_DAYS)}T00:00:00+08:00`;
  const recent = (checked(await ctx.admin.from("stockout_reports").select("store_id,product_code,created_at,required_qty").eq("store_id", r.store_id).eq("product_code", r.product_code).gte("created_at", sinceIso)) as any[] | null) || [];
  const dup = findRecentDuplicate(recent, r.store_id, r.product_code, t);
  if (dup && body.confirm_duplicate !== true) {
    return respond(
      { error: `這間門市在 ${DUPLICATE_WINDOW_DAYS} 天內已回報過這個商品（${taipeiDate(dup.created_at)}，需求 ${dup.required_qty} 件），確定仍要再送出嗎？`, code: "DUPLICATE_RECENT", duplicate: { created_at: dup.created_at, required_qty: dup.required_qty } },
      409,
    );
  }
  const existing = checked(await ctx.admin.from("stockout_product_responses").select("id,eta_date").eq("product_code", r.product_code).maybeSingle()) as any;
  const status = isResponseActive(existing, t) ? "responded" : "pending";
  const ins = await ctx.admin.from("stockout_reports").insert({ ...r, reported_by: ctx.user.id, status }).select().single();
  return respond({ success: true, data: checked(ins as any) }, 201);
}

/** DELETE :id：商品部（view_all／respond）可刪任意，其餘只能刪自己的；該商品已無任何回報時，一併清掉目前回覆（歷程保留），規則同舊版。 */
export async function deleteReport(ctx: Context, id: string) {
  // 與舊版相同：沒有另外的權限閘門，只看「本人的回報」或「商品部（view_all／respond）」；其他一律 404
  const caps = stockoutCaps(ctx);
  if (!uuid(id)) throw new WorkspaceError(400, "缺少 id");
  // 先查再刪只是為了用共用規則函式預判；真正的條件（本人或商品部）在資料庫函式內再檢查一次
  const row = checked(await ctx.admin.from("stockout_reports").select("reported_by").eq("id", id).maybeSingle()) as any;
  if (!row || !canDeleteReport(caps, row.reported_by, ctx.user.id)) throw new WorkspaceError(404, "找不到可刪除的缺貨回報");
  const res = await ctx.admin.rpc("workspace_stockout_delete_report", { p_id: id, p_user: ctx.user.id, p_can_manage: canSeeAll(caps) });
  const out = checked(res as any) as any;
  if (!out?.found) throw new WorkspaceError(404, "找不到可刪除的缺貨回報");
  return respond({ success: true, clearedResponse: !!out.cleared });
}

/** POST respond：商品部回覆（以商品編號 upsert）。回覆與歷程在同一個資料庫交易內寫入。 */
export async function saveResponse(ctx: Context, request: Request) {
  if (!canRespondTo(stockoutCaps(ctx))) throw new WorkspaceError(403, "沒有回覆缺貨商品的權限");
  const v = validateResponse((await readBody(request)) as any);
  if (!v.ok) throw new WorkspaceError(400, v.message);
  const r = v.value;
  const res = await ctx.admin.rpc("workspace_stockout_respond", { p_code: r.product_code, p_name: r.product_name, p_content: r.response_content, p_eta: r.eta_date, p_user: ctx.user.id });
  if ((res as any).error) {
    if (String((res as any).error.message || "").includes("MISSING_FIELDS")) throw new WorkspaceError(400, "缺少必要欄位");
    throw new WorkspaceError(503, "資料讀取或寫入失敗，請稍後重試");
  }
  return respond({ success: true, data: (res as any).data });
}

/** DELETE responses/:code：刪除商品部目前回覆（規則同舊版 API；舊版畫面沒有這個按鈕，新版畫面也沒有，m6-w29 g）。 */
export async function deleteResponse(ctx: Context, code: string) {
  if (!canRespondTo(stockoutCaps(ctx))) throw new WorkspaceError(403, "沒有刪除權限");
  const c = (code || "").trim();
  if (!c) throw new WorkspaceError(400, "缺少 product_code");
  checked(await ctx.admin.from("stockout_product_responses").delete().eq("product_code", c) as any);
  return respond({ success: true });
}
