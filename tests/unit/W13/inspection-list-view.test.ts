import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W13 單元層：列表頁結構（補回舊版欄位、比較按鈕位置、預設月份由伺服器決定、統計用共用純函式）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const list = read('vue-workspace/src/pages/Inspections.vue');
const overview = read('vue-workspace/src/components/InspectionOverview.vue');
const route = read('app/api/workspace/inspections/route.ts');

describe('列表欄位補回舊版（評級徽章、得分（滿分 10 分）、含改善 +N）', () => {
  it('表頭有「分數」與「得分（滿分 10 分）」，列內有評級徽章與含改善加分', () => {
    expect(list).toContain('<th>分數</th>');
    expect(list).toContain('<th>得分（滿分 10 分）</th>');
    expect(list).toContain('grade-badge');
    expect(list).toContain('含改善 +{{ row.improvement_bonus }}');
  });
  it('API 取回 improvement_bonus 與 grade', () => {
    expect(route).toContain('improvement_bonus');
    expect(route).toMatch(/grade,improvement_bonus/);
  });
});

describe('巡店比較入口回到舊版規則', () => {
  it('表頭按鈕只在經理巡店分頁、有紀錄、持比較權限時出現', () => {
    const m = list.match(/<button\s+v-if="([\s\S]*?)"\s+data-testid="compare-entry"/);
    expect(m, '找不到 compare-entry 按鈕').toBeTruthy();
    expect(m![1]).toContain("type === 'manager'");
    expect(m![1]).toContain('compareInspections');
    expect(m![1]).toContain('allRecords.length');
  });
  it('每列「比較督導巡店」只給已完成的經理單', () => {
    expect(list).toMatch(/type === 'manager' &&\s+row\.status === 'completed' &&\s+session\.data\?\.capabilities\.compareInspections/);
  });
});

describe('Q4 預設月份由伺服器決定、Q1 卡片只算所選月份', () => {
  it('尚未手動選月份時不帶 month；結果回來後以伺服器月份為準', () => {
    expect(list).toContain('useDefault ? "" : props.tab.month');
    expect(list).toContain('resultMonth.value = result.month');
  });
  it('統計卡用共用 inspectionStats（只算已完成）且只吃目前月份的 records', () => {
    expect(overview).toContain('inspectionStats(props.records)');
    expect(overview).toContain('草稿與進行中不列入');
  });
  it('尚未巡店名單標「有草稿未送出」', () => {
    expect(overview).toContain('有草稿未送出');
  });
});
