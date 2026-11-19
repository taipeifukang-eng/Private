import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENDOR_SECRET_FIELDS } from '@/lib/workspace/general-affairs/vendor-rules';

// G20／G21（資料庫層）靜態檢查：DEV SQL、rollback、套用腳本彼此一致；函式授權與命名；政策不留 DELETE 與店長入口；帳務機密欄位只在完整版 JSON；縣市行政區固定資料冪等。
// 不連資料庫（行為由 tests/integration/G20-G21-db-api.* 實測）。
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const dev = (n: string) => read(`supabase/workspace-dev/${n}`);
const COLS = '20261118090000_m7m8_b6_vendor_columns_rls';
const RPC = '20261118100000_m7m8_b6_vendor_rpc';
const SEED = '20261118130000_m7m8_b6_dev_seed';
const cols = dev(`${COLS}.sql`);
const rpc = dev(`${RPC}.sql`);
const seed = dev(`${SEED}.sql`);

describe('G20-G21 SQL 檔案與套用腳本', () => {
  it('每個 SQL 都有對應的 rollback，且套用腳本依序列出五支（含 110000、120000 預留）', () => {
    for (const b of [COLS, RPC, SEED]) {
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${b}.sql`)), b).toBe(true);
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${b}.rollback.sql`)), `${b} rollback`).toBe(true);
    }
    const script = read('scripts/apply-workspace-m7m8-b6-dev.cjs');
    const order = ['20261118090000_m7m8_b6_vendor_columns_rls', '20261118100000_m7m8_b6_vendor_rpc', '20261118110000_m7m8_b6_utility_bills', '20261118120000_m7m8_b6_stats_home', '20261118130000_m7m8_b6_dev_seed'];
    const idx = order.map((n) => script.indexOf(n));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(script).toContain('mjpd');
    expect(script).toContain('--rollback');
    expect(script).toContain('if (!exists) console.log(`skip (not present)');
    expect(script.replace(/^\/\/.*$/gm, '')).not.toMatch(/\.env\.local|\.env\.production|dotenv/);
  });
  it('先決檢查與接續編號：090000 起、大於第 5 批最大號 20261117130000', () => {
    expect('20261118090000' > '20261117130000').toBe(true);
    expect(cols).toContain('Missing prerequisite');
    expect(rpc).toContain('Missing prerequisite');
    expect(fs.existsSync(path.join(root, 'supabase/workspace-dev/_backup/20261118_b6_vendor_policies_before_b6.sql'))).toBe(true);
  });
});

