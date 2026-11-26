import type { NextRequest } from "next/server";
import { type Context, checked, respond, uuid, WorkspaceError } from "./server";
import {
  canSeeClinicSelfpayMenu,
  resolveAccess,
  seesAllStores,
  type ClinicSelfpayAccess,
} from "../clinic-selfpay/access";
import { parseScreenshotPaths, serializeScreenshotPaths, toYearMonth } from "../clinic-selfpay/common";
import { buildRowDebugSample, extractItems } from "../clinic-selfpay/claim-parser";
import { readClaimRows, readPriceWorkbook } from "../clinic-selfpay/files";
import {
  buildClaimItems,
  buildPriceMap,
  findUnmatched,
  noPriceMessage,
  periodMismatch,
  periodMismatchMessage,
  roundSummary,
  summarize,
  unmatchedMessage,
} from "../clinic-selfpay/margin";
import { parsePriceWorkbook } from "../clinic-selfpay/price-parser";
import { SCREENSHOT_BUCKET, detectImageType, screenshotExt, validateScreenshots } from "../clinic-selfpay/screenshots";

// 診所自費藥毛利（M6 W30）。資料表與舊版 /api/clinic-selfpay/** 完全相同（不建新表）；
// 權限語意為正式區 has_permission（ctx.has：不檢查 roles.is_active、無 DB admin 繞過、只有應用層 profiles.role==='admin' 後備），
// 加上舊版的職稱規則（lib/clinic-selfpay/access.ts）。每個動作都檢查門市範圍。
const MONTH = /^\d{4}-\d{2}$/;
type Store = { id: string; store_code: string; store_name: string };
type Profile = { role: string | null; job_title: string | null };

async function profileOf(ctx: Context): Promise<Profile> {
  const row = checked(await ctx.admin.from("profiles").select("role,job_title").eq("id", ctx.user.id).maybeSingle());
  return { role: (row as any)?.role ?? null, job_title: (row as any)?.job_title ?? null };
}
async function accessOf(ctx: Context) {
  const profile = await profileOf(ctx);
  return { profile, access: resolveAccess(ctx.has, profile.job_title) };
}
/** 給 session 用：選單可見 = 實際能用（D1）。 */
export async function clinicMenuVisible(ctx: Context): Promise<boolean> {
  return canSeeClinicSelfpayMenu((await accessOf(ctx)).access);
}
async function authorizedStores(ctx: Context, profile: Profile): Promise<Store[]> {
  if (seesAllStores(profile.role, profile.job_title)) {
    return (checked(await ctx.admin.from("stores").select("id,store_code,store_name").eq("is_active", true).order("store_code")) || []) as Store[];
  }
  const rows = checked(
    await ctx.admin
      .from("store_managers")
      .select("store_id,stores!inner(id,store_code,store_name)")
      .eq("user_id", ctx.user.id)
      .eq("stores.is_active", true),
  ) as any[];
  const dedup = new Map<string, Store>();
  for (const r of rows || []) {
    const s = Array.isArray(r.stores) ? r.stores[0] : r.stores;
    if (s && !dedup.has(s.id)) dedup.set(s.id, s);
  }
  return Array.from(dedup.values()).sort((a, b) => a.store_code.localeCompare(b.store_code));
}
function need(ok: boolean, message: string) {
  if (!ok) throw new WorkspaceError(403, message);
}
const missing = (message: string) => (message || "").toLowerCase();
const isMissingSelfpayColumn = (m: string) => missing(m).includes("selfpay_drug_name") && (missing(m).includes("does not exist") || missing(m).includes("schema cache"));
const isMissingClosureTable = (m: string) => missing(m).includes("clinic_selfpay_price_month_closures") && (missing(m).includes("does not exist") || missing(m).includes("schema cache"));
const fail = (status: number, message: string, extra: Record<string, unknown> = {}) => respond({ error: message, ...extra }, status);

export async function getPermissions(ctx: Context) {
  const { access } = await accessOf(ctx);
  return respond({ access });
}

export async function getStores(ctx: Context) {
  const { profile, access } = await accessOf(ctx);
  need(access.canUseCalculator || access.canManageMapping, "無診所自費藥毛利計算使用權限");
  return respond({ stores: await authorizedStores(ctx, profile) });
}

