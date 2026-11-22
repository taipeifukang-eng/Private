import {
  checked,
  respond,
  requireCapability,
  WorkspaceError,
  uuid,
  type Context,
} from "./server";
import { moduleCodes } from "./modules";
import {
  chunk,
  cleanSearch,
  escapeLike,
  IMPORT_BATCH_SIZE,
  LIST_PAGE_SIZE,
  MAX_CODE_LENGTH,
  MAX_IMPORT_ROWS,
  MAX_NAME_LENGTH,
  MAX_UNIT_LENGTH,
  mergeSearch,
  orContains,
  planImport,
  sanitizeInputs,
  SEARCH_CONTAINS_LIMIT,
  SEARCH_LIMIT,
  type ExistingProduct,
  type ImportPlan,
} from "../products-master/rules";

// M6 W27/W28：workspace 商品主檔 API 的伺服端邏輯（路由在 app/api/workspace/products-master/[[...path]]）。
// 權限：搜尋登入即可（B1）；清單、新增、編輯、停用、重新啟用、匯入需 store.products_master.manage（B2、B3）。
// 讀寫一律用 admin client（資料表 RLS 只放行管理權限者，搜尋要對所有登入者開放，所以權限在這一層判斷）。
export const MANAGE = moduleCodes.productsMaster;
const COLUMNS = "id,product_code,product_name,unit,is_active";

type Body = Record<string, unknown>;
async function readBody(request: Request): Promise<Body> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkspaceError(400, "請求內容格式不正確");
  return body as Body;
}
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function log(ctx: Context, action: string, productCode: string | null, rowCount: number, detail: Record<string, unknown>) {
  const res = await ctx.admin.from("products_master_operation_logs").insert({ action, actor_id: ctx.user.id, product_code: productCode, row_count: rowCount, detail });
  if (res.error) throw new WorkspaceError(503, "操作紀錄寫入失敗，請稍後重試");
}

/** GET search?q=：登入即可。編號開頭優先、再補名稱或編號包含，最多 20 筆，只含啟用商品。 */
export async function searchProducts(ctx: Context, qRaw: string | null) {
  const q = cleanSearch(qRaw);
  if (!q) return respond({ success: true, data: [] });
  const esc = escapeLike(q);
  const base = () => ctx.admin.from("products_master").select("product_code,product_name,unit").eq("is_active", true);
  const [prefix, contains] = await Promise.all([
    base().ilike("product_code", `${esc}%`).order("product_code").limit(SEARCH_LIMIT),
    // 「編號或名稱包含、但編號不是開頭」：和舊版同一個 or 查詢，但值用雙引號包起來（見 orContains），特殊字元不會改寫條件。
    base().or(orContains(esc)).not("product_code", "ilike", `${esc}%`).order("product_code").limit(SEARCH_CONTAINS_LIMIT),
  ]);
  return respond({ success: true, data: mergeSearch(checked(prefix) || [], checked(contains) || []).map((r) => ({ product_code: r.product_code, product_name: r.product_name, unit: r.unit })) });
}

/** GET ?page=&q=&include_inactive=1：每頁 50 筆，預設只顯示啟用商品；頁碼超出範圍時回最後一頁。 */
export async function listProducts(ctx: Context, params: URLSearchParams) {
  requireCapability(ctx, MANAGE);
  const q = cleanSearch(params.get("q"));
  const includeInactive = params.get("include_inactive") === "1";
  const requestedPage = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const build = (head: boolean) => {
    let query = ctx.admin.from("products_master").select(COLUMNS, head ? { count: "exact", head: true } : undefined);
    if (!includeInactive) query = query.eq("is_active", true);
    if (q) query = query.or(orContains(escapeLike(q)));
    return query;
  };
  const counted = await build(true);
  if (counted.error) throw new WorkspaceError(503, "資料讀取或寫入失敗，請稍後重試");
  const total = counted.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const from = (page - 1) * LIST_PAGE_SIZE;
  const items = checked((await build(false).order("product_code").range(from, from + LIST_PAGE_SIZE - 1)) as any) as any[] | null;
  return respond({ items: items || [], total, page, pageSize: LIST_PAGE_SIZE, pageCount, capabilities: { manage: true } });
}

function validateFields(body: Body) {
  const name = text(body.product_name);
  const unit = text(body.unit);
  if (!name) throw new WorkspaceError(400, "請輸入商品名稱");
  if (name.length > MAX_NAME_LENGTH) throw new WorkspaceError(400, `商品名稱最多 ${MAX_NAME_LENGTH} 字`);
  if (unit.length > MAX_UNIT_LENGTH) throw new WorkspaceError(400, `單位最多 ${MAX_UNIT_LENGTH} 字`);
  return { name, unit };
}

export async function createProduct(ctx: Context, request: Request) {
  requireCapability(ctx, MANAGE);
  const body = await readBody(request);
  const code = text(body.product_code);
  if (!code) throw new WorkspaceError(400, "請輸入商品編號");
  if (code.length > MAX_CODE_LENGTH) throw new WorkspaceError(400, `商品編號最多 ${MAX_CODE_LENGTH} 字`);
  const { name, unit } = validateFields(body);
  const exists = checked(await ctx.admin.from("products_master").select("id").eq("product_code", code).maybeSingle());
  if (exists) throw new WorkspaceError(409, "此商品編號已存在");
  const ins = await ctx.admin.from("products_master").insert({ product_code: code, product_name: name, unit, is_active: true }).select(COLUMNS).single();
  if (ins.error) {
    if ((ins.error as any).code === "23505") throw new WorkspaceError(409, "此商品編號已存在");
    throw new WorkspaceError(503, "資料讀取或寫入失敗，請稍後重試");
  }
  await log(ctx, "create", code, 1, { name, unit });
  return respond({ success: true, product: ins.data }, 201);
}