describe('G20-G21 RLS 收緊（090000）', () => {
  const policy = (name: string) => cols.split('\n').filter((l, i, a) => l.includes(`CREATE POLICY ${name} `) || (a[i - 1]?.includes(`CREATE POLICY ${name} `) ?? false) || (a[i - 2]?.includes(`CREATE POLICY ${name} `) ?? false)).join('\n');
  it('沒有 DELETE 政策、沒有 FOR ALL、不再使用 service_center.access', () => {
    expect(cols).not.toMatch(/FOR DELETE/);
    expect(cols).not.toMatch(/CREATE POLICY [^\n]*FOR ALL/);
    expect(cols.replace(/--.*\n/g, '')).not.toContain('service_center.access');
  });
  it('廠商表只留 vendor.view／manage（讀）與 vendor.manage（寫）；不含分類、區域、合作紀錄', () => {
    const read = policy('p1e_ga_vendors_read');
    expect(read).toContain('vendor.view');
    expect(read).toContain('vendor.manage');
    expect(read).not.toMatch(/service_category|service_region|cooperation_record/);
    for (const p of ['p1e_ga_vendors_insert', 'p1e_ga_vendors_update']) {
      const t = policy(p);
      expect(t).toContain('vendor.manage');
      expect(t).not.toContain('vendor.view');
    }
  });
  it('分類與區域：讀＝自己的 view／manage 加廠商 view／manage；寫＝自己的 manage', () => {
    for (const [tbl, own] of [['categories', 'service_category'], ['regions', 'service_region']] as const) {
      const r = policy(`p1e_ga_service_${tbl}_read`);
      expect(r).toContain(`${own}.view`);
      expect(r).toContain(`${own}.manage`);
      expect(r).toContain('vendor.view');
      for (const w of ['insert', 'update']) {
        const t = policy(`p1e_ga_service_${tbl}_${w}`);
        expect(t).toContain(`${own}.manage`);
        expect(t).not.toContain('.view');
      }
    }
  });
  it('contract_required 與 preferred_vendor 預設改 false，一次性資料修正只在預設還是 true 時做', () => {
    expect(cols).toMatch(/ALTER COLUMN contract_required SET DEFAULT false/);
    expect(cols).toMatch(/ALTER COLUMN preferred_vendor SET DEFAULT false/);
    expect(cols).toMatch(/IF v_default = 'true' THEN\s+INSERT INTO public\.ga_m7m8_b6_apply_log[^;]*;\s+UPDATE public\.ga_vendors SET contract_required = false/);
    expect(cols).toContain('updated_by');
  });
  it('rollback 依「套用前存檔」還原（審查 A3）：政策原文、區域 id 清單、索引、預設值、updated_by 都以存檔為準，找不到存檔就中止', () => {
    const rb = dev(`${COLS}.rollback.sql`);
    // 套用端存檔：政策（可直接執行的 CREATE POLICY）、套用前已存在的區域 id、索引、預設值、updated_by 是否已存在、一次性改 false 的廠商
    for (const k of ['b43.policies.', 'b42.region_ids_before', 'b42.indexes_before', 'b42.default.', 'b42.updated_by_existed.', 'b42.contract_required_true_ids']) expect(cols, k).toContain(k);
    expect(cols).toContain("format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s'");
    expect(cols).toContain('ON CONFLICT (k) DO NOTHING');
    // 撤回端：執行存檔的語句、依 id 清單刪區域、只移除新建的索引與欄位、找不到存檔 RAISE
    expect(rb).toContain("jsonb_array_elements_text(j -> 'statements')");
    expect(rb).toContain("EXECUTE s");
    expect(rb).toContain("b42.region_ids_before");
    expect(rb).not.toMatch(/r\.code ~/);
    expect(rb).toContain('DROP COLUMN IF EXISTS updated_by');
    expect(rb).toContain('uq_ga_service_categories_code');
    expect((rb.match(/RAISE EXCEPTION/g) || []).length).toBeGreaterThanOrEqual(3);
    // 正式區 42、43 的撤回同樣依存檔，不再寫死 DEV 原況
    const p42 = read('docs/vue-workspace/parity-plan/m7m8-sql/42-b6-vendor-columns-rollback.sql');
    const p43 = read('docs/vue-workspace/parity-plan/m7m8-sql/43-b6-vendor-rls-rollback.sql');
    expect(p42).toContain('b42.region_ids_before');
    expect(p42).not.toMatch(/SET DEFAULT true/);
    expect(p43).toContain('b43.policies.');
    expect(p43).not.toContain('service_center.access');
    // 舊的政策備份檔仍保留供對照
    const backup = read('supabase/workspace-dev/_backup/20261118_b6_vendor_policies_before_b6.sql');
    expect(backup).toContain('CREATE POLICY');
  });
});

