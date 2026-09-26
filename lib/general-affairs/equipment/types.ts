export const EQUIPMENT_STATUSES = [
  'ACTIVE',
  'TEMPORARILY_STOPPED',
  'SPARE',
  'RETIRED',
  'SCRAPPED',
] as const;

export const EQUIPMENT_CRITICALITIES = [
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
] as const;

export const EQUIPMENT_ONBOARDING_STATUSES = [
  'NEEDS_EQUIPMENT_PHOTO',
  'NEEDS_LABEL_PHOTO',
  'PENDING_GA_REVIEW',
  'COMPLETED',
] as const;

export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];
export type EquipmentCriticality = typeof EQUIPMENT_CRITICALITIES[number];
export type EquipmentOnboardingStatus = typeof EQUIPMENT_ONBOARDING_STATUSES[number];

export type EquipmentTemplatePayload = {
  category_id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  specs?: Record<string, unknown>;
  default_fields?: Record<string, unknown>;
  default_warranty_months?: number | null;
  image_path?: string | null;
  is_active?: boolean;
};

export type EquipmentPayload = {
  store_id: string;
  category_id: string;
  template_id?: string | null;
  name: string;
  asset_code?: string | null;
  barcode?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  status?: EquipmentStatus;
  criticality?: EquipmentCriticality;
  onboarding_status?: EquipmentOnboardingStatus;
  area?: string | null;
  location_detail?: string | null;
  purpose?: string | null;
  installed_at?: string | null;
  purchased_at?: string | null;
  activated_at?: string | null;
  purchase_amount?: number | null;
  specs?: Record<string, unknown>;
  tags?: string[];
  notes?: string | null;
  has_warranty?: boolean;
  warranty_end_date?: string | null;
  image_path?: string | null;
  qr_token?: string | null;
  qr_token_issued_at?: string | null;
  qr_token_revoked_at?: string | null;
};

export type EquipmentWarning = {
  code: string;
  message: string;
  duplicate_count?: number;
};

export type EquipmentListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
