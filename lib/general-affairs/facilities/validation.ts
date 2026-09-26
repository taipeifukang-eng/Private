import {
  FACILITY_CRITICALITIES,
  FACILITY_STATUSES,
  type FacilityPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function assertPlainObject(value: unknown, label: string) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必須是物件格式`);
  }
  return value as Record<string, unknown>;
}

function normalizeNullableNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必須是數字`);
  return parsed;
}

function normalizeDate(value: unknown, label: string) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (!DATE_PATTERN.test(text)) throw new Error(`${label} 格式必須是 YYYY-MM-DD`);
  return text;
}

function normalizeTags(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('標籤必須是陣列格式');
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeFacilityCode(value: unknown) {
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

export function validateFacilityPayload(input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  rejectSystemFields(payload);
  const output: Record<string, unknown> = {};

  for (const [key, label] of [
    ['store_id', '門市 id'],
    ['category_id', '分類 id'],
  ] as const) {
    if (!options.partial || Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = validateUuid(payload[key], label);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'facility_template_id')) {
    output.facility_template_id = payload.facility_template_id ? validateUuid(payload.facility_template_id, '設施架型 id') : null;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    output.name = normalizeRequiredText(payload.name, '設施名稱');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'facility_code')) {
    output.facility_code = normalizeFacilityCode(payload.facility_code);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const status = String(payload.status || 'ACTIVE').trim();
    if (!FACILITY_STATUSES.includes(status as any)) throw new Error('設施狀態錯誤');
    output.status = status;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'criticality')) {
    const criticality = String(payload.criticality || 'NORMAL').trim();
    if (!FACILITY_CRITICALITIES.includes(criticality as any)) throw new Error('重要程度錯誤');
    output.criticality = criticality;
  }

  for (const key of ['area', 'location_detail', 'unit', 'description', 'notes'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeOptionalText(payload[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'quantity')) {
    const quantity = normalizeNullableNumber(payload.quantity, '數量');
    if (quantity !== null && quantity <= 0) throw new Error('數量必須大於 0');
    output.quantity = quantity;
  }

  for (const [key, label] of [
    ['purchase_unit_amount', '每單位購買金額'],
    ['purchase_amount', '購買總額'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const amount = normalizeNullableNumber(payload[key], label);
      if (amount !== null && amount < 0) throw new Error(`${label}不可為負數`);
      output[key] = amount;
    }
  }

  if (
    (Object.prototype.hasOwnProperty.call(output, 'quantity') || Object.prototype.hasOwnProperty.call(output, 'unit')) &&
    ((output.quantity === null && output.unit) || (output.quantity !== null && !output.unit))
  ) {
    throw new Error('數量與單位必須一起填寫');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_fixed_asset')) {
    output.is_fixed_asset = normalizeBoolean(payload.is_fixed_asset, true);
  }

  for (const [key, label] of [
    ['installed_at', '安裝日期'],
    ['purchased_at', '購買日期'],
    ['last_renovated_at', '最近整修日期'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeDate(payload[key], label);
    }
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

  return output as FacilityPayload;
}

export function validateDeletionReason(value: unknown) {
  const reason = normalizeOptionalText(value);
  if (!reason || reason.length < 2) throw new Error('請輸入至少 2 個字的刪除原因');
  if (reason.length > 200) throw new Error('刪除原因不可超過 200 字');
  return reason;
}