async function findById(ctx: Context, id: string) {
  if (!uuid(id)) throw new WorkspaceError(400, "商品識別碼不正確");
  const row = checked(await ctx.admin.from("products_master").select(COLUMNS).eq("id", id).maybeSingle()) as any;
  if (!row) throw new WorkspaceError(404, "找不到這個商品");
  return row as { id: string; product_code: string; product_name: string; unit: string; is_active: boolean };
}

/** PATCH :id：編號不可改，只能改名稱、單位。 */
export async function editProduct(ctx: Context, request: Request, id: string) {
  requireCapability(ctx, MANAGE);
  const body = await readBody(request);
  const cur = await findById(ctx, id);
  if (body.product_code !== undefined && text(body.product_code) !== cur.product_code) throw new WorkspaceError(400, "商品編號不可修改");
  const { name, unit } = validateFields(body);
  const upd = checked(
    await ctx.admin.from("products_master").update({ product_name: name, unit, updated_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).single(),
  );
  await log(ctx, "update", cur.product_code, 1, { from: { name: cur.product_name, unit: cur.unit }, to: { name, unit } });
  return respond({ success: true, product: upd });
}

/** POST :id/deactivate、:id/reactivate：只有管理權限者。已是目標狀態時不重複寫入也不留紀錄。 */
export async function setActive(ctx: Context, id: string, active: boolean) {
  requireCapability(ctx, MANAGE);
  const cur = await findById(ctx, id);
  if (cur.is_active === active) return respond({ success: true, changed: false, product: cur });
  const upd = checked(
    await ctx.admin.from("products_master").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).single(),
  );
  await log(ctx, active ? "reactivate" : "deactivate", cur.product_code, 1, { name: cur.product_name });
  return respond({ success: true, changed: true, product: upd });
}

// 讀現有資料時 in() 的編號放在網址裡，一次 500 個太長會被拒絕，所以用較小的批次（100）並分組並行。
const LOOKUP_CHUNK = 100;
async function loadExisting(ctx: Context, codes: string[]): Promise<Map<string, ExistingProduct>> {
  const map = new Map<string, ExistingProduct>();
  const parts = chunk(codes, LOOKUP_CHUNK);
  for (let i = 0; i < parts.length; i += 5) {
    const results = await Promise.all(
      parts.slice(i, i + 5).map((part) => ctx.admin.from("products_master").select("product_code,product_name,unit,is_active").in("product_code", part)),
    );
    for (const res of results) for (const r of (checked(res as any) as ExistingProduct[] | null) || []) map.set(r.product_code, r);
  }
  return map;
}
async function buildPlan(ctx: Context, request: Request): Promise<ImportPlan> {
  requireCapability(ctx, MANAGE);
  const body = await readBody(request);
  const inputs = sanitizeInputs(body.rows);
  if (!inputs) throw new WorkspaceError(400, "缺少匯入資料");
  if (!inputs.length) throw new WorkspaceError(400, "Excel 無資料");
  if (inputs.length > MAX_IMPORT_ROWS) throw new WorkspaceError(400, `單次最多匯入 ${MAX_IMPORT_ROWS} 筆，請分檔匯入`);
  if (!inputs.some((r) => r.code && r.name))
    throw new WorkspaceError(400, "找不到有效資料，請確認欄位名稱（商品編號、商品名稱、單位）");
  const codes = Array.from(new Set(inputs.map((r) => r.code).filter(Boolean)));
  return planImport(inputs, await loadExisting(ctx, codes));
}

const planView = (plan: ImportPlan) => ({
  counts: plan.counts,
  inserts: plan.inserts.slice(0, 200),
  updates: plan.updates.slice(0, 200),
  skipped: plan.skipped.slice(0, 500),
  truncated: plan.inserts.length > 200 || plan.updates.length > 200 || plan.skipped.length > 500,
});

/** POST import/preview：只計算，不寫入。 */
export async function previewImport(ctx: Context, request: Request) {
  return respond({ success: true, ...planView(await buildPlan(ctx, request)) });
}

/** POST import：確認後寫入，每 500 筆一批；以寫入當下的資料重新計算（預覽之後別人可能改過）。 */
export async function commitImport(ctx: Context, request: Request) {
  const plan = await buildPlan(ctx, request);
  const now = new Date().toISOString();
  const records = [
    ...plan.inserts.map((r) => ({ product_code: r.code, product_name: r.name, unit: r.unit, is_active: true, updated_at: now })),
    ...plan.updates.map((r) => ({ product_code: r.code, product_name: r.name, unit: r.unit, is_active: true, updated_at: now })),
  ];
  let written = 0;
  for (const part of chunk(records, IMPORT_BATCH_SIZE)) {
    const res = await ctx.admin.from("products_master").upsert(part, { onConflict: "product_code" });
    if (res.error) {
      await log(ctx, "import", null, written, { failed: true, written, planned: records.length }).catch(() => {});
      throw new WorkspaceError(503, `匯入中斷：已寫入 ${written} 筆，其餘未寫入，可重新匯入同一份檔案（已寫入的會自動略過）`);
    }
    written += part.length;
  }
  await log(ctx, "import", null, written, { counts: plan.counts });
  return respond({ success: true, count: written, counts: plan.counts });
}
