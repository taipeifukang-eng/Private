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

    // 獲取所有營運門市，總部不列入經理/督導門市分配統計
    const { data: stores, error } = await supabase
      .from('stores')
      .select('id, store_code, store_name, short_name')
      .eq('is_active', true)
      .order('store_code');

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const branchStores = (stores || []).filter((store) => {
      const label = [store.store_code, store.store_name, store.short_name]
        .filter(Boolean)
        .join(' ');
      return store.store_code !== '0000' && !/總部|总部|HQ/i.test(label);
    });

    return NextResponse.json({ success: true, stores: branchStores });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
