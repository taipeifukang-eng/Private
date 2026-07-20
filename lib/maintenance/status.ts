export type MaintenanceTicketStatus = 'UNACCEPTED' | 'ACCEPTED' | 'PROCESSING' | 'COMPLETED';

export type LegacyMaintenanceStatus = 'pending' | 'in_progress' | 'completed' | 'closed';

export type MaintenanceProgressStage =
  | 'INITIAL_REVIEW'
  | 'WAITING_STORE_INFO'
  | 'INTERNAL_HANDLING'
  | 'SEARCHING_VENDOR'
  | 'WAITING_VENDOR_REPLY'
  | 'WAITING_VENDOR_QUOTE'
  | 'QUOTE_REVIEW'
  | 'VENDOR_ASSIGNED'
  | 'WAITING_VENDOR_VISIT'
  | 'VENDOR_WORKING'
  | 'WAITING_PARTS'
  | 'PARTS_IN_TRANSIT'
  | 'WAITING_INTERNAL_APPROVAL'
  | 'WAITING_STORE_CONFIRMATION'
  | 'REOPENED'
  | 'OTHER';

export type MaintenanceEventVisibility = 'PUBLIC' | 'INTERNAL';

export type MaintenanceCompletionMethod = 'STORE_CONFIRMED' | 'ADMIN_FORCE_CLOSED';

export type MaintenanceTicketAction =
  | 'ACCEPT'
  | 'SAVE_PROGRESS'
  | 'REQUEST_COMPLETION'
  | 'STORE_CONFIRM_COMPLETE'
  | 'REPORT_UNRESOLVED'
  | 'FORCE_CLOSE';

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceTicketStatus, string> = {
  UNACCEPTED: '未受理',
  ACCEPTED: '已受理',
  PROCESSING: '處理中',
  COMPLETED: '已完成',
};

export const MAINTENANCE_PROGRESS_STAGE_LABELS: Record<MaintenanceProgressStage, string> = {
  INITIAL_REVIEW: '初步評估',
  WAITING_STORE_INFO: '等待門市補充資料',
  INTERNAL_HANDLING: '總務自行處理',
  SEARCHING_VENDOR: '尋找廠商',
  WAITING_VENDOR_REPLY: '等待廠商回覆',
  WAITING_VENDOR_QUOTE: '等待廠商報價',
  QUOTE_REVIEW: '報價確認中',
  VENDOR_ASSIGNED: '已安排廠商',
  WAITING_VENDOR_VISIT: '等待廠商到場',
  VENDOR_WORKING: '廠商施工中',
  WAITING_PARTS: '等待料件',
  PARTS_IN_TRANSIT: '料件配送中',
  WAITING_INTERNAL_APPROVAL: '等待內部確認',
  WAITING_STORE_CONFIRMATION: '處理完成待門市確認',
  REOPENED: '門市反映仍有問題',
  OTHER: '其他',
};

export const MAINTENANCE_PROGRESS_STAGE_OPTIONS: Array<{
  code: MaintenanceProgressStage;
  name: string;
}> = Object.entries(MAINTENANCE_PROGRESS_STAGE_LABELS).map(([code, name]) => ({
  code: code as MaintenanceProgressStage,
  name,
}));

export const EXECUTION_PROGRESS_STAGES = new Set<MaintenanceProgressStage>([
  'WAITING_STORE_INFO',
  'SEARCHING_VENDOR',
  'WAITING_VENDOR_REPLY',
  'WAITING_VENDOR_QUOTE',
  'QUOTE_REVIEW',
  'VENDOR_ASSIGNED',
  'WAITING_VENDOR_VISIT',
  'VENDOR_WORKING',
  'WAITING_PARTS',
  'PARTS_IN_TRANSIT',
  'WAITING_INTERNAL_APPROVAL',
  'WAITING_STORE_CONFIRMATION',
  'REOPENED',
]);

export function normalizeMaintenanceStatus(value: unknown): MaintenanceTicketStatus | null {
  if (typeof value !== 'string') return null;
  const status = value.trim();
  if (status === 'pending') return 'UNACCEPTED';
  if (status === 'in_progress') return 'PROCESSING';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'closed') return 'COMPLETED';
  if (['UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED'].includes(status)) {
    return status as MaintenanceTicketStatus;
  }
  return null;
}

export function normalizeProgressStage(value: unknown): MaintenanceProgressStage | null {
  if (typeof value !== 'string') return null;
  const stage = value.trim();
  if (stage in MAINTENANCE_PROGRESS_STAGE_LABELS) return stage as MaintenanceProgressStage;
  return null;
}

export function getMaintenanceStatusLabel(status: unknown) {
  const normalized = normalizeMaintenanceStatus(status);
  return normalized ? MAINTENANCE_STATUS_LABELS[normalized] : String(status || '-');
}

export function getProgressStageLabel(stage: unknown) {
  const normalized = normalizeProgressStage(stage);
  return normalized ? MAINTENANCE_PROGRESS_STAGE_LABELS[normalized] : null;
}
