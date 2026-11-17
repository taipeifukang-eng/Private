import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { vendorAbilities } from '@/lib/workspace/general-affairs/vendor-rules';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import {
  ancestorsOf, descendantsOf, emptyVendorForm, flattenTree, formFromDetail, payloadFromForm, stepProblem, toggleRegion, vendorDisplayName, VENDOR_STEPS,
  type VendorDetailData,
} from '../../../vue-workspace/src/lib/ga-vendors';

// 第 6 批 G20-G21-ui（畫面層）：導覽旗標與側欄與 API 權限一致、頁面登錄、表單規則（四步驟無附件、需簽合約預設否、統編必填與格式、日期先後）、
// 區域樹（勾子層連祖先一起勾）、新增與編輯送出的欄位、列印樣式、採購單連結與工單廠商下拉的規則（原始碼層級）、工單進度 SQL 的廠商狀態檢查。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (...allowed: string[]) => (...codes: string[]) => codes.some((c) => allowed.includes(c));
const C = {
  vView: 'general_affairs.vendor.view', vManage: 'general_affairs.vendor.manage', cView: 'general_affairs.service_category.view', cManage: 'general_affairs.service_category.manage',
  rView: 'general_affairs.service_region.view', rManage: 'general_affairs.service_region.manage', coop: 'general_affairs.cooperation_record.view',
};

describe('G20/G21 導覽旗標、側欄與 API 權限一致', () => {
  const f = (...c: string[]) => gaFlags(has(...c), false, false, false, has(...c));
  it('三個頁面的入口條件：廠商＝廠商檢視或管理；分類＝分類檢視或管理；區域＝區域檢視或管理', () => {
    expect(f(C.vView)).toMatchObject({ gaVendors: true, gaVendorCategories: false, gaVendorRegions: false, gaVendorManage: false });
    expect(f(C.vManage)).toMatchObject({ gaVendors: true, gaVendorManage: true });
    expect(f(C.cView)).toMatchObject({ gaVendors: false, gaVendorCategories: true, gaVendorRegions: false });
    expect(f(C.rManage)).toMatchObject({ gaVendors: false, gaVendorCategories: false, gaVendorRegions: true });
    expect(f(C.coop)).toMatchObject({ gaVendors: false, gaVendorCategories: false, gaVendorRegions: false });
    expect(f()).toMatchObject({ gaVendors: false, gaVendorCategories: false, gaVendorRegions: false, gaVendorManage: false });
  });
  it('入口旗標與 vendorAbilities（API 用的同一組權限常數）逐項一致', () => {
    for (const c of Object.values(C)) {
      const a = vendorAbilities(new Set([c]));
      expect(f(c).gaVendors, c).toBe(a.canView);
      expect(f(c).gaVendorManage, c).toBe(a.canManage);
    }
  });
  it('管理員後備不放寬：has 為真但資料庫語意沒有權限時，頁面旗標是 false（避免看得到打不開）', () => {
    const adminLike = gaFlags(() => true, false, false, false, () => false);
    expect(adminLike).toMatchObject({ gaVendors: false, gaVendorCategories: false, gaVendorRegions: false, gaVendorManage: false });
  });
  it('舊網址對到新版 kind；合作紀錄與採購分析在第 6 批 G22 移植', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors']).toEqual({ kind: 'ga-vendors', flag: 'gaVendors' });
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/categories']).toEqual({ kind: 'ga-vendor-categories', flag: 'gaVendorCategories' });
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/regions']).toEqual({ kind: 'ga-vendor-regions', flag: 'gaVendorRegions' });
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/stats']).toEqual({ kind: 'ga-vendor-stats', flag: 'gaVendorStats' });
    expect(GA_PAGE_BY_HREF['/general-affairs/vendors/purchases']).toEqual({ kind: 'ga-purchase-analysis', flag: 'gaPurchaseAnalysis' });
  });
  it('kind、標題、權限鍵與頁面登錄都在', () => {
    for (const k of ['ga-vendors', 'ga-vendor-categories', 'ga-vendor-regions'] as const) {
      expect(WORKSPACE_TAB_KINDS).toContain(k);
    }
    expect(WORKSPACE_PAGE_META['ga-vendors']).toMatchObject({ title: '廠商資料', permission: ['gaVendors'] });
    expect(WORKSPACE_PAGE_META['ga-vendor-categories']).toMatchObject({ title: '服務分類', permission: ['gaVendorCategories'] });
    expect(WORKSPACE_PAGE_META['ga-vendor-regions']).toMatchObject({ title: '服務區域', permission: ['gaVendorRegions'] });
    const pages = read('vue-workspace/src/workspace-pages.ts');
    expect(pages).toMatch(/"ga-vendors": Vendors,/);
    expect(pages).toMatch(/"ga-vendor-categories": VendorCategories,/);
    expect(pages).toMatch(/"ga-vendor-regions": VendorRegions,/);
  });
  const nav = (perm: string[]) => {
    const p = new Set(perm);
    return gaNavigation({ has: (...c: string[]) => c.some((x) => p.has(x)), permissions: p as any, roleCodes: new Set(['x']), isAdmin: false });
  };
  const kinds = (g: ReturnType<typeof nav>) => g.flatMap((x) => x.items.flatMap((i) => [i, ...(i.children || [])])).map((i) => i.kind).filter(Boolean);
  it('側欄：只有分類權限的人看得到「服務分類」看不到「廠商資料」；只有合作紀錄權限的人三頁都沒有（績效頁後段才移植）；廠商管理者看得到廠商資料', () => {
    expect(kinds(nav([C.cView]))).toContain('ga-vendor-categories');
    expect(kinds(nav([C.cView]))).not.toContain('ga-vendors');
    expect(kinds(nav([C.coop]))).not.toEqual(expect.arrayContaining(['ga-vendors']));
    expect(kinds(nav([C.vManage]))).toContain('ga-vendors');
    expect(kinds(nav([]))).not.toContain('ga-vendors');
    const item = nav([C.vManage]).flatMap((g) => g.items).find((i) => i.kind === 'ga-vendors');
    expect(item?.label).toBe('廠商資料');
  });
});

