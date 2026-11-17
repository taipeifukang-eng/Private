import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 使用者 2026-11-18 決定 1（統編唯一索引）與決定 3（績效採購金額權限）的靜態檢查：DEV SQL 與正式區草稿 48／44／46、README 順序、前端隱藏。
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const DRAFTS = 'docs/vue-workspace/parity-plan/m7m8-sql';
const DEV = 'supabase/workspace-dev/20261118140000_m7m8_b6_vendor_tax_unique';
const fnBody = (sql: string, name: string) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(i, name).toBeGreaterThanOrEqual(0);
  return sql.slice(i, sql.indexOf('\n$$;', i));
};
const core = (sql: string) => sql.slice(sql.indexOf('DO $$'), sql.lastIndexOf('COMMIT;')).trim();

describe('統編唯一索引（決定 1）', () => {
  const dev = read(`${DEV}.sql`);
  const draft = read(`${DRAFTS}/48-b6-vendor-tax-unique.sql`);
  it('DEV 與草稿 48 都有 rollback，DEV 時間戳接在第 6 批最大號（130000）之後', () => {
    expect(exists(`${DEV}.rollback.sql`)).toBe(true);
    expect(exists(`${DRAFTS}/48-b6-vendor-tax-unique-rollback.sql`)).toBe(true);
    expect('20261118140000' > '20261118130000').toBe(true);
    for (const f of [`${DEV}.rollback.sql`, `${DRAFTS}/48-b6-vendor-tax-unique-rollback.sql`]) expect(read(f)).toMatch(/DROP INDEX IF EXISTS public\.ga_vendors_tax_id_norm_uidx;/);
  });
  it('正規化函式 ga_vd_norm_tax 是 IMMUTABLE；索引是正規化統編的部分唯一索引（空值不算）', () => {
    expect(read('supabase/workspace-dev/20261118100000_m7m8_b6_vendor_rpc.sql')).toMatch(/FUNCTION public\.ga_vd_norm_tax\(p_value text\) RETURNS text LANGUAGE sql IMMUTABLE/);
    for (const sql of [dev, draft]) {
      expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ga_vendors_tax_id_norm_uidx ON public\.ga_vendors \(\(public\.ga_vd_norm_tax\(tax_id\)\)\) WHERE public\.ga_vd_norm_tax\(tax_id\) <> '';/);
    }
  });
  it('建立前先檢查重複（含停用），有重複就 RAISE EXCEPTION 並列出名單；DEV 與草稿核心一致；草稿自己 BEGIN／COMMIT', () => {
    for (const sql of [dev, draft]) {
      expect(sql).toContain("RAISE EXCEPTION '有 % 組重複統編");
      expect(sql).not.toMatch(/status\s*(=|<>|IN)\s*'active'/);
      expect(sql.indexOf("RAISE EXCEPTION '有 %")).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'));
    }
    expect(core(dev)).toBe(core(draft));
    // 索引運算式以寫入者身分執行：必須開 ga_vd_norm_tax 的執行權限給 authenticated（44 原本收回），rollback 再收回
    for (const sql of [dev, draft]) expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_vd_norm_tax(text) TO authenticated;');
    for (const f of [`${DEV}.rollback.sql`, `${DRAFTS}/48-b6-vendor-tax-unique-rollback.sql`]) expect(read(f)).toContain('REVOKE EXECUTE ON FUNCTION public.ga_vd_norm_tax(text) FROM authenticated;');
    expect(draft).toMatch(/^BEGIN;/m);
    expect(draft.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
  it('ga_ws_vendor_save：索引衝突轉成 409 TAX_ID_DUPLICATE 並指出既有廠商；DEV 與草稿 44 函式本體一致', () => {
    const a = fnBody(read('supabase/workspace-dev/20261118100000_m7m8_b6_vendor_rpc.sql'), 'ga_ws_vendor_save');
    const b = fnBody(read(`${DRAFTS}/44-b6-vendor-functions.sql`), 'ga_ws_vendor_save');
    expect(a).toBe(b);
    expect(a).toContain('WHEN unique_violation THEN');
    expect(a).toContain("v_cname = 'ga_vendors_tax_id_norm_uidx'");
    expect(a).toMatch(/GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;/);
    expect((a.match(/'TAX_ID_DUPLICATE'/g) || []).length).toBe(2);
  });
  it('README 套用順序 48 在 44 之後、47 之前，並說明 41 第 3 區必須清空；41 第 3 區說明同步', () => {
    const readme = read(`${DRAFTS}/README.md`);
    expect(readme).toContain('`41 → 42 → 44 → 48 → 47 → 45 → 46 → 43`');
    expect(readme).toContain('48-b6-vendor-tax-unique.sql');
    expect(readme).toContain('48-b6-vendor-tax-unique-rollback.sql');
    expect(read(`${DRAFTS}/41-b6-preview-before-apply.sql`)).toMatch(/第 3 區：[^\n]*必須整理到 0 組才能套用 48/);
    const script = read('scripts/apply-workspace-m7m8-b6-dev.cjs');
    expect(script.indexOf('20261118140000_m7m8_b6_vendor_tax_unique')).toBeGreaterThan(script.indexOf('20261118130000_m7m8_b6_dev_seed'));
  });
});

describe('績效採購金額權限（決定 3）', () => {
  const dev = fnBody(read('supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.sql'), 'ga_ws_vendor_perf');
  const draft = fnBody(read(`${DRAFTS}/46-b6-stats-home.sql`), 'ga_ws_vendor_perf');
  it('DEV 與草稿 46 函式本體一致；用 ga_po_can_view 判斷，無權者金額、張數、合計為 null 並排除只有採購單的廠商，回 can_view_po_amount', () => {
    expect(dev).toBe(draft);
    expect(dev).toContain('v_can_po := public.ga_po_can_view(v_uid);');
    expect(dev).toMatch(/o\.vendor_id IS NOT NULL AND v_can_po\n/);
    expect(dev).toContain("'po_count', CASE WHEN v_can_po THEN m.po_count END, 'po_amount', CASE WHEN v_can_po THEN m.po_amount END");
    expect(dev).toMatch(/'po_amount_total', CASE WHEN v_can_po THEN \(SELECT/);
    expect(dev).toContain("'can_view_po_amount', v_can_po");
  });
  it('首頁摘要的採購單金額只在待核准項目（核准權限者才有該項）', () => {
    const home = read('supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.sql');
    expect(home).toMatch(/IF v_c \? 'po_pending' THEN[\s\S]{0,400}total_amount::text/);
    expect(home).toMatch(/IF v_approve THEN\s+SELECT count\(\*\) INTO v_n FROM public\.ga_purchase_orders WHERE status = 'PENDING_APPROVAL'/);
  });
  it('績效頁依 can_view_po_amount 隱藏金額欄、合計卡與欄位標題', () => {
    const vue = read('vue-workspace/src/pages/ga/VendorStats.vue');
    expect(vue).toContain('data.value?.can_view_po_amount === true');
    expect((vue.match(/v-if="showPo"/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(vue).toContain(':colspan="colCount"');
  });
});

describe('allowlist 決定紀錄', () => {
  it('四條已核可：approvedBy 有值、reason 記錄決定日期', () => {
    const list = JSON.parse(read('tests/parity/allowlist.json')) as Array<{ id: string; approvedBy: string | null; reason: string }>;
    for (const id of ['m7m8-b6-vendor-tax-id-unique-rpc-only', 'm7m8-b6-vendor-perf-po-amount-coop-only', 'm7m8-b6-legacy-purchase-review-inline-vendor-null', 'm7m8-b6-legacy-service-center-select-star-empty']) {
      const e = list.find((x) => x.id === id);
      expect(e, id).toBeTruthy();
      expect(e!.approvedBy, id).toContain('2026-11-18');
      expect(e!.reason, id).toContain('2026-11-18');
    }
  });
});
