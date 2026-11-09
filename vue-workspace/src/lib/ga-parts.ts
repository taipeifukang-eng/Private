// 料件表單 <-> API 欄位轉換（新增頁與列表編輯共用）。
export type PartFormValue = {
  category_id: string; name: string; part_code: string; barcode: string; brand: string; model: string; specification: string; description: string;
  base_unit: string; purchase_unit: string; purchase_to_base_rate: string; minimum_issue_qty: string;
  allow_fractional_issue: boolean; allow_unpacking: boolean; tags: string; notes: string; is_active: boolean;
};

export function emptyPart(): PartFormValue {
  return {
    category_id: "", name: "", part_code: "", barcode: "", brand: "", model: "", specification: "", description: "",
    base_unit: "", purchase_unit: "", purchase_to_base_rate: "", minimum_issue_qty: "1",
    allow_fractional_issue: false, allow_unpacking: false, tags: "", notes: "", is_active: true,
  };
}

export function partFromRow(row: Record<string, any>): PartFormValue {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    category_id: s(row.category_id), name: s(row.name), part_code: s(row.part_code), barcode: s(row.barcode), brand: s(row.brand),
    model: s(row.model), specification: s(row.specification), description: s(row.description), base_unit: s(row.base_unit),
    purchase_unit: s(row.purchase_unit), purchase_to_base_rate: s(row.purchase_to_base_rate), minimum_issue_qty: s(row.minimum_issue_qty || 1),
    allow_fractional_issue: !!row.allow_fractional_issue, allow_unpacking: !!row.allow_unpacking,
    tags: Array.isArray(row.tags) ? row.tags.join(", ") : "", notes: s(row.notes), is_active: row.is_active !== false,
  };
}

/** 表單 -> API 內容。canSeeNotes 為 false 時不送 notes（避免把看不到的備註清空）；locked 時不送單位欄位。 */
export function partPayload(v: PartFormValue, opts: { canSeeNotes: boolean; unitLocked?: boolean }) {
  const out: Record<string, unknown> = {
    category_id: v.category_id, name: v.name, part_code: v.part_code, barcode: v.barcode, brand: v.brand, model: v.model,
    specification: v.specification, description: v.description, minimum_issue_qty: v.minimum_issue_qty,
    allow_fractional_issue: v.allow_fractional_issue, allow_unpacking: v.allow_unpacking,
    tags: v.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), is_active: v.is_active,
  };
  if (!opts.unitLocked) {
    out.base_unit = v.base_unit;
    out.purchase_unit = v.purchase_unit;
    out.purchase_to_base_rate = v.purchase_unit ? v.purchase_to_base_rate : "";
  }
  if (opts.canSeeNotes) out.notes = v.notes;
  return out;
}

export function validatePartForm(v: PartFormValue) {
  const errors: Record<string, string> = {};
  if (!v.category_id) errors.category_id = "請選擇料件分類";
  if (!v.name.trim()) errors.name = "請輸入料件名稱";
  if (!v.base_unit.trim()) errors.base_unit = "請輸入基本庫存單位";
  if (v.purchase_unit.trim() && v.purchase_unit.trim().toUpperCase() !== v.base_unit.trim().toUpperCase()) {
    const r = Number(v.purchase_to_base_rate);
    if (!(r > 0)) errors.purchase_to_base_rate = "填寫採購單位時，換算率必須大於 0";
  }
  return errors;
}
