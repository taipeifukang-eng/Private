// G18 工單中心 API（/api/workspace/general-affairs/work-orders/**）。
// 讀取與寫入都走資料庫函式 ga_ws_wo_*（SECURITY DEFINER、has_permission 語意、同交易、鎖列、版本檢查）；本檔負責路由、輸入驗證、白話錯誤、伺服端欄位遮蔽與照片簽名。
// 權限（資料庫語意，無管理員後備）：看＝工單查看（全部或自己門市）；改＝工單更新／管理（只有「查看全部」不能改）；強制結案另需 service_center.force_close；
// 領用料件需工單更新＋庫存交易管理＋料件查看（缺哪個講清楚）；刪除限未受理且未連需求單（回報人只能刪自己的）。
// 共通：非 GET 檢查 Origin（runGa）、未登入 401、寫入帶 expected_updated_at、衝突回 409 STALE、page／pageSize ≤ 100 回 {data,total,meta}、店長端看不到處理人與 INTERNAL 內容。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { signPhotos, checkImages, uploadImages, removeUploaded, WO_BUCKET } from "./work-order-photos";
import {
  maskWorkOrderDetail, maskWorkOrderRow, parseExpected, parseListFilters, shapePrint, validateForceClose, validateIssuePart, validateProgressPayload, validateSupplement, workOrderAbilities,
} from "./work-order-rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

export const abilitiesOf = (ctx: Context) => workOrderAbilities(ctx.permissions, { isAdminProfile: !!ctx.isAdmin });
const idOf = (v: string | undefined) => { if (!isUuid(v)) throw new GaError(400, "工單 id 格式錯誤"); return v as string; };
const done = (r: { data: any }, status = 200) => respond({ data: r.data }, status);

export async function workOrdersApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    throw new GaError(405, "不支援的操作");
  }
  if (a === "summary") {
    if (m === "GET") return summary(ctx, new URL(request.url));
    throw new GaError(405, "不支援的操作");
  }
  const id = idOf(a);
  if (!b) {
    if (m === "GET") return detail(ctx, id);
    if (m === "DELETE") return remove(ctx, request, id);
  }
  if (b === "print" && m === "GET") return print(ctx, id, new URL(request.url));
  if (b === "category" && m === "PATCH") return category(ctx, request, id);
  if (m === "POST") {
    if (b === "progress") return transition(ctx, request, id, "SAVE_PROGRESS");
    if (b === "request-completion") return transition(ctx, request, id, "REQUEST_COMPLETION");
    if (b === "force-close") return transition(ctx, request, id, "FORCE_CLOSE");
    if (b === "request-supplement") return transition(ctx, request, id, "REQUEST_SUPPLEMENT");
    if (b === "store-confirm") return storeConfirm(ctx, request, id);
    if (b === "report-unresolved") return reportUnresolved(ctx, request, id);
    if (b === "reply-supplement") return replySupplement(ctx, request, id);
    if (b === "issue-part") return issuePart(ctx, request, id);
    if (b === "attachments") return attachments(ctx, request, id);
  }
  throw new GaError(404, "找不到這個功能");
}

// ---------------------------------------------------------------- 讀取
async function list(ctx: Context, url: URL) {
  const ab = abilitiesOf(ctx);
  if (!ab.canEnter) throw new GaError(403, "沒有查看工單的權限");
  const filters = validated(() => parseListFilters(url.searchParams));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_wo_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const rows = ((d.rows as any[]) || []).map((row) => maskWorkOrderRow(row, ab.gaSide));
  return respond({ data: rows, total: d.total ?? 0, meta: pagingMeta(page, pageSize, d.total ?? 0), focus_counts: d.focus_counts ?? {}, permissions: ab });
}

async function summary(ctx: Context, url: URL) {
  const ab = abilitiesOf(ctx);
  if (!ab.canEnter) throw new GaError(403, "沒有查看工單的權限");
  const f = validated(() => parseListFilters(url.searchParams));
  const r = await rpc(ctx, "ga_ws_wo_summary", { p_filters: f.status ? { status: f.status } : {} });
  return respond({ data: r.data?.stores ?? [] });
}

