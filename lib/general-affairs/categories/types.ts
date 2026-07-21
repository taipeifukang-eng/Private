export type GeneralAffairsCategoryType = 'equipment' | 'facility' | 'part';

export type BaseCategoryPayload = {
  parent_id?: string | null;
  name: string;
  code: string;
  description?: string | null;
  icon_key?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export type EquipmentCategoryPayload = BaseCategoryPayload & {
  requires_brand?: boolean;
  requires_model?: boolean;
  requires_serial_number?: boolean;
  requires_warranty?: boolean;
  default_fields?: Record<string, unknown>;
};

export type FacilityCategoryPayload = BaseCategoryPayload & {
  default_issue_fields?: Record<string, unknown>;
};

export type PartCategoryPayload = BaseCategoryPayload & {
  spec_schema?: unknown[];
  default_base_unit?: string | null;
  is_recyclable_default?: boolean;
  manage_compatibility?: boolean;
};

export type CategoryPayload =
  | EquipmentCategoryPayload
  | FacilityCategoryPayload
  | PartCategoryPayload;

export type CategoryConfig = {
  type: GeneralAffairsCategoryType;
  table: 'ga_equipment_categories' | 'ga_facility_categories' | 'ga_part_categories';
  viewPermission: string;
  managePermission: string;
};
