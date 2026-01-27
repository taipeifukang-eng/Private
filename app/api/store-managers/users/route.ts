import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    
    // 獲取所有包含「店長」職稱的用戶
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, employee_code, job_title')
      .or('job_title.ilike.%店長%,job_title.ilike.%代理店長%')
      .order('full_name');

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    return NextResponse.json({ success: true, users: data || [] });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
