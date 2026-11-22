// G10 資產掃描 API：GET /assets/scan/:token（QR 永久網址 /general-affairs/assets/scan/{token} 的新版資料來源）。
// 規則（對應舊版 /api/general-affairs/assets/scan/[token]，差異都列在白名單）：
//   400 格式錯誤、401 未登入（由共用 context 回）、404 NOT_FOUND 不存在、404 REVOKED 已作廢（Q8：已報廢／退役／刪除，友善說明）、
//   403 NO_ACCESS 無權限（Q5：白話說明＋該門市店長姓名當聯絡方式，解讀 (l)）、200 成功。
// 欄位經 pickAssetFields：只有設備／設施查看或管理權限者看得到完整欄位；其餘（名單內店長等）只看基本欄位（Q5）。
// 報修按鈕：只有真的能替「這間門市」建需求單的人 canReport 才是 true（有建單權限，且能替任何門市或本人是該門市名單內；舊版只看權限，不看門市）。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { ASSET_TABLE, ASSET_TYPE, pickAssetFields, type AssetKind, type AssetLevel } from "./asset-fields";
import { isValidQrToken } from "./qr-url";
import { SIGNED_URL_SECONDS } from "./upload-rules";
import { GaError, must, respond, rpc, type Context } from "./server";

const BUCKET = "general-affairs-attachments";
const TOKEN_SELECT: Record<AssetKind, string> = {
  equipment: "id,store_id,category_id,name,asset_code,status,area,location_detail,has_warranty,warranty_end_date,onboarding_status,updated_at,brand,model,serial_number,purpose,installed_at,purchased_at,qr_token,qr_token_revoked_at,deleted_at",
  facilities: "id,store_id,category_id,name,facility_code,status,area,location_detail,specs,onboarding_status,updated_at,description,installed_at,purchased_at,last_renovated_at,qr_token,qr_token_revoked_at,deleted_at",
};
const CATEGORY_TABLE: Record<AssetKind, string> = { equipment: "ga_equipment_categories", facilities: "ga_facility_categories" };
const VIEW_PERMS: Record<AssetKind, string[]> = { equipment: [GA.equipmentView, GA.equipmentManage], facilities: [GA.facilityView, GA.facilityManage] };
/** 舊版掃描頁「看全部」的權限（保留：設備／設施查看或管理、需求單與工單全部或管理、門市管理）。 */
const SCAN_VIEW_ALL = [
  GA.equipmentManage, GA.facilityManage, "general_affairs.request.manage", "general_affairs.work_order.manage", "store.manage",
  GA.equipmentView, GA.facilityView, "general_affairs.request.view_all", "general_affairs.maintenance_request.view_all", "general_affairs.work_order.view_all", "cross_dept.maintenance.view_all",
];
/** 與舊版掃描頁、舊版「新增需求」選單相同的建單權限（DEV 的店長角色只有 maintenance_request.create，正式區店長角色另有 request.create）。 */
const REQUEST_CREATE = ["general_affairs.request.create", "general_affairs.maintenance_request.create", "cross_dept.maintenance.submit"];
/** 與舊版 canCreateServiceRequestForAnyStore 相同：可替任何門市建需求單。 */
const CREATE_ANY_STORE = ["general_affairs.request.manage", "store.manage", "employee.manage"];
/** 掃描頁只給現場辨識用的照片：排除發票、收據、保固文件、合約類附件（避免店長看到採購資料）。 */
const NON_PHOTO_PURPOSE = /RECEIPT|INVOICE|WARRANTY|PURCHASE|CONTRACT|QUOTE|BILL/;
const MAX_PHOTOS = 8;

export const SCAN_MESSAGES = {
  notFound: "找不到這個 QR Code 對應的設備或設施。標籤可能不是本系統印製，或資料已被移除，請洽總務確認。",
  revoked: "這個 QR Code 已經作廢：對應的設備或設施已報廢、退役或刪除。請不要再使用這張標籤，需要處理請洽總務。",
  noAccess: "您沒有查看這個設備／設施的權限。它可能屬於其他門市，或不在您帳號可查看的門市範圍內。請聯絡下列人員，或洽總務確認門市與權限設定。",
} as const;

