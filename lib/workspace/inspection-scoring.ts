export type InspectionTemplate = {
  id: string;
  max_score: number;
  checklist_items:
    { label: string; deduction: number; requires_quantity?: boolean }[] | null;
};
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
  mappings = [220, 215, 191, 181, 171, 161, 151, 141, 131, 121, 0].map(
    (min_score, i) => ({ grade: 10 - i, min_score }),
  ),
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
      throw new Error("項目扣分超過該項滿分，請確認缺失數量");
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
  const grade =
    [...mappings]
      .sort((a, b) => b.grade - a.grade)
      .find((m) => total >= m.min_score)?.grade ?? 0;
  return {
    results,
    total,
    max: 220,
    grade: String(grade),
    deduction,
  };
}
