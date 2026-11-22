import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPORT_BY_KEY,
  EXPORT_DEFINITIONS,
  canExportStore,
  canOpenMonthlyExport,
  canUseExport,
  deriveExportStoreStatus,
  exportAccess,
  exportFileName,
  findNonExportableIds,
  isExportYearMonth,
  normalizeStoreIds,
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

describe('規格 A.3 門市 id 檢查（不再擋未提交）', () => {
  const row = (id: string, code: string, status: ExportStoreRow['store_status']): ExportStoreRow => ({ id, store_code: code, store_name: `店${code}`, total_employees: 1, submitted_count: 0, confirmed_count: 0, store_status: status });
  const stores = [row('a', 'ZT01', 'pending'), row('b', 'ZT02', 'submitted'), row('c', 'ZT03', 'confirmed'), { ...row('x', 'ZT09', 'pending'), is_active: false }];
  it('normalizeStoreIds：trim、小寫、只接受標準 UUID，其餘一律 null', () => {
    const id = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
    expect(normalizeStoreIds([` ${id} `])).toEqual([id.toLowerCase()]);
    expect(normalizeStoreIds([])).toEqual([]);
    for (const bad of [`{${id}}`, id.replace(/-/g, ''), 'zzz', '', 123, null]) expect(normalizeStoreIds([bad]), String(bad)).toBeNull();
    expect(normalizeStoreIds([id, 'zzz'])).toBeNull();
  });
  it('只擋不存在的門市 id；未提交與停用門市都視為存在', () => {
    expect(findNonExportableIds(['a', 'b', 'x'], stores)).toEqual([]);
    expect(findNonExportableIds(['b', 'zzz', 'A'], stores)).toEqual(['zzz']);
  });
  it('模組不再提供未提交守衛，包裝層也不再回 unsubmitted', () => {
    expect(read('lib/workspace/monthly-export.ts')).not.toContain('findUnsubmittedStores');
    const route = read('app/api/workspace/monthly-export/[resource]/route.ts');
    expect(route).not.toContain('unsubmitted');
    expect(route).not.toContain('findUnsubmittedStores');
  });
});

describe('規格 A.1 權限：全部只看 monthly.export.download', () => {
  it('舊 route 的權限碼對照（防漂移）', () => {
    for (const r of ['download', 'actual-staff-points', 'roster', 'transport', 'meal-allowance', 'spring-festival-bonus', 'stores']) {
      expect(read(`app/api/export-monthly-status/${r}/route.ts`), r).toContain("'monthly.export.download'");
    }
  });
  it('exportAccess／canOpen／canUseExport 只依 hasGeneral', () => {
    const yes = exportAccess({ hasGeneral: true });
    const no = exportAccess({ hasGeneral: false });
    expect(yes).toEqual({ general: true });
    expect(canOpenMonthlyExport(yes)).toBe(true);
    expect(canOpenMonthlyExport(no)).toBe(false);
    for (const d of EXPORT_DEFINITIONS) {
      expect(canUseExport(yes, d.key), d.key).toBe(true);
      expect(canUseExport(no, d.key), d.key).toBe(false);
    }
  });
  it('定義表：九支都是 general，只有 support-hours 不依門市', () => {
    expect(EXPORT_DEFINITIONS.every((d) => d.permission === 'general')).toBe(true);
    expect(EXPORT_DEFINITIONS.filter((d) => !d.storeScoped).map((d) => d.key)).toEqual(['support-hours']);
  });
  it('包裝層：資源一律先檢查 monthly.export.download，支援時數不套用角色判斷，門市清單用 admin 讀全部', () => {
    const route = read('app/api/workspace/monthly-export/[resource]/route.ts');
    expect(route).toContain('!access.general');
    expect(route).toContain('buildSupportHoursResponse');
    expect(route).not.toContain('scopedExportStoreIds');
    expect(route).toContain('allStores: true, activeOnly: true');
  });
});

describe('W02 包裝層', () => {
  const route = read('app/api/workspace/monthly-export/[resource]/route.ts');
  it('八支舊版產檔 handler 被包裝；支援時數共用搬出的產檔函式（不重寫）', () => {
    expect(route).toContain('@/lib/workspace/support-hours-export');
    expect(read('app/api/export-monthly-status/support-hours/route.ts')).toContain('buildSupportHoursResponse');
    for (const r of ['download', 'actual-staff-points', 'roster', 'transport', 'single-item-bonus', 'talent-cultivation-bonus', 'meal-allowance', 'spring-festival-bonus']) {
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
  it('改回舊版的條目已移除', () => {
    const ids = entries.map((e) => e.id);
    for (const gone of ['w02-unsubmitted-rejected', 'w02-stores-scoped-for-single-item']) expect(ids, gone).not.toContain(gone);
  });
  it('剩餘條目都已核可且有 match', () => {
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      expect(e.approvedBy, e.id).toBe('user (2026-11-04)');
      expect(e.match, e.id).toBeTruthy();
    }
  });
});
