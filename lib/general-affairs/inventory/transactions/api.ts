import { NextResponse } from 'next/server';

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '請先登入',
  UNAUTHENTICATED: '請先登入',
  PERMISSION_DENIED: '沒有庫存交易權限',
  PART_VIEW_REQUIRED: '缺少料件查看權限',
  LOCATION_NOT_FOUND: '找不到庫存位置',
  PART_NOT_FOUND: '找不到料件',
  LOCATION_PART_NOT_FOUND: '找不到位置料件設定',
  LOCATION_PART_NOT_CONFIGURED: '此庫存位置尚未啟用此料件設定',
  INVALID_TRANSACTION_TYPE: '庫存交易類型錯誤',
  INVALID_UNIT_TYPE: '庫存交易單位類型錯誤',
  INVALID_INPUT_UNIT_TYPE: '庫存交易單位類型錯誤',
  INVALID_PURCHASE_UNIT: '此料件未設定有效採購單位換算率',
  INVALID_QUANTITY: '庫存交易數量或內容錯誤',
  FRACTIONAL_NOT_ALLOWED: '此料件不允許小數領用',
  MINIMUM_ISSUE_NOT_MET: '低於最小領用量',
  UNPACKING_NOT_ALLOWED: '此料件不允許拆包領用',
  INSUFFICIENT_STOCK: '庫存不足',
  BALANCE_NOT_FOUND: '找不到庫存餘額',
  INVALID_HOLDING_QUANTITY: '使用狀態數量錯誤',
  HOLDING_EXCEEDS_BALANCE: '使用中與閒置數量不可超過實際持有量',
  IDEMPOTENCY_CONFLICT: '此交易請求已被不同內容使用',
  VALIDATION_ERROR: '輸入資料格式錯誤',
  UNKNOWN_ERROR: '庫存交易操作失敗',
};

const ERROR_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  PART_VIEW_REQUIRED: 403,
  LOCATION_NOT_FOUND: 404,
  PART_NOT_FOUND: 404,
  LOCATION_PART_NOT_FOUND: 422,
  LOCATION_PART_NOT_CONFIGURED: 422,
  INVALID_TRANSACTION_TYPE: 400,
  INVALID_UNIT_TYPE: 400,
  INVALID_INPUT_UNIT_TYPE: 400,
  INVALID_QUANTITY: 400,
  INSUFFICIENT_STOCK: 409,
  BALANCE_NOT_FOUND: 404,
  INVALID_HOLDING_QUANTITY: 400,
  HOLDING_EXCEEDS_BALANCE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VALIDATION_ERROR: 400,
};

export function extractInventoryError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '');

  const match = message.match(/^([A-Z_]+):\s*(.*)$/);
  const code = match?.[1] || ((error as { code?: string })?.code === '23505' ? 'IDEMPOTENCY_CONFLICT' : 'UNKNOWN_ERROR');
  const detail = match?.[2] || message;
  const safeMessage = ERROR_MESSAGES[code] || detail || ERROR_MESSAGES.UNKNOWN_ERROR;
  const status = ERROR_STATUS[code] || (code === 'UNKNOWN_ERROR' ? 500 : 422);
  return { code, message: safeMessage, status };
}

export function jsonError(error: unknown, fallbackCode = 'UNKNOWN_ERROR', statusOverride?: number) {
  const parsed = extractInventoryError(error);
  const code = parsed.code === 'UNKNOWN_ERROR' ? fallbackCode : parsed.code;
  const message = ERROR_MESSAGES[code] || parsed.message || ERROR_MESSAGES.UNKNOWN_ERROR;
  const status = statusOverride || ERROR_STATUS[code] || parsed.status;
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export function jsonSuccess(data: unknown, init?: ResponseInit & { meta?: unknown }) {
  const body: Record<string, unknown> = { success: true, data };
  if (init && 'meta' in init) body.meta = init.meta;
  return NextResponse.json(body, init);
}

export function maskIdempotencyKey(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