export async function listBatches(ctx: Context, params: URLSearchParams) {
  const { profile, access } = await accessOf(ctx);
  need(access.canUseCalculator, "無毛利計算查閱權限");
  const stores = await authorizedStores(ctx, profile);
  if (!stores.length) return respond({ batches: [] });
  const yearMonth = (params.get("year_month") || "").trim();
  const storeId = (params.get("store_id") || "").trim();
  let query = ctx.admin
    .from("clinic_selfpay_claim_batches")
    .select("id, store_id, year_month, clinic_code, clinic_name, period_start, period_end, item_count, total_qty, total_billing_amount, total_gross_profit_amount, imported_at")
    .in("store_id", stores.map((s) => s.id))
    .order("imported_at", { ascending: false })
    .limit(100);
  if (yearMonth) query = query.eq("year_month", yearMonth);
  if (storeId) query = query.eq("store_id", storeId);
  const rows = checked(await query) as any[];
  const byId = new Map(stores.map((s) => [s.id, s]));
  return respond({
    batches: (rows || []).map((row) => ({
      ...row,
      store_code: byId.get(row.store_id)?.store_code || "",
      store_name: byId.get(row.store_id)?.store_name || "",
    })),
  });
}

export async function getBatch(ctx: Context, id: string) {
  const { profile, access } = await accessOf(ctx);
  need(access.canUseCalculator, "無毛利計算查閱權限");
  if (!uuid(id)) throw new WorkspaceError(404, "找不到批次");
  const batch = checked(await ctx.admin.from("clinic_selfpay_claim_batches").select("*").eq("id", id).maybeSingle()) as any;
  if (!batch) throw new WorkspaceError(404, "找不到批次");
  const stores = await authorizedStores(ctx, profile);
  need(stores.some((s) => s.id === batch.store_id), "無此批次查看權限");
  const items = (checked(await ctx.admin.from("clinic_selfpay_claim_items").select("*").eq("batch_id", id).order("line_no", { ascending: true })) || []) as any[];
  const screenshotUrls: string[] = [];
  for (const path of parseScreenshotPaths(batch.screenshot_path)) {
    const { data } = await ctx.admin.storage.from(SCREENSHOT_BUCKET).createSignedUrl(path, 60 * 60);
    if (data?.signedUrl) screenshotUrls.push(data.signedUrl);
  }
  const store = stores.find((s) => s.id === batch.store_id);
  return respond({
    batch: { ...batch, store_code: store?.store_code || "", store_name: store?.store_name || "" },
    items,
    summary: roundSummary(summarize(items)),
    screenshotUrls,
  });
}

export async function deleteBatch(ctx: Context, id: string) {
  const { profile, access } = await accessOf(ctx);
  need(access.canDeleteBatch, "無刪除匯入資料權限");
  if (!uuid(id)) throw new WorkspaceError(404, "找不到批次");
  const batch = checked(await ctx.admin.from("clinic_selfpay_claim_batches").select("id,store_id,screenshot_path").eq("id", id).maybeSingle()) as any;
  if (!batch) throw new WorkspaceError(404, "找不到批次");
  const stores = await authorizedStores(ctx, profile);
  need(stores.some((s) => s.id === batch.store_id), "無此批次刪除權限");
  // 先刪截圖檔再刪資料；刪檔失敗不再默默略過（舊版忽略錯誤，會留下孤兒檔）：回報錯誤並保留批次，可以重試。
  const paths = parseScreenshotPaths(batch.screenshot_path);
  if (paths.length) {
    const removed = await ctx.admin.storage.from(SCREENSHOT_BUCKET).remove(paths);
    if (removed.error) throw new WorkspaceError(502, `截圖檔案刪除失敗，批次沒有刪除，請稍後重試（${removed.error.message}）`);
  }
  checked(await ctx.admin.from("clinic_selfpay_claim_batches").delete().eq("id", id));
  return respond({ deleted: true, removedScreenshots: paths.length });
}

type FileLike = File;
const isFile = (v: unknown): v is FileLike => typeof File !== "undefined" && v instanceof File;
const flag = (v: FormDataEntryValue | null) => v === "1" || v === "true";

