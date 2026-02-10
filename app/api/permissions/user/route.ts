// ============================================
// 使用者權限列表 API
// ============================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserPermissions } from '@/lib/permissions/check';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: '未登入' },
        { status: 401 }
      );
    }

    const permissions = await getUserPermissions(user.id);

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('取得權限列表錯誤:', error);
    return NextResponse.json(
      { error: '取得權限列表失敗' },
      { status: 500 }
    );
  }
}