async function detail(ctx: Context, id: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.canEnter) throw new GaError(403, "沒有查看工單的權限");
  const r = await rpc(ctx, "ga_ws_wo_get", { p_id: id });
  const d = r.data || {};
  const gaSide = !!d.ga_side;
  const photos = await signPhotos(d.attachments || [], d.legacy_photos || []);
  const { attachments: _a, legacy_photos: _l, ...rest } = maskWorkOrderDetail(d, gaSide);
  return respond({ data: { ...rest, photos }, page_abilities: ab });
}

async function print(ctx: Context, id: string, url: URL) {
  const ab = abilitiesOf(ctx);
  if (!ab.canEnter) throw new GaError(403, "沒有查看工單的權限");
  const want = ["1", "true"].includes((url.searchParams.get("include_internal") || "").toLowerCase());
  if (want && !ab.gaSide) throw new GaError(403, "只有總務端可以列印內部備註");
  const r = await rpc(ctx, "ga_ws_wo_print", { p_id: id, p_include_internal: want });
  const d = r.data || {};
  const photos = await signPhotos(d.attachments || [], d.legacy_photos || []);
  return respond({ data: shapePrint(d, photos, ab.gaSide, want) });
}

// ---------------------------------------------------------------- 寫入
async function transition(ctx: Context, request: NextRequest, id: string, action: "SAVE_PROGRESS" | "REQUEST_COMPLETION" | "FORCE_CLOSE" | "REQUEST_SUPPLEMENT") {
  const b = await body(request);
  const expected = validated(() => parseExpected(b.expected_updated_at));
  const payload = validated(() => {
    if (action === "SAVE_PROGRESS") return validateProgressPayload(b, { notesRequired: true });
    if (action === "REQUEST_COMPLETION") return validateProgressPayload(b, { notesRequired: false });
    if (action === "FORCE_CLOSE") return validateForceClose(b);
    return validateSupplement(b);
  });
  const r = await rpc(ctx, "ga_ws_wo_transition", { p_id: id, p_action: action, p_expected_updated_at: expected, p_payload: payload });
  return done(r);
}

async function storeConfirm(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const expected = validated(() => parseExpected(b.expected_updated_at));
  const note = String(b.note ?? "").trim();
  if (note.length > 2000) throw new GaError(400, "說明不可超過 2000 字");
  return done(await rpc(ctx, "ga_ws_wo_store_confirm", { p_id: id, p_note: note || null, p_expected_updated_at: expected }));
}

async function reportUnresolved(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const expected = validated(() => parseExpected(b.expected_updated_at));
  const reason = String(b.reason ?? b.note ?? "").trim();
  if (!reason) throw new GaError(400, "回報仍有問題必須填寫原因");
  if (reason.length > 2000) throw new GaError(400, "原因不可超過 2000 字");
  return done(await rpc(ctx, "ga_ws_wo_report_unresolved", { p_id: id, p_reason: reason, p_expected_updated_at: expected }));
}

async function replySupplement(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const expected = validated(() => parseExpected(b.expected_updated_at));
  const note = String(b.note ?? "").trim();
  if (!note) throw new GaError(400, "補充資料必須填寫回覆說明");
  if (note.length > 2000) throw new GaError(400, "說明不可超過 2000 字");
  return done(await rpc(ctx, "ga_ws_wo_reply_supplement", { p_id: id, p_note: note, p_expected_updated_at: expected }));
}

async function issuePart(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const p = validated(() => validateIssuePart(b));
  // 版本：資料庫在「同識別重送」時不看版本、直接回原結果，所以這裡只驗格式不強制必填（第一次送出沒帶版本，資料庫會回 400）。
  const expected = String(b.expected_updated_at ?? "").trim();
  if (expected && Number.isNaN(Date.parse(expected))) throw new GaError(400, "版本資訊格式錯誤（expected_updated_at），請重新載入畫面");
  const r = await rpc(ctx, "ga_ws_wo_issue_part", {
    p_id: id, p_location_id: p.location_id, p_part_id: p.part_id, p_quantity: p.quantity, p_input_unit_type: p.input_unit_type, p_reason: p.reason, p_notes: p.notes, p_key: p.key,
    p_expected_updated_at: expected || null,
  });
  return respond({ data: r.data, replay: !!(r as any).idempotent_replay }, r.status === 201 ? 201 : 200);
}