export async function importBatch(ctx: Context, request: NextRequest) {
  const { profile, access } = await accessOf(ctx);
  need(access.canUseCalculator, "無毛利計算匯入權限");
  const form = await request.formData();
  const storeId = String(form.get("store_id") || "");
  const yearMonth = String(form.get("year_month") || "");
  const file = form.get("file");
  const screenshotFiles = form.getAll("screenshots").filter(isFile);
  const legacyScreenshot = form.get("screenshot");
  if (isFile(legacyScreenshot)) screenshotFiles.push(legacyScreenshot);
  if (!storeId || !MONTH.test(yearMonth)) throw new WorkspaceError(400, "請提供正確的門市與年月");
  if (!isFile(file)) throw new WorkspaceError(400, "缺少診所自費藥檔案");
  const shotError = validateScreenshots(screenshotFiles);
  if (shotError) throw new WorkspaceError(400, shotError);
  // 伺服端讀檔頭，不信任自報的 File.type；實際格式決定副檔名與 contentType
  const shotPayloads: { buf: Buffer; type: string }[] = [];
  for (const s of screenshotFiles.filter((x) => x.size > 0)) {
    const buf = Buffer.from(await s.arrayBuffer());
    const type = detectImageType(buf);
    if (!type) throw new WorkspaceError(400, `截圖內容不是有效的 png、jpeg、webp 圖片（${s.name || "未命名"}）`);
    shotPayloads.push({ buf, type });
  }
  const stores = await authorizedStores(ctx, profile);
  need(stores.some((s) => s.id === storeId), "無此門市操作權限");

  const parsedFile = readClaimRows(await file.arrayBuffer());
  const parsed = extractItems(parsedFile.rows);
  if (!parsed.items.length) {
    return fail(400, "未解析出藥品明細，請確認檔案格式", {
      code: "NO_ITEMS",
      debug: {
        fileName: file.name,
        sheetName: parsedFile.sheetName,
        totalRows: parsedFile.rows.length,
        source: { b2: parsed.sourceB2Text, b4: parsed.sourceB4Text, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd },
        parseStats: parsed.debugStats,
        rowSample: buildRowDebugSample(parsedFile.rows),
      },
    });
  }

  const inferredYearMonth = toYearMonth(parsed.periodStart);
  const targetYearMonth = inferredYearMonth || yearMonth;
  const priceRows = (checked(
    await ctx.admin
      .from("clinic_selfpay_price_entries")
      .select("id, health_insurance_code, product_code, member_price, cost_price")
      .eq("store_id", storeId)
      .eq("year_month", targetYearMonth),
  ) || []) as any[];
  if (!priceRows.length) {
    return fail(400, noPriceMessage(targetYearMonth), {
      code: "NO_PRICE_MONTH",
      debug: { targetYearMonth, sourceYearMonth: inferredYearMonth, selectedYearMonth: yearMonth, itemCount: parsed.items.length },
    });
  }
  const priceMap = buildPriceMap(priceRows);
  // D2：任何一個藥品在價格主檔找不到就整批擋下，列出缺少的健保代碼與藥名（與舊版相同）。
  const unmatched = findUnmatched(parsed.items, priceMap);
  if (unmatched.length) {
    return fail(400, unmatchedMessage(unmatched), {
      code: "UNMATCHED",
      unmatched,
      debug: { unmatchedCount: unmatched.length, matchedPriceRows: priceRows.length, targetYearMonth },
    });
  }

  // D3：以檔案期間為準；與畫面選的年月不同時要使用者確認後才繼續。
  if (periodMismatch(inferredYearMonth, yearMonth) && !flag(form.get("confirm_period"))) {
    return fail(409, periodMismatchMessage(inferredYearMonth!, yearMonth), {
      code: "PERIOD_MISMATCH",
      fileYearMonth: inferredYearMonth,
      selectedYearMonth: yearMonth,
    });
  }
  // D4：同門市、同月、同診所已有批次時提示；確認後仍新增，舊批次保留。
  let dupQuery = ctx.admin
    .from("clinic_selfpay_claim_batches")
    .select("id, year_month, clinic_code, clinic_name, item_count, total_billing_amount, source_file_name, imported_at")
    .eq("store_id", storeId)
    .eq("year_month", targetYearMonth)
    .order("imported_at", { ascending: false });
  dupQuery = parsed.clinicCode ? dupQuery.eq("clinic_code", parsed.clinicCode) : dupQuery.is("clinic_code", null);
  const existing = (checked(await dupQuery) || []) as any[];
  if (existing.length && !flag(form.get("confirm_duplicate"))) {
    return fail(
      409,
      `這個門市 ${targetYearMonth} 已有診所 ${parsed.clinicCode || "（無代碼）"} 的匯入批次（${existing.length} 筆），再次匯入會新增一個批次，舊批次會保留，確定嗎？`,
      { code: "DUPLICATE_BATCH", existing },
    );
  }

  const uploaded: string[] = [];
  const cleanup = async () => {
    if (uploaded.length) await ctx.admin.storage.from(SCREENSHOT_BUCKET).remove(uploaded);
  };
  try {
    for (const shot of shotPayloads) {
      const path = `${storeId}/${targetYearMonth}/${Date.now()}_${Math.random().toString(36).slice(2)}.${screenshotExt(shot.type)}`;
      const up = await ctx.admin.storage.from(SCREENSHOT_BUCKET).upload(path, shot.buf, { contentType: shot.type, upsert: false });
      if (up.error) throw new WorkspaceError(502, `截圖上傳失敗：${up.error.message}`);
      uploaded.push(path);
    }
    const batch = checked(
      await ctx.admin
        .from("clinic_selfpay_claim_batches")
        .insert({
          store_id: storeId,
          year_month: targetYearMonth,
          clinic_code: parsed.clinicCode,
          clinic_name: parsed.clinicName,
          period_start: parsed.periodStart,
          period_end: parsed.periodEnd,
          screenshot_path: serializeScreenshotPaths(uploaded),
          source_file_name: file.name,
          source_b2_text: parsed.sourceB2Text,
          source_b4_text: parsed.sourceB4Text,
          imported_by: ctx.user.id,
        })
        .select("id, clinic_code, clinic_name, year_month")
        .single(),
    ) as any;
    const claimItems = buildClaimItems(parsed.items, priceMap).map((row) => ({ ...row, batch_id: batch.id }));
    const summary = roundSummary(summarize(claimItems));
    try {
      for (let i = 0; i < claimItems.length; i += 500) {
        checked(await ctx.admin.from("clinic_selfpay_claim_items").insert(claimItems.slice(i, i + 500)));
      }
      checked(
        await ctx.admin
          .from("clinic_selfpay_claim_batches")
          .update({
            item_count: summary.itemCount,
            total_qty: summary.totalQty,
            total_billing_amount: summary.totalBilling,
            total_gross_profit_amount: summary.totalGrossProfit,
          })
          .eq("id", batch.id),
      );
    } catch (e) {
      // 明細或合計寫入失敗：不留下半套批次（明細 cascade），截圖也一併清掉。
      await ctx.admin.from("clinic_selfpay_claim_batches").delete().eq("id", batch.id);
      throw e;
    }
    return respond({
      batchId: batch.id,
      clinicCode: batch.clinic_code,
      clinicName: batch.clinic_name,
      yearMonth: batch.year_month,
      sourceYearMonth: inferredYearMonth,
      screenshotCount: uploaded.length,
      summary,
    });
  } catch (e) {
    await cleanup();
    throw e;
  }
}

