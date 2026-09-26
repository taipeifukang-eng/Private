export const PART_COMPATIBILITY_TYPES = [
  'EQUIPMENT_TEMPLATE',
  'VENDOR_SERIES',
  'BRAND_MODEL',
] as const;

export type PartCompatibilityType = typeof PART_COMPATIBILITY_TYPES[number];

export type PartPayload = {
  category_id: string;
  name: string;
  part_code?: string | null;
  barcode?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
  description?: string | null;
  base_unit: string;
  purchase_unit?: string | null;
  purchase_to_base_rate?: number | null;
  minimum_issue_qty?: number;
  allow_fractional_issue?: boolean;
  allow_unpacking?: boolean;
  image_path?: string | null;
  specs?: Record<string, unknown>;
  tags?: string[];
  is_active?: boolean;
  notes?: string | null;
};

export type PartCompatibilityPayload = {
  part_id?: string;
  compatibility_type: PartCompatibilityType;
  equipment_template_id?: string | null;
  vendor_name?: string | null;
  series_name?: string | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
};

export type PartWarning = {
  code: string;
  message: string;
  duplicate_count?: number;
};

export type PartListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
