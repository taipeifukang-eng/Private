import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatTaipeiDate } from '../../../vue-workspace/src/taipei-time';

// 巡店列表、分頁標籤、刪除確認視窗的門市名稱：與舊版相同 short_name || store_name
const src = (f: string) => readFileSync(`vue-workspace/src/pages/${f}`, 'utf8');
describe('inspection store display name', () => {
  it('list row, filter, tab title use short_name first', () => {
    const s = src('Inspections.vue');
    expect(s).toContain('row.store?.short_name || row.store?.store_name');
    expect(s).toContain('s.short_name || s.store_name');
    expect(s).not.toMatch(/\{\{ row\.store\?\.store_name/);
  });
  it('detail tab title and delete dialog use short_name first', () => {
    const s = src('InspectionDetail.vue');
    expect(s).toContain('data.value.store?.short_name || data.value.store?.store_name');
    expect(s).toContain('data.store?.short_name || data.store?.store_name');
    expect(s).not.toContain('{{ data.store?.store_name }}');
  });
  it('print and compare tab titles use short_name first', () => {
    expect(src('InspectionPrint.vue')).toContain('store?.short_name || data.value.store?.store_name');
    expect(src('InspectionCompare.vue')).toContain('?.short_name ||');
  });
  it('list date uses legacy zh-TW format when no GPS', () => {
    expect(formatTaipeiDate('2026-09-25')).toBe('2026/9/25');
    expect(formatTaipeiDate('2026-09-25T00:00:00+00:00')).toBe('2026/9/25');
  });
});
