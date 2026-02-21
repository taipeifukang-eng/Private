import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET: 取得評分對照表
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('inspection_grade_mapping')
      .select('*')
      .order('grade', { ascending: false });

    if (error) {
      // 如果表不存在，回傳預設值
      return NextResponse.json({
        mappings: getDefaultMappings(),
        isDefault: true,
      });
    }

    return NextResponse.json({
      mappings: data && data.length > 0 ? data : getDefaultMappings(),
      isDefault: !data || data.length === 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT: 更新評分對照表（全量替換）
export async function PUT(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const body = await request.json();
    const { mappings } = body;

    if (!Array.isArray(mappings) || mappings.length !== 11) {
      return NextResponse.json({ error: '需要 11 個評級（0-10）' }, { status: 400 });
    }

    // 先清空再插入
    await supabase.from('inspection_grade_mapping').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const rows = mappings.map((m: any) => ({
      grade: m.grade,
      min_score: m.min_score,
      updated_by: user.id,
    }));

    const { error } = await supabase
      .from('inspection_grade_mapping')
      .insert(rows);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function getDefaultMappings() {
  return [
    { grade: 10, min_score: 220 },
    { grade: 9, min_score: 215 },
    { grade: 8, min_score: 191 },
    { grade: 7, min_score: 181 },
    { grade: 6, min_score: 171 },
    { grade: 5, min_score: 161 },
    { grade: 4, min_score: 151 },
    { grade: 3, min_score: 141 },
    { grade: 2, min_score: 131 },
    { grade: 1, min_score: 121 },
    { grade: 0, min_score: 0 },
  ];
}
