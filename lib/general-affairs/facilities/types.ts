export const FACILITY_STATUSES = [
  'ACTIVE',
  'PARTIALLY_DAMAGED',
  'OUT_OF_SERVICE',
  'UNDER_RENOVATION',
  'RETIRED',
] as const;

export const FACILITY_CRITICALITIES = [
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
] as const;

export type FacilityStatus = typeof FACILITY_STATUSES[number];
export type FacilityCriticality = typeof FACILITY_CRITICALITIES[number];

export type FacilityPayload = {
  store_id: string;
  category_id: string;
  facility_template_id?: string | null;
  name: string;
  facility_code?: string | null;
  status?: FacilityStatus;
  criticality?: FacilityCriticality;
  area?: string | null;
  location_detail?: string | null;
  quantity?: number | null;
  unit?: string | null;
  is_fixed_asset?: boolean;
  installed_at?: string | null;
  purchased_at?: string | null;
  purchase_unit_amount?: number | null;
  purchase_amount?: number | null;
  last_renovated_at?: string | null;
  description?: string | null;
  specs?: Record<string, unknown>;
  tags?: string[];
  image_path?: string | null;
  notes?: string | null;
  qr_token?: string | null;
  qr_token_issued_at?: string | null;
  qr_token_revoked_at?: string | null;
};

export type FacilityWarning = {
  code: string;
  message: string;
  duplicate_count?: number;
};

export type FacilityListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
