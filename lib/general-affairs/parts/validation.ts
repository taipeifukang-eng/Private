import {
  PART_COMPATIBILITY_TYPES,
  type PartCompatibilityPayload,
  type PartPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SYSTEM_FIELDS = new Set([
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
  'deleted_by',
  'deletion_reason',
]);

export function validateUuid(value: unknown, label: string) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} 格式錯誤`);
  }
  return normalized;
}

export function normalizeOptionalText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`請輸入${label}`);
  return text;
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNullableNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必須是數字`);
  return parsed;
}

function normalizeNumber(value: unknown, label: string, fallback: number) {
  const normalized = normalizeNullableNumber(value, label);
  return normalized === null ? fallback : normalized;
}

function assertPlainObject(value: unknown, label: string) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必須是物件格式`);
  }
  return value as Record<string, unknown>;
}

function normalizeTags(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('標籤必須是陣列格式');
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

function normalizePartCode(value: unknown) {
  const text = normalizeOptionalText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeImagePath(value: unknown) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) throw new Error('圖片路徑僅可保存相對 Storage Path');
  if (text.startsWith('/')) throw new Error('圖片路徑不可使用絕對路徑');
  if (text.includes('\\')) throw new Error('圖片路徑不可包含反斜線');
  if (text.split('/').includes('..')) throw new Error('圖片路徑不可包含路徑穿越');
  return text;
}

function rejectSystemFields(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    if (SYSTEM_FIELDS.has(key)) {
      throw new Error(`${key} 為系統欄位，不可由 Client 指定`);
    }
  }
}

function normalizeUnitPair(output: Record<string, unknown>) {
  const baseUnit = output.base_unit as string | undefined;
  const purchaseUnit = output.purchase_unit as string | null | undefined;
  const rate = output.purchase_to_base_rate as number | null | undefined;

  if (purchaseUnit === null && rate !== null && rate !== undefined) {
    throw new Error('未填採購單位時，換算率必須留空');
  }

  if (purchaseUnit) {
    if (baseUnit && purchaseUnit.toUpperCase() === baseUnit.toUpperCase()) {
      output.purchase_to_base_rate = 1;
    } else if (rate === null || rate === undefined || rate <= 0) {
      throw new Error('填寫採購單位時，換算率必須大於 0');
    }
  }
}

export function validatePartPayload(input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  rejectSystemFields(payload);
  const output: Record<string, unknown> = {};

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'category_id')) {
    output.category_id = validateUuid(payload.category_id, '分類 id');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    output.name = normalizeRequiredText(payload.name, '料件名稱');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'part_code')) {
    output.part_code = normalizePartCode(payload.part_code);
  }

  for (const key of ['barcode', 'brand', 'model', 'specification', 'description', 'notes'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeOptionalText(payload[key]);
    }
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'base_unit')) {
    output.base_unit = normalizeRequiredText(payload.base_unit, '基本庫存單位');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'purchase_unit')) {
    output.purchase_unit = normalizeOptionalText(payload.purchase_unit);
  } else if (!options.partial) {
    output.purchase_unit = null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'purchase_to_base_rate')) {
    output.purchase_to_base_rate = normalizeNullableNumber(payload.purchase_to_base_rate, '採購換算率');
  } else if (!options.partial) {
    output.purchase_to_base_rate = null;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'minimum_issue_qty')) {
    const minimumIssueQty = normalizeNumber(payload.minimum_issue_qty, '最小領用量', 1);
    if (minimumIssueQty <= 0) throw new Error('最小領用量必須大於 0');
    output.minimum_issue_qty = minimumIssueQty;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'allow_fractional_issue')) {
    output.allow_fractional_issue = normalizeBoolean(payload.allow_fractional_issue, false);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'allow_unpacking')) {
    output.allow_unpacking = normalizeBoolean(payload.allow_unpacking, false);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_active')) {
    output.is_active = normalizeBoolean(payload.is_active, true);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'specs')) {
    output.specs = assertPlainObject(payload.specs, '規格');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
    output.tags = normalizeTags(payload.tags);
  } else if (!options.partial) {
    output.tags = [];
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'image_path')) {
    output.image_path = normalizeImagePath(payload.image_path);
  }

  if (output.allow_fractional_issue === false && output.minimum_issue_qty !== undefined) {
    const value = Number(output.minimum_issue_qty);
    if (!Number.isInteger(value)) throw new Error('不允許小數領用時，最小領用量必須為整數');
  }

  normalizeUnitPair(output);
  return output as PartPayload;
}

export function validatePartCompatibilityPayload(
  input: any,
  options: { partial?: boolean; partId?: string } = {},
) {
  const payload = input || {};
  rejectSystemFields(payload);
  const output: Record<string, unknown> = {};

  if (options.partId) {
    output.part_id = options.partId;
  } else if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'part_id')) {
    output.part_id = validateUuid(payload.part_id, '料件 id');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'compatibility_type')) {
    const type = String(payload.compatibility_type || '').trim().toUpperCase();
    if (!PART_COMPATIBILITY_TYPES.includes(type as any)) throw new Error('相容性類型錯誤');
    output.compatibility_type = type;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'equipment_template_id')) {
    output.equipment_template_id = payload.equipment_template_id
      ? validateUuid(payload.equipment_template_id, '設備範本 id')
      : null;
  }

  for (const key of ['vendor_name', 'series_name', 'brand', 'model', 'notes'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeOptionalText(payload[key]);
    }
  }

  if (!options.partial) {
    const type = output.compatibility_type;
    if (type === 'EQUIPMENT_TEMPLATE') {
      if (!output.equipment_template_id) throw new Error('設備範本相容性必須選擇設備範本');
      output.vendor_name = null;
      output.series_name = null;
      output.brand = null;
      output.model = null;
    }
    if (type === 'VENDOR_SERIES') {
      if (!output.vendor_name) throw new Error('廠商系列相容性必須填寫廠商名稱');
      output.equipment_template_id = null;
      output.brand = null;
      output.model = null;
    }
    if (type === 'BRAND_MODEL') {
      if (!output.brand) throw new Error('品牌型號相容性必須填寫品牌');
      output.equipment_template_id = null;
      output.vendor_name = null;
      output.series_name = null;
    }
  }

  return output as PartCompatibilityPayload;
}

export function validateDeletionReason(value: unknown) {
  const reason = normalizeOptionalText(value);
  if (!reason) throw new Error('請輸入刪除原因');
  if (reason.length > 200) throw new Error('刪除原因不可超過 200 字');
  return reason;
}
