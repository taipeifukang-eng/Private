import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { addDays, taipeiToday, warrantyState } from '../../../lib/workspace/general-affairs/asset-fields';

// G09 保固頁依賴的規則：台北時間、到期日當天結束才過期。維修紀錄的範圍規則由資料庫函式判斷（整合層測）。
const access = (codes: string[]) =>
  resolveAccess([{ is_active: true, role: { code: 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);

describe('保固頁入口只給設備／設施查看或管理', () => {
  it('店長身分沒有保固頁，維修紀錄有', () => {
    const f = gaFlags(access([]).has, true);
    expect([f.gaEquipmentWarranties, f.gaFacilityWarranties, f.gaEquipmentHistory, f.gaFacilityHistory]).toEqual([false, false, true, true]);
  });
  it('需求單管理但沒有設備權限：看不到設備保固與維修紀錄入口', () => {
    const f = gaFlags(access(['general_affairs.request.manage']).has, false);
    expect([f.gaEquipmentWarranties, f.gaEquipmentHistory]).toEqual([false, false]);
  });
});

describe('保固狀態（台北時間）', () => {
  const today = taipeiToday();
  it('到期日當天仍在保固內（今天到期），隔天才過保', () => {
    expect(warrantyState({ has_warranty: true, end_date: today }).state).toBe('expiring');
    expect(warrantyState({ has_warranty: true, end_date: addDays(today, -1) }).state).toBe('expired');
  });
  it('31 天以上為保固中；沒填日期為保固日未填；無保固', () => {
    expect(warrantyState({ has_warranty: true, end_date: addDays(today, 31) }).state).toBe('active');
    expect(warrantyState({ has_warranty: true, end_date: null }).state).toBe('missing');
    expect(warrantyState({ has_warranty: false, end_date: addDays(today, 5) }).state).toBe('none');
  });
});
