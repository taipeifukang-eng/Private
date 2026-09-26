import {
  INVENTORY_TRANSFER_ACTIONS,
  type InventoryTransferActionPayload,
  type InventoryTransferCreatePayload,
} from './types';
import { INVENTORY_INPUT_UNIT_TYPES } from '@/lib/general-affairs/inventory/transactions/types';

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function assertUuid(value: unknown, label: string) {
  const text = stringValue(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} 格式錯誤`);
  }
  return text;
}

function numericValue(value: unknown, label: string) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} 必須大於 0`);
  return number;
}

export function validateInventoryTransferCreatePayload(body: unknown): InventoryTransferCreatePayload {
  if (!body || typeof body !== 'object') throw new Error('調撥資料格式錯誤');
  const payload = body as Record<string, unknown>;
  const sourceLocationId = assertUuid(payload.sourceLocationId, '來源位置');
  const destinationLocationId = assertUuid(payload.destinationLocationId, '目的位置');
  if (sourceLocationId === destinationLocationId) throw new Error('來源位置與目的位置不可相同');

  const reason = stringValue(payload.reason);
  if (!reason) throw new Error('請輸入調撥原因');

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) throw new Error('請至少新增一筆調撥料件');
  if (rawItems.length > 20) throw new Error('單張調撥單最多 20 筆料件');

  const seenParts = new Set<string>();
  const items = rawItems.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 筆料件格式錯誤`);
    const row = item as Record<string, unknown>;
    const partId = assertUuid(row.partId, `第 ${index + 1} 筆料件`);
    if (seenParts.has(partId)) throw new Error('同一張調撥單不可重複選擇同一料件');
    seenParts.add(partId);
    const inputUnitType = stringValue(row.inputUnitType).toUpperCase() || 'BASE';
    if (!INVENTORY_INPUT_UNIT_TYPES.includes(inputUnitType as any)) throw new Error(`第 ${index + 1} 筆單位類型錯誤`);
    return {
      partId,
      quantity: numericValue(row.quantity, `第 ${index + 1} 筆數量`),
      inputUnitType: inputUnitType as 'BASE' | 'PURCHASE',
      notes: optionalString(row.notes),
    };
  });

  return {
    serviceRequestId: payload.serviceRequestId ? assertUuid(payload.serviceRequestId, '來源需求單') : null,
    sourceLocationId,
    destinationLocationId,
    reason,
    notes: optionalString(payload.notes),
    shippingMethod: optionalString(payload.shippingMethod),
    items,
  };
}

export function validateInventoryTransferActionPayload(body: unknown): InventoryTransferActionPayload {
  if (!body || typeof body !== 'object') throw new Error('調撥動作資料格式錯誤');
  const payload = body as Record<string, unknown>;
  const action = stringValue(payload.action).toUpperCase();
  if (!INVENTORY_TRANSFER_ACTIONS.includes(action as any)) throw new Error('調撥動作錯誤');

  const idempotencyKey = stringValue(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error('缺少 idempotencyKey');

  const cancelReason = optionalString(payload.cancelReason);
  if (action === 'CANCEL' && !cancelReason) throw new Error('取消調撥必須填寫原因');

  return {
    action: action as InventoryTransferActionPayload['action'],
    notes: optionalString(payload.notes),
    shippingMethod: optionalString(payload.shippingMethod),
    cancelReason,
    idempotencyKey,
  };
}
