import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { reconcilePharmacistTransfers } from '../../../lib/pharmacist-transfer-reconciliation';

// P01 單元層：藥師名冊（督導區總覽）的判定邏輯逐條對照舊版。
// 1. 原始碼守衛：新版 lib/workspace/pharmacist-overview.ts 的「快照同步、督導區對應、變化類型判定」區塊，
//    與舊版 app/admin/pharmacist-management/page.tsx 的同一區塊（去除排版與除錯 log 後）必須完全一致；
//    任何一邊單獨改動就會失敗，提醒另一邊同步。
// 2. 調店、升遷「次月生效」：非整月調店當月維持原店，次月才生效（兩邊共用 reconcilePharmacistTransfers）。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 去除 console.log 敘述、引號差異、括號、逗號、分號與所有空白。 */
function squash(code: string) {
  return code
    .replace(/^\s*console\.log\([^\n]*\);?\s*$/gm, '')
    .replace(/"/g, "'")
    .replace(/[(),;\s]/g, '');
}

function between(code: string, from: string, to: string) {
  const a = code.indexOf(from);
  const b = code.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`找不到區塊 ${from} … ${to}`);
  return code.slice(a, b);
}

const legacy = read('app/admin/pharmacist-management/page.tsx');
const native = read('lib/workspace/pharmacist-overview.ts');

describe('P01 藥師名冊判定：新版與舊版原始碼逐條一致', () => {
  it('快照同步 ensureSnapshotForMonth 到變化類型判定（missingZoneRows 之前），整段一致', () => {
    const l = between(legacy, 'async function ensureSnapshotForMonth', 'const missingZoneRows');
    const n = between(native, 'async function ensureSnapshotForMonth', 'const missingZoneRows');
    expect(l.length).toBeGreaterThan(20000); // 空洞檢查：確實比到了大段邏輯
    expect(squash(n)).toBe(squash(l));
  });

  it('變化類型字串齊全：離職、新增任職、門市異動、職級異動、門市/職級異動、留職停薪、次月生效備註', () => {
    const block = squash(between(native, 'let changeType =', 'const missingZoneRows'));
    for (const text of ["changeType='無變更'", "'離職'", "'新增任職'", "'門市異動'", "'職級異動'", "'門市/職級異動'", "'留職停薪'", '調店（次月生效）', '升遷（次月生效）']) {
      expect(block, text).toContain(text);
    }
  });

  it('門市卡片與摘要數字的組裝一致（scopedStoreList 到 summary 結束）', () => {
    const cut = (code: string) => {
      const a = code.indexOf('const scopedStoreList');
      const b = code.indexOf('const summary = {');
      const end = code.indexOf('};', b);
      return squash(code.slice(a, end));
    };
    expect(cut(native)).toBe(cut(legacy));
  });

  it('兩邊共用同一組名冊模組（快照補帶與調店對帳），不各自複製', () => {
    for (const code of [legacy, native]) {
      expect(code).toMatch(/from ['"]@\/lib\/pharmacist-snapshot-carry['"]/);
      expect(code).toMatch(/from ['"]@\/lib\/pharmacist-transfer-reconciliation['"]/);
    }
  });

  it('門市範圍：edit 或 monthly.status.view_all 看全部在用門市，否則只看自己負責的門市', () => {
    const l = squash(legacy.slice(legacy.indexOf('let storeIds'), legacy.indexOf('let storeIds') + 700));
    const n = squash(native.slice(native.indexOf('let storeIds'), native.indexOf('let storeIds') + 700));
    expect(l).toContain('ifcanEditModule||canViewAllMonthly');
    expect(n).toContain('ifcanEditModule||canViewAllMonthly');
    expect(l).toContain("from'store_managers'");
    expect(n).toContain("from'store_managers'");
    expect(l).toContain("eq'is_active'true");
    expect(n).toContain("eq'is_active'true");
  });
});

describe('P01 調店次月生效判定（reconcilePharmacistTransfers）', () => {
  const stores = [
    { id: 'old', store_name: '舊店' },
    { id: 'new', store_name: '新店' },
  ];
  const row = { id: 's1', employee_code: 'ZT9001', store_id: 'old', position: '藥師', is_active: true };
  const transfer = { employee_code: 'ZT9001', movement_type: 'store_transfer', store_id: 'new', movement_date: '2099-03-01' };
  const at = (movements: any[], month: string, scope = stores) => reconcilePharmacistTransfers([row], movements, month, scope);

  it('整月調店（1 日）：當月即在新店；之前月份仍在舊店', () => {
    expect(at([transfer], '2099-03')[0].store_id).toBe('new');
    expect(at([transfer], '2099-02')[0].store_id).toBe('old');
  });
  it('非整月調店（15 日）：當月維持舊店，次月才生效', () => {
    const partial = { ...transfer, movement_date: '2099-03-15' };
    expect(at([partial], '2099-03')[0].store_id).toBe('old');
    expect(at([partial], '2099-04')[0].store_id).toBe('new');
  });
  it('跨年：12 月 15 日調店，次年 1 月生效', () => {
    const partial = { ...transfer, movement_date: '2098-12-15' };
    expect(at([partial], '2098-12')[0].store_id).toBe('old');
    expect(at([partial], '2099-01')[0].store_id).toBe('new');
  });
  it('權限範圍：只看得到舊店的人，調店後從名冊消失；只看得到新店的人，調店後才看到', () => {
    expect(at([transfer], '2099-04', [stores[0]])).toHaveLength(0);
    expect(at([transfer], '2099-04', [stores[1]])[0].store_id).toBe('new');
  });
  it('同一人在新舊店各有一筆快照：只留目的地那筆', () => {
    const both = reconcilePharmacistTransfers([row, { ...row, id: 's2', store_id: 'new' }], [transfer], '2099-04', stores);
    expect(both).toHaveLength(1);
    expect(both[0].id).toBe('s2');
  });
  it('調店後又重新入職原店：以最後一筆異動為準', () => {
    const rehire = { employee_code: 'ZT9001', movement_type: 'onboarding', store_id: 'old', movement_date: '2099-04-01' };
    expect(at([transfer, rehire], '2099-05')[0].store_id).toBe('old');
  });
  it('員編大小寫不影響比對；不改動輸入資料', () => {
    const lower = { ...transfer, employee_code: 'zt9001' };
    expect(at([lower], '2099-03')[0].store_id).toBe('new');
    expect(row.store_id).toBe('old');
  });
});
