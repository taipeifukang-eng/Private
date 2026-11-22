import { describe, expect, it } from 'vitest';
import { activeMaxScoreTotal, bonusImpactNotice, findBonusOverlap, maxScoreWarning } from '@/lib/workspace/inspection-settings-rules';
import {
  DEFAULT_GRADE_MAPPING,
  gradeFromMapping,
  legacyHardcodedGrade,
  scoreInspection,
} from '@/lib/workspace/inspection-scoring';

// W18 單元層（M4 Q5–Q8）。

describe('Q7 回補規則天數重疊（擋重疊，空缺允許）', () => {
  const rules = [
    { id: 'a', day_from: 0, day_to: 3, is_active: true },
    { id: 'b', day_from: 4, day_to: 5, is_active: true },
    { id: 'c', day_from: 6, day_to: 7, is_active: false },
  ];
  it('0–5 與 3–7 重疊', () => {
    expect(findBonusOverlap([{ id: 'x', day_from: 0, day_to: 5, is_active: true }], { day_from: 3, day_to: 7, is_active: true })?.id).toBe('x');
  });
  it('邊界相接算重疊（3 與 3），相鄰不重疊（3 與 4）', () => {
    expect(findBonusOverlap(rules, { day_from: 3, day_to: 3, is_active: true })?.id).toBe('a');
    expect(findBonusOverlap(rules, { day_from: 8, day_to: 10, is_active: true })).toBeNull();
  });
  it('空缺允許：9–10 與既有 0–5 之間有空缺', () => {
    expect(findBonusOverlap(rules, { day_from: 9, day_to: 10, is_active: true })).toBeNull();
  });
  it('停用的規則不參與；停用的候選不檢查；編輯自己不算重疊', () => {
    expect(findBonusOverlap(rules, { day_from: 6, day_to: 7, is_active: true })).toBeNull();
    expect(findBonusOverlap(rules, { day_from: 0, day_to: 3, is_active: false })).toBeNull();
    expect(findBonusOverlap(rules, { id: 'a', day_from: 0, day_to: 2, is_active: true })).toBeNull();
  });
});

describe('Q8 啟用項目滿分總和只警告', () => {
  const t = (max: number, active = true) => ({ is_active: active, max_score: max });
  it('總和只算啟用項目並四捨五入到小數一位', () => {
    expect(activeMaxScoreTotal([t(100), t(120), t(50, false)])).toBe(220);
    expect(activeMaxScoreTotal([t(0.1), t(0.2)])).toBe(0.3);
    expect(activeMaxScoreTotal([t('5' as any), t(215)])).toBe(220);
  });
  it('等於 220 不警告；225 警告並說明仍從 220 起算', () => {
    expect(maxScoreWarning(220)).toBeNull();
    const w = maxScoreWarning(225)!;
    expect(w).toContain('225');
    expect(w).toContain('從 220 分起算');
  });
});

describe('Q6 回補規則儲存前的影響筆數', () => {
  it('顯示目前等待改善的筆數與計算時點', () => {
    const n = bonusImpactNotice(7);
    expect(n).toContain('7 筆等待改善');
    expect(n).toContain('回報當下');
    expect(bonusImpactNotice(0)).toContain('0 筆');
  });
});

describe('Q5 評級：預設門檻與舊版寫死值同輸入同輸出（邊界分數）', () => {
  const boundaries = [219.9, 220, 215, 214.9, 191, 190.9, 181, 180.9, 171, 170.9, 161, 160.9, 151, 150.9, 141, 140.9, 131, 130.9, 121, 120.9, 0, 0.1, 100];
  it('新版資料驅動（預設 11 級）＝舊版寫死門檻', () => {
    for (const s of boundaries) expect(gradeFromMapping(s, DEFAULT_GRADE_MAPPING), String(s)).toBe(legacyHardcodedGrade(s));
  });
  it('指定邊界的等級：219.9→9、215→9、214.9→8、191→8、190.9→7、121→1、120.9→0、0→0', () => {
    expect([219.9, 215, 214.9, 191, 190.9, 121, 120.9, 0].map((s) => gradeFromMapping(s))).toEqual([9, 9, 8, 8, 7, 1, 0, 0]);
  });
  it('scoreInspection 的評級與舊版寫死值一致（滿分 220 起扣）', () => {
    const tpl = [{ id: 't1', max_score: 220, checklist_items: [{ label: 'x', deduction: 0.1, requires_quantity: true }] }];
    for (const qty of [1, 50, 150, 1000]) {
      const r = scoreInspection(tpl as any, [{ template_id: 't1', checked_items: ['x'], quantities: { x: qty } }]);
      expect(Number(r.grade), `數量 ${qty}`).toBe(legacyHardcodedGrade(r.total));
    }
  });
  it('snapshot：完成後改門檻不影響已完成的單（以 snapshot 算，非目前設定）', () => {
    const snapshot = DEFAULT_GRADE_MAPPING;
    const changed = DEFAULT_GRADE_MAPPING.map((m) => (m.grade === 9 ? { ...m, min_score: 218 } : m));
    expect(gradeFromMapping(216, snapshot)).toBe(9);
    expect(gradeFromMapping(216, changed)).toBe(8);
  });
});
