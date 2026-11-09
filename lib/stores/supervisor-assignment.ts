/**
 * 門市 → 督導區 對應（從 app/api/stores-with-supervisors/route.ts 原樣抽出，邏輯不變，供多處共用）。
 *
 * 督導區的定義：以「經理/督導管理設定」store_managers 為準，只認定「真正的督導」：
 *   - 有 role_type=supervisor 標記者：職稱含「督導」、且管理 >= 3 間、且未達全部門市 90%（區域經理）才算督導
 *   - 若沒有任何人符合，改用門市數量推斷（沒有 role_type 標記、管理 3 間以上且未達 90%）
 *   - 每間門市取第一位符合的督導作為其督導區
 */

export interface SupervisorAssignmentStore {
  id: string;
  [key: string]: any;
}

export interface SupervisorAssignmentManagerRow {
  store_id: string;
  user_id: string;
  role_type: string | null;
  user?: any;
}

export function assignSupervisorsToStores<S extends SupervisorAssignmentStore>(
  stores: S[],
  storeManagers: SupervisorAssignmentManagerRow[],
  log: (...args: any[]) => void = () => {},
): (S & { supervisor_id: string | null; supervisor_code: string | null; supervisor_name: string | null })[] {
  const totalStores = stores?.length || 0;

  log('=== Store Managers Analysis ===');
  log('Total stores:', totalStores);
  log('Total assignments:', storeManagers?.length || 0);

  // 先統計每個人管理的門市數量
  const managerStoreCount = new Map<string, { count: number; name: string; code: string | null; hasRoleType: boolean; jobTitle: string | null }>();
  storeManagers?.forEach((m) => {
    const user = Array.isArray(m.user) ? m.user[0] : m.user;
    const current = managerStoreCount.get(m.user_id);
    managerStoreCount.set(m.user_id, {
      count: (current?.count || 0) + 1,
      name: user?.full_name || '未知',
      code: user?.employee_code || null,
      hasRoleType: current?.hasRoleType || m.role_type === 'supervisor',
      jobTitle: user?.job_title || null,
    });
  });

  log('Unique managers/supervisors:', managerStoreCount.size);

  // 識別督導：結合 role_type 和門市數量
  const actualSupervisors = new Set<string>();
  const maxThreshold = totalStores * 0.9; // 90% 以上視為區域經理
  const minThreshold = 3; // 至少管理3家門市

  // 方案一：優先使用有 role_type = 'supervisor' 標記的
  const supervisorsWithRoleType = Array.from(managerStoreCount.entries()).filter(([_, info]) => info.hasRoleType);

  log('Managers with role_type=supervisor:', supervisorsWithRoleType.length);

  if (supervisorsWithRoleType.length > 0) {
    // 有 role_type 標記，但仍需排除：
    // 1) 區域經理（管理90%以上門市）
    // 2) 職稱為「經理」而非「督導」的人員
    supervisorsWithRoleType.forEach(([userId, info]) => {
      log(`  ${info.name} (${info.code || 'N/A'}): ${info.count} stores [role_type=supervisor] job_title=${info.jobTitle}`);
      const jobTitle = info.jobTitle || '';
      const isSupervisorTitle = jobTitle.includes('督導');
      const isManagerOnlyTitle = !isSupervisorTitle; // 純經理職稱，不含督導
      if (info.count >= maxThreshold) {
        log(`    ⚠️ 排除（區域經理，管理 ${info.count}/${totalStores} 門市，雖有 supervisor 標記）`);
      } else if (isManagerOnlyTitle) {
        log(`    ⚠️ 排除（職稱為「${jobTitle}」，非督導職稱）`);
      } else if (info.count >= minThreshold) {
        actualSupervisors.add(userId);
        log(`    ✓ 認定為督導`);
      } else {
        log(`    ⚠️ 排除（僅管理 ${info.count} 家門市）`);
      }
    });
  }

  // 方案二：如果沒有找到任何督導，或數量太少，使用門市數量推斷作為補充
  if (actualSupervisors.size === 0) {
    log('No valid supervisors found with role_type, using store count heuristic...');

    managerStoreCount.forEach((info, userId) => {
      if (!info.hasRoleType) {
        // 只看沒有 role_type 標記的
        log(`  ${info.name} (${info.code || 'N/A'}): ${info.count} stores`);
        if (info.count >= minThreshold && info.count < maxThreshold) {
          actualSupervisors.add(userId);
          log(`    ✓ 認定為督導（基於門市數量）`);
        } else if (info.count >= maxThreshold) {
          log(`    ⚠️ 排除（區域經理，管理 ${info.count}/${totalStores} 門市）`);
        } else {
          log(`    ⚠️ 排除（門市店長，僅管理 ${info.count} 家門市）`);
        }
      }
    });
  }

  log('Actual supervisors (區域督導):', actualSupervisors.size);

  // 將督導資訊加入門市資料（只保留真正的督導，排除區域經理）
  return (stores || []).map((store) => {
    const manager = storeManagers?.find((m) => m.store_id === store.id && actualSupervisors.has(m.user_id));

    // 處理 user 可能是陣列或物件的情況
    let user: { full_name: any; employee_code: any } | null = null;
    if (manager?.user) {
      user = Array.isArray(manager.user) ? manager.user[0] : manager.user;
    }

    return {
      ...store,
      supervisor_id: manager?.user_id || null,
      supervisor_code: user?.employee_code || null,
      supervisor_name: user?.full_name || null,
    };
  });
}
