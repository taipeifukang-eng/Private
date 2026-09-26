export const INVENTORY_LOCATION_TYPES = [
  'CENTRAL_WAREHOUSE',
  'STORE',
  'OFFICE',
  'TEMPORARY',
  'OTHER',
] as const;

export const PREFERRED_ISSUE_UNIT_TYPES = ['BASE', 'PURCHASE'] as const;

export type InventoryLocationType = typeof INVENTORY_LOCATION_TYPES[number];
export type PreferredIssueUnitType = typeof PREFERRED_ISSUE_UNIT_TYPES[number];

export type InventoryLocationPayload = {
  code?: string | null;
  name: string;
  location_type: InventoryLocationType;
  store_id?: string | null;
  description?: string | null;
  is_active?: boolean;
  allow_negative_stock?: boolean;
  is_default?: boolean;
};

export type InventoryLocationPartPayload = {
  location_id?: string;
  part_id: string;
  is_active?: boolean;
  safety_stock_qty?: number | null;
  reorder_point_qty?: number | null;
  maximum_stock_qty?: number | null;
  preferred_issue_unit_type?: PreferredIssueUnitType | null;
  notes?: string | null;
};

export type InventoryLocationListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
