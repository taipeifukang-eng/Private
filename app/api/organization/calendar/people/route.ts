import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const query = (request.nextUrl.searchParams.get('q') || '').replace(/[%_]/g, ' ').trim();
    if (query.length < 2) return NextResponse.json({ people: [] });
    if (query.length > 80) return NextResponse.json({ error: '搜尋文字過長' }, { status: 400 });

    const admin = createAdminClient();
    const pattern = `%${query.replace(/[,%()]/g, ' ').trim()}%`;
    const [nameResult, codeResult] = await Promise.all([
      admin.from('profiles').select('id, full_name, employee_code').ilike('full_name', pattern).limit(25),
      admin.from('profiles').select('id, full_name, employee_code').ilike('employee_code', pattern).limit(25),
    ]);
    if (nameResult.error) throw nameResult.error;
    if (codeResult.error) throw codeResult.error;

    const people = new Map<string, { id: string; name: string; employee_code: string | null }>();
    [...(nameResult.data || []), ...(codeResult.data || [])].forEach((profile: any) => {
      if (!profile.id || profile.id === user.id) return;
      people.set(profile.id, {
        id: profile.id,
        name: profile.full_name || '未設定姓名',
        employee_code: profile.employee_code || null,
      });
    });

    return NextResponse.json({ people: Array.from(people.values()).slice(0, 30) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('搜尋行事曆分享對象失敗:', error);
    return NextResponse.json({ error: error.message || '搜尋人員失敗' }, { status: 500 });
  }
}
