import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  requireAuthenticatedUser,
  requireStoreScopePermission,
  STORE_SCOPE_MANAGEMENT_PERMISSION_CODES,
} from '@/lib/admin/store-management-access';

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireAuthenticatedUser(supabase);
    if (auth.response) return auth.response;

    const permissionDenied = await requireStoreScopePermission(
      auth.user.id,
      STORE_SCOPE_MANAGEMENT_PERMISSION_CODES,
    );
    if (permissionDenied) return permissionDenied;

    // 獲取所有門市管理者分配
    const { data: assignments, error } = await supabase
      .from('store_managers')
      .select('user_id, store_id, role_type, is_primary');

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, assignments: assignments || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
