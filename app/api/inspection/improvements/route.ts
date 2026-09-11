import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const [canViewAll, canViewOwnScope] = await Promise.all([
      hasAnyPermission(user.id, [
        'inspection.improvement.view_all',
      ]),
      hasAnyPermission(user.id, [
        'inspection.improvement.view_own',
        'inspection.improvement.view_own_store',
        'inspection.improvement.manage',
        'inspection.improvement.submit',
      ]),
    ]);

    if (!canViewAll && !canViewOwnScope) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { data: rawImprovements, error: improvementsError } = await adminClient
      .from('inspection_improvements')
      .select(`
        id, inspection_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        status, deadline, days_taken, bonus_score,
        improved_at, created_at
      `)
      .order('deadline', { ascending: true })
      .order('created_at', { ascending: false });

    if (improvementsError) {
      console.error('查詢待改善事項失敗:', improvementsError);
      return NextResponse.json(
        { error: improvementsError.message || '查詢待改善事項失敗' },
        { status: 500 }
      );
    }

    let visibleImprovements = rawImprovements || [];

    if (!canViewAll) {
      const [storeManagerResult, ownInspectionResult] = await Promise.all([
        adminClient
          .from('store_managers')
          .select('store_id')
          .eq('user_id', user.id),
        adminClient
          .from('inspection_masters')
          .select('id')
          .eq('inspector_id', user.id),
      ]);

      if (storeManagerResult.error) {
        console.warn('查詢使用者管理門市失敗:', storeManagerResult.error);
      }
      if (ownInspectionResult.error) {
        console.warn('查詢使用者巡店紀錄失敗:', ownInspectionResult.error);
      }

      const storeIds = new Set(
        (storeManagerResult.data || []).map((row: any) => row.store_id).filter(Boolean)
      );
      const inspectionIds = new Set(
        (ownInspectionResult.data || []).map((row: any) => row.id).filter(Boolean)
      );

      visibleImprovements = visibleImprovements.filter((item: any) =>
        storeIds.has(item.store_id) || inspectionIds.has(item.inspection_id)
      );
    }

    // 分開補關聯資料，避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料。
    const storeIds = Array.from(new Set(visibleImprovements.map((item: any) => item.store_id).filter(Boolean)));
    const inspectionIds = Array.from(new Set(visibleImprovements.map((item: any) => item.inspection_id).filter(Boolean)));

    const [storesResult, inspectionsResult] = await Promise.all([
      storeIds.length > 0
        ? adminClient.from('stores').select('id, store_name, store_code').in('id', storeIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      inspectionIds.length > 0
        ? adminClient
            .from('inspection_masters')
            .select('id, inspection_date, inspector_id')
            .in('id', inspectionIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (storesResult.error) {
      console.warn('查詢待改善門市資料失敗:', storesResult.error);
    }
    if (inspectionsResult.error) {
      console.warn('查詢待改善巡店主檔失敗:', inspectionsResult.error);
    }

    const storeMap = new Map(
      (storesResult.data || []).map((store: any) => [store.id, store])
    );
    const inspectionMap = new Map(
      (inspectionsResult.data || []).map((inspection: any) => [inspection.id, inspection])
    );
    const inspectorIds = Array.from(new Set(
      (inspectionsResult.data || []).map((inspection: any) => inspection.inspector_id).filter(Boolean)
    ));

    let inspectorNameMap = new Map<string, string>();
    if (inspectorIds.length > 0) {
      const { data: inspectorProfiles, error: inspectorError } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .in('id', inspectorIds);

      if (inspectorError) {
        console.warn('查詢督導名稱失敗:', inspectorError);
      }
      inspectorNameMap = new Map(
        (inspectorProfiles || []).map((profile: any) => [profile.id, profile.full_name || '未知'])
      );
    }

    const today = new Date().toISOString().split('T')[0];
    const overdueItems = visibleImprovements.filter(
      (item: any) => item.status === 'pending' && item.deadline < today
    );

    if (overdueItems.length > 0) {
      await Promise.all(
        overdueItems.map((item: any) =>
          adminClient
            .from('inspection_improvements')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', item.id)
        )
      );
      overdueItems.forEach((item: any) => {
        item.status = 'overdue';
      });
    }

    const improvements = visibleImprovements.map((item: any) => {
      const store = storeMap.get(item.store_id) || {};
      const inspection = inspectionMap.get(item.inspection_id) || {};
      const inspectorId = (inspection as any).inspector_id;

      return {
        ...item,
        store_name: (store as any).store_name || '未知門市',
        store_code: (store as any).store_code || '',
        inspection_date: (inspection as any).inspection_date || '',
        inspector_name: (inspectorId && inspectorNameMap.get(inspectorId)) || '未知',
      };
    });

    return NextResponse.json({ improvements });
  } catch (error: any) {
    console.error('載入待改善事項失敗:', error);
    return NextResponse.json(
      { error: error.message || '載入待改善事項失敗' },
      { status: 500 }
    );
  }
}
