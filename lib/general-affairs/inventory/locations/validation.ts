import {
  INVENTORY_LOCATION_TYPES,
  PREFERRED_ISSUE_UNIT_TYPES,
  type InventoryLocationPayload,
  type InventoryLocationPartPayload,
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

function rejectSystemFields(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    if (SYSTEM_FIELDS.has(key)) {
      throw new Error(`${key} 為系統欄位，不可由 Client 指定`);
    }
  }
}

function normalizeLocationCode(value: unknown) {
  const text = normalizeOptionalText(value);
  return text ? text.toUpperCase() : null;
}

function validatePolicyOrder(output: Record<string, unknown>) {
  const safety = output.safety_stock_qty as number | null | undefined;
  const reorder = output.reorder_point_qty as number | null | undefined;
  const maximum = output.maximum_stock_qty as number | null | undefined;

  for (const [value, label] of [
    [safety, '安全庫存'],
    [reorder, '補貨點'],
    [maximum, '最高庫存'],
  ] as const) {
    if (value !== null && value !== undefined && value < 0) {
      throw new Error(`${label}不可小於 0`);
    }
  }

  if (safety !== null && safety !== undefined && reorder !== null && reorder !== undefined && safety > reorder) {
    throw new Error('安全庫存不可大於補貨點');
  }
  if (reorder !== null && reorder !== undefined && maximum !== null && maximum !== undefined && reorder > maximum) {
    throw new Error('補貨點不可大於最高庫存');
  }
  if (safety !== null && safety !== undefined && maximum !== null && maximum !== undefined && safety > maximum) {
    throw new Error('安全庫存不可大於最高庫存');
  }
}

export function validateInventoryLocationPayload(input: any, options: { partial?: boolean } = {}) {
  const payload = input || {};
  rejectSystemFields(payload);
  const output: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'code')) {
    output.code = normalizeLocationCode(payload.code);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    output.name = normalizeRequiredText(payload.name, '庫存位置名稱');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'location_type')) {
    const type = String(payload.location_type || '').trim().toUpperCase();
    if (!INVENTORY_LOCATION_TYPES.includes(type as any)) throw new Error('庫存位置類型錯誤');
    output.location_type = type;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'store_id')) {
    output.store_id = payload.store_id ? validateUuid(payload.store_id, '門市 id') : null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    output.description = normalizeOptionalText(payload.description);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_active')) {
    output.is_active = normalizeBoolean(payload.is_active, true);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'allow_negative_stock')) {
    output.allow_negative_stock = normalizeBoolean(payload.allow_negative_stock, false);
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_default')) {
    output.is_default = normalizeBoolean(payload.is_default, false);
  }

  const locationType = output.location_type ?? payload.location_type;
  const storeId = Object.prototype.hasOwnProperty.call(output, 'store_id') ? output.store_id : payload.store_id;
  if (!options.partial && locationType === 'STORE' && !storeId) throw new Error('STORE 類型必須選擇門市');
  if (!options.partial && locationType && locationType !== 'STORE' && storeId) throw new Error('非 STORE 類型不得設定門市');

  if (output.is_active === false && output.is_default === true) {
    output.is_default = false;
  }

  return output as InventoryLocationPayload;
}

export function validateInventoryLocationPartPayload(
  input: any,
  options: { partial?: boolean; locationId?: string } = {},
) {
  const payload = input || {};
  rejectSystemFields(payload);
  const output: Record<string, unknown> = {};

  if (options.locationId) {
    output.location_id = options.locationId;
  } else if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'location_id')) {
    output.location_id = validateUuid(payload.location_id, '庫存位置 id');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'part_id')) {
    output.part_id = validateUuid(payload.part_id, '料件 id');
  }

  if (!options.partial || Object.prototype.hasOwnProperty.call(payload, 'is_active')) {
    output.is_active = normalizeBoolean(payload.is_active, true);
  }

  for (const [key, label] of [
    ['safety_stock_qty', '安全庫存'],
    ['reorder_point_qty', '補貨點'],
    ['maximum_stock_qty', '最高庫存'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      output[key] = normalizeNullableNumber(payload[key], label);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'preferred_issue_unit_type')) {
    const unitType = normalizeOptionalText(payload.preferred_issue_unit_type)?.toUpperCase() || null;
    if (unitType !== null && !PREFERRED_ISSUE_UNIT_TYPES.includes(unitType as any)) {
      throw new Error('偏好領用單位類型錯誤');
    }
    output.preferred_issue_unit_type = unitType;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
    output.notes = normalizeOptionalText(payload.notes);
  }

  validatePolicyOrder(output);
  return output as InventoryLocationPartPayload;
}

export function validateDeletionReason(value: unknown) {
  const reason = normalizeOptionalText(value);
  if (!reason) throw new Error('請輸入刪除原因');
  if (reason.length > 200) throw new Error('刪除原因不可超過 200 字');
  return reason;
}