export async function scanApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  if (rest[0] === "scan" && rest[1] && rest.length === 2) return scan(ctx, rest[1]);
  throw new GaError(404, "找不到這個功能");
}

async function findByToken(token: string) {
  const admin: any = adminClient();
  for (const kind of ["equipment", "facilities"] as const) {
    const { data, error } = await admin.from(ASSET_TABLE[kind]).select(TOKEN_SELECT[kind]).eq("qr_token", token).maybeSingle();
    if (error) throw new GaError(503, "資料讀取失敗，請稍後重試");
    if (data) return { kind, row: data as any };
  }
  return null;
}

async function storeManagerNames(storeId: string) {
  const admin: any = adminClient();
  const links = ((await must(admin.from("store_managers").select("user_id,role_type").eq("store_id", storeId).eq("role_type", "store_manager"))) as any[]) || [];
  const ids = Array.from(new Set(links.map((l) => l.user_id).filter(Boolean)));
  if (!ids.length) return [] as { name: string }[];
  const profiles = ((await must(admin.from("profiles").select("id,full_name").in("id", ids))) as any[]) || [];
  return Array.from(new Set(profiles.map((p) => String(p.full_name || "").trim()).filter(Boolean))).sort().map((name) => ({ name }));
}

async function photos(kind: AssetKind, id: string) {
  const admin: any = adminClient();
  const rows = ((await must(
    admin.from("ga_resource_attachments").select("id,purpose,storage_path,file_name,content_type,is_primary,uploaded_at")
      .eq("resource_type", ASSET_TYPE[kind]).eq("resource_id", id).is("deleted_at", null)
      .order("is_primary", { ascending: false }).order("sort_order").order("uploaded_at", { ascending: false }).limit(40),
  )) as any[]) || [];
  const picked = rows.filter((r) => String(r.content_type || "").startsWith("image/") && !NON_PHOTO_PURPOSE.test(String(r.purpose || "").toUpperCase())).slice(0, MAX_PHOTOS);
  const paths = picked.map((r) => r.storage_path);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
    (data || []).forEach((s: any, i: number) => s?.signedUrl && urls.set(paths[i], s.signedUrl));
  }
  return picked.map((r) => ({ id: r.id, purpose: r.purpose, file_name: r.file_name, is_primary: !!r.is_primary, url: urls.get(r.storage_path) || null }));
}

async function recentRepairs(ctx: Context, kind: AssetKind, id: string) {
  // 範圍（看全部或只看自己門市、是否看得到處理人）由資料庫函式判斷；沒有範圍的人（例如只有需求單管理）就不顯示紀錄，不影響掃描本身。
  try {
    const r = await rpc(ctx, "ga_ws_asset_maintenance_history", { p_type: ASSET_TYPE[kind], p_asset_id: id, p_store_id: null, p_status: null, p_search: null, p_from: null, p_to: null, p_limit: 5, p_offset: 0 });
    return { visible: true, total: Number(r.data.total || 0), rows: (r.data.rows || []) as any[] };
  } catch {
    return { visible: false, total: 0, rows: [] as any[] };
  }
}

