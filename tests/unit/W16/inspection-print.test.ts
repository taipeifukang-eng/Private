import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { followupNotice, printFindings, reportNumber, scoreRate, scoreTrio } from '../../../lib/workspace/inspection-print';
import type { BonusRule } from '../../../lib/workspace/improvement-rules';

// W16 單元層：A4 報表的純規則（Q20、Q21）與版面結構對照舊版 PrintInspectionReport。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const legacy = read('components/PrintInspectionReport.tsx');
const report = read('vue-workspace/src/components/InspectionReport.vue');
const css = read('vue-workspace/src/style.css');
const detailPage = read('vue-workspace/src/pages/InspectionDetail.vue');
const detailApi = read('app/api/workspace/inspection-detail/route.ts');
const RULES: BonusRule[] = [
  { day_from: 0, day_to: 3, bonus_score: 20, sort_order: 1, is_active: true },
  { day_from: 4, day_to: 5, bonus_score: 10, sort_order: 2, is_active: true },
  { day_from: 6, day_to: 7, bonus_score: 5, sort_order: 3, is_active: true },
];

describe('報告編號、得分率、分數並列', () => {
  it('報告編號＝id 前 8 碼大寫（與舊版 inspection.id.slice(0, 8).toUpperCase() 同）', () => {
    expect(legacy).toContain('inspection.id.slice(0, 8).toUpperCase()');
    expect(reportNumber('abcdef12-3456-7890-abcd-ef1234567890')).toBe('ABCDEF12');
  });
  it('得分率與舊版同算法（總分大於 0 才算，一位小數）', () => {
    expect(legacy).toContain('((inspection.total_score / inspection.max_possible_score) * 100).toFixed(1)');
    expect(scoreRate(175, 220)).toBe('79.5');
    expect(scoreRate(0, 220)).toBe('0.0');
    expect(scoreRate(10, 0)).toBe('0.0');
  });
  it('原始得分、改善回補、最終得分並列（回補已加進總分，不是再加一次）', () => {
    expect(scoreTrio({ total_score: 177.5, improvement_bonus: 2.5 })).toEqual({ original: 175, bonus: 2.5, final: 177.5 });
    expect(scoreTrio({ total_score: 200, improvement_bonus: 0 })).toEqual({ original: 200, bonus: 0, final: 200 });
    expect(scoreTrio({ total_score: 200 })).toEqual({ original: 200, bonus: 0, final: 200 });
  });
});

describe('Q21 期限日期與回補級距', () => {
  it('用資料裡的期限日期；沒有期限時以巡店日加最大天數', () => {
    const a = followupNotice({ inspectionDate: '2099-03-10', deadline: '2099-03-17', rules: RULES });
    expect(a.deadline).toBe('2099-03-17');
    expect(a.text).toBe('請於 2099-03-17 前回報；3 天內回補 20%、4–5 天回補 10%、6–7 天回補 5%');
    expect(followupNotice({ inspectionDate: '2099-03-10', rules: RULES }).deadline).toBe('2099-03-17');
  });
  it('級距隨後台規則變：停用最長一條後期限變短、說明少一條', () => {
    const rules = RULES.map((r, i) => (i === 2 ? { ...r, is_active: false } : r));
    const n = followupNotice({ inspectionDate: '2099-03-10', rules });
    expect(n.deadline).toBe('2099-03-15');
    expect(n.tiers).toEqual(['3 天內回補 20%', '4–5 天回補 10%']);
  });
  it('舊版寫死「3 個工作日內」，新版報表不再寫死', () => {
    expect(legacy).toContain('3 個工作日內');
    expect(report).not.toContain('3 個工作日');
    expect(report).toContain('data-testid="flow-deadline"');
  });
});

