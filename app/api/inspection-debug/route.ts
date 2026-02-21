import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, any> = {};
  
  try {
    const supabase = await createClient();

    // 測試 1: 用戶認證
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      results['1_auth'] = { success: !error, userId: user?.id, email: user?.email, error: error?.message };
    } catch (e: any) {
      results['1_auth'] = { success: false, error: e.message };
    }

    // 測試 2: profiles 查詢
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('id', user.id)
          .single();
        results['2_profile'] = { success: !error, data, error: error?.message, code: error?.code };
      }
    } catch (e: any) {
      results['2_profile'] = { success: false, error: e.message };
    }

    // 測試 3: inspection_masters 基本查詢
    try {
      const { data, error, count } = await supabase
        .from('inspection_masters')
        .select('id, store_id, inspector_id, inspection_date, status', { count: 'exact' })
        .limit(5);
      results['3_inspection_masters'] = { 
        success: !error, 
        count: data?.length,
        totalCount: count,
        firstRecord: data?.[0],
        error: error?.message, 
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      };
    } catch (e: any) {
      results['3_inspection_masters'] = { success: false, error: e.message };
    }

    // 測試 4: stores 查詢
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('id, store_name, short_name')
        .limit(3);
      results['4_stores'] = { success: !error, count: data?.length, error: error?.message, code: error?.code };
    } catch (e: any) {
      results['4_stores'] = { success: false, error: e.message };
    }

    // 測試 5: inspection_results 查詢
    try {
      const { data, error } = await supabase
        .from('inspection_results')
        .select('id, template_id, inspection_id')
        .limit(3);
      results['5_inspection_results'] = { success: !error, count: data?.length, error: error?.message, code: error?.code, hint: error?.hint };
    } catch (e: any) {
      results['5_inspection_results'] = { success: false, error: e.message };
    }

    // 測試 6: inspection_templates 查詢
    try {
      const { data, error } = await supabase
        .from('inspection_templates')
        .select('id, section, item_name')
        .limit(3);
      results['6_inspection_templates'] = { success: !error, count: data?.length, error: error?.message, code: error?.code, hint: error?.hint };
    } catch (e: any) {
      results['6_inspection_templates'] = { success: false, error: e.message };
    }

    // 測試 7: 完整模擬列表頁查詢流程
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const { data: rawInspections, error: inspError } = await supabase
        .from('inspection_masters')
        .select('id, store_id, inspector_id, inspection_date, status, total_score, max_possible_score, grade, score_percentage, created_at')
        .gte('inspection_date', sixMonthsAgo.toISOString())
        .order('inspection_date', { ascending: false });

      if (inspError) {
        results['7_full_flow'] = { success: false, step: 'inspection_masters', error: inspError.message, code: inspError.code };
      } else {
        const storeIds = Array.from(new Set(rawInspections?.map(i => i.store_id).filter(Boolean) || []));
        const inspectorIds = Array.from(new Set(rawInspections?.map(i => i.inspector_id).filter(Boolean) || []));
        
        let storeError = null;
        let inspectorError = null;
        
        if (storeIds.length > 0) {
          const { error } = await supabase.from('stores').select('id, store_name, store_code, short_name').in('id', storeIds);
          storeError = error;
        }
        
        if (inspectorIds.length > 0) {
          const { error } = await supabase.from('profiles').select('id, full_name').in('id', inspectorIds);
          inspectorError = error;
        }
        
        results['7_full_flow'] = { 
          success: !storeError && !inspectorError,
          inspectionCount: rawInspections?.length,
          storeIds: storeIds.length,
          inspectorIds: inspectorIds.length,
          storeError: storeError?.message,
          inspectorError: inspectorError?.message
        };
      }
    } catch (e: any) {
      results['7_full_flow'] = { success: false, error: e.message };
    }

    return NextResponse.json(results, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ fatalError: e.message }, { status: 500 });
  }
}
