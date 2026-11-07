import fs from 'node:fs';
import path from 'node:path';

// 舊版巡店新增／編輯頁（app/inspection/new、[id]/edit、components/SignaturePad）的行為事實，
// 直接從舊版原始碼讀取（門檻、簽名板規則、暫存規則…），避免測試自己寫死而與舊版脫節。
const ROOT = path.resolve(__dirname, '..', '..');
export const readLegacy = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
export const legacyNewPage = () => readLegacy('app/inspection/new/page.tsx');
export const legacyEditPage = () => readLegacy('app/inspection/[id]/edit/page.tsx');
export const legacySignaturePad = () => readLegacy('components/SignaturePad.tsx');

export type ScoreTemplate = {
  id: string;
  item_name?: string;
  max_score: number;
  checklist_items: { label: string; deduction: number; requires_quantity?: boolean }[] | null;
};
export type ScoreInput = { template_id: string; checked_items: string[]; quantities: Record<string, number> };

/** 舊版評級門檻（由原始碼 `if (finalScore >= N) grade = 'G'` 讀出，高到低）。 */
export function legacyLadder(): { min: number; grade: number }[] {
  return [...legacyNewPage().matchAll(/if \(finalScore >= (\d+)\) grade = '(\d+)'|else if \(finalScore >= (\d+)\) grade = '(\d+)'/g)].map((m) => ({
    min: Number(m[1] ?? m[3]),
    grade: Number(m[2] ?? m[4]),
  }));
}

/** 舊版 handleCheckItem／handleQuantityChange／calculateTotals 的等價實作（逐行對照原始碼）。 */
export function legacyScore(templates: ScoreTemplate[], inputs: ScoreInput[]) {
  const ladder = legacyLadder();
  let totalDeduction = 0;
  for (const t of templates) {
    const input = inputs.find((i) => i.template_id === t.id)!;
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
