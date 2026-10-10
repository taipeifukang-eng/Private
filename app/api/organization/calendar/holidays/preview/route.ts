import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { hasPermission } from '@/lib/permissions/check';
import { ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION } from '@/lib/admin/organization-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OFFICIAL_SOURCE_PAGE = 'https://www.dgpa.gov.tw/information?pid=12922&uid=137';
const MAX_CSV_BYTES = 2 * 1024 * 1024;

function officialCsvUrl(value: string, year: number) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('官方 CSV 下載網址格式無法辨識');
  }
  const fileName = url.searchParams.get('name') || '';
  const rocYear = Number(fileName.match(/^(\d{2,3})年/)?.[1]);
  const standardFileName = /^\d{2,3}年中華民國政府行政機關辦公日曆表(?:\(\d+更新\))?(?:_utf8bom)?\.csv$/i.test(fileName);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.dgpa.gov.tw' ||
    url.pathname !== '/FileConversion' ||
    !standardFileName ||
    /Google/i.test(fileName)
  ) {
    throw new Error('請使用人事總處或政府資料開放平台的一般版辦公日曆 CSV，不要選 Google 行事曆專用檔');
  }
  if (!Number.isInteger(rocYear)) throw new Error('無法從官方檔名辨識民國年度');
  if (rocYear + 1911 !== year) throw new Error(`這個檔案是民國 ${rocYear} 年，請切換到西元 ${rocYear + 1911} 年再匯入`);
  return url.toString();
}

async function findOfficialCsvUrl(year: number) {
  const expectedPrefix = `${year - 1911}年中華民國政府行政機關辦公日曆表`;
  let announcementHtml = '';
  try {
    const response = await fetch(OFFICIAL_SOURCE_PAGE, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (response.ok) announcementHtml = await response.text();
  } catch {
    // Fall back to the official open-data catalog below.
  }

  const linkPattern = /<a\b[^>]*href="([^"]*FileConversion[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(announcementHtml)) !== null) {
    const href = match[1].replace(/&amp;/g, '&');
    const label = match[2].replace(/<[^>]*>/g, '').trim();
    if (label.startsWith(expectedPrefix) && /_utf8bom\.csv$/i.test(label) && !/Google/i.test(label)) {
      return officialCsvUrl(new URL(href, 'https://www.dgpa.gov.tw').toString(), year);
    }
  }

  const catalogResponse = await fetch('https://data.gov.tw/dataset/14718', {
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!catalogResponse.ok) throw new Error(`政府資料開放平台讀取失敗（HTTP ${catalogResponse.status}）`);
  const catalogHtml = (await catalogResponse.text())
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&');
  const urls = catalogHtml.match(/https:\/\/www\.dgpa\.gov\.tw\/FileConversion\?[^"\\\s<]+/gi) || [];
  const candidates = urls
    .map(value => value.replace(/[),;]+$/, ''))
    .filter(value => {
      try {
        const candidate = new URL(value);
        const name = candidate.searchParams.get('name') || '';
        return name.startsWith(expectedPrefix) && !/Google/i.test(name) && /\.csv$/i.test(name);
      } catch {
        return false;
      }
    });
  candidates.sort((left, right) => {
    const leftName = new URL(left).searchParams.get('name') || '';
    const rightName = new URL(right).searchParams.get('name') || '';
    const score = (name: string) => (/_utf8bom\.csv$/i.test(name) ? 2 : 0) + (/\(\d+更新\)/.test(name) ? 1 : 0);
    return score(rightName) - score(leftName);
  });
  if (candidates[0]) return officialCsvUrl(candidates[0], year);
  throw new Error(`官方資料尚未提供民國 ${year - 1911} 年的一般版 CSV，請稍後再載入或查看下方開放資料連結`);
}

function parseOfficialCsv(bytes: Buffer, year: number) {
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('CSV 檔案沒有工作表內容');
  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false });
  const headers = (rows[0] || []).map(value => String(value).replace(/^\uFEFF/, '').trim());
  const dateIndex = headers.indexOf('西元日期');
  const weekdayIndex = headers.indexOf('星期');
  const holidayIndex = headers.indexOf('是否放假');
  const noteIndex = headers.indexOf('備註');
  if ([dateIndex, weekdayIndex, holidayIndex, noteIndex].some(index => index < 0)) {
    throw new Error('CSV 欄位不符合政府一般版辦公日曆格式；請勿選擇 Google 行事曆專用檔');
  }

  const allDates = new Set<string>();
  const holidays: Array<{ holiday_date: string; name: string; day_type: string }> = [];
  for (const row of rows.slice(1)) {
    const cells = row as unknown[];
    if (!cells.some(value => String(value).trim())) continue;
    const dateDigits = String(cells[dateIndex]).replace(/\D/g, '');
    if (!/^\d{8}$/.test(dateDigits)) throw new Error('CSV 中有無法辨識的西元日期');
    const date = `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}`;
    if (Number(date.slice(0, 4)) !== year) throw new Error(`CSV 包含非 ${year} 年的日期`);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error(`CSV 日期無效：${date}`);
    }
    if (allDates.has(date)) throw new Error(`CSV 日期重複：${date}`);
    allDates.add(date);

    const weekday = String(cells[weekdayIndex]).trim();
    const isHoliday = String(cells[holidayIndex]).trim();
    const note = String(cells[noteIndex]).trim();
    if (isHoliday === '2' && note) {
      holidays.push({
        holiday_date: date,
        name: note,
        day_type: note.includes('補假') ? 'substitute_holiday' : 'national_holiday',
      });
    } else if (isHoliday === '0' && (weekday === '六' || weekday === '日')) {
      holidays.push({
        holiday_date: date,
        name: note || '補行上班',
        day_type: 'makeup_workday',
      });
    } else if (isHoliday !== '0' && isHoliday !== '2') {
      throw new Error(`CSV 中有無法辨識的「是否放假」值：${isHoliday}`);
    }
  }

  const expectedDays = new Date(Date.UTC(year, 1, 29)).getUTCDate() === 29 ? 366 : 365;
  if (allDates.size !== expectedDays) {
    throw new Error(`CSV 日期不完整：應有 ${expectedDays} 天，實際讀到 ${allDates.size} 天`);
  }
  if (holidays.length === 0) throw new Error('沒有辨識到假日或補行上班日');
  return holidays;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION))) {
      return NextResponse.json({ error: '沒有維護政府假日資料的權限' }, { status: 403 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效年度' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const year = Number(payload.calendar_year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 });
    }
    if (payload.use_official_source !== true) {
      return NextResponse.json({ error: '僅支援從人事總處載入官方資料' }, { status: 400 });
    }

    const sourceUrl = await findOfficialCsvUrl(year);
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`人事總處 CSV 下載失敗（HTTP ${response.status}）`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_CSV_BYTES) throw new Error('官方 CSV 檔案超過 2 MB');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CSV_BYTES) throw new Error('官方 CSV 檔案超過 2 MB');

    const holidays = parseOfficialCsv(bytes, year);
    return NextResponse.json({
      calendar_year: year,
      source_name: '行政院人事行政總處',
      source_url: sourceUrl,
      source_revision: `${year - 1911} 年政府行政機關辦公日曆表`,
      holidays,
      count: holidays.length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('解析政府辦公日曆 CSV 失敗:', error);
    return NextResponse.json({ error: error.message || 'CSV 解析失敗' }, { status: 400 });
  }
}