describe('廠商表單規則', () => {
  it('只有四個步驟，沒有附件步驟（舊版假附件移除）', () => {
    expect(VENDOR_STEPS).toEqual(['基本資料', '服務範圍', '聯絡人', '合作與帳務']);
    expect(VENDOR_STEPS.join('')).not.toMatch(/附件/);
    const src = read('vue-workspace/src/components/ga/VendorForm.vue');
    expect(src).not.toMatch(/type="file"/);
    expect(src).toMatch(/既有檔名（未存檔/);
  });
  it('新增的預設值：需簽合約為否、優先廠商為否、類型公司、服務地址同公司地址', () => {
    expect(emptyVendorForm()).toMatchObject({ contract_required: false, preferred_vendor: false, vendor_type: 'company', same_service_address: true, payment_methods: [], service_category_ids: [] });
  });
  it('第一步：名稱必填；新增時公司與工作室統編必填（個人可留空）；統編 8 碼數字（全形與空白先正規化）；編輯不強制統編', () => {
    const f = emptyVendorForm();
    expect(stepProblem(f, 0, true)).toBe('請填寫廠商名稱');
    f.name = '測試';
    expect(stepProblem(f, 0, true)).toMatch(/統一編號/);
    expect(stepProblem(f, 0, false)).toBe('');
    f.vendor_type = 'personal';
    expect(stepProblem(f, 0, true)).toBe('');
    f.vendor_type = 'company';
    f.tax_id = '1234';
    expect(stepProblem(f, 0, true)).toBe('統一編號要是 8 碼數字');
    f.tax_id = '１２３４ ５６７８';
    expect(stepProblem(f, 0, true)).toBe('');
  });
  it('聯絡人 Email 格式、合約到期日不能早於合作開始日', () => {
    const f = emptyVendorForm();
    f.email = 'abc';
    expect(stepProblem(f, 2, true)).toBe('Email 格式不正確');
    f.email = 'a@b.co';
    expect(stepProblem(f, 2, true)).toBe('');
    f.cooperation_start_date = '2038-05-01';
    f.contract_end_date = '2038-04-30';
    expect(stepProblem(f, 3, true)).toBe('合約到期日不能早於合作開始日');
    f.contract_end_date = '2038-05-01';
    expect(stepProblem(f, 3, true)).toBe('');
  });
  it('送出的欄位：標籤與品牌拆成清單；服務地址同公司地址時不送服務地址；沒有帳務權限時完全不送帳務欄位與統編', () => {
    const f = emptyVendorForm();
    Object.assign(f, { name: ' 甲廠商 ', tax_id: '12345675', brands: 'A、B,A', tags: '冷氣，水電', billing_title: '抬頭', payment_terms: '現結', service_city: '台北市', same_service_address: true });
    const p = payloadFromForm(f, true);
    expect(p).toMatchObject({ name: '甲廠商', brands: ['A', 'B'], tags: ['冷氣', '水電'], tax_id: '12345675', billing_title: '抬頭', payment_terms: '現結', service_city: '', contract_required: false });
    const q = payloadFromForm(f, false);
    for (const k of ['tax_id', 'billing_title', 'billing_address', 'invoice_type', 'payment_terms', 'payment_methods', 'accounting_notes']) expect(q, k).not.toHaveProperty(k);
    expect(q).not.toHaveProperty('attachment_names');
    expect(p).not.toHaveProperty('attachment_names');
  });
  it('由詳情還原表單再送出，內容不變（編輯不會誤清欄位）', () => {
    const d = {
      id: 'x', name: '乙', alias: '丙', vendor_type: 'studio', status: 'active', tax_id: '12345675', contact_name: '王', contact_phone: '0912', phone: null, email: 'a@b.co', tags: ['t'], service_category_ids: ['c1'], service_region_ids: ['r1'],
      contract_required: true, contract_end_date: '2038-06-01', contract_due: false, updated_at: 't', founded_date: null, fax: null, website: null, city: '台北市', district: null, address: '某路', service_city: null, service_district: null, service_address: null,
      same_service_address: true, line_id: null, description: null, brands: ['A'], equipment_types: [], service_capability_note: null, cooperation_start_date: null, preferred_vendor: false, cooperation_notes: null, attachment_names: ['舊.pdf'],
      created_at: 't', updated_by_name: null, billing_title: 'B', payment_methods: ['匯款'], service_categories: [], service_regions: [],
    } as unknown as VendorDetailData;
    const p = payloadFromForm(formFromDetail(d), true);
    expect(p).toMatchObject({ name: '乙', alias: '丙', vendor_type: 'studio', tax_id: '12345675', contact_name: '王', contract_required: true, contract_end_date: '2038-06-01', brands: ['A'], tags: ['t'], payment_methods: ['匯款'], service_category_ids: ['c1'], city: '台北市' });
    expect(JSON.stringify(p)).not.toContain('舊.pdf');
  });
  it('舊單據上的廠商名稱：停用加（已停用）、暫停加（暫停）、合作中原樣', () => {
    expect(vendorDisplayName('甲', 'inactive')).toBe('甲（已停用）');
    expect(vendorDisplayName('甲', 'paused')).toBe('甲（暫停）');
    expect(vendorDisplayName('甲', 'active')).toBe('甲');
  });
});

