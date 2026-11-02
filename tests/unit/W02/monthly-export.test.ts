import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPORT_BY_KEY,
  EXPORT_DEFINITIONS,
  canExportStore,
  canOpenMonthlyExport,
  canUseExport,
  canExportSupportHours,
  deriveExportStoreStatus,
  exportAccess,
  exportFileName,
  findNonExportableIds,
  findUnsubmittedStores,
  isExportYearMonth,
  normalizeStoreIds,
  unsubmittedMessage,
  type ExportKey,
  type ExportStoreRow,
} from '@/lib/workspace/monthly-export';
import { loadAllowlist, loadMap, validateMap } from '../../support/parity';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('W02 檔名：照舊版前端 page.tsx 的 a.download 命名', () => {
  const ym = '2099-11';
  const expected: Record<ExportKey, string> = {
    download: `每月人員狀態_${ym}_3間門市.xlsx`,
    'actual-staff-points': `實際人力點值_${ym}.xlsx`,
    roster: `每月門市人員名冊_${ym}.xlsx`,
    transport: `交通費用_${ym}.xlsx`,
    'single-item-bonus': `單品獎金_${ym}.xlsx`,
    'talent-cultivation-bonus': `育才獎金_${ym}.xlsx`,
    'meal-allowance': `誤餐費_${ym}.xlsx`,
    'spring-festival-bonus': `春節出勤獎金_${ym}.xlsx`,
    'support-hours': `門市支援時數_${ym}.xlsx`,
  };
  it('九種下載逐一對照', () => {
    for (const d of EXPORT_DEFINITIONS) expect(exportFileName(d.key, ym, 3), d.key).toBe(expected[d.key]);
    expect(EXPORT_DEFINITIONS.length).toBe(9);
  });
  it('檔名與舊 page.tsx 的 a.download 字面一致（防漂移）', () => {
    const page = read('app/admin/export-monthly-status/page.tsx');
    for (const d of EXPORT_DEFINITIONS) {
      const literal = d.fileName('${yearMonth}', 0).replace('0間門市', '${selectedStoreIds.size}間門市');
      expect(page, d.key).toContain('`' + literal + '`');
    }
  });
});

describe('W02 門市可匯出判斷與狀態推導', () => {
  it('canExportStore：只有 submitted、confirmed', () => {
    expect(canExportStore('submitted')).toBe(true);
    expect(canExportStore('confirmed')).toBe(true);
    for (const v of ['pending', 'draft', '', null, undefined, 'SUBMITTED']) expect(canExportStore(v), String(v)).toBe(false);
  });
  it('deriveExportStoreStatus 與舊 stores route 同一優先序', () => {
    expect(deriveExportStoreStatus('confirmed', 0, 0)).toBe('confirmed');
    expect(deriveExportStoreStatus('submitted', 5, 0)).toBe('submitted'); // 摘要優先於人員列
    expect(deriveExportStoreStatus(null, 1, 3)).toBe('confirmed');
    expect(deriveExportStoreStatus(undefined, 0, 2)).toBe('submitted');
    expect(deriveExportStoreStatus('draft', 0, 0)).toBe('pending');
    expect(deriveExportStoreStatus(null, 0, 0)).toBe('pending');
  });
  it('列表推導與舊 route 原始碼一致（防漂移）', () => {
    const legacy = read('app/api/export-monthly-status/stores/route.ts');
    for (const line of ["summary?.status === 'confirmed'", "summary?.status === 'submitted'", 'confirmedCount > 0', 'submittedCount > 0']) expect(legacy).toContain(line);
  });
  it('isExportYearMonth', () => {
    expect(isExportYearMonth('2099-11')).toBe(true);
    for (const v of ['2099-13', '2099-00', '209-11', '2099/11', '', null, 202611]) expect(isExportYearMonth(v), String(v)).toBe(false);
  });
});

