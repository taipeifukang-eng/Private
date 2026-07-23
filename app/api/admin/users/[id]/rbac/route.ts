import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  ROLE_LIST_PAGE_PERMISSION_CODES,
  USER_MANAGEMENT_NAV_PERMISSION_CODES,
} from '@/lib/permissions/rbac-management';
import { getUserRbacDetail } from '@/lib/admin/user-rbac-view';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function isValidTargetId(id: string) {
  return UUID_PATTERN.test(id) && id !== NIL_UUID;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const targetUserId = params.id;
    if (!isValidTargetId(targetUserId)) {
      return NextResponse.json(
        { success: false, error: '使用者 id 格式錯誤' },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const canViewUserRbac = await hasAnyPermission(user.id, [
      ...USER_MANAGEMENT_NAV_PERMISSION_CODES,
      ...ROLE_LIST_PAGE_PERMISSION_CODES,
    ]);

    if (!canViewUserRbac) {
      return NextResponse.json(
        { success: false, error: '沒有查看使用者角色與權限的權限' },
        { status: 403 }
      );
    }

    const adminSupabase = createAdminClient();
    const detail = await getUserRbacDetail(adminSupabase, targetUserId);

    if (!detail) {
      return NextResponse.json(
        { success: false, error: '使用者不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: detail },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('取得使用者 RBAC 詳情失敗:', error);
    return NextResponse.json(
      { success: false, error: '取得使用者角色與權限失敗' },
      { status: 500 }
    );
  }
}