export async function listMappings(ctx: Context, params: URLSearchParams) {
  const { profile, access } = await accessOf(ctx);
  need(access.canManageMapping, "無 DPOS 對應主檔管理權限");
  const storeId = (params.get("store_id") || "").trim();
  const yearMonth = (params.get("year_month") || "").trim();
  if (!storeId) throw new WorkspaceError(400, "缺少 store_id");
  if (yearMonth && !MONTH.test(yearMonth)) throw new WorkspaceError(400, "year_month 格式錯誤");
  need((await authorizedStores(ctx, profile)).some((s) => s.id === storeId), "無此門市查看權限");

  const read = (cols: string) => {
    let q = ctx.admin.from("clinic_selfpay_price_entries").select(cols).eq("store_id", storeId);
    if (yearMonth) q = q.eq("year_month", yearMonth);
    return q.order("updated_at", { ascending: false }).limit(5000);
  };
  let priceRows: any[] = [];
  let legacyNames = false;
  const first = await read("health_insurance_code, product_code, product_name, selfpay_drug_name, year_month, updated_at");
  if (first.error && isMissingSelfpayColumn(first.error.message)) {
    legacyNames = true;
    priceRows = (checked(await read("health_insurance_code, product_code, product_name, year_month, updated_at")) || []) as any[];
  } else priceRows = (checked(first as any) || []) as any[];

  const drugNames = new Map<string, string>();
  if (legacyNames) {
    const batches = (checked(await ctx.admin.from("clinic_selfpay_claim_batches").select("id").eq("store_id", storeId).order("imported_at", { ascending: false }).limit(300)) || []) as any[];
    if (batches.length) {
      const items = (checked(await ctx.admin.from("clinic_selfpay_claim_items").select("health_insurance_code, drug_name, created_at").in("batch_id", batches.map((b) => b.id)).order("created_at", { ascending: false }).limit(10000)) || []) as any[];
      for (const r of items) {
        const code = String(r.health_insurance_code || "").toUpperCase();
        const name = String(r.drug_name || "").trim();
        if (code && name && !drugNames.has(code)) drugNames.set(code, name);
      }
    }
  }
  const latest = new Map<string, any>();
  for (const r of priceRows) {
    const code = String(r.health_insurance_code || "").toUpperCase();
    if (code && !latest.has(code)) latest.set(code, r);
  }
  let isClosed = false;
  if (yearMonth) {
    const closure = await ctx.admin.from("clinic_selfpay_price_month_closures").select("year_month").eq("store_id", storeId).eq("year_month", yearMonth).limit(1);
    if (closure.error && !isMissingClosureTable(closure.error.message)) checked(closure as any);
    isClosed = !!(closure.data && closure.data.length);
  }
  const items = Array.from(latest.entries())
    .map(([code, row]) => ({
      health_insurance_code: code,
      drug_name: legacyNames ? drugNames.get(code) || row.product_name || "" : row.selfpay_drug_name || "",
      product_code: row.product_code || "",
      product_name: row.product_name || "",
      latest_year_month: row.year_month || yearMonth || "",
    }))
    .sort((a, b) => a.health_insurance_code.localeCompare(b.health_insurance_code));
  return respond({ items, meta: { yearMonth, isClosed } });
}

