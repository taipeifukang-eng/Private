import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import {
  cleanCalendarText,
  isCalendarDate,
  ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION,
  ORGANIZATION_CALENDAR_HOLIDAY_TYPES,
  readCalendarRequestBody,
} from '@/lib/admin/organization-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION))) {
      return NextResponse.json({ error: '沒有維護政府假日資料的權限' }, { status: 403 });
    }

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的匯入資料' }, { status: 400 });

    const year = Number(body.calendar_year);
    const sourceName = cleanCalendarText(body.source_name, 120);
    const sourceUrl = typeof body.source_url === 'string' ? body.source_url.trim() : '';
    const sourceRevision = typeof body.source_revision === 'string' ? body.source_revision.trim() : '';
    const holidays = body.holidays;
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 });
    }
    if (!sourceName) return NextResponse.json({ error: '請填寫資料來源' }, { status: 400 });
    if (sourceRevision.length > 120) return NextResponse.json({ error: '版本資訊最多 120 字' }, { status: 400 });
    try {
      const parsedUrl = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid protocol');
    } catch {
      return NextResponse.json({ error: '請填寫有效的官方來源網址' }, { status: 400 });
    }
    if (!Array.isArray(holidays) || holidays.length < 1 || holidays.length > 500) {
      return NextResponse.json({ error: '每次需匯入 1 至 500 筆日期' }, { status: 400 });
    }

    const seenDates = new Set<string>();
    const rows = [];
    for (const item of holidays) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return NextResponse.json({ error: '有一筆日期資料格式錯誤' }, { status: 400 });
      }
      const date = (item as Record<string, unknown>).holiday_date;
      const name = cleanCalendarText((item as Record<string, unknown>).name, 120);
      const dayType = (item as Record<string, unknown>).day_type;
      if (!isCalendarDate(date) || Number(date.slice(0, 4)) !== year || !name ||
          !ORGANIZATION_CALENDAR_HOLIDAY_TYPES.includes(dayType as typeof ORGANIZATION_CALENDAR_HOLIDAY_TYPES[number])) {
        return NextResponse.json({ error: '請檢查日期、名稱與假日類型；日期需屬於匯入年度' }, { status: 400 });
      }
      if (seenDates.has(date)) return NextResponse.json({ error: `日期重複：${date}` }, { status: 400 });
      seenDates.add(date);
      rows.push({ holiday_date: date, name, day_type: dayType });
    }

    const { data, error } = await supabase.rpc('organization_calendar_publish_holiday_import', {
      p_calendar_year: year,
      p_source_name: sourceName,
      p_source_url: sourceUrl,
      p_source_revision: sourceRevision || null,
      p_holidays: rows,
    });
    if (error) throw error;

    return NextResponse.json({ import_id: data, count: rows.length }, { status: 201 });
  } catch (error: any) {
    console.error('匯入政府假日失敗:', error);
    return NextResponse.json({ error: error.message || '匯入政府假日失敗' }, { status: 500 });
  }
}