describe('W02-q3 含未提交門市', () => {
  const row = (id: string, code: string, status: ExportStoreRow['store_status']): ExportStoreRow => ({ id, store_code: code, store_name: `店${code}`, total_employees: 1, submitted_count: 0, confirmed_count: 0, store_status: status });
  const stores = [row('a', 'ZT01', 'pending'), row('b', 'ZT02', 'submitted'), row('c', 'ZT03', 'confirmed'), row('d', 'ZT04', 'pending')];
  it('只回傳被選取且未提交者', () => {
    expect(findUnsubmittedStores(['a', 'b', 'c'], stores).map((s) => s.id)).toEqual(['a']);
    expect(findUnsubmittedStores(['b', 'c'], stores)).toEqual([]);
    expect(findUnsubmittedStores([], stores)).toEqual([]);
    expect(findUnsubmittedStores(['zzz'], stores)).toEqual([]); // 清單外（例如已停用）不處理
  });
  it('normalizeStoreIds：trim、小寫、只接受標準 UUID，其餘一律 null', () => {
    const id = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
    expect(normalizeStoreIds([` ${id} `])).toEqual([id.toLowerCase()]);
    expect(normalizeStoreIds([])).toEqual([]);
    for (const bad of [`{${id}}`, id.replace(/-/g, ''), 'zzz', '', 123, null]) expect(normalizeStoreIds([bad]), String(bad)).toBeNull();
    expect(normalizeStoreIds([id, 'zzz'])).toBeNull();
  });
  it('大小寫不同的 id 仍比對得到', () => {
    expect(findNonExportableIds(['b', 'zzz', 'a'], stores)).toEqual(['zzz', 'a']);
    expect(findNonExportableIds(['b', 'c'], stores)).toEqual([]);
    expect(findUnsubmittedStores(['A'], stores).map((s) => s.id)).toEqual(['a']);
  });
  it('訊息列出所有未提交門市', () => {
    const msg = unsubmittedMessage(findUnsubmittedStores(['a', 'd'], stores));
    expect(msg).toContain('ZT01');
    expect(msg).toContain('ZT04');
  });
});

describe('W02-q2 權限：單品獎金、支援時數照舊版', () => {
  const p = (role: string, department = '', job_title = '') => ({ role, department, job_title });
  it('支援時數：admin／supervisor／area_manager，或營業部 manager 且職稱不是需指派職稱', () => {
    expect(canExportSupportHours(p('admin'))).toBe(true);
    expect(canExportSupportHours(p('supervisor'))).toBe(true);
    expect(canExportSupportHours(p('area_manager'))).toBe(true);
    expect(canExportSupportHours(p('manager', '營業部', '經理'))).toBe(true);
    expect(canExportSupportHours(p('manager', '營業一部', ''))).toBe(true);
    for (const t of ['督導', '店長', '代理店長', '督導(代理店長)']) expect(canExportSupportHours(p('manager', '營業部', t)), t).toBe(false);
    expect(canExportSupportHours(p('manager', '行政部', '經理'))).toBe(false);
    expect(canExportSupportHours(p('member', '營業部', '經理'))).toBe(false);
    expect(canExportSupportHours(null)).toBe(false);
    expect(canExportSupportHours(undefined)).toBe(false);
  });
  it('判斷式與舊 support-hours route 原始碼一致（防漂移）', () => {
    const legacy = read('app/api/export-monthly-status/support-hours/route.ts');
    expect(legacy).toContain("['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '')");
    expect(legacy).toContain("profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment");
    expect(legacy).toContain("['admin', 'supervisor', 'area_manager'].includes(profile?.role || '')");
  });
  it('單品獎金舊 route 只檢查登入（沒有 requirePermission）；育才獎金同樣沒有', () => {
    expect(read('app/api/export-monthly-status/single-item-bonus/route.ts')).not.toContain('requirePermission');
    expect(read('app/api/export-monthly-status/talent-cultivation-bonus/route.ts')).not.toContain('requirePermission');
  });
  it('其餘一般匯出舊 route 都檢查 monthly.export.download', () => {
    for (const r of ['download', 'actual-staff-points', 'roster', 'transport', 'meal-allowance', 'spring-festival-bonus', 'stores']) {
      expect(read(`app/api/export-monthly-status/${r}/route.ts`), r).toContain("'monthly.export.download'");
    }
  });
  it('按鈕可見性：只有單品獎金／支援時數權限者，其他一般按鈕不可用', () => {
    const onlyTwo = exportAccess({ hasGeneral: false, hasMonthlyModule: true, profile: p('admin') });
    expect(onlyTwo).toEqual({ general: false, singleItem: true, supportHours: true });
    const usable = EXPORT_DEFINITIONS.filter((d) => canUseExport(onlyTwo, d.key)).map((d) => d.key);
    expect(usable.sort()).toEqual(['single-item-bonus', 'support-hours']);
    const general = exportAccess({ hasGeneral: true, hasMonthlyModule: false, profile: p('member') });
    expect(EXPORT_DEFINITIONS.filter((d) => canUseExport(general, d.key)).map((d) => d.key).sort()).toEqual(
      EXPORT_DEFINITIONS.map((d) => d.key).filter((k) => k !== 'support-hours').sort(),
    );
  });
  it('只符合支援時數角色判斷（無一般匯出、無月結模組）：單品獎金與支援時數可用', () => {
    for (const role of ['admin', 'supervisor', 'area_manager']) {
      const a = exportAccess({ hasGeneral: false, hasMonthlyModule: false, profile: p(role) });
      expect(a, role).toEqual({ general: false, singleItem: true, supportHours: true });
      expect(canOpenMonthlyExport(a)).toBe(true);
    }
    const biz = exportAccess({ hasGeneral: false, hasMonthlyModule: false, profile: p('manager', '營業部', '經理') });
    expect(biz.singleItem).toBe(true);
  });
  it('入口：沒有任何相關權限進不來', () => {
    expect(canOpenMonthlyExport(exportAccess({ hasGeneral: false, hasMonthlyModule: false, profile: p('member') }))).toBe(false);
    expect(canOpenMonthlyExport(exportAccess({ hasGeneral: false, hasMonthlyModule: true, profile: p('member') }))).toBe(true);
    expect(canOpenMonthlyExport(exportAccess({ hasGeneral: false, hasMonthlyModule: false, profile: p('manager', '營業部', '經理') }))).toBe(true);
  });
  it('定義表：只有 single-item 是 login、只有 support-hours 是 support-hours 且不依門市', () => {
    expect(EXPORT_DEFINITIONS.filter((d) => d.permission === 'login').map((d) => d.key)).toEqual(['single-item-bonus']);
    expect(EXPORT_DEFINITIONS.filter((d) => d.permission === 'support-hours').map((d) => d.key)).toEqual(['support-hours']);
    expect(EXPORT_BY_KEY['support-hours'].storeScoped).toBe(false);
  });
});

