import { type APIRequestContext } from '@playwright/test';
import { adminDb, runIdOrThrow } from './m5-fixtures';

/**
 * M5 W23／W24（年度行事曆、Google 同步）測試共用工具。
 * 資料規則：公司行事、個人行程與假日來源名稱一律「[自動測試]M5W23 <runId> <tag>」；行事日期只用保留年度 2099；
 * 只刪「自己建立（帶標記）」的列；sweeper 以同一標記作後備（sweep-targets.cjs）。
 * Google 與人事總處日曆一律 mock（D17）：測試站以 WORKSPACE_CALENDAR_MOCK=true 啟動，/api/workspace/calendar/mock 控制與讀取假 Google。
 * Google 連線只有一列（id=1，全公司共用）：測試開始前若 DEV 已有「不是 mock 帳號」的連線，一律不動並中止測試。
 */
export const CAL_MARKER_PREFIX = '[自動測試]M5W23 ';
export const calTitle = (tag: string) => `${CAL_MARKER_PREFIX}${runIdOrThrow()} ${tag}`;
export const MOCK_GOOGLE_EMAIL = 'mock-google@example.test';
export const RESERVED_YEAR = 2099;

const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
};

/** 假 Google 控制（需要已登入的 request context）。 */
export async function mockControl(api: APIRequestContext, body: Record<string, unknown>) {
  const r = await api.post('/api/workspace/calendar/mock', { data: body });
  if (!r.ok()) throw new Error(`mock 控制失敗（HTTP ${r.status()}）：${await r.text()}`);
  return (await r.json()) as {
    tokenInvalid: boolean; scopeMissing: boolean; failTitles: string[]; failDelete: boolean; csvVariant: 'base' | 'changed'; officialFail: boolean;
    events: { id: string; summary?: string; description?: string; location?: string }[];
    calls: { method: string; host: string; path: string }[];
  };
}
export const mockReset = (api: APIRequestContext) => mockControl(api, { action: 'reset' });
export async function mockSnapshot(api: APIRequestContext) {
  const r = await api.get('/api/workspace/calendar/mock');
  if (!r.ok()) throw new Error(`mock 讀取失敗（HTTP ${r.status()}）`);
  return (await r.json()) as Awaited<ReturnType<typeof mockControl>>;
}

/** 測試開始前：DEV 不能有別人的 Google 連線；2099 年不能有非測試的假日版本。 */
export async function assertCalendarBaseline() {
  const db = adminDb();
  const conn = must(await db.from('organization_calendar_google_connections').select('id,google_account_email'), '讀取 Google 連線') as any[];
  const foreign = conn.filter((c) => c.google_account_email !== MOCK_GOOGLE_EMAIL);
  if (foreign.length) throw new Error('DEV 已有非 mock 的 Google 連線，測試不會動它，請先確認後再跑');
  const imports = must(await db.from('organization_calendar_holiday_imports').select('id,source_name').eq('calendar_year', RESERVED_YEAR), '讀取 2099 假日版本') as any[];
  const strange = imports.filter((i) => !String(i.source_name).startsWith(CAL_MARKER_PREFIX));
  if (strange.length) throw new Error('保留年度 2099 出現不是測試建立的假日版本，測試不會動它，請先確認後再跑');
}

/** 清除本次與上次殘留的測試資料（只刪帶標記的列、保留年度 2099 的測試假日、mock 連線）。 */
export async function cleanupCalendar(): Promise<string[]> {
  const db = adminDb();
  const log: string[] = [];
  const like = `${CAL_MARKER_PREFIX}%`;
  const events = ((await db.from('organization_calendar_events').select('id').like('title', like)).data || []) as any[];
  const ids = events.map((e) => e.id);
  if (ids.length) {
    for (const t of [
      () => db.from('organization_calendar_event_audit').delete().in('event_id', ids),
      () => db.from('organization_calendar_google_event_links').delete().in('source_key', ids.map((id) => `company:${id}`)),
      () => db.from('organization_calendar_events').delete().in('id', ids),
    ]) {
      const r = await t();
      if (r.error) log.push(r.error.message);
    }
  }
  for (const r of [
    await db.from('organization_personal_calendar_events').delete().like('title', like),
    await db.from('organization_calendar_google_event_links').delete().like('source_key', 'holiday:2099-%'),
    await db.from('organization_calendar_holiday_imports').delete().like('source_name', like),
    await db.from('organization_calendar_google_connections').delete().eq('google_account_email', MOCK_GOOGLE_EMAIL),
    await db.from('store_employees').delete().like('employee_code', 'ZTTW23%'),
  ]) if (r.error) log.push(r.error.message);
  return log;
}

// ---- 資料列讀取 ----
export async function companyEventRow(id: string): Promise<any | null> {
  return must(await adminDb().from('organization_calendar_events').select('*').eq('id', id).maybeSingle(), '讀取公司行事');
}
export async function auditRows(id: string): Promise<any[]> {
  return must(await adminDb().from('organization_calendar_event_audit').select('*').eq('event_id', id).order('changed_at'), '讀取異動紀錄') as any[];
}
export async function personalEventRow(id: string): Promise<any | null> {
  return must(await adminDb().from('organization_personal_calendar_events').select('*').eq('id', id).maybeSingle(), '讀取個人行程');
}
export async function publishedImports(year = RESERVED_YEAR): Promise<any[]> {
  return must(await adminDb().from('organization_calendar_holiday_imports').select('*').eq('calendar_year', year).order('imported_at'), '讀取假日版本') as any[];
}
export async function holidaysOf(importId: string): Promise<{ holiday_date: string; name: string; day_type: string }[]> {
  return must(await adminDb().from('organization_calendar_holidays').select('holiday_date,name,day_type').eq('import_id', importId).order('holiday_date'), '讀取假日') as any[];
}
export async function googleConnection(): Promise<any | null> {
  return must(await adminDb().from('organization_calendar_google_connections').select('id,calendar_id,google_account_email,last_sync_status,last_sync_error').eq('id', 1).maybeSingle(), '讀取 Google 連線');
}
export async function googleLinks(): Promise<any[]> {
  return must(await adminDb().from('organization_calendar_google_event_links').select('source_key,source_type,google_event_id,last_error'), '讀取 Google 連結') as any[];
}

/** 以「有新增公司行事權限」的帳號建立公司行事（資料庫的觸發器需要登入身分，service role 不能直接寫）。 */
export async function seedCompanyEvent(api: APIRequestContext, tag: string, over: Record<string, unknown> = {}): Promise<{ id: string; title: string }> {
  const title = calTitle(tag);
  const r = await api.post('/api/workspace/calendar/company-events', { data: { title, event_type: 'meeting', start_date: '2099-03-10', end_date: '2099-03-10', is_all_day: true, ...over } });
  const text = await r.text();
  if (r.status() !== 201) throw new Error(`建立公司行事失敗（HTTP ${r.status()}）：${text}`);
  const event = JSON.parse(text).event;
  return { id: event.id, title };
}

/** 離職員工主檔（員編 ZTTW23…，掛在測試門市 VW001）：用來測「搜尋不含離職」。 */
export async function seedResignedEmployee(code: string, name: string) {
  const store = must(await adminDb().from('stores').select('id').eq('store_code', 'VW001').single(), '讀取測試門市') as any;
  must(
    await adminDb().from('store_employees').insert({ store_id: store.id, employee_code: code, employee_name: name, position: '藥師', employment_type: 'full_time', is_active: false, employment_status: 'resigned' }),
    '建立離職員工主檔',
  );
}
