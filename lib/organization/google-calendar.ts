import { createDecipheriv, createCipheriv, createHash, randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;
type Connection = {
  id: number;
  calendar_id: string;
  google_account_email: string;
  refresh_token_ciphertext: string;
  connected_by: string | null;
  connected_at?: string;
  last_sync_at?: string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
  last_sync_error?: string | null;
};
type CalendarEvent = {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  status: string;
};
type Holiday = {
  holiday_date: string;
  name: string;
  day_type: string;
};
type SyncRow = {
  source_key: string;
  source_type: 'company' | 'holiday';
  calendar_id: string;
  google_event_id: string | null;
};

export type GoogleCalendarSyncResult = {
  status: 'synced' | 'not_connected' | 'failed' | 'partial';
  synced?: number;
  failed?: number;
  message?: string;
  errors?: string[];
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';
const EVENT_TYPE_LABELS: Record<string, string> = {
  meeting: '會議',
  activity: '活動',
  important: '重要事項',
};
const HOLIDAY_TYPE_LABELS: Record<string, string> = {
  national_holiday: '國定假日',
  substitute_holiday: '補假日',
  makeup_workday: '補行上班',
};

export function getGoogleCalendarEnvironment() {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || '',
    encryptionKey: process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY || '',
  };
}

export function isGoogleCalendarConfigured() {
  const config = getGoogleCalendarEnvironment();
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.calendarId && /^[a-f\d]{64}$/i.test(config.encryptionKey));
}

function encryptionKey() {
  const encoded = getGoogleCalendarEnvironment().encryptionKey;
  if (!/^[a-f\d]{64}$/i.test(encoded)) {
    throw new Error('Google 同步加密金鑰未設定或格式錯誤（需 64 位十六進位字串）');
  }
  return Buffer.from(encoded, 'hex');
}

export function encryptRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptRefreshToken(value: string) {
  const [ivText, tagText, cipherText] = value.split('.');
  if (!ivText || !tagText || !cipherText) throw new Error('Google 授權資料格式錯誤，請重新連結');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function connection(admin: AdminClient) {
  const { data, error } = await admin
    .from('organization_calendar_google_connections')
    .select('id, calendar_id, google_account_email, refresh_token_ciphertext, connected_by, connected_at, last_sync_at, last_sync_status, last_sync_error')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data as Connection | null;
}

export async function getGoogleCalendarStatus(admin = createAdminClient()) {
  const [connected, linkResult] = await Promise.all([
    connection(admin),
    admin.from('organization_calendar_google_event_links').select('source_key, last_error'),
  ]);
  if (linkResult.error) throw linkResult.error;
  const links = linkResult.data || [];
  return {
    configured: isGoogleCalendarConfigured(),
    calendarId: getGoogleCalendarEnvironment().calendarId || null,
    connected: Boolean(connected),
    calendarMatches: !connected || connected.calendar_id === getGoogleCalendarEnvironment().calendarId,
    googleAccountEmail: connected?.google_account_email || null,
    connectedAt: connected?.connected_at || null,
    lastSyncAt: connected?.last_sync_at || null,
    lastSyncStatus: connected?.last_sync_status || null,
    lastSyncError: connected?.last_sync_error || null,
    pendingCount: links.filter(link => Boolean(link.last_error)).length,
  };
}

async function accessToken(value: Connection) {
  const config = getGoogleCalendarEnvironment();
  if (!config.clientId || !config.clientSecret) throw new Error('Google OAuth 用戶端尚未完成設定');
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptRefreshToken(value.refresh_token_ciphertext),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    const detail = payload.error === 'invalid_grant'
      ? 'Google 授權已失效，請重新連結（測試模式的授權可能在 7 天後到期）'
      : '無法更新 Google 授權，請重新連結';
    throw new Error(detail);
  }
  return payload.access_token as string;
}

function dateAfter(date: string) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString().slice(0, 10);
}

function dateTime(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalized}+08:00`;
}

function companyPayload(event: CalendarEvent) {
  const lines = [EVENT_TYPE_LABELS[event.event_type] || '公司行事', event.description?.trim()].filter(Boolean);
  const payload: Record<string, unknown> = {
    summary: event.title,
    description: lines.join('\n\n'),
    location: event.location || '',
    extendedProperties: { private: { system_source: `company:${event.id}` } },
  };
  if (event.is_all_day) {
    payload.start = { date: event.start_date };
    payload.end = { date: dateAfter(event.end_date) };
  } else {
    payload.start = { dateTime: dateTime(event.start_date, event.start_time || '09:00'), timeZone: 'Asia/Taipei' };
    payload.end = { dateTime: dateTime(event.end_date, event.end_time || '10:00'), timeZone: 'Asia/Taipei' };
  }
  return payload;
}

function holidayPayload(holiday: Holiday) {
  return {
    summary: holiday.name,
    description: `政府公告參考：${HOLIDAY_TYPE_LABELS[holiday.day_type] || '假日'}`,
    start: { date: holiday.holiday_date },
    end: { date: dateAfter(holiday.holiday_date) },
    extendedProperties: { private: { system_source: `holiday:${holiday.holiday_date}` } },
  };
}

async function googleApi(token: string, path: string, method: string, body?: unknown) {
  const response = await fetch(`${GOOGLE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (response.status === 404 && method === 'DELETE') return;
  if (response.status === 204) return;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = result?.error?.message;
    throw new Error(typeof reason === 'string'
      ? `Google Calendar：${reason.slice(0, 200)}（HTTP ${response.status}）`
      : `Google Calendar API 失敗（HTTP ${response.status}）`);
  }
  return result;
}

