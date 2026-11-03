import { describe, expect, it, vi } from 'vitest';

// P01 單元層（行為）：角色「只有 master.edit、沒有 management.edit」時，新版 overview 的 capabilities 與舊版一致：
// masterEdit 為 true（舊版 canEdit 只看 master.edit），edit 為 false。全部以 mock 替身執行，不連任何資料庫。
let granted: string[] = [];
vi.mock('@/lib/permissions/check', () => ({ hasPermission: async (_uid: string, key: string) => granted.includes(key) }));
vi.mock('@/lib/supabase/server', () => {
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res({ data: [], error: null, count: 0 }) : chain),
    apply: () => chain,
  });
  return {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-test' } } }) }, from: () => chain }),
    createAdminClient: () => ({ from: () => chain }),
  };
});

import { pharmacistOverview } from '@/lib/workspace/pharmacist-overview';

describe('P01 藥師主檔編輯權限（行為）', () => {
  it('只有 view + master.view + master.edit：masterEdit=true、edit=false', async () => {
    granted = ['pharmacist.management.view', 'pharmacist.management.master.view', 'pharmacist.management.master.edit'];
    const res = await pharmacistOverview({ year_month: '2099-01', zone: 'all' });
    expect(res.capabilities).toMatchObject({ edit: false, master: true, masterEdit: true });
  });
  it('有 management.edit 但沒有 master.edit：masterEdit=false、edit=true', async () => {
    granted = ['pharmacist.management.view', 'pharmacist.management.master.view', 'pharmacist.management.edit'];
    const res = await pharmacistOverview({ year_month: '2099-01', zone: 'all' });
    expect(res.capabilities).toMatchObject({ edit: true, masterEdit: false });
  });
});
