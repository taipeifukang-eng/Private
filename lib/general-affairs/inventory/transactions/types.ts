export const INVENTORY_TRANSACTION_TYPES = ['RECEIPT', 'ISSUE', 'ADJUST_IN', 'ADJUST_OUT'] as const;
export const INVENTORY_INPUT_UNIT_TYPES = ['BASE', 'PURCHASE'] as const;

export type InventoryTransactionType = typeof INVENTORY_TRANSACTION_TYPES[number];
export type InventoryInputUnitType = typeof INVENTORY_INPUT_UNIT_TYPES[number];

export type InventoryTransactionPostPayload = {
  transactionType: InventoryTransactionType;
  locationId: string;
  partId: string;
  quantity: number;
  inputUnitType: InventoryInputUnitType;
  reason: string;
  notes?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey: string;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type InventoryApiError = {
  code: string;
  message: string;
};

export type InventoryListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
