// G10 QR 標籤資料 API（Q9）：GET /qr/labels
// 網域由伺服端環境變數決定（qr-url.ts），不取瀏覽器網址；SVG 在伺服端產生；單次最多 300 張；
// 已報廢／已退役／已刪除／QR 已作廢者排除並說明；沒有編號的仍可印但警告；非正式環境標籤加「測試」浮水印。
// 設備與設施同一套規則（設施標籤列印為解讀 (b)）。權限：該類查看或管理（資料庫語意），店長不能列印。
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { ASSET_TABLE, ASSET_TYPE, type AssetKind } from "./asset-fields";
import { applyLabelLimit, getQrBaseUrl, labelExclusion, labelWatermark, qrUrlFor, QR_LABEL_LIMIT, QrUrlError } from "./qr-url";
import { isUuid, orIlike } from "./rules";
import { GaError, must, respond, type Context } from "./server";

const PERMS: Record<AssetKind, string[]> = { equipment: [GA.equipmentView, GA.equipmentManage], facilities: [GA.facilityView, GA.facilityManage] };
const CODE_COLUMN: Record<AssetKind, string> = { equipment: "asset_code", facilities: "facility_code" };
const CATEGORY_TABLE: Record<AssetKind, string> = { equipment: "ga_equipment_categories", facilities: "ga_facility_categories" };
const TERMINAL: Record<AssetKind, string> = { equipment: "SCRAPPED", facilities: "RETIRED" };
const NOUN: Record<AssetKind, string> = { equipment: "設備", facilities: "設施" };
const MAX_IDS = 150; // 網址長度限制（每個 id 37 字元）；更多請改用篩選條件
const EXCLUDED_SAMPLE = 20;

export async function qrApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  if (rest[0] === "labels" && rest.length === 1) return labels(ctx, new URL(request.url));
  throw new GaError(404, "找不到這個功能");
}

function kindOf(value: string | null): AssetKind {
  const v = (value || "").trim().toLowerCase();
  if (v === "equipment") return "equipment";
  if (v === "facility" || v === "facilities") return "facilities";
  throw new GaError(400, "請指定資產類型（equipment 或 facility）");
}

async function categoryWithDescendants(kind: AssetKind, id: string) {
  const rows = ((await must((adminClient() as any).from(CATEGORY_TABLE[kind]).select("id,parent_id").is("deleted_at", null).range(0, 4999))) as any[]) || [];
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) || []), r.id]);
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const c of children.get(stack.pop()!) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
  return Array.from(out);
}