describe('樹狀清單與區域勾選', () => {
  const rows = [
    { id: 'tw', parent_id: null, name: '台灣', sort_order: 1 },
    { id: 'n', parent_id: 'tw', name: '北部', sort_order: 1 },
    { id: 'tpe', parent_id: 'n', name: '台北市', sort_order: 1 },
    { id: 'dz', parent_id: 'tpe', name: '大安區', sort_order: 1 },
    { id: 'ntp', parent_id: 'n', name: '新北市', sort_order: 2 },
    { id: 'orph', parent_id: 'gone', name: '孤兒', sort_order: 9 },
  ];
  it('攤平成深度優先清單並帶深度；找不到上層的視為最上層', () => {
    const flat = flattenTree(rows);
    expect(flat.map((r) => `${r.depth}:${r.name}`)).toEqual(['0:台灣', '1:北部', '2:台北市', '3:大安區', '2:新北市', '0:孤兒']);
  });
  it('祖先與子孫', () => {
    expect(ancestorsOf(rows, 'dz')).toEqual(['tpe', 'n', 'tw']);
    expect(descendantsOf(rows, 'n').sort()).toEqual(['dz', 'ntp', 'tpe']);
  });
  it('勾行政區會連祖先一起勾；取消縣市會連底下的行政區一起取消', () => {
    const a = toggleRegion(rows, [], 'dz', true).sort();
    expect(a).toEqual(['dz', 'n', 'tpe', 'tw']);
    const b = toggleRegion(rows, a, 'tpe', false).sort();
    expect(b).toEqual(['n', 'tw']);
  });
  it('資料有循環也不會無限迴圈', () => {
    const cyc = [{ id: 'a', parent_id: 'b', name: 'a' }, { id: 'b', parent_id: 'a', name: 'b' }];
    expect(ancestorsOf(cyc, 'a').length).toBeLessThanOrEqual(2);
    expect(flattenTree(cyc).length).toBeLessThanOrEqual(2);
  });
});