export async function closeMonth(ctx: Context, request: NextRequest) {
  const { profile, access } = await accessOf(ctx);
  need(access.canManageMapping, "無 DPOS 對應主檔管理權限");
  const body = await request.json().catch(() => ({}));
  const storeId = String(body.store_id || "").trim();
  const yearMonth = String(body.year_month || "").trim();
  if (!storeId || !MONTH.test(yearMonth)) throw new WorkspaceError(400, "請提供正確的門市與年月");
  need((await authorizedStores(ctx, profile)).some((s) => s.id === storeId), "無此門市操作權限");
  const existing = checked(await ctx.admin.from("clinic_selfpay_price_entries").select("id").eq("store_id", storeId).eq("year_month", yearMonth).limit(1)) as any[];
  if (!existing || !existing.length) throw new WorkspaceError(400, "所選年月尚無主檔資料，無法關帳");
  const check = await ctx.admin.from("clinic_selfpay_price_month_closures").select("id").eq("store_id", storeId).eq("year_month", yearMonth).limit(1);
  if (check.error) {
    if (isMissingClosureTable(check.error.message)) throw new WorkspaceError(500, "資料庫尚未建立主檔關帳表，請先執行 clinic selfpay migration");
    checked(check as any);
  }
  if (check.data && check.data.length) {
    checked(await ctx.admin.from("clinic_selfpay_price_month_closures").delete().eq("store_id", storeId).eq("year_month", yearMonth));
    return respond({ yearMonth, isClosed: false, action: "reopened" });
  }
  checked(await ctx.admin.from("clinic_selfpay_price_month_closures").upsert({ store_id: storeId, year_month: yearMonth, closed_by: ctx.user.id }, { onConflict: "store_id,year_month" }));
  return respond({ yearMonth, isClosed: true, action: "closed" });
}

