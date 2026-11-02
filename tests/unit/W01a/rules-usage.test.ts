import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadAllowlist } from '../../support/parity';

// M1-x1：API 與畫面都必須引用同一份規則表，不得各自重寫判斷（防止漂移）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('M1-x1 規則表被實際引用', () => {
  const route = read('app/api/workspace/monthly/route.ts');
  const page = read('vue-workspace/src/pages/Monthly.vue');
  it('monthly API 引用規則表，且沒有自己寫死 status === "draft" 的判斷', () => {
    expect(route).toContain('@/lib/workspace/monthly-status-rules');
    expect(route).toContain('canDoMonthlyAction');
    expect(route).toContain('rowsAllow');
    expect(route).toContain('rowsAllowAll');
    expect(route).toContain('PERFORMANCE_FIELDS');
    expect(route).toContain('preSubmitReport');
    expect(route).not.toMatch(/status\s*!==\s*["']draft["']/);
  });
  it('Vue 畫面引用規則表（狀態、按鈕可用性、送審前檢查、自動跳下一間、標籤）', () => {
    expect(page).toContain('lib/workspace/monthly-status-rules');
    for (const fn of ['canDoMonthlyAction', 'rowsAllow', 'nextUnconfirmedStore', 'staffTags', 'resolveMonthState']) expect(page).toContain(fn);
    expect(page).not.toMatch(/r\.status\s*===\s*['"]submitted['"]/);
  });
  it('規則表是純檔案：不 import 任何伺服器或 Supabase 模組', () => {
    const rules = read('lib/workspace/monthly-status-rules.ts');
    expect(rules).not.toMatch(/^import /m);
  });
});

describe('W01a 白名單條目', () => {
  const entries = loadAllowlist().filter((e) => e.page === 'monthly-status');
  it('全部尚未核可（approvedBy 為 null），且都有 match', () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const e of entries) {
      expect(e.approvedBy, e.id).toBeNull();
      expect(e.match, e.id).toBeTruthy();
    }
  });
  it('刪除只有草稿可刪（W01a-q1）有登記', () => {
    expect(entries.some((e) => e.id === 'w01a-delete-draft-only-action')).toBe(true);
  });
});

describe('M1-x1 review fixes', () => {
  it('page confirm/revert/unconfirm buttons use rowsAllowAll', () => {
    const page = read('vue-workspace/src/pages/Monthly.vue');
    for (const a of ['confirm', 'revert', 'unconfirm']) {
      expect(page).toContain("rowsAllowAll(rows, '" + a + "')");
      expect(page).not.toContain("rowsAllow(rows, '" + a + "')");
    }
  });
  it('tools route add_employee goes through the rules table', () => {
    const tools = read('app/api/workspace/monthly/tools/route.ts');
    expect(tools).toContain('@/lib/workspace/monthly-status-rules');
    expect(tools).toContain("'add'");
  });
  it('movements query is scoped to the viewed store', () => {
    expect(read('app/api/workspace/monthly/route.ts')).toContain('.eq("store_id", store)');
  });
});
