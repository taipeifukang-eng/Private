import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compareStatus, legacyCompareStatus } from '../../../lib/workspace/inspection-compare';

// P04 單元層：比較的差異判定與舊版同輸入同輸出；Q23 權限結構；除錯頁排除登錄。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('差異判定新舊同輸入同輸出', () => {
  const values = [undefined, 0, 0.5, 2, 5, 10];
  it('兩邊都有紀錄或只有一邊有紀錄（缺的一邊視為 0 扣分）：與舊版完全相同', () => {
    for (const a of values) {
      for (const b of values) {
        if (a === undefined && b === undefined) continue;
        const s = a === undefined ? null : { deduction_amount: a };
        const m = b === undefined ? null : { deduction_amount: b };
        expect(compareStatus(s, m), `${a} vs ${b}`).toBe(legacyCompareStatus(s, m));
      }
    }
  });
  it('只有兩邊都沒有該項紀錄才是「缺少明細」（舊版沒有這個狀態，當成相同）', () => {
    expect(compareStatus(null, null)).toBe('missing');
    expect(legacyCompareStatus(null, null)).toBe('same');
  });
  it('扣分不同才標差異；相同或都是 0 為相同', () => {
    expect(compareStatus({ deduction_amount: 5 }, { deduction_amount: 5 })).toBe('same');
    expect(compareStatus({ deduction_amount: 0 }, { deduction_amount: 0 })).toBe('same');
    expect(compareStatus({ deduction_amount: 5 }, { deduction_amount: 2 })).toBe('both_different');
    expect(compareStatus({ deduction_amount: 5 }, null)).toBe('supervisor_only');
    expect(compareStatus(null, { deduction_amount: 5 })).toBe('manager_only');
    expect(compareStatus({ deduction_amount: '5.0' }, { deduction_amount: 5 })).toBe('same');
  });
});

describe('Q23 權限與範圍（結構）', () => {
  const api = read('app/api/workspace/inspection-compare/route.ts');
  it('需同時有「巡店比較」與「經理巡店」，門市限可見範圍，範圍外只看得到自己建立的單', () => {
    expect(api).toContain('requireCapability(ctx, ["inspection.compare"])');
    expect(api).toContain('requireCapability(ctx, ["inspection.manager_tab"])');
    expect(api).toContain('inspectionStores(ctx)');
    expect(api).toContain('stores.some((s) => s.id === store)');
    expect(api).toContain('q.eq("inspector_id", ctx.user.id)');
  });
  it('session 的 compareInspections 也要兩個權限都有', () => {
    const session = read('app/api/workspace/session/route.ts');
    expect(session).toMatch(/compareInspections:\s*ctx\.has\("inspection\.compare"\) &&\s*ctx\.has\("inspection\.manager_tab"\)/);
  });
  it('使用共用差異判定函式', () => {
    expect(api).toContain('compareStatus(a, b)');
  });
});

describe('除錯頁排除登錄（D13）', () => {
  const checklist = read('docs/vue-workspace/full-migration-checklist.md');
  it.each(['/inspection/debug', '/inspection/diagnostic', '/inspection/test-debug'])('%s 標記 exclude', (route) => {
    const line = checklist.split('\n').find((l) => l.startsWith(`| \`${route}\``));
    expect(line, route).toContain('exclude');
  });
  it('/api/inspection-debug 也登錄為 exclude', () => {
    expect(checklist).toMatch(/\| `\/api\/inspection-debug` .*exclude/);
  });
});
