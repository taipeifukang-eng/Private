// ============================================
// 權限檢查 API - 單一權限
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: '未登入' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { permissionCode } = body;

    if (!permissionCode) {
      return NextResponse.json(
        { error: '缺少 permissionCode 參數' },
        { status: 400 }
      );
    }

    const allowed = await hasPermission(user.id, permissionCode);

    return NextResponse.json({ allowed });
  } catch (error) {
    console.error('權限檢查錯誤:', error);
    return NextResponse.json(
      { error: '權限檢查失敗' },
      { status: 500 }
    );
  }
}