describe('G20 縣市行政區固定資料（冪等）', () => {
  const src = read('supabase/migration_general_affairs_taiwan_admin_regions.sql');
  it('只用 ON CONFLICT DO NOTHING，不覆蓋總務編輯；沒有 DO UPDATE', () => {
    expect(cols).not.toMatch(/DO UPDATE/);
    expect((cols.match(/ON CONFLICT \(code\) DO NOTHING/g) || []).length).toBe(4);
  });
  it('筆數與來源檔一致：22 縣市、行政區名單逐條相同，並補上來源檔依賴的台灣與四大區', () => {
    const cities = [...src.matchAll(/\('[^']+', '([A-Z]{3})', 'TW-[A-Z]', \d+\)/g)].map((m) => m[1]);
    expect(cities).toHaveLength(22);
    const districtBlock = (s: string) => s.slice(s.indexOf('district_seed'));
    const names = (s: string) => [...districtBlock(s).matchAll(/\('([A-Z]{3})', ARRAY\[([^\]]*)\]\)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(names(cols)).toEqual(names(src));
    expect(names(cols)).toHaveLength(22);
    const districts = names(src).reduce((n, x) => n + x.split(':')[1].split(',').length, 0);
    expect(districts).toBeGreaterThan(330);
    for (const code of ['TW', 'TW-N', 'TW-C', 'TW-S', 'TW-E', 'TW-O']) expect(cols).toContain(`'${code}'`);
    // 縣市由來源檔 city_seed 帶入（行內逐條相同）
    for (const c of cities) expect(cols).toContain(`'${c}'`);
  });
  it('code 唯一索引先建立（來源檔的 ON CONFLICT (code) 需要它）', () => {
    expect(cols.indexOf('uq_ga_service_regions_code')).toBeGreaterThan(0);
    expect(cols.indexOf('uq_ga_service_regions_code')).toBeLessThan(cols.indexOf('INSERT INTO public.ga_service_regions'));
  });
});

describe('G20-G21 函式（100000）', () => {
  const publicFns = [...rpc.matchAll(/CREATE OR REPLACE FUNCTION public\.(ga_ws_\w+)\(([^)]*)\)/g)].map((m) => m[1]);
  const allFns = [...rpc.matchAll(/CREATE OR REPLACE FUNCTION public\.(ga_\w+)\(([^)]*)\)/g)].map((m) => ({ name: m[1], args: m[2] }));
  it('對外函式 11 支，前綴 ga_ws_vendor_／ga_ws_svc_category_／ga_ws_svc_region_（不與第 2 批 ga_ws_category_ 撞名）', () => {
    expect(publicFns.sort()).toEqual(['ga_ws_svc_category_get', 'ga_ws_svc_category_list', 'ga_ws_svc_category_save', 'ga_ws_svc_region_get', 'ga_ws_svc_region_list', 'ga_ws_svc_region_save',
      'ga_ws_vendor_get', 'ga_ws_vendor_list', 'ga_ws_vendor_options', 'ga_ws_vendor_save', 'ga_ws_vendor_set_status']);
    for (const n of publicFns) expect(n).not.toMatch(/^ga_ws_category_/);
  });
  it('有權限判斷的函式全是 SECURITY DEFINER、固定 search_path；對外函式授權 authenticated 並撤銷 PUBLIC／anon', () => {
    const chunks = rpc.split('CREATE OR REPLACE FUNCTION ').slice(1);
    for (const c of chunks) {
      const name = c.slice(0, c.indexOf('('));
      expect(c.slice(0, 1200), name).toMatch(/SET search_path TO 'public', 'pg_temp'/);
      if (name.startsWith('ga_ws_')) expect(c.slice(0, 600), name).toMatch(/SECURITY DEFINER/);
    }
    for (const n of publicFns) {
      expect(rpc).toMatch(new RegExp(`REVOKE ALL ON FUNCTION [^;]*public\\.${n}\\(`));
      expect(rpc).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION [^;]*public\\.${n}\\([^;]*TO authenticated`));
    }
    expect(rpc).toMatch(/REVOKE ALL ON FUNCTION public\.ga_vd_can_view\(uuid\)[^;]*FROM PUBLIC, anon, authenticated/);
  });
  it('權限只用 has_permission（照正式區語意）：不用 current_user_has_permission、不看 profiles.role、不查 roles.is_active', () => {
    const code = rpc.replace(/--.*\n/g, '');
    expect(code).not.toContain('current_user_has_permission');
    expect(code).not.toMatch(/profiles[^;]*\brole\b\s*=/);
    expect(code).not.toContain('is_active');
    expect(code).toContain("has_permission(v_uid, 'general_affairs.service_category.manage')");
  });
  it('每個 ga_ws 函式都回 {ok,status,...} 並以 ga_rq_catch 轉出錯誤；寫入函式都檢查 expected_updated_at 與 STALE', () => {
    for (const n of publicFns) {
      const body = rpc.slice(rpc.indexOf(`FUNCTION public.${n}(`), rpc.indexOf('$$;', rpc.indexOf(`FUNCTION public.${n}(`)));
      expect(body, n).toContain('ga_rq_catch(SQLERRM, SQLSTATE)');
      expect(body, n).toContain("'ok', true");
      if (/_save$|set_status$/.test(n)) {
        expect(body, n).toContain('EXPECTED_REQUIRED');
        expect(body, n).toContain("'STALE'");
      }
    }
  });
  it('V1：帳務機密 8 欄只出現在完整版 JSON（p_full），精簡版 v_base 沒有', () => {
    const json = rpc.slice(rpc.indexOf('FUNCTION public.ga_vd_json('), rpc.indexOf('REVOKE ALL ON FUNCTION public.ga_vd_can_view'));
    const base = json.slice(json.indexOf('v_base := '), json.indexOf('IF NOT p_full'));
    const full = json.slice(json.indexOf('IF NOT p_full'));
    for (const f of VENDOR_SECRET_FIELDS) {
      expect(base, f).not.toContain(`'${f}'`);
      // 銀行四欄（第 4.5 批）由 20261119150000 讀出現行定義替換加入完整版 JSON，不在第 6 批原檔；另在 G45 單元測試驗證。
      if (!f.startsWith('bank_')) expect(full, f).toContain(`'${f}'`);
    }
    // 下拉：統編與付款條件只在有權限時才併入
    const opt = rpc.slice(rpc.indexOf('FUNCTION public.ga_ws_vendor_options('), rpc.indexOf('================ 3. 服務分類'));
    expect(opt).toContain('CASE WHEN v_billing THEN');
    const optBase = opt.slice(opt.indexOf("jsonb_build_object('id'"), opt.indexOf("'contact_phone', v.contact_phone) AS j"));
    for (const f of VENDOR_SECRET_FIELDS) expect(optBase, f).not.toContain(`'${f}'`);
  });
  it('沒有任何刪除函式或 DELETE 語句（廠商停用、分類區域不可刪）', () => {
    expect(rpc.replace(/--.*\n/g, '')).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(allFns.filter((f) => /delete|remove/i.test(f.name))).toEqual([]);
  });
  it('名稱正規化字尾與統編權重與 TS 一致', () => {
    const ts = read('lib/workspace/general-affairs/vendor-rules.ts');
    const sqlSuffix = /regexp_replace\(v, '\(([^)]+)\)\$'/.exec(rpc)?.[1];
    const tsSuffix = /const SUFFIX = \/\(([^)]+)\)\$\//.exec(ts)?.[1];
    expect(sqlSuffix).toBeTruthy();
    expect(sqlSuffix).toBe(tsSuffix);
    expect(rpc).toContain('ARRAY[1, 2, 1, 2, 1, 2, 4, 1]');
    expect(ts).toContain('[1, 2, 1, 2, 1, 2, 4, 1]');
  });
  it('rollback 移除本檔建立的每個函式', () => {
    const rb = dev(`${RPC}.rollback.sql`);
    for (const f of allFns) expect(rb, f.name).toContain(`public.${f.name}(`);
    expect(rb).not.toMatch(/DROP TABLE|DELETE FROM/);
  });
});

describe('G20-G21 DEV 測試角色（130000）', () => {
  it('代碼一律 vue_workspace_ga6_ 開頭、不動既有 vue_workspace_ga_ 角色、權限碼只用已存在的', () => {
    const codes = [...seed.matchAll(/'(vue_workspace_[a-z0-9_]+)', jsonb_build_object\('name'/g)].map((m) => m[1]);
    expect(codes).toHaveLength(6);
    for (const c of codes) expect(c).toMatch(/^vue_workspace_ga6_/);
    expect(codes.sort()).toEqual(['vue_workspace_ga6_cat_only', 'vue_workspace_ga6_coop_only', 'vue_workspace_ga6_ga_all', 'vue_workspace_ga6_util_mgr', 'vue_workspace_ga6_util_view', 'vue_workspace_ga6_vendor_mgr']);
    expect(seed).toContain("NOT LIKE 'vue_workspace_ga6");
    const rb = dev(`${SEED}.rollback.sql`);
    expect(rb).toContain("LIKE 'vue\\_workspace\\_ga6\\_%'");
    expect(rb).not.toMatch(/vue_workspace_ga_/);
  });
  it('只有分類區域者沒有 vendor 權限；只有合作紀錄者只有 cooperation_record.view', () => {
    const block = (code: string) => seed.slice(seed.indexOf(`'${code}', jsonb_build_object`), seed.indexOf(')),', seed.indexOf(`'${code}', jsonb_build_object`)));
    expect(block('vue_workspace_ga6_cat_only')).not.toContain('vendor.');
    expect(block('vue_workspace_ga6_coop_only')).toContain('cooperation_record.view');
    expect(block('vue_workspace_ga6_coop_only')).not.toMatch(/vendor\.|service_category|service_region/);
  });
});