describe('W02 包裝層', () => {
  const route = read('app/api/workspace/monthly-export/[resource]/route.ts');
  it('九支舊版產檔 handler 全部被包裝（共用產檔邏輯，不重寫）', () => {
    for (const r of ['download', 'actual-staff-points', 'roster', 'transport', 'single-item-bonus', 'talent-cultivation-bonus', 'meal-allowance', 'spring-festival-bonus', 'support-hours']) {
      expect(route, r).toContain(`@/app/api/export-monthly-status/${r}/route`);
    }
    expect(route).toContain('maxDuration');
    expect(route).toContain('checkOrigin');
    expect(route).toContain('guardStoreIds');
  });
  it('導覽改用 monthly-export kind 並已註冊', () => {
    expect(read('lib/workspace/navigation.ts')).toContain('"monthly-export"');
    expect(read('lib/workspace/navigation.ts')).not.toContain('monthly.status.export');
    expect(read('lib/workspace/page-kinds.ts')).toContain('"monthly-export"');
    expect(read('vue-workspace/src/workspace-pages.ts')).toContain('"monthly-export": MonthlyExport');
  });
});

describe('W02 parity map', () => {
  it('map 格式合法，白名單 match.entry 都對應 map 項目', () => {
    const map = loadMap('monthly-export');
    expect(validateMap(map, 'monthly-export')).toEqual([]);
    const ids = new Set(map.entries.map((e) => e.id));
    for (const e of loadAllowlist().filter((x) => x.page === 'monthly-export')) expect(ids.has(e.match!.entry!), e.id).toBe(true);
    for (const d of EXPORT_DEFINITIONS) {
      expect(ids.has(`file-${d.key}`), d.key).toBe(true);
      expect(ids.has(`perm-${d.key}`), d.key).toBe(true);
    }
  });
});

describe('W02 白名單條目', () => {
  const entries = loadAllowlist().filter((e) => e.page === 'monthly-export' || e.id.startsWith('w02-') || e.id.startsWith('nav-monthly-export'));
  it('全部尚未核可（approvedBy 為 null），且都有 match', () => {
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      expect(e.approvedBy, e.id).toBeNull();
      expect(e.match, e.id).toBeTruthy();
    }
  });
});