async function saveLink(admin: AdminClient, link: {
  source_key: string;
  source_type: 'company' | 'holiday';
  calendar_id: string;
  google_event_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}) {
  const { error } = await admin.from('organization_calendar_google_event_links').upsert({
    ...link,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source_key' });
  if (error) throw error;
}

async function syncOne(
  admin: AdminClient,
  current: Connection,
  token: string,
  sourceType: 'company' | 'holiday',
  sourceKey: string,
  eventPayload: Record<string, unknown> | null,
  existing?: SyncRow,
) {
  try {
    if (!eventPayload) {
      if (existing?.google_event_id) {
        await googleApi(token,
          `/calendars/${encodeURIComponent(existing.calendar_id)}/events/${encodeURIComponent(existing.google_event_id)}`,
          'DELETE');
      }
      const { error } = await admin.from('organization_calendar_google_event_links').delete().eq('source_key', sourceKey);
      if (error) throw error;
      return;
    }

    const sameCalendar = existing?.calendar_id === current.calendar_id && Boolean(existing.google_event_id);
    if (existing?.google_event_id && !sameCalendar) {
      await googleApi(token,
        `/calendars/${encodeURIComponent(existing.calendar_id)}/events/${encodeURIComponent(existing.google_event_id)}`,
        'DELETE').catch(() => undefined);
    }
    const path = sameCalendar
      ? `/calendars/${encodeURIComponent(current.calendar_id)}/events/${encodeURIComponent(existing!.google_event_id!)}`
      : `/calendars/${encodeURIComponent(current.calendar_id)}/events`;
    const stableId = createHash('sha256').update(sourceKey).digest('hex');
    const payload = { ...eventPayload, ...(!sameCalendar ? { id: stableId } : {}) };
    let result;
    try {
      result = await googleApi(token, path, sameCalendar ? 'PATCH' : 'POST', payload);
    } catch (error: any) {
      const message = String(error?.message || '');
      const stablePath = `/calendars/${encodeURIComponent(current.calendar_id)}/events/${encodeURIComponent(stableId)}`;
      if (sameCalendar && message.includes('HTTP 404')) {
        result = await googleApi(token, `/calendars/${encodeURIComponent(current.calendar_id)}/events`, 'POST', { ...eventPayload, id: stableId });
      } else if (!sameCalendar && message.includes('HTTP 409')) {
        result = await googleApi(token, stablePath, 'PATCH', { ...eventPayload, id: stableId });
      } else {
        throw error;
      }
    }
    await saveLink(admin, {
      source_key: sourceKey,
      source_type: sourceType,
      calendar_id: current.calendar_id,
      google_event_id: result?.id || existing?.google_event_id || null,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error: any) {
    await saveLink(admin, {
      source_key: sourceKey,
      source_type: sourceType,
      calendar_id: current.calendar_id,
      google_event_id: existing?.calendar_id === current.calendar_id ? existing.google_event_id : null,
      last_synced_at: null,
      last_error: String(error?.message || 'Google 同步失敗').slice(0, 500),
    });
    throw error;
  }
}

async function finishSync(admin: AdminClient, status: 'success' | 'partial' | 'failed', error?: string) {
  await admin.from('organization_calendar_google_connections').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: status,
    last_sync_error: error?.slice(0, 1000) || null,
  }).eq('id', 1);
}

export async function syncCompanyCalendarEvent(event: CalendarEvent): Promise<GoogleCalendarSyncResult> {
  const admin = createAdminClient();
  let current: Connection | null;
  try {
    current = await connection(admin);
  } catch (error: any) {
    return { status: 'failed', failed: 1, message: error?.message || '無法讀取 Google 同步設定' };
  }
  if (!current) return { status: 'not_connected', message: 'Google 公司日曆尚未連結' };
  if (current.calendar_id !== getGoogleCalendarEnvironment().calendarId) {
    return { status: 'failed', failed: 1, message: '伺服器設定的 Google 日曆 ID 與已連結日曆不同，請先聯絡系統管理者' };
  }
  try {
    const token = await accessToken(current);
    const { data: link } = await admin.from('organization_calendar_google_event_links')
      .select('source_key, source_type, calendar_id, google_event_id')
      .eq('source_key', `company:${event.id}`).maybeSingle();
    await syncOne(admin, current, token, 'company', `company:${event.id}`,
      event.status === 'active' ? companyPayload(event) : null, link as SyncRow | undefined);
    await finishSync(admin, 'success');
    return { status: 'synced', synced: 1 };
  } catch (error: any) {
    await finishSync(admin, 'failed', error?.message || '同步失敗');
    return { status: 'failed', failed: 1, message: error?.message || 'Google 同步失敗' };
  }
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index]);
    }
  });
  await Promise.all(workers);
}

