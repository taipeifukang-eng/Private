import { NextRequest } from "next/server";
import * as year from "@/app/api/organization/calendar/route";
import * as companyEvents from "@/app/api/organization/calendar/company-events/route";
import * as personalEvents from "@/app/api/organization/calendar/personal-events/route";
import * as shares from "@/app/api/organization/calendar/shares/route";
import * as holidays from "@/app/api/organization/calendar/holidays/route";
import * as holidayPreview from "@/app/api/organization/calendar/holidays/preview/route";
import * as googleSync from "@/app/api/organization/calendar/google/sync/route";
import * as googleDiagnose from "@/app/api/organization/calendar/google/diagnose/route";
import * as googleDisconnect from "@/app/api/organization/calendar/google/disconnect/route";
import { getGoogleCalendarStatus } from "@/lib/organization/google-calendar";
import {
  ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION,
  ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION,
  ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION,
  ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION,
} from "@/lib/admin/organization-calendar";
import { calendarMockEnabled, mockState, resetMock, setMock } from "@/lib/workspace/calendar-mock";
import {
  diffHolidays,
  googleBanner,
  holidayDiffSummary,
  holidayPublishNeedsConfirm,
  isSearchableColleague,
  normalizePeopleQuery,
  pendingSyncCount,
  PEOPLE_RESULT_LIMIT,
  type HolidayRow,
} from "@/lib/workspace/calendar-rules";
import { checkOrigin, checked, context, failed, respond, WorkspaceError, type Context } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// M5 W23／W24：年度行事曆。除下列新規則外，一律委派既有 /api/organization/calendar/** 的 handler（舊版 RBAC 與資料規則不動）：
//   Q17 所有登入者都能看（只需登入，不看角色）；
//   Q18 people：搜尋排除已停用／離職；
//   Q21 holidays：同年度已有發布版本時，發布前要帶 confirm_replace；preview 回傳與現行版本的差異；
//   Q20 google/status：待同步筆數與授權失效旗標；
//   D17 mock：只在測試站（WORKSPACE_CALENDAR_MOCK）存在，供測試控制與讀取假 Google。
// Google 授權（connect／callback）維持舊網址 /api/organization/calendar/google/*，不經過這裡。

// 權限旗標：公司行事新增／修改與假日發布最終由資料庫規則（RLS／函式）決定，沒有管理員繞過，所以用資料庫語意（ctx.permissions）；
// Google 管理只靠應用層檢查（舊 handler 用 hasPermission，管理員放行），所以用 ctx.has，與舊版頁面一致。
function flags(ctx: Context) {
  return {
    createCompany: ctx.permissions.has(ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION),
    editCompany: ctx.permissions.has(ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION),
    manageHolidays: ctx.permissions.has(ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION),
    manageGoogle: ctx.has(ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION),
  };
}

async function currentHolidays(ctx: Context, calendarYear: number) {
  const imp = checked(
    await ctx.admin
      .from("organization_calendar_holiday_imports")
      .select("id, calendar_year, source_name, source_revision, imported_at")
      .eq("calendar_year", calendarYear)
      .eq("status", "published")
      .maybeSingle(),
  ) as any;
  if (!imp) return { existing: null, rows: [] as HolidayRow[] };
  const rows = checked(
    await ctx.admin
      .from("organization_calendar_holidays")
      .select("holiday_date, name, day_type")
      .eq("import_id", imp.id)
      .order("holiday_date"),
  ) as HolidayRow[];
  return { existing: { ...imp, count: rows.length }, rows };
}

async function searchPeople(ctx: Context, req: NextRequest) {
  const { query, tooShort, tooLong } = normalizePeopleQuery(req.nextUrl.searchParams.get("q"));
  if (tooShort) return respond({ people: [] });
  if (tooLong) throw new WorkspaceError(400, "搜尋文字過長");
  const pattern = `%${query.replace(/[,%()]/g, " ").trim()}%`;
  // 比舊版多抓一些候選（60），因為停用與離職的人會在後面被排除。
  const [byName, byCode] = await Promise.all([
    ctx.admin.from("profiles").select("id, full_name, employee_code").ilike("full_name", pattern).limit(60),
    ctx.admin.from("profiles").select("id, full_name, employee_code").ilike("employee_code", pattern).limit(60),
  ]);
  const found: any[] = [...(checked(byName as any) as any[]), ...(checked(byCode as any) as any[])];
  const candidates = new Map<string, { id: string; name: string; employee_code: string | null }>();
  for (const p of found) {
    if (!p.id || p.id === ctx.user.id) continue;
    candidates.set(p.id, { id: p.id, name: p.full_name || "未設定姓名", employee_code: p.employee_code || null });
  }
  const list = Array.from(candidates.values()).slice(0, 100);
  const codes = Array.from(new Set(list.map((p) => p.employee_code).filter(Boolean))) as string[];
  const employeeRows = codes.length
    ? (checked(
        await ctx.admin.from("store_employees").select("employee_code, is_active, employment_status").in("employee_code", codes),
      ) as any[])
    : [];
  const rowsByCode = new Map<string, any[]>();
  for (const r of employeeRows) rowsByCode.set(r.employee_code, [...(rowsByCode.get(r.employee_code) || []), r]);
  // 停用：登入帳號的封鎖時間尚未到期（與使用者管理的停用判定相同）。
  const disabled = new Set<string>();
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(
      list.slice(i, i + 20).map(async (p) => {
        const { data } = await ctx.admin.auth.admin.getUserById(p.id);
        const until = data?.user?.banned_until;
        if (until && Date.parse(until) > Date.now()) disabled.add(p.id);
      }),
    );
  }
  const people = list
    .filter((p) => isSearchableColleague({ disabled: disabled.has(p.id), employeeRows: p.employee_code ? rowsByCode.get(p.employee_code) || [] : [] }))
    .slice(0, PEOPLE_RESULT_LIMIT);
  return respond({ people });
}