async function labels(ctx: Context, url: URL) {
  const kind = kindOf(url.searchParams.get("type"));
  if (!dbCan(ctx.permissions, ...PERMS[kind])) throw new GaError(403, `沒有${NOUN[kind]}標籤列印權限`);
  const type = ASSET_TYPE[kind];
  const p = url.searchParams;
  // 先確認網域設定：缺值就直接擋下，不查資料也不產出任何標籤。
  let baseUrl: string;
  try {
    baseUrl = getQrBaseUrl();
  } catch (e) {
    if (e instanceof QrUrlError) throw new GaError(e.status, e.message, { code: "QR_CONFIG" });
    throw e;
  }
  const watermark = labelWatermark();

  const ids = Array.from(new Set((p.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean)));
  const storeId = (p.get("storeId") || "").trim();
  const categoryId = (p.get("categoryId") || "").trim();
  if (ids.some((i) => !isUuid(i))) throw new GaError(400, "資產 id 格式錯誤");
  if (ids.length > MAX_IDS) throw new GaError(400, `一次最多指定 ${MAX_IDS} 筆，請改用篩選條件`);
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市 id 格式錯誤");
  if (categoryId && !isUuid(categoryId)) throw new GaError(400, "分類 id 格式錯誤");

  const admin: any = adminClient();
  const code = CODE_COLUMN[kind];
  const select = `id,name,${code},status,deleted_at,qr_token,qr_token_revoked_at,store_id,category_id`;
  let rows: any[] = [];
  const excludedRows: any[] = [];
  let excludedTotal = 0;
  let matched = 0;
  let missing: { id: string; name: string; reason: string; message: string }[] = [];
  const toCandidate = (r: any) => ({ id: r.id, name: r.name, code: r[code], status: r.status, deleted_at: r.deleted_at, qr_token: r.qr_token, qr_token_revoked_at: r.qr_token_revoked_at });

  if (ids.length) {
    const found = ((await must(admin.from(ASSET_TABLE[kind]).select(select).in("id", ids))) as any[]) || [];
    const byId = new Map(found.map((r) => [r.id, r]));
    missing = ids.filter((i) => !byId.has(i)).map((i) => ({ id: i, name: "（找不到）", reason: "NOT_FOUND", message: "找不到這筆資料" }));
    for (const r of found) {
      const ex = labelExclusion(type, toCandidate(r));
      if (ex) excludedRows.push(ex);
      else rows.push(r);
    }
    matched = rows.length;
    excludedTotal = excludedRows.length + missing.length;
  } else {
    const apply = (q: any) => {
      q = q.is("deleted_at", null);
      const search = (p.get("q") || p.get("search") || "").trim();
      if (search) q = q.or(orIlike(["name", code], search));
      if (storeId) q = q.eq("store_id", storeId);
      const status = (p.get("status") || "").trim();
      if (status) q = q.eq("status", status);
      return q;
    };
    const categoryIds = categoryId ? await categoryWithDescendants(kind, categoryId) : null;
    const withCategory = (q: any) => (categoryIds ? q.in("category_id", categoryIds) : q);
    const printable = withCategory(apply(admin.from(ASSET_TABLE[kind]).select(select, { count: "exact" })))
      .is("qr_token_revoked_at", null).not("qr_token", "is", null).neq("status", TERMINAL[kind])
      .order(code, { ascending: true, nullsFirst: false }).order("name").order("id").range(0, QR_LABEL_LIMIT - 1);
    const blocked = withCategory(apply(admin.from(ASSET_TABLE[kind]).select(select, { count: "exact" })))
      .or(`qr_token_revoked_at.not.is.null,qr_token.is.null,status.eq.${TERMINAL[kind]}`).order("name").order("id").range(0, EXCLUDED_SAMPLE - 1);
    const [a, b] = await Promise.all([printable, blocked]);
    if (a.error || b.error) throw new GaError(503, "資料讀取失敗，請稍後重試");
    rows = a.data || [];
    matched = a.count || 0;
    excludedTotal = b.count || 0;
    for (const r of b.data || []) {
      const ex = labelExclusion(type, toCandidate(r));
      if (ex) excludedRows.push(ex);
    }
  }

  const limited = applyLabelLimit(rows);
  const truncated = limited.truncated || matched > limited.items.length;
  const storeIds = Array.from(new Set(limited.items.map((r) => r.store_id).filter(Boolean)));
  const stores = storeIds.length ? (((await must(admin.from("stores").select("id,store_code,store_name,short_name").in("id", storeIds))) as any[]) || []) : [];
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const items = await Promise.all(
    limited.items.map(async (r) => {
      const qrUrl = qrUrlFor(r.qr_token);
      const svg = await QRCode.toString(qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      const s: any = storeById.get(r.store_id);
      const assetCode = String(r[code] || "").trim() || null;
      return {
        id: r.id, type, name: r.name, code: assetCode, storeCode: s?.store_code ?? null, storeName: s ? s.short_name || s.store_name : null,
        qrUrl, svg, warnings: assetCode ? [] : ["NO_CODE"],
      };
    }),
  );
  items.sort((a, b) => String(a.storeCode ?? "").localeCompare(String(b.storeCode ?? "")) || String(a.code ?? "￿").localeCompare(String(b.code ?? "￿")));

  return respond({
    items,
    excluded: [...excludedRows, ...missing].slice(0, EXCLUDED_SAMPLE),
    excludedTotal,
    watermark,
    baseUrl,
    limit: QR_LABEL_LIMIT,
    truncated,
    matched,
    noCodeCount: items.filter((i) => i.warnings.includes("NO_CODE")).length,
  });
}