describe('原始碼層級的畫面規則', () => {
  it('填寫表：只印啟用分類與啟用縣市；列印時只留表單（A4）；預覽與列印內容同一元件', () => {
    const sheet = read('vue-workspace/src/components/ga/VendorPrintSheet.vue');
    expect(sheet).toMatch(/status === "active"\)/);
    expect(sheet).toMatch(/region_type === "city"/);
    const css = read('vue-workspace/src/style.css');
    expect(css).toMatch(/\.vendor-print-output\{display:none\}/);
    expect(css).toMatch(/@page\{size:A4 portrait/);
    expect(css).toMatch(/body:has\(>\.vendor-print-output\)>\*:not\(\.vendor-print-output\)\{display:none!important\}/);
    const dlg = read('vue-workspace/src/components/ga/VendorPrintDialog.vue');
    expect(dlg).toMatch(/<Teleport to="body">/);
    expect(dlg).toMatch(/status=active/);
  });
  it('採購單頁：只有廠商管理權限者看得到連到新版廠商頁的連結，其餘顯示「請洽總務新增」；不再連舊版', () => {
    const src = read('vue-workspace/src/pages/ga/PurchaseOrderEdit.vue');
    expect(src).toMatch(/v-if="canManageVendor"[\s\S]{0,200}openGaPage\('ga-vendors'\)/);
    expect(src).toMatch(/請洽總務新增/);
    expect(src).not.toMatch(/去舊版新增供應商/);
    expect(src).toMatch(/gaVendorManage/);
  });
  it('工單進度表單：廠商下拉只給總務端且有更新權限者、只列合作中、留白不送 vendor_id（不清掉原廠商）', () => {
    const wo = read('vue-workspace/src/components/ga/WorkOrderDetail.vue');
    expect(wo).toMatch(/<VendorSelect v-if="gaSide && ab\?\.can_save_progress"/);
    expect(wo).toMatch(/if \(form\.vendorId\) body\.vendor_id = form\.vendorId;/);
    const sel = read('vue-workspace/src/components/ga/VendorSelect.vue');
    expect(sel).toMatch(/v\.status === "active"/);
    expect(sel).toMatch(/留白＝不修改/);
  });
  it('DEV SQL：工單進度新選的廠商要合作中（VENDOR_INACTIVE／VENDOR_NOT_FOUND），沒給 vendor_id 不動；rollback 還原第 5 批版本；套用腳本有登錄這支檔', () => {
    const up = read('supabase/workspace-dev/20261118105000_m7m8_b6_work_order_vendor_check.sql');
    expect(up).toMatch(/VENDOR_INACTIVE/);
    expect(up).toMatch(/VENDOR_NOT_FOUND/);
    expect(up).toMatch(/v_vendor IS DISTINCT FROM v_cur/);
    expect(up).toMatch(/vendor_id = COALESCE\(v_vendor, vendor_id\)/);
    const down = read('supabase/workspace-dev/20261118105000_m7m8_b6_work_order_vendor_check.rollback.sql');
    expect(down).not.toMatch(/VENDOR_INACTIVE/);
    expect(down).toMatch(/vendor_id = COALESCE\(v_vendor, vendor_id\)/);
    expect(read('scripts/apply-workspace-m7m8-b6-dev.cjs')).toMatch(/20261118105000_m7m8_b6_work_order_vendor_check/);
  });
  it('廠商下拉 API 支援只取指定廠商（工單詳情顯示目前廠商名稱，含已停用）', () => {
    const src = read('lib/workspace/general-affairs/vendors.ts');
    expect(src).toMatch(/onlyIds/);
  });
  it('首頁入口：廠商卡導向可進入的第一個廠商頁', () => {
    const c = read('vue-workspace/src/pages/ga/GaCenter.vue');
    expect(c).toMatch(/VENDOR_KINDS = \["ga-vendors", "ga-vendor-categories", "ga-vendor-regions", "ga-vendor-stats", "ga-purchase-analysis"\]/);
    expect(c).toMatch(/data-testid="ga-vendor-entry"/);
  });
  it('失敗一律顯示明確原因：頁面都走 errorText，不再用「此功能尚未開放」', () => {
    for (const p of ['pages/ga/Vendors.vue', 'components/ga/VendorForm.vue', 'components/ga/VendorDetail.vue', 'components/ga/ServiceTreeAdmin.vue']) {
      const s = read(`vue-workspace/src/${p}`);
      expect(s, p).toMatch(/errorText/);
      expect(s, p).not.toMatch(/尚未在目前測試環境開放|MODULE_NOT_AVAILABLE/);
    }
  });
  it('分類與區域頁沒有刪除按鈕（只能停用）', () => {
    const s = read('vue-workspace/src/components/ga/ServiceTreeAdmin.vue');
    expect(s).not.toMatch(/method: "DELETE"/);
    expect(s).not.toMatch(/>\s*刪除\s*</);
  });
});