async function remove(ctx: Context, request: NextRequest, id: string) {
  const url = new URL(request.url);
  let raw: unknown = url.searchParams.get("expected_updated_at");
  if (!raw) raw = (await body(request)).expected_updated_at;
  const expected = validated(() => parseExpected(raw));
  return done(await rpc(ctx, "ga_ws_wo_delete", { p_id: id, p_expected_updated_at: expected }));
}

async function category(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const expected = validated(() => parseExpected(b.expected_updated_at));
  const raw = b.category_id;
  const cat = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
  if (cat && !isUuid(cat)) throw new GaError(400, "分類識別碼格式錯誤");
  return done(await rpc(ctx, "ga_ws_wo_category", { p_id: id, p_category_id: cat, p_expected_updated_at: expected }));
}

// ---------------------------------------------------------------- 新照片（共用附件；只收圖片）
const REPORT_PURPOSE = "REPORT_PHOTO";
const PROGRESS_PURPOSE = "PROGRESS_PHOTO";
async function attachments(ctx: Context, request: NextRequest, id: string) {
  let form: FormData;
  try { form = await request.formData(); } catch { throw new GaError(400, "上傳內容格式錯誤，或檔案太大（單檔上限 4MB）"); }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  const updateId = String(form.get("update_id") || "").trim();
  if (updateId && !isUuid(updateId)) throw new GaError(400, "進度紀錄 id 格式錯誤");
  await checkImages(files, 5);
  // 看得到這張工單才往下（看不到 404、沒權限 403，與資料庫函式一致）。
  const got = await rpc(ctx, "ga_ws_wo_get", { p_id: id });
  const wo = got.data?.work_order || {};
  const canUpdate = !!got.data?.abilities && got.data.abilities.read_only === false;
  const isReporter = wo.reported_by === ctx.user.id;
  if (updateId) {
    if (!canUpdate) throw new GaError(403, got.data?.abilities?.read_only_reason || "沒有修改工單的權限，不能上傳進度照片");
    const upd = (await must((adminClient() as any).from("maintenance_updates").select("id").eq("id", updateId).eq("request_id", id).maybeSingle())) as any;
    if (!upd) throw new GaError(404, "找不到這筆進度紀錄");
  } else if (!canUpdate) {
    if (!isReporter) throw new GaError(403, "只有回報人本人或可修改工單的人可以加照片");
    if (wo.status === "COMPLETED") throw new GaError(409, "工單已完成，不能再加照片");
  }
  const resourceType = updateId ? "MAINTENANCE_UPDATE" : "MAINTENANCE_REQUEST";
  const resourceId = updateId || id;
  const purpose = updateId ? PROGRESS_PURPOSE : REPORT_PURPOSE;
  const uploaded: string[] = [];
  try {
    const stored = await uploadImages(files, resourceType, resourceId, purpose, uploaded);
    const records = stored.map((s, i) => ({
      resource_type: resourceType, resource_id: resourceId, purpose, storage_bucket: WO_BUCKET, storage_path: s.path,
      file_name: s.file_name, content_type: s.content_type, size_bytes: s.size_bytes, sort_order: i, metadata: {}, uploaded_by: ctx.user.id,
    }));
    // 以使用者身分寫入：資料庫觸發器用 auth.uid() 檢查附件管理權限（工單更新／管理、回報人、該門市店長），服務身分會被擋。
    const res = await (ctx.auth as any).from("ga_resource_attachments").insert(records);
    if (res.error) throw res.error.message?.includes("RESOURCE_ATTACHMENT_PERMISSION_DENIED") ? new GaError(403, "沒有這張工單的附件管理權限") : dbError(res.error);
    const rows = (await must((adminClient() as any).from("ga_resource_attachments").select("id,resource_type,resource_id,purpose,file_name,content_type,size_bytes,uploaded_at,storage_bucket,storage_path").in("storage_path", stored.map((x) => x.path)).is("deleted_at", null))) as any[];
    const photos = await signPhotos(rows, []);
    return respond({ data: photos }, 201);
  } catch (error) {
    await removeUploaded(uploaded);
    if (error instanceof GaError) throw error;
    throw dbError(error);
  }
}
