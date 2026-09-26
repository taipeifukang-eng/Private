import {
  EQUIPMENT_CRITICALITIES,
  EQUIPMENT_ONBOARDING_STATUSES,
  EQUIPMENT_STATUSES,
  type EquipmentPayload,
  type EquipmentTemplatePayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function normalizeNullableInteger(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} 必須是整數`);
  return parsed;
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

function normalizeImagePath(value: unknown) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) throw new Error('圖片路徑僅可保存相對 Storage Path');
  if (text.startsWith('/')) throw new Error('圖片路徑不可使用絕對路徑');
  if (text.includes('\\')) throw new Error('圖片路徑不可包含反斜線');
  if (text.split('/').includes('..')) throw new Error('圖片路徑不可包含路徑穿越');
  return text;
}

export function validateEquipmentTemplatePayload(input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  const output: Record<string, unknown> = {};

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'category_id')) {
    output.category_id = validateUuid(payload.category_id, '分類 id');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    output.name = normalizeRequiredText(payload.name, '設備範本名稱');
  }

  for (const key of ['brand', 'model', 'description'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeOptionalText(payload[key]);
    }
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'specs')) {
    output.specs = assertPlainObject(payload.specs, '規格');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'default_fields')) {
    output.default_fields = assertPlainObject(payload.default_fields, '預設欄位');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'default_warranty_months')) {
    const months = normalizeNullableInteger(payload.default_warranty_months, '預設保固月數');
    if (months !== null && months < 0) throw new Error('預設保固月數不可為負數');
    output.default_warranty_months = months;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'image_path')) {
    output.image_path = normalizeImagePath(payload.image_path);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_active')) {
    output.is_active = normalizeBoolean(payload.is_active, true);
  }

  return output as EquipmentTemplatePayload;
}

export function validateEquipmentPayload(input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  const output: Record<string, unknown> = {};

  for (const [key, label] of [
    ['store_id', '門市 id'],
    ['category_id', '分類 id'],
  ] as const) {
    if (!options.partial || Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = validateUuid(payload[key], label);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'template_id')) {
    output.template_id = payload.template_id ? validateUuid(payload.template_id, '範本 id') : null;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    output.name = normalizeRequiredText(payload.name, '設備名稱');
  }

  for (const key of [
    'asset_code',
    'barcode',
    'brand',
    'model',
    'serial_number',
    'area',
    'location_detail',
    'purpose',
    'notes',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeOptionalText(payload[key]);
    }
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const status = String(payload.status || 'ACTIVE').trim();
    if (!EQUIPMENT_STATUSES.includes(status as any)) throw new Error('設備狀態錯誤');
    output.status = status;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'criticality')) {
    const criticality = String(payload.criticality || 'NORMAL').trim();
    if (!EQUIPMENT_CRITICALITIES.includes(criticality as any)) throw new Error('重要程度錯誤');
    output.criticality = criticality;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'onboarding_status')) {
    const onboardingStatus = String(payload.onboarding_status || 'NEEDS_EQUIPMENT_PHOTO').trim();
    if (!EQUIPMENT_ONBOARDING_STATUSES.includes(onboardingStatus as any)) throw new Error('建檔貼標狀態錯誤');
    output.onboarding_status = onboardingStatus;
  }

  for (const [key, label] of [
    ['installed_at', '安裝日期'],
    ['purchased_at', '購買日期'],
    ['activated_at', '啟用日期'],
    ['warranty_end_date', '保固到期日'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeDate(payload[key], label);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'purchase_amount')) {
    const amount = normalizeNullableNumber(payload.purchase_amount, '購買金額');
    if (amount !== null && amount < 0) throw new Error('購買金額不可為負數');
    output.purchase_amount = amount;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'specs')) {
    output.specs = assertPlainObject(payload.specs, '規格');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
    output.tags = normalizeTags(payload.tags);
  } else if (!options.partial) {
    output.tags = [];
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'has_warranty')) {
    output.has_warranty = normalizeBoolean(payload.has_warranty, false);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'image_path')) {
    output.image_path = normalizeImagePath(payload.image_path);
  }

  if (output.has_warranty === false && output.warranty_end_date) {
    throw new Error('無保固時不可填寫保固到期日');
  }

  return output as EquipmentPayload;
}

export function validateDeletionReason(value: unknown) {
  const reason = normalizeOptionalText(value);
  if (!reason) throw new Error('請輸入刪除原因');
  if (reason.length > 200) throw new Error('刪除原因不可超過 200 字');
  return reason;
}
