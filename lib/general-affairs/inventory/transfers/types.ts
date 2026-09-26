export const INVENTORY_TRANSFER_STATUSES = ['REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED'] as const;
export const INVENTORY_TRANSFER_ACTIONS = ['CONFIRM_SOURCE', 'MARK_IN_TRANSIT', 'RECEIVE', 'CANCEL'] as const;

export type InventoryTransferStatus = typeof INVENTORY_TRANSFER_STATUSES[number];
export type InventoryTransferAction = typeof INVENTORY_TRANSFER_ACTIONS[number];

export type InventoryTransferItemPayload = {
  partId: string;
  quantity: number;
  inputUnitType: 'BASE' | 'PURCHASE';
  notes?: string | null;
};

export type InventoryTransferCreatePayload = {
  serviceRequestId?: string | null;
  sourceLocationId: string;
  destinationLocationId: string;
  reason: string;
  notes?: string | null;
  shippingMethod?: string | null;
  items: InventoryTransferItemPayload[];
};

export type InventoryTransferActionPayload = {
  action: InventoryTransferAction;
  notes?: string | null;
  shippingMethod?: string | null;
  cancelReason?: string | null;
  idempotencyKey: string;
};
