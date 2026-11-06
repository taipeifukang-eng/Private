import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';

// 每月人員狀態加速（monthly-speed-spec 項目 A）整合層：只讀。
// 名冊回應附的 meta 必須和 tools?op=meta 完全相同；欄位權限（viewStats／viewSupport）照舊；沒有門市權限的帳號兩邊都是 403。

const MONTH = '2026-10';
const ACCOUNTS = ['admin', 'store_manager', 'supervisor', 'ops_assistant', 'navigation', 'monthly_view', 'pharmacist'];

test.describe('名冊回應附帶 meta，與 op=meta 一致', () => {
  for (const key of ACCOUNTS) {
    test(key, async () => {
      const admin = await apiAs('admin');
      const api = await apiAs(key);
      try {
        const list = await (await admin.get('/api/workspace/monthly', { params: { month: MONTH } })).json();
        const stores = (list.allStores as { id: string; store_code: string }[]).filter((s) => ['0002', 'ZT01', 'ZT02'].includes(s.store_code));
        expect(stores.length).toBeGreaterThan(0);
        for (const s of stores) {
          const roster = await api.get('/api/workspace/monthly', { params: { month: MONTH, store: s.id } });
          const tools = await api.get('/api/workspace/monthly/tools', { params: { month: MONTH, store: s.id, op: 'meta' } });
          if (roster.status() !== 200) {
            // 看不到這間門市：兩支 API 都拒絕，且不洩漏任何資料。
            expect(roster.status()).toBe(403);
            expect(tools.status()).toBe(403);
            continue;
          }
          const body = await roster.json();
          expect(tools.status()).toBe(200);
          const meta = await tools.json();
          expect(body.meta).toEqual(meta);
          // 欄位權限：沒有統計權限就沒有統計欄位；沒有支援時數權限就沒有支援欄位。
          expect(Object.keys(meta.stats).includes('total_staff_count')).toBe(meta.capabilities.viewStats);
          expect(Object.keys(meta.stats).includes('support_to_other_stores_hours')).toBe(meta.capabilities.viewSupport);
          expect(body.canViewStats).toBe(meta.capabilities.viewStats);
          expect(body.storeStatus).toBe(meta.storeStatus);
        }
        // 獨立比對：活動入口與 session 的舊版 canEnterCampaignView 一致（meta 兩條路徑共用同一支函式，單比兩邊會是同義反覆）。
        // DEV 的 has_permission 對 admin 角色有繞過、Production 沒有，所以 admin 帳號（隱含授權）不比對這一項。
        if (key !== 'admin') {
          const sess = await (await api.get('/api/workspace/session')).json();
          const first = stores[0];
          const r = await api.get('/api/workspace/monthly', { params: { month: MONTH, store: first.id } });
          if (r.status() === 200) expect((await r.json()).meta.capabilities.activity).toBe(sess.capabilities.campaignView);
        }
        // 沒有指定門市（總覽）不附 meta。
        const noStore = await api.get('/api/workspace/monthly', { params: { month: '2099-12' } });
        if (noStore.status() === 200) {
          const j = await noStore.json();
          if (!j.store) expect(j.meta).toBeUndefined();
        }
      } finally {
        await admin.dispose();
        await api.dispose();
      }
    });
  }
});