/** LIKE 的萬用字元跳脫：舊版把輸入直接放進 ilike，輸入 % 或 _ 會比對到其他健保碼。 */
const likeLiteral = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function priceHistory(ctx: Context, params: URLSearchParams) {
  const { profile, access } = await accessOf(ctx);
  need(access.canManageMapping, "無 DPOS 對應主檔管理權限");
  const storeId = (params.get("store_id") || "").trim();
  const code = (params.get("health_insurance_code") || "").trim();
  if (!storeId || !code) throw new WorkspaceError(400, "缺少 store_id 或 health_insurance_code");
  need((await authorizedStores(ctx, profile)).some((s) => s.id === storeId), "無此門市查看權限");
  const rows = checked(
    await ctx.admin
      .from("clinic_selfpay_price_entries")
      .select("year_month, health_insurance_code, product_code, product_name, member_price, cost_price, source_file_name, updated_at")
      .eq("store_id", storeId)
      .ilike("health_insurance_code", likeLiteral(code))
      .order("year_month", { ascending: false }),
  );
  return respond({ items: rows || [] });
}

export async function importPrices(ctx: Context, request: NextRequest) {
  const { profile, access } = await accessOf(ctx);
  need(access.canManageMapping, "無 DPOS 對應主檔管理權限");
  const form = await request.formData();
  const storeId = String(form.get("store_id") || "");
  const yearMonth = String(form.get("year_month") || "");
  const file = form.get("file");
  if (!storeId || !MONTH.test(yearMonth)) throw new WorkspaceError(400, "請提供正確的門市與年月");
  if (!isFile(file)) throw new WorkspaceError(400, "缺少匯入檔案");
  need((await authorizedStores(ctx, profile)).some((s) => s.id === storeId), "無此門市操作權限");

  const workbook = readPriceWorkbook(await file.arrayBuffer());
  // 先找出要讀的月份，查已關帳月份，再解析（關帳月份略過）
  const probe = parsePriceWorkbook(workbook, { storeId, yearMonth, fileName: file.name, userId: ctx.user.id });
  let closed = new Set<string>();
  const closure = await ctx.admin.from("clinic_selfpay_price_month_closures").select("year_month").eq("store_id", storeId).in("year_month", probe.targetMonths);
  if (closure.error && !isMissingClosureTable(closure.error.message)) checked(closure as any);
  if (!closure.error) closed = new Set((closure.data || []).map((r: any) => String(r.year_month || "")));
  const parsed = parsePriceWorkbook(workbook, { storeId, yearMonth, fileName: file.name, userId: ctx.user.id, closedMonths: closed });
  if (!parsed.records.length) {
    throw new WorkspaceError(
      400,
      parsed.skippedClosedMonths.length
        ? `以下年月已關帳，未匯入任何資料：${parsed.skippedClosedMonths.join("、")}`
        : "找不到有效資料，請確認欄位格式：健保碼、自費藥名稱、品號、品名、會員價、成本（至少需有健保碼與品號）",
    );
  }
  const { records, duplicateCount } = parsed.deduped;
  const up = await ctx.admin.from("clinic_selfpay_price_entries").upsert(records, { onConflict: "store_id,year_month,health_insurance_code" });
  if (up.error && isMissingSelfpayColumn(up.error.message)) {
    checked(await ctx.admin.from("clinic_selfpay_price_entries").upsert(records.map(({ selfpay_drug_name, ...rest }) => rest), { onConflict: "store_id,year_month,health_insurance_code" }));
  } else checked(up as any);
  return respond({
    imported: records.length,
    rawRows: parsed.records.length,
    deduplicatedRows: duplicateCount,
    importedMonths: Array.from(new Set(records.map((r) => r.year_month))).sort(),
    skippedClosedMonths: parsed.skippedClosedMonths,
    warning: duplicateCount > 0 ? `匯入檔內有 ${duplicateCount} 筆重複健保碼資料，已依門市、年月、健保碼保留最後一筆。` : null,
  });
}

export type { ClinicSelfpayAccess };
