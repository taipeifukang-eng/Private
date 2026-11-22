export type InspectionTemplate = {
  id: string;
  item_name?: string;
  max_score: number;
  checklist_items:
    { label: string; deduction: number; requires_quantity?: boolean }[] | null;
};
export type GradeMapping = { grade: number; min_score: number }[];
export const DEFAULT_GRADE_MAPPING: GradeMapping = [220, 215, 191, 181, 171, 161, 151, 141, 131, 121, 0].map(
  (min_score, i) => ({ grade: 10 - i, min_score }),
);
/** 評級＝達標的最高一級（M4 Q5：每張單用完成當時 snapshot 的門檻）。 */
export function gradeFromMapping(total: number, mapping: GradeMapping = DEFAULT_GRADE_MAPPING) {
  return (
    [...mapping]
      .sort((a, b) => b.grade - a.grade)
      .find((m) => total >= Number(m.min_score))?.grade ?? 0
  );
}
/** 舊版寫死門檻（改善加分重算、舊新增／編輯頁），僅供新舊同輸入同輸出對照測試。 */
export function legacyHardcodedGrade(total: number) {
  if (total >= 220) return 10;
  if (total >= 215) return 9;
  if (total >= 191) return 8;
  if (total >= 181) return 7;
  if (total >= 171) return 6;
  if (total >= 161) return 5;
  if (total >= 151) return 4;
  if (total >= 141) return 3;
  if (total >= 131) return 2;
  if (total >= 121) return 1;
  return 0;
}
export type InspectionScoreInput = {
  template_id: string;
  checked_items: string[];
  quantities: Record<string, number>;
  notes?: string;
  photos?: string[];
};
export function scoreInspection(
  templates: InspectionTemplate[],
  inputs: InspectionScoreInput[],
  mappings: GradeMapping = DEFAULT_GRADE_MAPPING,
) {
  if (
    inputs.length !== templates.length ||
    new Set(inputs.map((i) => i.template_id)).size !== templates.length
  )
    throw new Error("檢查項目已變更，請重新載入範本");
  const results = templates.map((t) => {
    const input = inputs.find((i) => i.template_id === t.id);
    if (
      !input ||
      !Array.isArray(input.checked_items) ||
      new Set(input.checked_items).size !== input.checked_items.length
    )
      throw new Error("檢查項目格式不正確");
    const options = t.checklist_items || [];
    let deduction = 0;
    const quantities: Record<string, number> = {};
    for (const label of input.checked_items) {
      const option = options.find((o) => o.label === label);
      if (
        !option ||
        !Number.isFinite(Number(option.deduction)) ||
        Number(option.deduction) < 0
      )
        throw new Error("扣分項目已變更，請重新載入範本");
      const qty = option.requires_quantity
        ? (input.quantities?.[label] ?? 1)
        : 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 10000)
        throw new Error("缺失數量必須為正整數");
      quantities[label] = qty;
      deduction += Number(option.deduction) * qty;
    }
    deduction = Math.round(deduction * 10) / 10;
    if (deduction > Number(t.max_score))
      throw new Error(
        `${t.item_name ? "「" + t.item_name + "」" : "項目"}扣分 ${deduction} 超過該項滿分 ${Number(t.max_score)}，請確認缺失數量`,
      );
    return {
      template_id: t.id,
      max_score: Number(t.max_score),
      given_score: Math.max(0, Number(t.max_score) - deduction),
      deduction_amount: deduction,
      is_improvement: deduction > 0,
      selected_items: input.checked_items,
      workspace_quantities: quantities,
      notes: input.notes || null,
      photo_urls: input.photos || [],
    };
  });
  const deduction =
    Math.round(results.reduce((n, r) => n + r.deduction_amount, 0) * 10) / 10;
  const total = Math.round((220 - deduction) * 10) / 10;
  if (total < 0) throw new Error("總扣分超過 220 分，請確認數量");
  const grade = gradeFromMapping(total, mappings);
  return {
    results,
    total,
    max: 220,
    grade: String(grade),
    deduction,
  };
}
