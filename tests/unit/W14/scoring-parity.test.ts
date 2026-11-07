import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gradeFromMapping, legacyHardcodedGrade, scoreInspection, type InspectionTemplate } from '../../../lib/workspace/inspection-scoring';

// W14 計算對等（M4 Q10/Q11）：同一份輸入餵舊版新增巡店頁的算法與新版 scoreInspection，總分與評級必須相同。
// 舊版算法直接從 app/inspection/new/page.tsx 原始碼讀取門檻，避免測試自己寫死而與舊版脫節。
const root = path.resolve(__dirname, '..', '..', '..');
const legacySource = fs.readFileSync(path.join(root, 'app/inspection/new/page.tsx'), 'utf8').replace(/\r\n/g, '\n');
const ladder = [...legacySource.matchAll(/if \(finalScore >= (\d+)\) grade = '(\d+)'|else if \(finalScore >= (\d+)\) grade = '(\d+)'/g)].map((m) => ({
  min: Number(m[1] ?? m[3]),
  grade: Number(m[2] ?? m[4]),
}));

/** 舊版 calculateTotals + handleCheckItem／handleQuantityChange 的等價實作（逐行對照原始碼）。 */
function legacyScore(templates: InspectionTemplate[], inputs: { template_id: string; checked_items: string[]; quantities: Record<string, number> }[]) {
  let totalDeduction = 0;
  for (const t of templates) {
    const input = inputs.find((i) => i.template_id === t.id)!;
    // handleQuantityChange：Math.max(1, quantity)；handleCheckItem：quantities[label] || 1
    const deduction = input.checked_items.reduce((sum, label) => {
      const item = (t.checklist_items || []).find((ci) => ci.label === label);
      if (!item) return sum;
      const quantity = item.requires_quantity ? Math.max(1, input.quantities[label] || 1) : 1;
      return sum + item.deduction * quantity;
    }, 0);
    totalDeduction += deduction;
  }
  const round1 = (v: number) => Math.round(v * 10) / 10;
  totalDeduction = round1(totalDeduction);
  const finalScore = round1(220 - totalDeduction);
  const grade = ladder.find((l) => finalScore >= l.min)?.grade ?? 0;
  return { total: finalScore, grade: String(grade), deduction: totalDeduction };
}

const tpl = (id: string, max: number, items: InspectionTemplate['checklist_items']): InspectionTemplate => ({ id, item_name: '項' + id, max_score: max, checklist_items: items });

describe('舊版門檻從原始碼讀取', () => {
  it('讀到 10 級、與寫死版本及新版預設對照表完全相同', () => {
    expect(ladder).toHaveLength(10);
    for (let score = 0; score <= 220; score += 0.1) {
      const s = Math.round(score * 10) / 10;
      const legacy = ladder.find((l) => s >= l.min)?.grade ?? 0;
      expect(legacyHardcodedGrade(s), String(s)).toBe(legacy);
      expect(gradeFromMapping(s), String(s)).toBe(legacy);
    }
  });
});

describe('評分邊界新舊對照（219.9、215、214.9、191、190.9、121、120.9、0）', () => {
  // 單一項目：每件扣 0.1，用數量湊出指定總分；滿分設大，避開 Q11。
  const templates = [tpl('t', 1000, [{ label: '缺失', deduction: 0.1, requires_quantity: true }])];
  const cases: [number, number, string][] = [
    [219.9, 1, '9'],
    [215, 50, '9'],
    [214.9, 51, '8'],
    [191, 290, '8'],
    [190.9, 291, '7'],
    [121, 990, '1'],
    [120.9, 991, '0'],
    [0, 2200, '0'],
    [220, 0, '10'],
  ];
  it.each(cases)('總分 %s（數量 %s）→ 評級 %s，新舊相同', (total, qty, grade) => {
    const input = [{ template_id: 't', checked_items: qty ? ['缺失'] : [], quantities: qty ? { 缺失: qty } : {} }];
    const legacy = legacyScore(templates, input);
    const next = scoreInspection(templates, input.map((i) => ({ ...i, notes: '', photos: [] })));
    expect(legacy.total).toBe(total);
    expect(next.total).toBe(total);
    expect(next.grade).toBe(legacy.grade);
    expect(next.grade).toBe(grade);
    expect(next.deduction).toBe(legacy.deduction);
  });
});

