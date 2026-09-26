export type GeneralAffairsFeatureStatus = 'available' | 'planned' | 'temporarily_unavailable';

export type GeneralAffairsFeatureKey =
  | 'service_home'
  | 'maintenance_reports'
  | 'service_requests'
  | 'work_orders'
  | 'part_request_create'
  | 'part_requests_temporary'
  | 'part_request_review'
  | 'inventory_transfer_receiving'
  | 'inventory_count'
  | 'inventory_overview'
  | 'inventory_transactions'
  | 'inventory_locations'
  | 'equipment'
  | 'equipment_categories'
  | 'equipment_new'
  | 'equipment_templates'
  | 'equipment_warranties'
  | 'equipment_maintenance_history'
  | 'facilities'
  | 'facility_categories'
  | 'facility_new'
  | 'facility_templates'
  | 'facility_warranties'
  | 'facility_maintenance_history'
  | 'parts'
  | 'part_categories'
  | 'part_new'
  | 'part_usage_history'
  | 'vendors'
  | 'vendor_categories'
  | 'vendor_regions'
  | 'vendor_stats'
  | 'vendor_purchase_analysis'
  | 'category_settings'
  | 'part_compatibilities'
  | 'utility_bills';

export type GeneralAffairsFeatureAvailability = {
  key: GeneralAffairsFeatureKey;
  label: string;
  status: GeneralAffairsFeatureStatus;
  message?: string;
};

export const GENERAL_AFFAIRS_FEATURES: Record<GeneralAffairsFeatureKey, GeneralAffairsFeatureAvailability> = {
  service_home: { key: 'service_home', label: '服務首頁', status: 'available' },
  maintenance_reports: { key: 'maintenance_reports', label: '維修回報', status: 'available' },
  service_requests: { key: 'service_requests', label: '總務需求單', status: 'available' },
  work_orders: { key: 'work_orders', label: '工單中心', status: 'available' },
  part_request_create: {
    key: 'part_request_create',
    label: '新增料件申請',
    status: 'temporarily_unavailable',
    message: '門市端料件需求已收斂到新增需求中的添購 / 補充類型。',
  },
  part_requests_temporary: {
    key: 'part_requests_temporary',
    label: '我的料件申請',
    status: 'temporarily_unavailable',
    message: '門市端料件需求已收斂到我的追蹤統一追蹤。',
  },
  part_request_review: {
    key: 'part_request_review',
    label: '料件處理中心',
    status: 'available',
  },
  inventory_transfer_receiving: {
    key: 'inventory_transfer_receiving',
    label: '調撥與收貨',
    status: 'available',
  },
  inventory_count: {
    key: 'inventory_count',
    label: '盤點作業',
    status: 'planned',
  },
  inventory_overview: { key: 'inventory_overview', label: '庫存總覽', status: 'available' },
  inventory_transactions: { key: 'inventory_transactions', label: '庫存流水', status: 'available' },
  inventory_locations: { key: 'inventory_locations', label: '庫存位置', status: 'available' },
  equipment: { key: 'equipment', label: '設備管理', status: 'available' },
  equipment_categories: { key: 'equipment_categories', label: '設備分類', status: 'available' },
  equipment_new: { key: 'equipment_new', label: '新增設備', status: 'available' },
  equipment_templates: {
    key: 'equipment_templates',
    label: '設備範本',
    status: 'temporarily_unavailable',
    message: '設備主檔不採用範本流程；總務直接依門市、分類、品牌型號與照片建立設備。',
  },
  equipment_warranties: { key: 'equipment_warranties', label: '保固管理', status: 'available' },
  equipment_maintenance_history: { key: 'equipment_maintenance_history', label: '設備維修紀錄', status: 'available' },
  facilities: { key: 'facilities', label: '設施管理', status: 'available' },
  facility_categories: { key: 'facility_categories', label: '設施分類', status: 'available' },
  facility_new: { key: 'facility_new', label: '新增設施', status: 'available' },
  facility_templates: { key: 'facility_templates', label: '設施架型', status: 'available' },
  facility_warranties: { key: 'facility_warranties', label: '設施保固管理', status: 'available' },
  facility_maintenance_history: { key: 'facility_maintenance_history', label: '設施維修紀錄', status: 'available' },
  parts: { key: 'parts', label: '料件中心', status: 'available' },
  part_categories: { key: 'part_categories', label: '料件分類', status: 'available' },
  part_new: {
    key: 'part_new',
    label: '新增料件',
    status: 'available',
  },
  part_usage_history: {
    key: 'part_usage_history',
    label: '使用紀錄',
    status: 'planned',
    message: '正式領用 / 工單扣料流程尚未建立，暫不顯示可操作使用紀錄。',
  },
  vendors: { key: 'vendors', label: '廠商資料', status: 'available' },
  vendor_categories: { key: 'vendor_categories', label: '服務分類', status: 'available' },
  vendor_regions: { key: 'vendor_regions', label: '服務區域', status: 'available' },
  vendor_stats: { key: 'vendor_stats', label: '合作紀錄', status: 'available' },
  vendor_purchase_analysis: { key: 'vendor_purchase_analysis', label: '採購分析', status: 'available' },
  category_settings: {
    key: 'category_settings',
    label: '分類設定',
    status: 'temporarily_unavailable',
    message: '分類設定目前分散在各主檔分類 API，尚未收斂成獨立設定頁。',
  },
  part_compatibilities: {
    key: 'part_compatibilities',
    label: '相容性管理',
    status: 'available',
  },
  utility_bills: { key: 'utility_bills', label: '水電電話網路費', status: 'available' },
};

export function getGeneralAffairsFeatureAvailability(featureKey?: GeneralAffairsFeatureKey) {
  if (!featureKey) return null;
  return GENERAL_AFFAIRS_FEATURES[featureKey] || null;
}

export function isGeneralAffairsFeatureAvailable(featureKey?: GeneralAffairsFeatureKey) {
  const feature = getGeneralAffairsFeatureAvailability(featureKey);
  return !feature || feature.status === 'available';
}
