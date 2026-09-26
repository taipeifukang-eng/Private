import {
  PURCHASE_REVIEW_DECISIONS,
  type PurchaseReviewDecision,
  type PurchaseReviewPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanOptionalText(value: unknown, max = 1000) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`文字不可超過 ${max} 字`);
  return text;
}

function cleanRequiredText(value: unknown, label: string, max = 1000) {
  const text = cleanOptionalText(value, max);
  if (!text) throw new Error(`請填寫${label}`);
  return text;
}

function cleanOptionalUuid(value: unknown, label: string) {
  const text = cleanOptionalText(value, 80);
  if (!text) return null;
  if (!UUID_PATTERN.test(text)) throw new Error(`${label}格式錯誤`);
  return text;
}

function cleanOptionalPositiveNumber(value: unknown, label: string) {
  const text = cleanOptionalText(value, 32);
  if (!text) return null;
  if (/e/i.test(text)) throw new Error(`${label}格式錯誤`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必須是有效數字`);
  if (parsed < 0) throw new Error(`${label}不可小於 0`);
  return parsed;
}

function cleanOptionalQuantity(value: unknown) {
  const parsed = cleanOptionalPositiveNumber(value, '核准數量');
  if (parsed === null) return null;
  if (parsed <= 0) throw new Error('核准數量必須大於 0');
  return parsed;
}

function cleanOptionalInteger(value: unknown, label: string) {
  const parsed = cleanOptionalPositiveNumber(value, label);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) throw new Error(`${label}必須是整數`);
  return parsed;
}

function cleanOptionalDate(value: unknown) {
  const text = cleanOptionalText(value, 20);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error('預計到貨日格式錯誤');
  return text.slice(0, 10);
}

export function validatePurchaseReviewPayload(input: unknown): PurchaseReviewPayload {
  const body = (input || {}) as Record<string, unknown>;
  const decision = String(body.decision || '').trim().toUpperCase();
  if (!PURCHASE_REVIEW_DECISIONS.includes(decision as PurchaseReviewDecision)) {
    throw new Error('請選擇採購評估結果');
  }

  const payload: PurchaseReviewPayload = {
    decision: decision as PurchaseReviewDecision,
    vendorId: cleanOptionalUuid(body.vendorId, '供應商 id'),
    vendorName: cleanOptionalText(body.vendorName, 120),
    approvedQuantity: cleanOptionalQuantity(body.approvedQuantity),
    approvedUnit: cleanOptionalText(body.approvedUnit, 20),
    estimatedAmount: cleanOptionalPositiveNumber(body.estimatedAmount, '預估金額'),
    quotedAmount: cleanOptionalPositiveNumber(body.quotedAmount, '報價金額'),
    negotiatedAmount: cleanOptionalPositiveNumber(body.negotiatedAmount, '議價後金額'),
    finalAmount: cleanOptionalPositiveNumber(body.finalAmount, '實際採購金額'),
    expectedDeliveryDate: cleanOptionalDate(body.expectedDeliveryDate),
    deliveryMethod: cleanOptionalText(body.deliveryMethod, 80),
    receivingLocationId: cleanOptionalUuid(body.receivingLocationId, '入庫位置 id'),
    substituteDescription: cleanOptionalText(body.substituteDescription, 500),
    decisionNote: cleanRequiredText(body.decisionNote, '評估說明', 1000),
    publicNote: cleanOptionalText(body.publicNote, 500),
    quoteLeadTimeDays: cleanOptionalInteger(body.quoteLeadTimeDays, '交期天數'),
    quoteNotes: cleanOptionalText(body.quoteNotes, 1000),
  };

  if (payload.decision === 'PURCHASE' && !payload.approvedQuantity) {
    throw new Error('進入採購時請填寫核准數量');
  }
  if (payload.decision === 'SUBSTITUTE' && !payload.substituteDescription) {
    throw new Error('改用替代品時請填寫替代品說明');
  }
  if (payload.decision === 'REJECT' && !payload.publicNote) {
    throw new Error('駁回時請填寫門市可見說明');
  }

  return payload;
}
