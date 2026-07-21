import type {
  CategoryConfig,
  CategoryPayload,
  EquipmentCategoryPayload,
  FacilityCategoryPayload,
  PartCategoryPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCategoryCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeOptionalText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSortOrder(value: unknown) {
  if (value === undefined || value === null || value === '') return 10;
  const next = Number(value);
  if (!Number.isInteger(next)) throw new Error('排序必須是整數');
  return next;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必須是物件格式`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必須是陣列格式`);
  }
  return value;
}

export function validateCategoryId(id: string | null | undefined) {
  const normalized = String(id ?? '').trim();
  if (!normalized || !UUID_PATTERN.test(normalized)) {
    throw new Error('分類 id 格式錯誤');
  }
  return normalized;
}

export function validateCategoryPayload(config: CategoryConfig, input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  const output: Record<string, unknown> = {};

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = String(payload.name ?? '').trim();
    if (!name) throw new Error('請輸入分類名稱');
    output.name = name;
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'code')) {
    const code = normalizeCategoryCode(payload.code);
    if (!code) throw new Error('請輸入分類代碼');
    output.code = code;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'parent_id')) {
    const parentId = normalizeOptionalText(payload.parent_id);
    if (parentId && !UUID_PATTERN.test(parentId)) throw new Error('父分類 id 格式錯誤');
    output.parent_id = parentId;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    output.description = normalizeOptionalText(payload.description);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'icon_key')) {
    output.icon_key = normalizeOptionalText(payload.icon_key);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sort_order')) {
    output.sort_order = normalizeSortOrder(payload.sort_order);
  } else if (!options.partial) {
    output.sort_order = 10;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'is_active')) {
    output.is_active = normalizeBoolean(payload.is_active, true);
  } else if (!options.partial) {
    output.is_active = true;
  }

  if (config.type === 'equipment') {
    const equipmentOutput = output as EquipmentCategoryPayload;
    if (Object.prototype.hasOwnProperty.call(payload, 'requires_brand') || !options.partial) {
      equipmentOutput.requires_brand = normalizeBoolean(payload.requires_brand);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'requires_model') || !options.partial) {
      equipmentOutput.requires_model = normalizeBoolean(payload.requires_model);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'requires_serial_number') || !options.partial) {
      equipmentOutput.requires_serial_number = normalizeBoolean(payload.requires_serial_number);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'requires_warranty') || !options.partial) {
      equipmentOutput.requires_warranty = normalizeBoolean(payload.requires_warranty);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'default_fields') || !options.partial) {
      equipmentOutput.default_fields = assertPlainObject(payload.default_fields, '預設欄位');
    }
  }

  if (config.type === 'facility') {
    const facilityOutput = output as FacilityCategoryPayload;
    if (Object.prototype.hasOwnProperty.call(payload, 'default_issue_fields') || !options.partial) {
      facilityOutput.default_issue_fields = assertPlainObject(payload.default_issue_fields, '預設問題欄位');
    }
  }

  if (config.type === 'part') {
    const partOutput = output as PartCategoryPayload;
    if (Object.prototype.hasOwnProperty.call(payload, 'spec_schema') || !options.partial) {
      partOutput.spec_schema = assertArray(payload.spec_schema, '規格 Schema');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'default_base_unit')) {
      partOutput.default_base_unit = normalizeOptionalText(payload.default_base_unit);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'is_recyclable_default') || !options.partial) {
      partOutput.is_recyclable_default = normalizeBoolean(payload.is_recyclable_default);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'manage_compatibility') || !options.partial) {
      partOutput.manage_compatibility = normalizeBoolean(payload.manage_compatibility);
    }
  }

  return output as CategoryPayload;
}
