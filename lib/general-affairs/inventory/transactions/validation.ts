import {
  INVENTORY_INPUT_UNIT_TYPES,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryInputUnitType,
  type InventoryTransactionPostPayload,
  type InventoryTransactionType,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SYSTEM_FIELDS = new Set([
  'transaction_no',
  'quantity_base',
  'balance_before',
  'balance_after',
  'created_by',
  'created_at',
  'version',
  'last_transaction_id',
  'last_transaction_at',
  'balance_id',
  'balance_version',
  'idempotency_payload_hash',
]);

export function validateUuid(value: unknown, label: string) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} 格式錯誤`);
  return normalized;
}

export function normalizeOptionalText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeRequiredText(value: unknown, label: string, max = 300) {
  const text = normalizeOptionalText(value);
  if (!text) throw new Error(`請輸入${label}`);
  if (text.length > max) throw new Error(`${label}不可超過 ${max} 字`);
  return text;
}

function rejectSystemFields(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    if (SYSTEM_FIELDS.has(key)) throw new Error(`${key} 為系統欄位，不可由 Client 指定`);
  }
}

function normalizePositiveNumber(value: unknown, label: string) {
  if (typeof value === 'string' && /e/i.test(value)) throw new Error(`${label} 格式錯誤`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必須是有效數字`);
  if (parsed <= 0) throw new Error(`${label} 必須大於 0`);
  if (String(value).length > 32) throw new Error(`${label} 長度過長`);
  return parsed;
}

function normalizeIsoDate(value: unknown) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error('發生時間格式錯誤');
  return new Date(timestamp).toISOString();
}

function normalizeMetadata(value: unknown) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata 必須是 JSON object');
  return value as Record<string, unknown>;
}

export function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20) || 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

export function validateInventoryTransactionPostPayload(input: unknown): InventoryTransactionPostPayload {
  const payload = (input || {}) as Record<string, unknown>;
  rejectSystemFields(payload);

  const transactionType = String(payload.transactionType ?? '').trim().toUpperCase();
  if (!INVENTORY_TRANSACTION_TYPES.includes(transactionType as InventoryTransactionType)) {
    throw new Error('庫存交易類型錯誤');
  }

  const inputUnitType = String(payload.inputUnitType ?? '').trim().toUpperCase();
  if (!INVENTORY_INPUT_UNIT_TYPES.includes(inputUnitType as InventoryInputUnitType)) {
    throw new Error('庫存交易單位類型錯誤');
  }

  const referenceId = payload.referenceId ? validateUuid(payload.referenceId, 'referenceId') : null;
  const referenceType = normalizeOptionalText(payload.referenceType)?.toUpperCase() || null;
  if (referenceId && !referenceType) throw new Error('referenceId 有值時必須提供 referenceType');

  const idempotencyKey = normalizeRequiredText(payload.idempotencyKey, 'idempotencyKey', 120);

  return {
    transactionType: transactionType as InventoryTransactionType,
    locationId: validateUuid(payload.locationId, '庫存位置 id'),
    partId: validateUuid(payload.partId, '料件 id'),
    quantity: normalizePositiveNumber(payload.quantity, '數量'),
    inputUnitType: inputUnitType as InventoryInputUnitType,
    reason: normalizeRequiredText(payload.reason, '交易原因', 300),
    notes: normalizeOptionalText(payload.notes),
    referenceType,
    referenceId,
    idempotencyKey,
    occurredAt: normalizeIsoDate(payload.occurredAt),
    metadata: normalizeMetadata(payload.metadata),
  };
}

export function validateOptionalUuidParam(searchParams: URLSearchParams, key: string, label: string) {
  const value = searchParams.get(key)?.trim();
  return value ? validateUuid(value, label) : null;
}

export function validateDateParam(searchParams: URLSearchParams, key: string, label: string) {
  const value = searchParams.get(key)?.trim();
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label}格式錯誤`);
  return new Date(timestamp).toISOString();
}

export function parseBooleanParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
