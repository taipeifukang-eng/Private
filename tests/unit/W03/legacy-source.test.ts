import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 防漂移：legacy-year.ts 是舊版 app/admin/performance/page.tsx 年度頁計算的逐行移植。
// 舊頁若改了這幾段字面，這個測試會失敗，提醒同步更新對照實作與新版計算。
const page = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'app/admin/performance/page.tsx'), 'utf8');

describe('舊版年度頁計算字面（對照實作的來源）', () => {
  for (const literal of [
    'businessDays: r.business_days || 26,',
    'if (!perf.grossProfitTarget || !perf.grossProfitActual) return null;',
    'return calcMonthlyBonus(perf, monthlyThresholds);',
    'const monthBonusAmounts = qMonths.map(m => bonusResults[m-1]?.finalBonus ?? 0);',
    'if (monthPerfs.every(p => !p.grossProfitTarget || !p.grossProfitActual)) return null;',
    'return calcQuarterlyBonus(monthPerfs, monthBonusAmounts, quarterlyThresholds);',
    'store_id: storeId, year, month, business_days: 26,',
    '此門市使用自訂閾值',
  ]) {
    it(literal, () => expect(page).toContain(literal));
  }
  it('自訂閾值標記的判斷：月閾值任一檻金額與預設不同', () => {
    expect(page).toContain('monthlyThresholds.some((t, i) => t.baseAmount !== MONTHLY_THRESHOLDS[i].baseAmount)');
  });
});
