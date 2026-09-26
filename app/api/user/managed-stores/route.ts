import { canCreateServiceRequestForAnyStore } from '@/lib/general-affairs/service-requests/access';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function normalizeStores(rows: any[] = []) {
  const seen = new Set<string>();

  return rows
    .map((row: any) => {
      const store = row?.stores || row;
      if (!store?.id || seen.has(store.id)) return null;
      seen.add(store.id);

      return {
        id: store.id,
        store_code: store.store_code,
        store_name: store.store_name,
        short_name: store.short_name || null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const codeA = String(a.store_code || '');
      const codeB = String(b.store_code || '');
      return codeA.localeCompare(codeB, 'zh-Hant-TW', { numeric: true });
    });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    if (await canCreateServiceRequestForAnyStore(user.id)) {
      const adminSupabase = createAdminClient();
      const { data: allStores, error: storesError } = await adminSupabase
        .from('stores')
        .select('id, store_code, store_name, short_name')
        .eq('is_active', true)
        .order('store_code', { ascending: true });

      if (storesError) {
        console.error('Error loading all stores:', storesError);
        return NextResponse.json({ success: false, error: storesError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        scope: 'all',
        stores: normalizeStores(allStores || []),
      });
    }

    // 獲取使用者管理的門市
    const { data: storeManagers, error: managersError } = await supabase
      .from('store_managers')
      .select('store_id, stores(id, store_code, store_name, short_name)')
      .eq('user_id', user.id);

    if (managersError) {
      console.error('Error loading managed stores:', managersError);
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      scope: 'managed',
      stores: normalizeStores(storeManagers || []),
    });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