async function scan(ctx: Context, rawToken: string) {
  const token = String(rawToken || "").trim().toLowerCase();
  if (!isValidQrToken(token)) throw new GaError(400, "QR Code 格式錯誤", { code: "BAD_TOKEN" });
  const found = await findByToken(token);
  if (!found) throw new GaError(404, SCAN_MESSAGES.notFound, { code: "NOT_FOUND" });
  const { kind, row } = found;
  const type = ASSET_TYPE[kind];

  const admin: any = adminClient();
  const memberRows = ((await must(admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id).eq("store_id", row.store_id).limit(1))) as any[]) || [];
  const isMember = memberRows.length > 0;
  const canViewAll = dbCan(ctx.permissions, ...SCAN_VIEW_ALL);
  const fullLevel = dbCan(ctx.permissions, ...VIEW_PERMS[kind]);
  const manage = dbCan(ctx.permissions, kind === "equipment" ? GA.equipmentManage : GA.facilityManage);

  const revoked = !!row.deleted_at || !!row.qr_token_revoked_at;
  if (revoked) {
    // 已作廢：誰掃都回 404 與友善說明；只有看得到這類資產的人才帶資產名稱與（管理者）可恢復的提示。
    const extra: Record<string, unknown> = { code: "REVOKED" };
    if (fullLevel) {
      extra.asset = { type, id: row.id, name: row.name, code: row[kind === "equipment" ? "asset_code" : "facility_code"] || null, status: row.status, deleted: !!row.deleted_at };
      if (manage && !row.deleted_at) extra.canRestore = true;
    }
    throw new GaError(404, SCAN_MESSAGES.revoked, extra);
  }

  const store = row.store_id ? (((await must(admin.from("stores").select("id,store_code,store_name,short_name").eq("id", row.store_id).limit(1))) as any[]) || [])[0] || null : null;
  if (!canViewAll && !isMember) {
    const contacts = await storeManagerNames(row.store_id);
    throw new GaError(403, SCAN_MESSAGES.noAccess, { code: "NO_ACCESS", contacts, storeName: store ? store.short_name || store.store_name : null });
  }

  const level: AssetLevel = fullLevel ? "full" : "basic";
  const category = row.category_id ? (((await must(admin.from(CATEGORY_TABLE[kind]).select("id,name,code").eq("id", row.category_id).limit(1))) as any[]) || [])[0] || null : null;
  const picked = pickAssetFields(kind, { ...row, store, category }, level) as Record<string, any>;
  // 完整層級才多給品牌、型號、序號等；掃描頁不回金額、供應商、備註、QR token（token 本來就在網址裡）。
  const detail: Record<string, any> = {
    id: row.id,
    type,
    code: picked[kind === "equipment" ? "asset_code" : "facility_code"] || null,
    name: picked.name,
    status: picked.status,
    store: picked.store,
    category: picked.category,
    area: picked.area,
    location_detail: picked.location_detail,
    warranty: picked.warranty,
    onboarding_status: picked.onboarding_status,
  };
  if (level === "full") {
    detail.brand = kind === "equipment" ? row.brand : row.specs?.facility_brand ?? null;
    detail.model = kind === "equipment" ? row.model : row.specs?.facility_model ?? null;
    detail.serial_number = kind === "equipment" ? row.serial_number : null;
    detail.installed_at = row.installed_at ?? null;
  }

  const hasCreate = dbCan(ctx.permissions, ...REQUEST_CREATE);
  const canReport = hasCreate && (dbCan(ctx.permissions, ...CREATE_ANY_STORE) || isMember);
  const [photoList, repairs] = await Promise.all([photos(kind, row.id), recentRepairs(ctx, kind, row.id)]);

  return respond({
    data: {
      ...detail,
      token,
      photos: photoList,
      repairs,
      access: { level, scope: manage ? "MANAGE" : canViewAll ? "VIEW_ALL" : "OWN_STORE" },
      canReport,
      // 報修目前連到舊版建單頁（新版需求單頁屬後面批次）。
      reportPath: canReport ? `/general-affairs/reports/new?assetToken=${token}` : null,
      reportReason: canReport ? null : hasCreate ? "您不是這間門市的名單內人員，不能替它建立報修單，請由該門市店長或總務協助。" : "您的帳號沒有建立報修單的權限，請由門市店長或總務協助提出。",
      managementKind: level === "full" ? (kind === "equipment" ? "ga-equipment" : "ga-facilities") : null,
    },
  });
}
