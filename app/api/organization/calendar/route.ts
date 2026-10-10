import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const year = Number(request.nextUrl.searchParams.get('year'));
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 });
    }

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const [companyResult, personalResult, importResult] = await Promise.all([
      supabase
        .from('organization_calendar_events')
        .select('id, title, event_type, start_date, end_date, is_all_day, start_time, end_time, location, description, status, created_by, updated_by, created_at, updated_at')
        .eq('status', 'active')
        .lte('start_date', yearEnd)
        .gte('end_date', yearStart)
        .order('start_date'),
      supabase
        .from('organization_personal_calendar_events')
        .select('id, owner_id, title, start_date, end_date, is_all_day, start_time, end_time, location, description, created_at, updated_at')
        .lte('start_date', yearEnd)
        .gte('end_date', yearStart)
        .order('start_date'),
      supabase
        .from('organization_calendar_holiday_imports')
        .select('id, calendar_year, source_name, source_url, source_revision, imported_at')
        .eq('calendar_year', year)
        .eq('status', 'published')
        .maybeSingle(),
    ]);

    if (companyResult.error) throw companyResult.error;
    if (personalResult.error) throw personalResult.error;
    if (importResult.error) throw importResult.error;

    let holidays: unknown[] = [];
    if (importResult.data?.id) {
      const holidayResult = await supabase
        .from('organization_calendar_holidays')
        .select('id, import_id, holiday_date, name, day_type')
        .eq('import_id', importResult.data.id)
        .order('holiday_date');
      if (holidayResult.error) throw holidayResult.error;
      holidays = holidayResult.data || [];
    }

    return NextResponse.json({
      year,
      companyEvents: companyResult.data || [],
      personalEvents: personalResult.data || [],
      holidays,
      holidaySource: importResult.data || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('取得年度行事曆失敗:', error);
    return NextResponse.json({ error: error.message || '取得年度行事曆失敗' }, { status: 500 });
  }
}
