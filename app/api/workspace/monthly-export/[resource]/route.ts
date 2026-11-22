import { NextRequest } from 'next/server';
import { context, checkOrigin, failed, respond, WorkspaceError } from '@/lib/workspace/server';
import {
  MONTHLY_EXPORT_GENERAL_PERMISSION,
  canOpenMonthlyExport,
  findNonExportableIds,
  isExportYearMonth,
  normalizeStoreIds,
} from '@/lib/workspace/monthly-export';
import { loadExportAccess, loadExportStores } from '@/lib/workspace/monthly-export-server';
// 包裝舊版 handler：產檔邏輯（欄位、排序、工作表）完全沿用 app/api/export-monthly-status/*，不重寫。
import { POST as download } from '@/app/api/export-monthly-status/download/route';
import { POST as actualStaffPoints } from '@/app/api/export-monthly-status/actual-staff-points/route';
import { GET as rosterPreview, POST as rosterDownload } from '@/app/api/export-monthly-status/roster/route';
import { POST as transport } from '@/app/api/export-monthly-status/transport/route';
import { POST as singleItemBonus } from '@/app/api/export-monthly-status/single-item-bonus/route';
import { POST as talentCultivationBonus } from '@/app/api/export-monthly-status/talent-cultivation-bonus/route';
import { POST as mealAllowance } from '@/app/api/export-monthly-status/meal-allowance/route';
import { POST as springFestivalBonus } from '@/app/api/export-monthly-status/spring-festival-bonus/route';
import { buildSupportHoursResponse } from '@/lib/workspace/support-hours-export';

export const dynamic = 'force-dynamic';
// 舊版為 serverless 函式；全部門市 × 一個月的匯出需要較長時間。
export const maxDuration = 120;

type Params = { params: { resource: string } };
type Handler = (request: NextRequest) => Promise<Response | undefined>;

const POSTS: Record<string, Handler> = {
  download,
  'actual-staff-points': actualStaffPoints,
  roster: rosterDownload,
  transport,
  'single-item-bonus': singleItemBonus,
  'talent-cultivation-bonus': talentCultivationBonus,
  'meal-allowance': mealAllowance,
  'spring-festival-bonus': springFestivalBonus,
};

async function deliver(handler: Handler, request: NextRequest) {
  const response = await handler(request);
  if (!response) throw new WorkspaceError(503, '服務未傳回結果，請重試');
  return response;
}

/** 基本格式檢查：store_ids 格式、年月格式、門市 id 必須存在。不再擋尚未提交門市（規格 A.3，照舊版產檔）。 */
async function guardStoreIds(ctx: Awaited<ReturnType<typeof context>>, yearMonth: unknown, storeIds: unknown): Promise<string[] | undefined> {
  if (storeIds === undefined || storeIds === null) return undefined; // 缺參數交給舊 handler 回 400
  if (!Array.isArray(storeIds)) throw new WorkspaceError(400, 'store_ids 格式錯誤');
  // 先正規化（trim、小寫、須為標準 UUID），之後守衛比對與送給舊 handler 的都是同一份 id，避免大小寫／括號寫法繞過。
  const normalized = normalizeStoreIds(storeIds);
  if (!normalized) throw new WorkspaceError(400, 'store_ids 含有無效的門市 id');
  if (!isExportYearMonth(yearMonth)) throw new WorkspaceError(400, '缺少或錯誤的年月參數');
  if (!normalized.length) return normalized;
  const stores = await loadExportStores(ctx, yearMonth, undefined, { allStores: true });
  // 不存在的門市 id 拒絕；已停用門市與舊版一致，交給舊 handler 產檔。
  if (findNonExportableIds(normalized, stores).length) throw new WorkspaceError(400, '所選門市不存在');
  return normalized;
}

/** 以正規化後的 body 重建請求再交給舊 handler。 */
function withBody(request: NextRequest, body: unknown) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new NextRequest(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}

/** 全部匯出資源共用的權限判斷（run 與 roster 預覽 GET 同一處，改權限只需改這裡）。 */
function assertDownloadAccess(access: Awaited<ReturnType<typeof loadExportAccess>>) {
  if (!access.general) throw new WorkspaceError(403, `沒有資料匯出權限（需要 ${MONTHLY_EXPORT_GENERAL_PERMISSION}）`);
}

async function run(request: NextRequest, { params }: Params, write: boolean) {
  try {
    if (write) checkOrigin(request);
    const ctx = await context(); // DEV 硬性守衛先於任何被包裝的 handler。
    const resource = params.resource;
    const access = await loadExportAccess(ctx);

    if (resource === 'access') {
      if (write) throw new WorkspaceError(405, '不支援此操作');
      return respond({ ...access, canOpen: canOpenMonthlyExport(access) });
    }

    // 全部資源（含單品獎金、育才獎金、支援時數、門市清單）一律只看 monthly.export.download。
    assertDownloadAccess(access);

    if (resource === 'stores') {
      if (write) throw new WorkspaceError(405, '不支援此操作');
      const yearMonth = request.nextUrl.searchParams.get('year_month');
      if (!isExportYearMonth(yearMonth)) throw new WorkspaceError(400, '缺少或錯誤的年月參數');
      // 以伺服器權限讀全部啟用門市，不縮小到任命門市或資料列可見範圍。
      const stores = await loadExportStores(ctx, yearMonth, undefined, { allStores: true, activeOnly: true });
      return respond({ success: true, stores });
    }

    if (resource === 'support-hours') {
      // 僅限 GET，一律全部門市；權限只看 monthly.export.download（不再套用舊版角色／職稱判斷）。
      if (write) throw new WorkspaceError(405, '不支援此操作');
      const yearMonth = request.nextUrl.searchParams.get('year_month');
      if (!isExportYearMonth(yearMonth)) throw new WorkspaceError(400, '缺少或錯誤的年月參數');
      return await buildSupportHoursResponse(ctx.auth, yearMonth);
    }

    if (!Object.prototype.hasOwnProperty.call(POSTS, resource)) throw new WorkspaceError(404, '找不到此匯出');
    if (write) {
      let body: { year_month?: unknown; store_ids?: unknown } = {};
      try {
        body = await request.clone().json();
      } catch {
        throw new WorkspaceError(400, '無效的請求內容');
      }
      if (!body || typeof body !== 'object') throw new WorkspaceError(400, '無效的請求內容');
      const ids = await guardStoreIds(ctx, body.year_month, body.store_ids);
      return await deliver(POSTS[resource], ids ? withBody(request, { ...body, store_ids: ids }) : request);
    }
    throw new WorkspaceError(405, '不支援此操作');
  } catch (e) {
    return failed(e);
  }
}

async function runGet(request: NextRequest, p: Params) {
  // roster 預覽（GET）：與 POST 相同的權限與 基本格式檢查。
  if (p.params.resource !== 'roster') return run(request, p, false);
  try {
    const ctx = await context();
    assertDownloadAccess(await loadExportAccess(ctx));
    const sp = request.nextUrl.searchParams;
    const raw = sp.get('store_ids');
    const ids = await guardStoreIds(ctx, sp.get('year_month'), raw === null ? undefined : raw.split(',').map((v) => v.trim()).filter(Boolean));
    if (!ids) return await deliver(rosterPreview, request);
    const url = new URL(request.url);
    url.searchParams.set('store_ids', ids.join(','));
    return await deliver(rosterPreview, new NextRequest(url, { method: 'GET', headers: request.headers }));
  } catch (e) {
    return failed(e);
  }
}

export const GET = (r: NextRequest, p: Params) => runGet(r, p);
export const POST = (r: NextRequest, p: Params) => run(r, p, true);
