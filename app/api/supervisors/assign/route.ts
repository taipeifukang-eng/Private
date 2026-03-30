import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

type SupervisorAssignmentRow = {
  id: number;
  store_id: string;
  is_primary: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeStoreIds(ids: unknown[]): string[] {
  return ids
    .map((id) => String(id || '').trim())
    .filter((id) => id.length > 0);
}

async function normalizePrimarySupervisors(supabase: any, storeIds: string[]) {
  const uniqueStoreIds = Array.from(new Set(storeIds)).filter((id) => id.length > 0);
  if (uniqueStoreIds.length === 0) return;

  const { data: rows, error } = await supabase
    .from('store_managers')
    .select('id, store_id, is_primary, created_at, updated_at')
    .eq('role_type', 'supervisor')
    .in('store_id', uniqueStoreIds);

  if (error) {
    throw new Error(`讀取督導主責資料失敗: ${error.message}`);
  }

  const grouped = new Map<string, SupervisorAssignmentRow[]>();
  (rows || []).forEach((row: SupervisorAssignmentRow) => {
    const list = grouped.get(row.store_id) || [];
    list.push(row);
    grouped.set(row.store_id, list);
  });

  const groupedEntries = Array.from(grouped.entries());
  for (let i = 0; i < groupedEntries.length; i += 1) {
    const [storeId, list] = groupedEntries[i];
    if (!list.length) continue;

    const currentPrimary = list.filter((r) => r.is_primary);
    let primaryId: number;

    if (currentPrimary.length === 1) {
      primaryId = currentPrimary[0].id;
    } else {
      const sorted = [...list].sort((a, b) => {
        const aCreated = Date.parse(a.created_at || '1970-01-01T00:00:00Z');
        const bCreated = Date.parse(b.created_at || '1970-01-01T00:00:00Z');
        if (aCreated !== bCreated) return aCreated - bCreated;

        const aUpdated = Date.parse(a.updated_at || '1970-01-01T00:00:00Z');
        const bUpdated = Date.parse(b.updated_at || '1970-01-01T00:00:00Z');
        if (aUpdated !== bUpdated) return aUpdated - bUpdated;

        return a.id - b.id;
      });
      primaryId = sorted[0].id;
    }

    const { error: resetError } = await supabase
      .from('store_managers')
      .update({ is_primary: false })
      .eq('store_id', storeId)
      .eq('role_type', 'supervisor');

    if (resetError) {
      throw new Error(`重設主責督導失敗(門市 ${storeId}): ${resetError.message}`);
    }

    const { error: setPrimaryError } = await supabase
      .from('store_managers')
      .update({ is_primary: true })
      .eq('id', primaryId);

    if (setPrimaryError) {
      throw new Error(`設定主責督導失敗(門市 ${storeId}): ${setPrimaryError.message}`);
    }
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查是否為管理員
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const { userId, storeIds, roleType = 'supervisor', proxyStoreIds = [] } = await request.json();
  console.log('[DEBUG assign] 收到參數 userId:', userId, '| roleType:', roleType, '| storeIds:', storeIds, '| proxyStoreIds:', proxyStoreIds);

    if (!userId || !Array.isArray(storeIds)) {
      return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 });
    }

    // 先查詢現有的分配
    const { data: existingAssignments } = await supabase
      .from('store_managers')
      .select('id, store_id, role_type, is_primary')
      .eq('user_id', userId);

    const existingStoreIds = new Set(existingAssignments?.map(a => a.store_id) || []);
    const newStoreIds = new Set(storeIds);

    // 找出需要刪除的
    const toDelete = existingAssignments?.filter(a => !newStoreIds.has(a.store_id)) || [];
    
    // 找出需要新增的
    const toInsert = storeIds.filter(id => !existingStoreIds.has(id));

    const toDeleteSupervisorStoreIds = toDelete
      .filter(a => a.role_type === 'supervisor')
      .map(a => String(a.store_id));

    let existingSupervisorStoreSet = new Set<string>();
    if (roleType === 'supervisor' && toInsert.length > 0) {
      const { data: existingSupervisors, error: existingSupervisorsError } = await supabase
        .from('store_managers')
        .select('store_id')
        .eq('role_type', 'supervisor')
        .in('store_id', toInsert)
        .neq('user_id', userId);

      if (existingSupervisorsError) {
        return NextResponse.json({
          success: false,
          error: `檢查既有督導資料失敗: ${existingSupervisorsError.message}`
        }, { status: 500 });
      }

      existingSupervisorStoreSet = new Set((existingSupervisors || []).map((r: any) => String(r.store_id)));
    }

    // 執行刪除
    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(a => a.id);
      const { error: deleteError } = await supabase
        .from('store_managers')
        .delete()
        .in('id', deleteIds);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        return NextResponse.json({ 
          success: false, 
          error: `刪除舊資料失敗: ${deleteError.message}` 
        }, { status: 500 });
      }
    }

    // 執行新增
    if (toInsert.length > 0) {
      const assignments = toInsert.map(storeId => ({
        user_id: userId,
        store_id: storeId,
        role_type: roleType, // 使用傳入的角色類型
        is_primary: roleType === 'supervisor' ? !existingSupervisorStoreSet.has(String(storeId)) : false
      }));

      const { error: insertError } = await supabase
        .from('store_managers')
        .insert(assignments);

      if (insertError) {
        console.error('Insert error:', insertError);
        return NextResponse.json({ 
          success: false, 
          error: `新增資料失敗: ${insertError.message}` 
        }, { status: 500 });
      }
    }

    const proxyStoreIdsParsed = normalizeStoreIds(proxyStoreIds as unknown[]);
  console.log('[DEBUG assign] proxyStoreIdsParsed:', proxyStoreIdsParsed);

    // 代理門市：不走 normalizePrimary，改用獨立邏輯
    // 讓自己 is_primary=false，再確保「其他督導」中有一位是主責
    if (proxyStoreIdsParsed.length > 0) {
      const { error: proxyUpdateError } = await supabase
        .from('store_managers')
        .update({ is_primary: false })
        .eq('user_id', userId)
        .eq('role_type', 'supervisor')
        .in('store_id', proxyStoreIdsParsed);

      if (proxyUpdateError) {
        return NextResponse.json({
          success: false,
          error: `設定代理門市失敗: ${proxyUpdateError.message}`,
        }, { status: 500 });
      }

      // 對每個代理門市：若其他督導都沒有主責，選最舊的補為主責
      console.log('[DEBUG assign] 代理 is_primary=false update 完成，正在查詢其他督導行...');
      const { data: otherRows } = await supabase
        .from('store_managers')
        .select('id, store_id, is_primary, created_at')
        .eq('role_type', 'supervisor')
        .neq('user_id', userId)
        .in('store_id', proxyStoreIdsParsed);

      console.log('[DEBUG assign] otherRows (proxy 門市的其他督導):', JSON.stringify(otherRows));
      const otherByStore = new Map<string, any[]>();
      (otherRows || []).forEach((row: any) => {
        const sid = String(row.store_id);
        const list = otherByStore.get(sid) || [];
        list.push(row);
        otherByStore.set(sid, list);
      });

      const otherEntries = Array.from(otherByStore.entries());
      for (let j = 0; j < otherEntries.length; j++) {
        const [, list] = otherEntries[j];
        const alreadyHasPrimary = list.some((r: any) => r.is_primary);
        if (!alreadyHasPrimary && list.length > 0) {
          const sorted = [...list].sort((a: any, b: any) =>
            Date.parse(a.created_at || '1970-01-01T00:00:00Z') -
            Date.parse(b.created_at || '1970-01-01T00:00:00Z')
          );
          await supabase
            .from('store_managers')
            .update({ is_primary: true })
            .eq('id', sorted[0].id);
        }
      }
    }

    // 非代理門市的主責補正（新增/刪除後補正，不包含代理門市）
    if (roleType === 'supervisor' || toDeleteSupervisorStoreIds.length > 0) {
      const nonProxyTouchedIds = [
        ...toDeleteSupervisorStoreIds,
        ...toInsert
          .map((id) => String(id))
          .filter((id) => id.length > 0 && !proxyStoreIdsParsed.includes(id)),
      ];
      if (nonProxyTouchedIds.length > 0) {
        await normalizePrimarySupervisors(supabase, nonProxyTouchedIds);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
