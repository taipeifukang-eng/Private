import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const staffStatusId = searchParams.get('staff_status_id');

    if (!staffStatusId) {
      return NextResponse.json({ success: false, error: '缺少員工狀態ID' }, { status: 400 });
    }

    const extractStoreCode = (raw: string | null | undefined): string => {
      const text = String(raw || '').toUpperCase();
      const matched = text.match(/\d{4}[A-Z]?/);
      return matched ? matched[0] : text.trim();
    };

    // 查詢加盟店門市代碼
    const { data: franchiseStores, error: franchiseError } = await supabase
      .from('stores')
      .select('store_code')
      .eq('is_franchise', true);

    if (franchiseError) {
      console.error('Error fetching franchise stores:', franchiseError);
    }

    const franchiseCodeSet = new Set(
      (franchiseStores || [])
        .map((s: any) => extractStoreCode(s.store_code))
        .filter(Boolean)
    );

    // 目前 staff_status 所屬門市代碼（若本店是加盟店，保留本店明細）
    const { data: currentStaffStatus, error: currentStaffStatusError } = await supabase
      .from('monthly_staff_status')
      .select('store_id, stores:store_id(store_code)')
      .eq('id', staffStatusId)
      .maybeSingle();

    if (currentStaffStatusError) {
      console.error('Error fetching current staff status store:', currentStaffStatusError);
    }

    const currentStoreCode = extractStoreCode(currentStaffStatus?.stores?.store_code);

    // 獲取該員工的業績明細
    const { data, error } = await supabase
      .from('monthly_performance_details')
      .select('*')
      .eq('staff_status_id', staffStatusId)
      .order('store_code');

    if (error) {
      console.error('Error fetching performance details:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const filteredData = (data || []).filter((row: any) => {
      const code = extractStoreCode(row.store_code);
      return !(franchiseCodeSet.has(code) && code !== currentStoreCode);
    });

    return NextResponse.json({
      success: true,
      data: filteredData
    });

  } catch (error: any) {
    console.error('Get performance details error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '獲取失敗' },
      { status: 500 }
    );
  }
}
