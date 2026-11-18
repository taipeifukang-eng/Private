// DEV 整合檢查（手動執行）：npx vitest run -c tests/monthly-stats-rx/vitest.dev.config.mts
// 只連 DEV（project ref 以 mjpd 開頭）、只用 VW/ZT 測試門市與保留年份 2038，結束清掉自己建的。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { loadRxLinkForStore } from '@/lib/monthly-stats/rx-link-server';
import { resolveRxLinkDisplay } from '@/lib/monthly-stats/rx-link';

process.loadEnvFile('.env.development.local');
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const ref = url.hostname.split('.')[0];
if (!ref.startsWith('mjpd')) throw new Error('拒絕執行：不是 DEV');

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

it('DEV 整合：伺服端讀取函式與顯示規則', async () => {
  const stores = (await db.from('stores').select('id, store_code').in('store_code', ['ZT01', 'ZT02', 'ZT03', 'ZT04'])).data;
  const id = (c) => stores.find((s) => s.store_code === c)?.id;
  assert.ok(id('ZT01') && id('ZT02') && id('ZT03') && id('ZT04'), '缺少 ZT 測試門市');
  const ids = stores.map((s) => s.id);
  const hq = (await db.from('stores').select('id').eq('store_code', '0000').limit(1)).data?.[0]?.id;

  async function cleanup() {
    await db.from('monthly_prescription_reports').delete().like('year_month', '2038-%').in('store_id', ids);
    await db.from('monthly_store_summary').delete().like('year_month', '2038-%').in('store_id', ids);
  }
  try {
    await cleanup();
    const ym = '2038-11';
    let r = await db.from('monthly_prescription_reports').insert([
      { year_month: ym, store_id: id('ZT01'), regular_prescription_count: 1200, regular_prescription_point_value: 1500000.25, chronic_prescription_count: 300, chronic_prescription_point_value: 642411.5 },
      { year_month: ym, store_id: id('ZT02'), regular_prescription_count: 10, regular_prescription_point_value: 5000, chronic_prescription_count: null, chronic_prescription_point_value: null },
    ]);
    assert.ifError(r.error);
    r = await db.from('monthly_store_summary').insert([
      { year_month: ym, store_id: id('ZT03'), total_employees: 0, confirmed_count: 0, store_status: 'pending', regular_prescription_count: 800, chronic_prescription_count: 120 },
    ]);
    assert.ifError(r.error);

    const get = (storeId) => loadRxLinkForStore({ canViewStats: true, canAccessStore: true, admin: db, yearMonth: ym, storeId });

    const a = await get(id('ZT01'));
    assert.equal(a.success, true);
    const da = resolveRxLinkDisplay({ report: a.report, legacySummary: null, isHeadOffice: a.isHeadOffice });
    assert.deepEqual([da.regular.text, da.chronic.text, da.totalPoint.text], ['1,200', '300', '2,142,412']);

    const b = await get(id('ZT02'));
    const db2 = resolveRxLinkDisplay({ report: b.report, legacySummary: null });
    assert.deepEqual([db2.regular.text, db2.chronic.text, db2.totalPoint.text], ['10', '暫無資料', '暫無資料']);

    const c = await get(id('ZT03'));
    assert.equal(c.report, null);
    const legacy = (await db.from('monthly_store_summary').select('*').eq('year_month', ym).eq('store_id', id('ZT03')).single()).data;
    const dc = resolveRxLinkDisplay({ report: c.report, legacySummary: legacy });
    assert.deepEqual([dc.regular.text, dc.regular.legacy, dc.chronic.text, dc.totalPoint.text], ['800', true, '120', '暫無資料']);

    const d = await get(id('ZT04'));
    const dd = resolveRxLinkDisplay({ report: d.report, legacySummary: null });
    assert.deepEqual([dd.regular.text, dd.chronic.text, dd.totalPoint.text], ['暫無資料', '暫無資料', '暫無資料']);

    const denied = await loadRxLinkForStore({ canViewStats: false, canAccessStore: true, admin: db, yearMonth: ym, storeId: id('ZT01') });
    assert.equal(denied.success, false);

    let hqNote = '（DEV 無 0000 門市，略過）';
    if (hq) {
      const h = await get(hq);
      assert.deepEqual([h.success, h.isHeadOffice, h.report], [true, true, null]);
      hqNote = '（0000 通過）';
    }
    console.log('DEV 整合檢查全部通過', hqNote);
  } finally {
    await cleanup();
    const left = await db.from('monthly_prescription_reports').select('store_id', { count: 'exact', head: true }).like('year_month', '2038-%').in('store_id', ids);
    const left2 = await db.from('monthly_store_summary').select('id', { count: 'exact', head: true }).like('year_month', '2038-%').in('store_id', ids);
    console.log('清除後殘留（處方箋/月統計）:', left.count, left2.count);
  }

}, 60000);