export async function syncCompanyCalendarSnapshot(): Promise<GoogleCalendarSyncResult> {
  const admin = createAdminClient();
  const current = await connection(admin);
  if (!current) return { status: 'not_connected', message: 'Google 公司日曆尚未連結' };
  if (current.calendar_id !== getGoogleCalendarEnvironment().calendarId) {
    return { status: 'failed', failed: 1, message: '伺服器設定的 Google 日曆 ID 與已連結日曆不同，請先聯絡系統管理者' };
  }

  const [eventResult, importResult, linkResult] = await Promise.all([
    admin.from('organization_calendar_events')
      .select('id, title, event_type, start_date, end_date, is_all_day, start_time, end_time, location, description, status')
      .eq('status', 'active'),
    admin.from('organization_calendar_holiday_imports')
      .select('id')
      .eq('status', 'published'),
    admin.from('organization_calendar_google_event_links')
      .select('source_key, source_type, calendar_id, google_event_id'),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (importResult.error) throw importResult.error;
  if (linkResult.error) throw linkResult.error;

  const importIds = (importResult.data || []).map(item => item.id);
  let holidays: Holiday[] = [];
  if (importIds.length) {
    const holidayResult = await admin.from('organization_calendar_holidays')
      .select('holiday_date, name, day_type')
      .in('import_id', importIds);
    if (holidayResult.error) throw holidayResult.error;
    holidays = (holidayResult.data || []) as Holiday[];
  }

  const sources = new Map<string, { type: 'company' | 'holiday'; payload: Record<string, unknown> }>();
  for (const event of (eventResult.data || []) as CalendarEvent[]) {
    sources.set(`company:${event.id}`, { type: 'company', payload: companyPayload(event) });
  }
  for (const holiday of holidays) {
    sources.set(`holiday:${holiday.holiday_date}`, { type: 'holiday', payload: holidayPayload(holiday) });
  }

  const links = (linkResult.data || []) as SyncRow[];
  const linkByKey = new Map(links.map(link => [link.source_key, link]));
  const errors: string[] = [];
  let synced = 0;
  const failures: Array<{ key: string; type: 'company' | 'holiday'; payload: Record<string, unknown> | null; existing?: SyncRow }> = [];
  for (const [key, source] of Array.from(sources.entries())) {
    failures.push({ key, type: source.type, payload: source.payload, existing: linkByKey.get(key) });
  }
  for (const link of links) {
    if (!sources.has(link.source_key)) failures.push({
      key: link.source_key,
      type: link.source_type,
      payload: null,
      existing: link,
    });
  }

  let token: string;
  try {
    token = await accessToken(current);
  } catch (error: any) {
    await finishSync(admin, 'failed', error?.message || 'Google 授權失敗');
    return { status: 'failed', failed: failures.length, message: error?.message || 'Google 授權失敗' };
  }

  await mapLimit(failures, 4, async item => {
    try {
      await syncOne(admin, current, token, item.type, item.key, item.payload, item.existing);
      synced += item.payload ? 1 : 0;
    } catch (error: any) {
      errors.push(`${item.key}：${String(error?.message || '同步失敗').slice(0, 180)}`);
    }
  });

  const failed = errors.length;
  const status = failed === 0 ? 'success' : synced > 0 ? 'partial' : 'failed';
  await finishSync(admin, status, errors.slice(0, 5).join('\n'));
  return {
    status: failed === 0 ? 'synced' : status as 'partial' | 'failed',
    synced,
    failed,
    errors: errors.slice(0, 5),
  };
}

export async function revokeGoogleCalendarConnection() {
  const admin = createAdminClient();
  const current = await connection(admin);
  if (!current) return { disconnected: false };
  try {
    const refreshToken = decryptRefreshToken(current.refresh_token_ciphertext);
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      cache: 'no-store',
    });
  } catch {
    // Local credentials are removed even if Google's revoke endpoint is unavailable.
  }
  const { error } = await admin.from('organization_calendar_google_connections').delete().eq('id', 1);
  if (error) throw error;
  return { disconnected: true };
}