describe('待改善彙整（Q20）', () => {
  const results = [
    { id: 'r1', template_id: 't1', is_improvement: true, deduction_amount: 5, template: { section_name: 'A', item_name: 'a' } },
    { id: 'r2', template_id: 't2', is_improvement: false, deduction_amount: 0, template: { section_name: 'A', item_name: 'b' } },
  ];
  const improvements = [
    { id: 'i1', inspection_result_id: 'r1', template_id: 't1', status: 'improved', bonus_score: 1 },
    { id: 'i9', inspection_result_id: null, template_id: 't9', section_name: 'Z', item_name: 'z', deduction_amount: 3, issue_description: '舊資料', issue_photo_urls: [], status: 'pending' },
  ];
  it('標記需改善的明細與其改善回報；沒有對應明細的改善項目也補上', () => {
    const items = printFindings(results, improvements);
    expect(items).toHaveLength(2);
    expect(items[0].improvements.map((i) => i.id)).toEqual(['i1']);
    expect(items[1].result.template.item_name).toBe('z');
  });
  it('只有標記需改善的才進彙整（與舊版 results.filter(is_improvement) 同）', () => {
    expect(printFindings(results, []).map((x) => x.result.id)).toEqual(['r1']);
  });
});

describe('版面對照舊版', () => {
  it.each([
    '店鋪名稱：', '店鋪代碼：', '店鋪地址：', '檢核日期：', '報告編號：', '室內溫度：', '當班人員', '評分總覽',
    '此次巡店督導其他建議', '待改善項目彙整', '缺失說明：', '缺失照片：', '督導改善建議：', '回饋與簽名確認',
    '督導建議流程：', '店長/當班主管確認簽名：', '簽名日期：', '本報告由系統自動生成', '列印時間：',
    '如有疑問，請聯繫督導人員或管理部門',
  ])('舊版與新版報表都有「%s」', (text) => {
    expect(legacy, `舊版缺少 ${text}`).toContain(text);
    expect(report, `新版缺少 ${text}`).toContain(text);
  });
  it('手寫空格、督導未簽名時印姓名、簽名日期缺簽時印底線', () => {
    expect(report).toContain('class="report-handwriting"');
    expect(report).toContain('data-testid="inspector-name"');
    expect(report).toContain('簽名日期：_____________');
  });
  it('Q20：已改善的項目下方多印改善回報（說明、照片、回補分數）', () => {
    expect(report).toContain('data-testid="report-followup"');
    expect(report).toContain('回補 {{ f.bonus_score ?? 0 }} 分');
    expect(report).toContain('improvement_photo_urls');
    expect(report).toContain("f.status === 'improved'");
  });
  it('A4、邊距 15mm、待改善彙整另起一頁、簽名區不被切斷、保留顏色', () => {
    expect(legacy).toContain('size: A4');
    expect(legacy).toContain('margin: 15mm');
    expect(css).toMatch(/@page\{size:A4;margin:15mm\}/);
    expect(css).toMatch(/\.inspection-print-output \.report-issues\{break-before:page\}/);
    expect(css).toContain('.report-signatures{break-inside:avoid}');
    expect(css).toContain('print-color-adjust:exact');
  });
});

describe('Q22 刪除', () => {
  it('伺服器：刪除限可見範圍、經理巡店需經理權限、版本不符拒絕；詳情回報可否刪除與連帶筆數', () => {
    expect(detailApi).toContain('requireCapability(ctx, ["inspection.delete"])');
    expect(detailApi).toContain('沒有經理巡店操作權限');
    expect(detailApi).toContain('找不到可操作的巡店記錄');
    expect(detailApi).toContain('.eq("workspace_version", body.version)');
    expect(detailApi).toMatch(/canDelete:\s*ctx\.has\("inspection\.delete"\) &&\s*\(row\.inspection_type !== "manager" \|\| ctx\.has\("inspection\.manager_tab"\)\)/);
  });
  it('確認視窗列出連帶刪除的筆數與已回補分數會消失', () => {
    expect(detailPage).toContain('data-testid="delete-counts"');
    expect(detailPage).toContain('data.results.length');
    expect(detailPage).toContain('data.improvements.length');
    expect(detailPage).toContain('data-testid="delete-bonus-warning"');
  });
});