async function googleStatus(ctx: Context) {
  if (!ctx.has(ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION)) throw new WorkspaceError(403, "沒有管理 Google 行事曆同步的權限");
  const status = await getGoogleCalendarStatus();
  const [events, imports, links] = await Promise.all([
    ctx.admin.from("organization_calendar_events").select("id").eq("status", "active"),
    ctx.admin.from("organization_calendar_holiday_imports").select("id").eq("status", "published"),
    ctx.admin.from("organization_calendar_google_event_links").select("source_key, last_error"),
  ]);
  const importIds = (checked(imports as any) as any[]).map((r) => r.id);
  const holidayRows = importIds.length
    ? (checked(await ctx.admin.from("organization_calendar_holidays").select("holiday_date").in("import_id", importIds)) as any[])
    : [];
  const sourceKeys = [
    ...(checked(events as any) as any[]).map((e) => `company:${e.id}`),
    ...holidayRows.map((h) => `holiday:${h.holiday_date}`),
  ];
  const pendingCount = pendingSyncCount(sourceKeys, checked(links as any) as any[]);
  const merged = { ...status, pendingCount, legacyPendingCount: status.pendingCount };
  return respond({ ...merged, banner: googleBanner(merged) });
}

async function mockRoute(req: NextRequest, method: string) {
  if (!calendarMockEnabled()) throw new WorkspaceError(404, "找不到此操作");
  const snapshot = () => {
    const s = mockState();
    return {
      tokenInvalid: s.tokenInvalid,
      scopeMissing: s.scopeMissing,
      failTitles: s.failTitles,
      failDelete: s.failDelete,
      csvVariant: s.csvVariant,
      officialFail: s.officialFail,
      events: Object.values(s.events),
      calls: s.calls,
    };
  };
  if (method === "GET") return respond(snapshot());
  const body = await req.json().catch(() => ({}));
  if (body?.action === "reset") resetMock();
  else setMock(body || {});
  return respond(snapshot());
}

async function run(req: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context({ profile: false }); // Q17：只需登入
    if (method !== "GET") checkOrigin(req);
    const [a, b] = path;
    const notFound = () => new WorkspaceError(404, "找不到此操作");

    if (a === "mock" && path.length === 1) return await mockRoute(req, method);

    if (path.length === 0) {
      if (method !== "GET") throw notFound();
      const response = await year.GET(req);
      if (!response.ok) return response;
      return respond({ ...(await response.json()), currentUserId: ctx.user.id, permissions: flags(ctx) });
    }
    if (a === "company-events" && path.length === 1 && ["GET", "POST", "PATCH"].includes(method))
      return await companyEvents[method as "GET" | "POST" | "PATCH"](req);
    if (a === "personal-events" && path.length === 1 && ["POST", "PATCH", "DELETE"].includes(method))
      return await personalEvents[method as "POST" | "PATCH" | "DELETE"](req);
    if (a === "shares" && path.length === 1 && ["GET", "POST", "DELETE"].includes(method))
      return await shares[method as "GET" | "POST" | "DELETE"](req);
    if (a === "people" && path.length === 1 && method === "GET") return await searchPeople(ctx, req);

    if (a === "holidays" && path.length === 1 && method === "POST") {
      if (!ctx.has(ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION)) throw new WorkspaceError(403, "沒有維護政府假日資料的權限");
      const body: any = await req.clone().json().catch(() => null);
      const calendarYear = Number(body?.calendar_year);
      if (Number.isInteger(calendarYear) && calendarYear >= 2000 && calendarYear <= 2200) {
        const { existing, rows } = await currentHolidays(ctx, calendarYear);
        if (existing && holidayPublishNeedsConfirm(true, body?.confirm_replace)) {
          const incoming: HolidayRow[] = Array.isArray(body?.holidays) ? body.holidays : [];
          const diff = diffHolidays(rows, incoming);
          return respond(
            { error: `${calendarYear} 年已有發布版本（${holidayDiffSummary(diff)}），請確認差異後再取代`, requiresConfirm: true, existing, diff },
            409,
          );
        }
      }
      return await holidays.POST(req);
    }
    if (a === "holidays" && b === "preview" && path.length === 2 && method === "POST") {
      const response = await holidayPreview.POST(req);
      if (!response.ok) return response;
      const data = await response.json();
      const { existing, rows } = await currentHolidays(ctx, Number(data.calendar_year));
      // 測試站：假的官方日曆來源名稱加測試標記，發布後的假日版本才能被 sweeper 辨識與清除（正式與一般環境不會進入這個分支）。
      const sourceName = calendarMockEnabled() ? `[自動測試]M5W23 ${data.source_name}` : data.source_name;
      return respond({ ...data, source_name: sourceName, existing, diff: existing ? diffHolidays(rows, data.holidays || []) : null });
    }

    if (a === "google" && path.length === 2) {
      if (b === "status" && method === "GET") return await googleStatus(ctx);
      if (b === "sync" && method === "POST") return await googleSync.POST();
      if (b === "diagnose" && method === "POST") return await googleDiagnose.POST();
      if (b === "disconnect" && method === "POST") return await googleDisconnect.POST();
    }
    throw notFound();
  } catch (e) {
    return failed(e);
  }
}
type RouteContext = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: RouteContext) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: RouteContext) => run(r, c.params.path || [], "POST");
export const PATCH = (r: NextRequest, c: RouteContext) => run(r, c.params.path || [], "PATCH");
export const DELETE = (r: NextRequest, c: RouteContext) => run(r, c.params.path || [], "DELETE");
