import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  requireAuthenticatedUser,
  requireStoreScopePermission,
  STORE_MANAGER_ASSIGN_PERMISSION_CODES,
} from '@/lib/admin/store-management-access';

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireAuthenticatedUser(supabase);
    if (auth.response) return auth.response;

    const permissionDenied = await requireStoreScopePermission(
      auth.user.id,
      STORE_MANAGER_ASSIGN_PERMISSION_CODES,
    );
    if (permissionDenied) return permissionDenied;
    
    // 獲取所有門市
    const { data, error } = await supabase
      .from('stores')
      .select('id, store_code, store_name')
      .eq('is_active', true)
      .order('store_code');

    if (error) {
      console.error('Error fetching stores:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    return NextResponse.json({ success: true, stores: data || [] });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