describe('正式區 SQL 草稿（41 至 44、47）：結構檢查', () => {
  const dir = 'docs/vue-workspace/parity-plan/m7m8-sql/';
  const names = ['42-b6-vendor-columns', '43-b6-vendor-rls', '44-b6-vendor-functions', '47-b6-work-order-vendor-check'];
  it('每份都附 rollback；檔頭只有註解，接著 BEGIN;，最後 COMMIT;（檔頭沒有漏掉 -- 的文字，之前就踩過）', () => {
    for (const n of names) {
      for (const f of [`${n}.sql`, `${n}-rollback.sql`]) {
        const lines = read(dir + f).split('\n');
        const begin = lines.findIndex((l) => l.trim() === 'BEGIN;');
        expect(begin, f).toBeGreaterThan(0);
        for (const l of lines.slice(0, begin)) expect(l.trim() === '' || l.trim().startsWith('--'), `${f}: ${l.slice(0, 40)}`).toBe(true);
        expect(lines.some((l) => l.trim() === 'COMMIT;'), f).toBe(true);
      }
    }
  });
  it('41 是唯讀預覽：只有 SELECT／WITH，沒有任何寫入或結構變更語句；涵蓋重複統編、code 重複、政策全文、角色名單', () => {
    const sql = read(dir + '41-b6-preview-before-apply.sql');
    const code = sql.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('--')).join(String.fromCharCode(10)).replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
    expect(sql).toMatch(/重複統編/);
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/code 重複/);
    expect(sql).toMatch(/purchase_review/);
  });
  it('42 補欄位且預設改 false、code 唯一索引、固定資料冪等；43 三張表都沒有 DELETE 政策；44 沒有 DROP TABLE；47 帶兩個錯誤碼', () => {
    const c = read(dir + '42-b6-vendor-columns.sql');
    expect(c).toMatch(/contract_required SET DEFAULT false/);
    expect(c).toMatch(/uq_ga_service_regions_code/);
    expect(c).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    const r = read(dir + '43-b6-vendor-rls.sql');
    expect(r).not.toMatch(/FOR DELETE|FOR ALL/);
    const f = read(dir + '44-b6-vendor-functions.sql');
    expect(f).not.toMatch(/DROP TABLE/i);
    expect(f).toMatch(/ga_ws_vendor_options/);
    expect(read(dir + '47-b6-work-order-vendor-check.sql')).toMatch(/VENDOR_INACTIVE[\s\S]*VENDOR_NOT_FOUND|VENDOR_NOT_FOUND[\s\S]*VENDOR_INACTIVE/);
  });
  it('README 有「第 6 批」章節、列出 41 至 44 與 47 與套用順序', () => {
    const readme = read(dir + 'README.md');
    expect(readme).toMatch(/## 第 6 批/);
    for (const n of ['41-b6-preview-before-apply', ...names]) expect(readme, n).toContain(n);
    expect(readme).toMatch(/41`（唯讀）→ 沒有 MISSING/);
  });
});
