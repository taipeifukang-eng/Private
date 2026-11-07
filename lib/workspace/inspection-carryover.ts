/**
 * M4 Q9：巡店範本在填寫途中被改了，重新載入範本時保留還對得上的勾選、數量、備註、照片，
 * 對不上的列出給督導確認（分數不會被悄悄改）。純函式，前後端與測試共用。
 */
export type CarryTemplate = {
  id: string;
  item_name?: string;
  max_score: number;
  is_active?: boolean;
  checklist_items:
    | { label: string; deduction: number; requires_quantity?: boolean }[]
    | null;
};
export type CarryScore = {
  template_id: string;
  checked_items: string[];
  quantities: Record<string, number>;
  notes: string;
  photos: string[];
};
export type CarryNotice = {
  template_id: string;
  item_name: string;
  kind: "removed" | "changed" | "added" | "disabled";
  label?: string;
  message: string;
};

const nameOf = (t: CarryTemplate | undefined, id: string) => t?.item_name || id;
const hasContent = (s: CarryScore) =>
  s.checked_items.length > 0 || !!s.notes.trim() || s.photos.length > 0;

export function carryOverScores(
  oldTemplates: CarryTemplate[],
  oldScores: CarryScore[],
  newTemplates: CarryTemplate[],
): { scores: CarryScore[]; notices: CarryNotice[] } {
  const notices: CarryNotice[] = [];
  const oldById = new Map(oldTemplates.map((t) => [t.id, t]));
  const scoreById = new Map(oldScores.map((s) => [s.template_id, s]));
  const newIds = new Set(newTemplates.map((t) => t.id));
  const scores = newTemplates.map((t): CarryScore => {
    const old = scoreById.get(t.id);
    const before = oldById.get(t.id);
    if (!old || !before) {
      notices.push({
        template_id: t.id,
        item_name: nameOf(t, t.id),
        kind: "added",
        message: "範本新增了這個檢查項目，請確認是否需要評分",
      });
      return { template_id: t.id, checked_items: [], quantities: {}, notes: "", photos: [] };
    }
    if (before.is_active !== false && t.is_active === false)
      notices.push({
        template_id: t.id,
        item_name: nameOf(t, t.id),
        kind: "disabled",
        message: "此項目已被停用，保留顯示，請確認是否仍要記錄",
      });
    const options = t.checklist_items || [];
    const checked: string[] = [];
    const quantities: Record<string, number> = {};
    for (const label of old.checked_items) {
      const option = options.find((o) => o.label === label);
      if (!option) {
        notices.push({
          template_id: t.id,
          item_name: nameOf(t, t.id),
          kind: "removed",
          label,
          message: `原本勾選的「${label}」已不在範本中，未帶入`,
        });
        continue;
      }
      const prevOption = (before.checklist_items || []).find((o) => o.label === label);
      if (prevOption && Number(prevOption.deduction) !== Number(option.deduction))
        notices.push({
          template_id: t.id,
          item_name: nameOf(t, t.id),
          kind: "changed",
          label,
          message: `「${label}」扣分由 ${prevOption.deduction} 改為 ${option.deduction}，請確認`,
        });
      checked.push(label);
      if (option.requires_quantity) {
        const q = old.quantities?.[label];
        quantities[label] = Number.isInteger(q) && q >= 1 ? q : 1;
      }
    }
    return {
      template_id: t.id,
      checked_items: checked,
      quantities,
      notes: old.notes,
      photos: [...old.photos],
    };
  });
  // 舊範本有、新範本沒有的整個項目（被停用或刪除）：有填內容才需要列出。
  for (const old of oldScores) {
    if (newIds.has(old.template_id) || !hasContent(old)) continue;
    notices.push({
      template_id: old.template_id,
      item_name: nameOf(oldById.get(old.template_id), old.template_id),
      kind: "removed",
      message: `整個檢查項目已不在範本中，原本填的 ${old.checked_items.length} 個勾選、備註與 ${old.photos.length} 張照片未帶入`,
    });
  }
  return { scores, notices };
}
