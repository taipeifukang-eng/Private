// ============================================
// 權限檢查 API - 多個權限
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission, hasAllPermissions } from '@/lib/permissions/check';

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
    const { permissionCodes, mode = 'any' } = body;

    if (!permissionCodes || !Array.isArray(permissionCodes)) {
      return NextResponse.json(
        { error: '缺少或無效的 permissionCodes 參數' },
        { status: 400 }
      );
    }

    let allowed = false;
    if (mode === 'any') {
      allowed = await hasAnyPermission(user.id, permissionCodes);
    } else if (mode === 'all') {
      allowed = await hasAllPermissions(user.id, permissionCodes);
    } else {
      return NextResponse.json(
        { error: '無效的 mode 參數，必須是 "any" 或 "all"' },
        { status: 400 }
      );
    }

    return NextResponse.json({ allowed });
  } catch (error) {
    console.error('權限檢查錯誤:', error);
    return NextResponse.json(
      { error: '權限檢查失敗' },
      { status: 500 }
    );
  }
}