describe('隨機輸入新舊同輸出（每項扣分不超過該項滿分）', () => {
  it('500 組隨機勾選與數量', () => {
    let seed = 20261108;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const templates = Array.from({ length: 12 }, (_, i) =>
      tpl('t' + i, 30, [
        { label: 'a', deduction: 1 + Math.floor(rnd() * 3) },
        { label: 'b', deduction: Math.round((0.5 + rnd() * 2) * 10) / 10, requires_quantity: true },
        { label: 'c', deduction: 2.5, requires_quantity: true },
      ]),
    );
    let compared = 0;
    for (let n = 0; n < 500; n++) {
      const inputs = templates.map((t) => {
        const checked = ['a', 'b', 'c'].filter(() => rnd() < 0.4);
        const quantities: Record<string, number> = {};
        for (const l of checked) quantities[l] = 1 + Math.floor(rnd() * 4);
        return { template_id: t.id, checked_items: checked, quantities };
      });
      const legacy = legacyScore(templates, inputs);
      let next;
      try {
        next = scoreInspection(templates, inputs.map((i) => ({ ...i, notes: '', photos: [] })));
      } catch {
        continue; // 超過單項滿分：Q11 另測
      }
      compared++;
      expect(next.total).toBe(legacy.total);
      expect(next.grade).toBe(legacy.grade);
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe('Q11 單項扣分超過該項滿分：新版擋下（與舊版不同，已核可）', () => {
  const templates = [tpl('t', 10, [{ label: '缺失', deduction: 5, requires_quantity: true }]), tpl('u', 10, [{ label: '壞', deduction: 1 }])];
  const input = [
    { template_id: 't', checked_items: ['缺失'], quantities: { 缺失: 5 }, notes: '', photos: [] },
    { template_id: 'u', checked_items: [], quantities: {}, notes: '', photos: [] },
  ];
  it('舊版：該項顯示 0 分，但總分照實扣 25（195）', () => {
    const legacy = legacyScore(templates, input);
    expect(legacy.total).toBe(195);
    expect(legacy.grade).toBe('8');
  });
  it('新版：擋下並指出項目、扣分與滿分', () => {
    expect(() => scoreInspection(templates, input)).toThrow(/「項t」扣分 25 超過該項滿分 10/);
  });
  it('剛好等於滿分可以存', () => {
    const ok = scoreInspection(templates, [{ ...input[0], quantities: { 缺失: 2 } }, input[1]]);
    expect(ok.results[0].given_score).toBe(0);
    expect(ok.total).toBe(210);
  });
  it('總扣分超過 220 擋下', () => {
    const big = Array.from({ length: 12 }, (_, i) => tpl('b' + i, 20, [{ label: 'x', deduction: 20 }]));
    const inputs = big.map((t) => ({ template_id: t.id, checked_items: ['x'], quantities: {}, notes: '', photos: [] }));
    expect(() => scoreInspection(big, inputs)).toThrow(/總扣分超過 220/);
  });
});

describe('Q10 數量輸入：最小 1、整數', () => {
  const templates = [tpl('t', 100, [{ label: '缺失', deduction: 2, requires_quantity: true }])];
  const base = { template_id: 't', checked_items: ['缺失'], notes: '', photos: [] };
  it('0、小數、負數都擋下', () => {
    for (const q of [0, 1.5, -1]) expect(() => scoreInspection(templates, [{ ...base, quantities: { 缺失: q } }])).toThrow(/缺失數量必須為正整數/);
  });
  it('沒填數量當 1（與舊版空白回 1 一致）', () => {
    expect(scoreInspection(templates, [{ ...base, quantities: {} }]).total).toBe(218);
  });
});
