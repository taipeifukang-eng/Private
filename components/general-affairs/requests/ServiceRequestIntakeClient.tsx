'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Image,
  MessageSquare,
  Paperclip,
  Pencil,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Send,
  ShoppingCart,
  Timer,
  Trash2,
  UserCog,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import PartFulfillmentRequestBridge from '@/components/general-affairs/requests/PartFulfillmentRequestBridge';

type ServiceRequest = {
  id: string;
  request_no: string;
  store_id: string;
  request_type: string;
  title: string;
  description: string;
  resource_type?: string | null;
  part_id?: string | null;
  desired_quantity?: number | null;
  desired_unit?: string | null;
  desired_spec?: string | null;
  impact_description?: string | null;
  main_status: string;
  intake_route?: string | null;
  assignee_role?: string | null;
  assignee_name?: string | null;
  maintenance_request_id?: string | null;
  public_progress?: string | null;
  rejection_reason?: string | null;
  rejection_note?: string | null;
  supplement_type?: string | null;
  supplement_note?: string | null;
  last_store_comment_at?: string | null;
  last_ga_response_at?: string | null;
  last_store_read_at?: string | null;
  last_store_read_by_name?: string | null;
  store_reply_pending?: boolean;
  unread_store_comment_count?: number;
  created_at: string;
  updated_at: string;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  equipment?: { name?: string | null; asset_code?: string | null; area?: string | null; location_detail?: string | null } | null;
  facility?: { name?: string | null; facility_code?: string | null; area?: string | null; location_detail?: string | null } | null;
  part?: { name?: string | null; part_code?: string | null } | null;
};

type IntakeAction = 'accept' | 'reject' | 'request_supplement' | 'assign' | 'update_progress' | 'request_store_confirmation';

type RequestAttachment = {
  id: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  purpose?: string | null;
  signed_url?: string | null;
  uploaded_at?: string | null;
};

function isImageAttachment(attachment: RequestAttachment) {
  const fileName = attachment.file_name?.toLowerCase() || '';
  const looksLikeImage = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(fileName);
  return Boolean((attachment.content_type?.startsWith('image/') || looksLikeImage) && attachment.signed_url);
}

type RequestEvent = {
  id: string;
  event_type: string;
  old_status?: string | null;
  new_status?: string | null;
  visibility?: string | null;
  title: string;
  description?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
};

type RequestComment = {
  id: string;
  source_context?: string | null;
  visibility?: string | null;
  body: string;
  created_by_name?: string | null;
  edited_at?: string | null;
  created_at?: string | null;
  attachments?: RequestAttachment[];
  can_edit?: boolean;
  can_delete?: boolean;
  read_by_name?: string | null;
  read_at?: string | null;
};

type CommentVisibility = 'PUBLIC' | 'INTERNAL';

type ApiError = { code?: string; message?: string };

type InventoryLocationOption = {
  id: string;
  code?: string | null;
  name: string;
  location_type: string;
  allow_negative_stock?: boolean;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
};

type InventoryPartOption = {
  id: string;
  name: string;
  part_code?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
  base_unit: string;
  purchase_unit?: string | null;
  purchase_to_base_rate?: number | null;
};

type InventoryBalanceRow = {
  id?: string;
  location_id: string;
  part_id: string;
  quantity_base: number;
};

type InventoryLocationPartOption = {
  id: string;
  location_id: string;
  part_id: string;
  preferred_issue_unit_type?: 'BASE' | 'PURCHASE' | string | null;
  currentBalance?: InventoryBalanceRow | null;
  part?: InventoryPartOption | null;
};

type PartRequestWorkspace = {
  desiredQuantity: number;
  unit: string;
  rows: Array<{ item: InventoryLocationPartOption; location: InventoryLocationOption | null; balance: number }>;
  availableRows: Array<{ item: InventoryLocationPartOption; location: InventoryLocationOption | null; balance: number }>;
  totalAvailable: number;
  primaryRow: { item: InventoryLocationPartOption; location: InventoryLocationOption | null; balance: number } | null;
  part: InventoryPartOption | null;
  recommendation: string;
  hasEnoughStock: boolean;
  hasPartialStock: boolean;
};

type StockIssueForm = {
  locationId: string;
  partId: string;
  quantity: string;
  inputUnitType: 'BASE' | 'PURCHASE';
  reason: string;
  notes: string;
  idempotencyKey: string;
};

type PurchaseReviewDecision = 'REJECT' | 'STOCK_ISSUE' | 'TRANSFER' | 'PURCHASE' | 'SUBSTITUTE';

type PurchaseVendorOption = {
  id: string;
  name: string;
  alias?: string | null;
  status?: string | null;
  phone?: string | null;
  contact_name?: string | null;
};

type PurchaseReviewForm = {
  decision: PurchaseReviewDecision;
  vendorId: string;
  vendorName: string;
  approvedQuantity: string;
  approvedUnit: string;
  estimatedAmount: string;
  quotedAmount: string;
  negotiatedAmount: string;
  finalAmount: string;
  expectedDeliveryDate: string;
  deliveryMethod: string;
  receivingLocationId: string;
  substituteDescription: string;
  decisionNote: string;
  publicNote: string;
  quoteLeadTimeDays: string;
  quoteNotes: string;
};

type PurchaseReceiptForm = {
  locationId: string;
  partId: string;
  quantity: string;
  inputUnitType: 'BASE' | 'PURCHASE';
  reason: string;
  notes: string;
  requestStoreConfirmation: boolean;
  idempotencyKey: string;
};

type EquipmentReviewTask = {
  id: string;
  title: string;
  status: 'PENDING_GA_REVIEW';
  updated_at: string;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  category?: { name?: string | null; code?: string | null } | null;
  equipment: {
    id: string;
    name?: string | null;
    asset_code?: string | null;
    area?: string | null;
    location_detail?: string | null;
    onboarding_review_note?: string | null;
    onboarding_requires_primary_photo?: boolean | null;
    onboarding_requires_label_photo?: boolean | null;
    primary_image?: RequestAttachment | null;
    label_position_image?: RequestAttachment | null;
  };
};

type IntakeWorkItem =
  | { kind: 'request'; id: string; status: string; searchable: string; updated_at: string; request: ServiceRequest }
  | { kind: 'equipment_review'; id: string; status: 'WAITING_GA_REVIEW'; searchable: string; updated_at: string; task: EquipmentReviewTask };

type WorkFocusFilter = '' | 'NEEDS_INTAKE' | 'STORE_REPLY' | 'PART_HANDLING' | 'WAITING_CONFIRMATION';

const STATUS_LABELS: Record<string, string> = {
  PENDING_INTAKE: '待受理',
  WAITING_STORE_SUPPLEMENT: '待補資料',
  WAITING_GA_REVIEW: '待總務複核',
  ACCEPTED: '已受理',
  IN_PROGRESS: '處理中',
  WAITING_STORE_CONFIRMATION: '待門市確認',
  COMPLETED: '已完成',
  REJECTED: '已駁回',
  CANCELED: '已取消',
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  REPAIR: '維修',
  PURCHASE_SUPPLEMENT: '添購/補充',
  ASSIGNED_RESPONSE: '總務要求回覆',
};

const SCENE_DESCRIPTION_LABELS = ['現場描述', '現場狀況', '需求描述', '問題描述', '描述', '說明'];
const DUPLICATE_SCENE_LABELS = [
  '問題類型',
  '環境問題',
  '狀況類型',
  '需求類型',
  '問題分類',
  '分類',
  '門市',
  '發生位置',
  '暫時處理方式',
];

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  EQUIPMENT: '設備',
  FACILITY: '設施',
  PART: '料件',
  GENERAL_SUPPLY: '庶務用品',
  OTHER_PURCHASE: '未建主檔物品',
};

const INTAKE_ROUTES = [
  { value: 'REPAIR_DISPATCH', label: '維修派工' },
  { value: 'PURCHASE_REVIEW', label: '添購/採購評估' },
  { value: 'STOCK_ISSUE', label: '庫存出庫' },
  { value: 'TRANSFER', label: '調撥處理' },
  { value: 'ASSET_TASK', label: '資產異動/門市配合' },
];

const ASSIGNEE_ROLES = [
  { value: 'GENERAL_AFFAIRS', label: '總務' },
  { value: 'WORKS', label: '工務' },
];

const PURCHASE_REVIEW_DECISIONS: Array<{ value: PurchaseReviewDecision; label: string; helper: string }> = [
  { value: 'PURCHASE', label: '進入採購', helper: '記錄供應商、報價、議價、核准數量與到貨方式。' },
  { value: 'STOCK_ISSUE', label: '改由庫存出庫', helper: '評估後改走需求單庫存出庫流程。' },
  { value: 'TRANSFER', label: '改由調撥', helper: '評估後改走調撥與收貨流程。' },
  { value: 'SUBSTITUTE', label: '改用替代品', helper: '不另開門市同意流程，但需記錄替代品資訊。' },
  { value: 'REJECT', label: '駁回', helper: '不符合添購條件，需填寫門市可見說明。' },
];

const REJECTION_REASONS = [
  { value: 'OUT_OF_SCOPE', label: '不屬於總務/工務處理範圍' },
  { value: 'INSUFFICIENT_DATA_RECREATE', label: '資料不足，請重新提出' },
  { value: 'DUPLICATE_REQUEST', label: '重複申請' },
  { value: 'NOT_ELIGIBLE', label: '不符合採購/維修條件' },
  { value: 'ALTERNATIVE_AVAILABLE', label: '已有替代處理方式' },
  { value: 'OTHER', label: '其他' },
];

const SUPPLEMENT_TYPES = [
  { value: 'PHOTO_UNCLEAR', label: '照片不清楚' },
  { value: 'MISSING_PHOTO', label: '缺少必要照片' },
  { value: 'DESCRIPTION_INSUFFICIENT', label: '問題描述不足' },
  { value: 'RESOURCE_SELECTION_WRONG', label: '設備/設施選擇錯誤' },
  { value: 'QUANTITY_OR_SPEC_INSUFFICIENT', label: '數量/規格說明不足' },
  { value: 'OTHER', label: '其他' },
];

const STATUS_FILTERS = [
  { value: 'PENDING_INTAKE', label: '待受理' },
  { value: 'WAITING_GA_REVIEW', label: '待總務複核' },
  { value: 'WAITING_STORE_SUPPLEMENT', label: '待補資料' },
  { value: 'ACCEPTED', label: '已受理' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'WAITING_STORE_CONFIRMATION', label: '待門市確認' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REJECTED', label: '已駁回' },
  { value: 'CANCELED', label: '已取消' },
  { value: '', label: '全部' },
];

const ACTIVE_ACTIONS_BY_STATUS: Record<string, IntakeAction[]> = {
  PENDING_INTAKE: ['accept', 'reject', 'request_supplement', 'assign'],
  WAITING_GA_REVIEW: ['accept', 'reject', 'request_supplement', 'assign'],
  ACCEPTED: ['update_progress', 'request_store_confirmation', 'request_supplement', 'assign'],
  IN_PROGRESS: ['update_progress', 'request_store_confirmation', 'request_supplement', 'assign'],
  WAITING_STORE_SUPPLEMENT: ['assign'],
  WAITING_STORE_CONFIRMATION: ['update_progress', 'assign'],
};

function shouldHandOffToWorkOrderCenter(request: ServiceRequest) {
  return Boolean(
    request.maintenance_request_id &&
    ['ACCEPTED', 'IN_PROGRESS', 'WAITING_STORE_CONFIRMATION'].includes(request.main_status),
  );
}

function visibilityLabel(value?: string | null) {
  return value === 'INTERNAL' ? '內部' : '公開';
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function numberText(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return parsed.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

function currencyText(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return '-';
  return parsed.toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });
}

function percentText(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value)}%`;
}

function storeLabel(request: ServiceRequest) {
  const store = request.store;
  return [store?.store_code, store?.short_name || store?.store_name].filter(Boolean).join(' ') || '-';
}

function inventoryLocationLabel(location?: InventoryLocationOption | null) {
  if (!location) return '-';
  const store = location.store?.short_name || location.store?.store_name || '';
  return [location.code, location.name, store].filter(Boolean).join('｜');
}

function inventoryPartLabel(part?: InventoryPartOption | null) {
  if (!part) return '-';
  return [part.part_code, part.name, part.brand, part.model].filter(Boolean).join('｜');
}

function purchaseVendorLabel(vendor?: PurchaseVendorOption | null) {
  if (!vendor) return '-';
  return [vendor.name, vendor.alias, vendor.contact_name, vendor.phone].filter(Boolean).join('｜');
}

function partRequestUnit(request: ServiceRequest, fallbackPart?: InventoryPartOption | null) {
  return request.desired_unit || fallbackPart?.base_unit || '單位';
}

function buildTransferPrefillUrl(request: ServiceRequest, workspace: PartRequestWorkspace | null) {
  const params = new URLSearchParams();
  params.set('fromRequestId', request.id);
  params.set('requestNo', request.request_no);
  params.set('destinationStoreId', request.store_id);
  params.set('reason', `需求單 ${request.request_no} ${request.title} 調撥`);
  params.set('notes', `由總務需求工作台建立，門市需求：${request.title}`);
  if (request.part_id) params.set('partId', request.part_id);
  if (request.desired_quantity) params.set('quantity', String(request.desired_quantity));
  if (workspace?.primaryRow?.item.location_id) params.set('sourceLocationId', workspace.primaryRow.item.location_id);
  return `/general-affairs/inventory/transfers?${params.toString()}`;
}

function locationPartBalance(item: InventoryLocationPartOption) {
  return Number(item.currentBalance?.quantity_base || 0);
}

function partHandlingRouteLabel(route?: string | null) {
  if (route === 'STOCK_ISSUE') return '出庫';
  if (route === 'TRANSFER') return '調撥';
  if (route === 'PURCHASE_REVIEW') return '採購評估';
  return '待判斷';
}

function requestNextStepLabel(request: ServiceRequest) {
  if (request.store_reply_pending) return '先看門市新留言';
  if (request.main_status === 'PENDING_INTAKE') return '待受理分流';
  if (request.main_status === 'WAITING_GA_REVIEW') return '待總務複核';
  if (request.main_status === 'ACCEPTED' || request.main_status === 'IN_PROGRESS') {
    if (request.resource_type === 'PART') return `處理${partHandlingRouteLabel(request.intake_route)}`;
    return '推進處理';
  }
  if (request.main_status === 'WAITING_STORE_CONFIRMATION') return '等門市確認';
  return STATUS_LABELS[request.main_status] || request.main_status;
}

function stripSceneDescription(value?: string | null) {
  const rawValue = value?.trim();
  if (!rawValue) return '';

  const parts = rawValue
    .replace(/\r\n/g, '\n')
    .replace(/[|｜]/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);

  const sceneLabelPattern = new RegExp(`^(${SCENE_DESCRIPTION_LABELS.join('|')})\\s*[:：]\\s*`);
  const duplicateLabelPattern = new RegExp(`^(${DUPLICATE_SCENE_LABELS.join('|')})(\\s*[:：].*)?$`);
  const duplicatePrefixPattern = new RegExp(`^(${DUPLICATE_SCENE_LABELS.join('|')})\\s*[:：]`);

  const labeledScene = parts.find((part) => sceneLabelPattern.test(part));
  if (labeledScene) return labeledScene.replace(sceneLabelPattern, '').trim();

  return parts
    .map((part) => part.replace(sceneLabelPattern, '').trim())
    .filter((part) => part && !duplicateLabelPattern.test(part) && !duplicatePrefixPattern.test(part))
    .join(' / ')
    .trim();
}

function requestListSceneDescription(request: ServiceRequest) {
  return stripSceneDescription(request.description) || stripSceneDescription(request.impact_description) || '未填現場描述';
}

function requestListTitle(request: ServiceRequest) {
  const original = request.title.trim();
  const store = request.store;
  const prefixes = [
    storeLabel(request),
    [store?.store_code, store?.short_name].filter(Boolean).join(' '),
    store?.short_name,
    store?.store_name,
    store?.store_code,
  ].filter((value): value is string => Boolean(value && value !== '-'));
  const prefix = prefixes.find((value) => original.startsWith(value));
  if (!prefix) return original;
  return original.slice(prefix.length).replace(/^[\s|｜/\-]+/, '').trim() || original;
}

function taskStoreLabel(task: EquipmentReviewTask) {
  const store = task.store;
  return [store?.store_code, store?.short_name || store?.store_name].filter(Boolean).join(' ') || '-';
}

function taskLocationLabel(task: EquipmentReviewTask) {
  return [task.equipment.area, task.equipment.location_detail].filter(Boolean).join(' / ') || '-';
}

function resourceLabel(request: ServiceRequest) {
  if (request.resource_type === 'EQUIPMENT') {
    return [request.equipment?.asset_code, request.equipment?.name, request.equipment?.area, request.equipment?.location_detail]
      .filter(Boolean)
      .join(' / ') || '設備';
  }
  if (request.resource_type === 'FACILITY') {
    return [request.facility?.facility_code, request.facility?.name, request.facility?.area, request.facility?.location_detail]
      .filter(Boolean)
      .join(' / ') || '設施';
  }
  if (request.resource_type === 'PART') {
    return [request.part?.part_code, request.part?.name].filter(Boolean).join(' / ') || '料件';
  }
  return RESOURCE_TYPE_LABELS[request.resource_type || ''] || '-';
}

function formatFileSize(value?: number | null) {
  if (!value || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getRequestFriendlySnapshot(request: ServiceRequest) {
  if (request.store_reply_pending) {
    return {
      current: '門市有新回覆',
      gaNext: '先閱讀留言，再決定是否受理、補資料或更新處理方式。',
      storeNext: '門市已回覆，暫時等總務判斷。',
      route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '尚未定案',
      tone: 'amber' as const,
    };
  }

  if (request.main_status === 'PENDING_INTAKE') {
    return {
      current: '剛送進來，還沒受理',
      gaNext: '判斷是否受理，並選出後續要走維修、出庫、調撥或採購。',
      storeNext: '門市正在等待總務接手。',
      route: '待分流',
      tone: 'orange' as const,
    };
  }

  if (request.main_status === 'WAITING_GA_REVIEW') {
    return {
      current: '等待總務複核',
      gaNext: '確認補件或照片是否足夠，足夠就繼續處理，不足就退回補充。',
      storeNext: '門市已送出補充內容，暫時等總務確認。',
      route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '待確認',
      tone: 'blue' as const,
    };
  }

  if (request.main_status === 'WAITING_STORE_SUPPLEMENT') {
    return {
      current: '等門市補資料',
      gaNext: '先不用重複處理，等門市補照片、數量或說明後再判斷。',
      storeNext: '門市需要補資料。',
      route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '待補資料',
      tone: 'amber' as const,
    };
  }

  if (request.main_status === 'ACCEPTED' || request.main_status === 'IN_PROGRESS') {
    const route = partHandlingRouteLabel(request.intake_route);
    const gaNext = request.resource_type === 'PART'
      ? `依目前判斷處理${route}，必要時改走出庫、調撥或採購。`
      : '推進處理進度，完成後送門市確認。';
    return {
      current: request.main_status === 'ACCEPTED' ? '總務已接手' : '處理中',
      gaNext,
      storeNext: '門市目前先等待處理結果。',
      route,
      tone: 'blue' as const,
    };
  }

  if (request.main_status === 'WAITING_STORE_CONFIRMATION') {
    return {
      current: '已送門市確認',
      gaNext: '追蹤門市是否確認完成；若門市回報有問題，再重新處理。',
      storeNext: '門市需要確認是否收到或問題是否解決。',
      route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '待確認',
      tone: 'emerald' as const,
    };
  }

  if (request.main_status === 'COMPLETED') {
    return {
      current: '已完成',
      gaNext: '以查詢與留存紀錄為主。',
      storeNext: '門市不需要再處理。',
      route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '已結案',
      tone: 'slate' as const,
    };
  }

  return {
    current: STATUS_LABELS[request.main_status] || request.main_status,
    gaNext: '以查詢與追蹤紀錄為主。',
    storeNext: '門市目前不需要操作。',
    route: request.intake_route ? partHandlingRouteLabel(request.intake_route) : '未指定',
    tone: 'slate' as const,
  };
}

function getActionLabel(action: IntakeAction) {
  if (action === 'accept') return '受理';
  if (action === 'reject') return '駁回';
  if (action === 'request_supplement') return '補資料';
  if (action === 'assign') return '轉派';
  if (action === 'update_progress') return '處理中';
  if (action === 'request_store_confirmation') return '送門市確認';
  return '送出處理';
}

function getSubmitActionLabel(action: IntakeAction, assigneeRole: string) {
  if (action === 'accept') {
    return assigneeRole === 'WORKS' ? '受理給工務' : '受理給總務';
  }
  return getActionLabel(action);
}

function getActionHint(action: IntakeAction) {
  if (action === 'accept') return '先接手，再決定出庫、調撥、採購或派工。';
  if (action === 'update_progress') return '已開始處理，但還不用門市確認。';
  if (action === 'request_store_confirmation') return '已處理完，請門市確認結果。';
  if (action === 'request_supplement') return '資料不夠，請門市補照片或說明。';
  if (action === 'reject') return '不符合處理範圍或不需處理。';
  if (action === 'assign') return '保留給未來資訊平台串接。';
  return '';
}

async function parseResponse(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    const error = json?.error as ApiError | string | undefined;
    if (typeof error === 'object' && error) throw new Error(error.message || error.code || fallback);
    throw new Error(String(error || fallback));
  }
  return json;
}

export default function ServiceRequestIntakeClient() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [equipmentReviewTasks, setEquipmentReviewTasks] = useState<EquipmentReviewTask[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedKind, setSelectedKind] = useState<'request' | 'equipment_review'>('request');
  const [status, setStatus] = useState('PENDING_INTAKE');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingEquipmentReviewTasks, setLoadingEquipmentReviewTasks] = useState(true);
  const [focusFilter, setFocusFilter] = useState<WorkFocusFilter>('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<RequestAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<RequestAttachment | null>(null);
  const [equipmentReviewNote, setEquipmentReviewNote] = useState('');
  const [rejectPrimaryPhoto, setRejectPrimaryPhoto] = useState(false);
  const [rejectLabelPhoto, setRejectLabelPhoto] = useState(true);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>('PUBLIC');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentMutatingId, setCommentMutatingId] = useState('');
  const [markingStoreReplyReadId, setMarkingStoreReplyReadId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<IntakeAction>('accept');
  const [intakeRoute, setIntakeRoute] = useState('REPAIR_DISPATCH');
  const [assigneeRole, setAssigneeRole] = useState('GENERAL_AFFAIRS');
  const [assigneeName, setAssigneeName] = useState('');
  const [rejectionReason, setRejectionReason] = useState('OUT_OF_SCOPE');
  const [rejectionNote, setRejectionNote] = useState('');
  const [supplementType, setSupplementType] = useState('PHOTO_UNCLEAR');
  const [supplementNote, setSupplementNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [inventoryLocations, setInventoryLocations] = useState<InventoryLocationOption[]>([]);
  const [inventoryLocationParts, setInventoryLocationParts] = useState<InventoryLocationPartOption[]>([]);
  const [inventoryOptionsLoading, setInventoryOptionsLoading] = useState(false);
  const [inventoryPartCatalogAccess, setInventoryPartCatalogAccess] = useState(true);
  const [stockIssueSubmitting, setStockIssueSubmitting] = useState(false);
  const [stockIssueForm, setStockIssueForm] = useState<StockIssueForm>({
    locationId: '',
    partId: '',
    quantity: '',
    inputUnitType: 'BASE',
    reason: '',
    notes: '',
    idempotencyKey: newIdempotencyKey(),
  });
  const [purchaseVendors, setPurchaseVendors] = useState<PurchaseVendorOption[]>([]);
  const [purchaseReceivingLocations, setPurchaseReceivingLocations] = useState<InventoryLocationOption[]>([]);
  const [purchaseReviewLoading, setPurchaseReviewLoading] = useState(false);
  const [purchaseReviewSubmitting, setPurchaseReviewSubmitting] = useState(false);
  const [hasSavedPurchaseReview, setHasSavedPurchaseReview] = useState(false);
  const [purchaseReviewForm, setPurchaseReviewForm] = useState<PurchaseReviewForm>({
    decision: 'PURCHASE',
    vendorId: '',
    vendorName: '',
    approvedQuantity: '',
    approvedUnit: '',
    estimatedAmount: '',
    quotedAmount: '',
    negotiatedAmount: '',
    finalAmount: '',
    expectedDeliveryDate: '',
    deliveryMethod: '總務採購後配送',
    receivingLocationId: '',
    substituteDescription: '',
    decisionNote: '',
    publicNote: '',
    quoteLeadTimeDays: '',
    quoteNotes: '',
  });
  const [showAdvancedPurchaseFields, setShowAdvancedPurchaseFields] = useState(false);
  const [showPurchaseReceiptForm, setShowPurchaseReceiptForm] = useState(false);
  const [purchaseReceiptSubmitting, setPurchaseReceiptSubmitting] = useState(false);
  const [purchaseReceiptForm, setPurchaseReceiptForm] = useState<PurchaseReceiptForm>({
    locationId: '',
    partId: '',
    quantity: '',
    inputUnitType: 'BASE',
    reason: '',
    notes: '',
    requestStoreConfirmation: true,
    idempotencyKey: newIdempotencyKey(),
  });
  const equipmentReviewNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const equipmentReviewRejectScopeRef = useRef<HTMLDivElement | null>(null);

  const workItems = useMemo<IntakeWorkItem[]>(() => {
    const requestItems: IntakeWorkItem[] = requests.map((request) => ({
      kind: 'request',
      id: request.id,
      status: request.main_status,
      updated_at: request.updated_at || request.created_at,
      searchable: [request.request_no, request.title, request.description, storeLabel(request), resourceLabel(request)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
      request,
    }));
    const equipmentItems: IntakeWorkItem[] = equipmentReviewTasks.map((task) => ({
      kind: 'equipment_review',
      id: task.id,
      status: 'WAITING_GA_REVIEW',
      updated_at: task.updated_at,
      searchable: [task.title, task.equipment.name, task.equipment.asset_code, taskStoreLabel(task), taskLocationLabel(task)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
      task,
    }));

    return [...requestItems, ...equipmentItems]
      .filter((item) => {
        if (!focusFilter) return true;
        if (focusFilter === 'NEEDS_INTAKE') return ['PENDING_INTAKE', 'WAITING_GA_REVIEW'].includes(item.status);
        if (focusFilter === 'WAITING_CONFIRMATION') return item.status === 'WAITING_STORE_CONFIRMATION';
        if (item.kind !== 'request') return false;
        if (focusFilter === 'STORE_REPLY') return Boolean(item.request.store_reply_pending);
        if (focusFilter === 'PART_HANDLING') {
          return (
            item.request.resource_type === 'PART' &&
            ['ACCEPTED', 'IN_PROGRESS'].includes(item.request.main_status)
          );
        }
        return true;
      })
      .filter((item) => !status || item.status === status)
      .filter((item) => !search.trim() || item.searchable.includes(search.trim().toLowerCase()))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [equipmentReviewTasks, focusFilter, requests, search, status]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { '': requests.length + equipmentReviewTasks.length };
    requests.forEach((request) => {
      counts[request.main_status] = (counts[request.main_status] || 0) + 1;
    });
    counts.WAITING_GA_REVIEW = (counts.WAITING_GA_REVIEW || 0) + equipmentReviewTasks.length;
    return counts;
  }, [equipmentReviewTasks.length, requests]);

  const selectedRequest = useMemo(
    () => selectedKind === 'request' ? requests.find((request) => request.id === selectedId) || null : null,
    [requests, selectedId, selectedKind],
  );

  const selectedEquipmentReviewTask = useMemo(
    () => selectedKind === 'equipment_review' ? equipmentReviewTasks.find((task) => task.id === selectedId) || null : null,
    [equipmentReviewTasks, selectedId, selectedKind],
  );

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    requests.forEach((request) => counts.set(request.main_status, (counts.get(request.main_status) || 0) + 1));
    return {
      total: requests.length + equipmentReviewTasks.length,
      pending: counts.get('PENDING_INTAKE') || 0,
      review: (counts.get('WAITING_GA_REVIEW') || 0) + equipmentReviewTasks.length,
      accepted: counts.get('ACCEPTED') || 0,
      processing: counts.get('IN_PROGRESS') || 0,
      waitingConfirmation: counts.get('WAITING_STORE_CONFIRMATION') || 0,
      storeReplies: requests.filter((request) => request.store_reply_pending).length,
      partHandling: requests.filter((request) => (
        request.resource_type === 'PART' &&
        ['ACCEPTED', 'IN_PROGRESS'].includes(request.main_status)
      )).length,
    };
  }, [equipmentReviewTasks.length, requests]);

  const availableActions = useMemo(() => {
    if (!selectedRequest) return [];
    if (shouldHandOffToWorkOrderCenter(selectedRequest)) return [];
    return ACTIVE_ACTIONS_BY_STATUS[selectedRequest.main_status] || [];
  }, [selectedRequest?.id, selectedRequest?.main_status, selectedRequest?.maintenance_request_id]);

  async function loadRequests() {
    setError('');
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      const json = await parseResponse(await fetch(`/api/general-affairs/requests?${params.toString()}`), '需求單載入失敗');
      const next = (json.data || []) as ServiceRequest[];
      setRequests(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '需求單載入失敗');
    }
  }

  async function loadEquipmentReviewTasks() {
    setError('');
    try {
      const json = await parseResponse(
        await fetch('/api/general-affairs/equipment/onboarding-review-tasks'),
        '設備貼標複核任務載入失敗',
      );
      setEquipmentReviewTasks((json.data || []) as EquipmentReviewTask[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '設備貼標複核任務載入失敗');
    }
  }

  async function refreshWorkspace() {
    setLoading(true);
    setLoadingEquipmentReviewTasks(true);
    await Promise.all([
      loadRequests().finally(() => setLoading(false)),
      loadEquipmentReviewTasks().finally(() => setLoadingEquipmentReviewTasks(false)),
    ]);
  }

  async function loadInventoryOptions() {
    setInventoryOptionsLoading(true);
    try {
      const json = await parseResponse(
        await fetch('/api/general-affairs/inventory/options'),
        '庫存選項載入失敗',
      );
      setInventoryLocations((json.data?.locations || []) as InventoryLocationOption[]);
      setInventoryLocationParts((json.data?.locationParts || []) as InventoryLocationPartOption[]);
      setInventoryPartCatalogAccess(json.data?.partCatalogAccess !== false);
    } catch (loadError) {
      setInventoryLocations([]);
      setInventoryLocationParts([]);
      setError(loadError instanceof Error ? loadError.message : '庫存選項載入失敗');
    } finally {
      setInventoryOptionsLoading(false);
    }
  }

  async function loadPurchaseReviewOptions(requestId: string) {
    setPurchaseReviewLoading(true);
    setHasSavedPurchaseReview(false);
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${requestId}/purchase-review`),
        '採購評估資料載入失敗',
      );
      setPurchaseVendors((json.data?.vendors || []) as PurchaseVendorOption[]);
      setPurchaseReceivingLocations((json.data?.inventoryLocations || []) as InventoryLocationOption[]);

      const review = json.data?.review;
      if (review) {
        setHasSavedPurchaseReview(true);
        setPurchaseReviewForm({
          decision: review.decision || 'PURCHASE',
          vendorId: review.vendor_id || '',
          vendorName: review.vendor_name || '',
          approvedQuantity: review.approved_quantity ? String(review.approved_quantity) : '',
          approvedUnit: review.approved_unit || '',
          estimatedAmount: review.estimated_amount ? String(review.estimated_amount) : '',
          quotedAmount: review.quoted_amount ? String(review.quoted_amount) : '',
          negotiatedAmount: review.negotiated_amount ? String(review.negotiated_amount) : '',
          finalAmount: review.final_amount ? String(review.final_amount) : '',
          expectedDeliveryDate: review.expected_delivery_date || '',
          deliveryMethod: review.delivery_method || '總務採購後配送',
          receivingLocationId: review.receiving_location_id || '',
          substituteDescription: review.substitute_description || '',
          decisionNote: review.decision_note || '',
          publicNote: review.public_note || '',
          quoteLeadTimeDays: review.quotes?.[0]?.lead_time_days ? String(review.quotes[0].lead_time_days) : '',
          quoteNotes: review.quotes?.[0]?.notes || '',
        });
        setPurchaseReceiptForm((current) => ({
          ...current,
          locationId: review.receiving_location_id || current.locationId,
          quantity: review.approved_quantity ? String(review.approved_quantity) : current.quantity,
          reason: current.reason || '採購到貨入庫',
          notes: current.notes || review.delivery_method || '',
          idempotencyKey: newIdempotencyKey(),
        }));
      }
    } catch (loadError) {
      setPurchaseVendors([]);
      setPurchaseReceivingLocations([]);
      setError(loadError instanceof Error ? loadError.message : '採購評估資料載入失敗');
    } finally {
      setPurchaseReviewLoading(false);
    }
  }

  async function loadTimelineForRequest(requestId: string) {
    setLoadingTimeline(true);
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${requestId}?surface=GA_WORKBENCH`),
        '需求紀錄載入失敗',
      );
      setEvents((json.events || []) as RequestEvent[]);
      setComments((json.comments || []) as RequestComment[]);
    } catch (loadError) {
      setEvents([]);
      setComments([]);
      setError(loadError instanceof Error ? loadError.message : '需求紀錄載入失敗');
    } finally {
      setLoadingTimeline(false);
    }
  }

  async function submitComment() {
    if (!selectedRequest || commentSubmitting || !commentBody.trim()) return;
    setCommentSubmitting(true);
    setError('');
    setNotice('');
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: commentBody,
            visibility: commentVisibility,
            source_context: 'GA_WORKBENCH',
          }),
        }),
        '留言新增失敗',
      );
      const commentId = json.data?.id;
      if (commentId && commentFiles.length > 0) {
        const formData = new FormData();
        formData.set('resource_type', 'SERVICE_REQUEST_COMMENT');
        formData.set('resource_id', commentId);
        formData.set('purpose', commentVisibility === 'INTERNAL' ? 'INTERNAL_COMMENT' : 'PUBLIC_COMMENT');
        commentFiles.forEach((file) => formData.append('files', file));
        await parseResponse(
          await fetch('/api/general-affairs/attachments', {
            method: 'POST',
            body: formData,
          }),
          '留言附件上傳失敗',
        );
      }
      setNotice(commentVisibility === 'INTERNAL' ? '內部備註已新增' : '公開留言已新增');
      setCommentBody('');
      setCommentFiles([]);
      await loadTimelineForRequest(selectedRequest.id);
      await refreshWorkspace();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '留言新增失敗');
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function markStoreReplyRead(commentId: string) {
    if (!selectedRequest || markingStoreReplyReadId) return;
    const currentIndex = comments.findIndex((comment) => comment.id === commentId);
    const nextUnreadComment = comments.find((comment, index) => (
      index > currentIndex
      && comment.id !== commentId
      && comment.source_context === 'STORE_TRACKING'
      && !comment.read_at
    )) || comments.find((comment) => (
      comment.id !== commentId
      && comment.source_context === 'STORE_TRACKING'
      && !comment.read_at
    ));
    setMarkingStoreReplyReadId(commentId);
    setError('');
    setNotice('');
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_id: commentId }),
        }),
        '留言標記已讀失敗',
      );
      const readAt = json.data?.created_at || new Date().toISOString();
      const readByName = json.data?.created_by_name || '總務人員';
      if (!json.already_read) {
        setComments((current) => current.map((comment) => (
          comment.id === commentId
            ? { ...comment, read_at: readAt, read_by_name: readByName }
            : comment
        )));
        setRequests((current) => current.map((item) => {
          if (item.id !== selectedRequest.id) return item;
          const unreadCount = Math.max(0, (item.unread_store_comment_count || 1) - 1);
          return {
            ...item,
            unread_store_comment_count: unreadCount,
            store_reply_pending: unreadCount > 0,
            last_store_read_at: readAt,
            last_store_read_by_name: readByName,
          };
        }));
      }
      setNotice('已記錄閱讀人員與時間');
      await Promise.all([loadRequests(), loadTimelineForRequest(selectedRequest.id)]);
      window.requestAnimationFrame(() => {
        const target = nextUnreadComment
          ? document.getElementById(`request-comment-${nextUnreadComment.id}`)
          : document.getElementById(`request-comments-${selectedRequest.id}`);
        target?.scrollIntoView({ behavior: 'smooth', block: nextUnreadComment ? 'center' : 'start' });
      });
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : '留言標記已讀失敗');
    } finally {
      setMarkingStoreReplyReadId('');
    }
  }

  function startEditComment(comment: RequestComment) {
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
    setError('');
    setNotice('');
  }

  async function updateComment(commentId: string) {
    if (!selectedRequest || commentMutatingId || !editingCommentBody.trim()) return;
    setCommentMutatingId(commentId);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: editingCommentBody }),
        }),
        '留言編輯失敗',
      );
      setEditingCommentId('');
      setEditingCommentBody('');
      setNotice('留言已更新');
      await loadTimelineForRequest(selectedRequest.id);
      await refreshWorkspace();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '留言編輯失敗');
    } finally {
      setCommentMutatingId('');
    }
  }

  async function deleteComment(commentId: string) {
    if (!selectedRequest || commentMutatingId) return;
    if (!window.confirm('確定要刪除此留言？')) return;
    setCommentMutatingId(commentId);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments/${commentId}`, {
          method: 'DELETE',
        }),
        '留言刪除失敗',
      );
      if (editingCommentId === commentId) {
        setEditingCommentId('');
        setEditingCommentBody('');
      }
      setNotice('留言已刪除');
      await loadTimelineForRequest(selectedRequest.id);
      await refreshWorkspace();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '留言刪除失敗');
    } finally {
      setCommentMutatingId('');
    }
  }

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (selectedId && workItems.some((item) => item.kind === selectedKind && item.id === selectedId)) return;
    const first = workItems[0];
    setSelectedKind(first?.kind || 'request');
    setSelectedId(first?.id || '');
  }, [selectedId, selectedKind, workItems]);

  useEffect(() => {
    if (!selectedEquipmentReviewTask) return;
    setEquipmentReviewNote('');
    setRejectPrimaryPhoto(false);
    setRejectLabelPhoto(true);
  }, [selectedEquipmentReviewTask?.id]);

  useEffect(() => {
    if (!selectedRequest?.id) {
      setAttachments([]);
      setPreviewAttachment(null);
      setEvents([]);
      setComments([]);
      setEditingCommentId('');
      setEditingCommentBody('');
      return;
    }

    let mounted = true;

    async function loadAttachments() {
      setLoadingAttachments(true);
      try {
        const params = new URLSearchParams({
          resourceType: 'SERVICE_REQUEST',
          resourceId: selectedRequest!.id,
        });
        const json = await parseResponse(
          await fetch(`/api/general-affairs/attachments?${params.toString()}`),
          '附件載入失敗',
        );
        if (mounted) setAttachments((json.data || []) as RequestAttachment[]);
      } catch (loadError) {
        if (mounted) {
          setAttachments([]);
          setError(loadError instanceof Error ? loadError.message : '附件載入失敗');
        }
      } finally {
        if (mounted) setLoadingAttachments(false);
      }
    }

    void loadAttachments();
    setCommentBody('');
    setCommentFiles([]);
    setEditingCommentId('');
    setEditingCommentBody('');
    void loadTimelineForRequest(selectedRequest.id);
    return () => {
      mounted = false;
    };
  }, [selectedRequest?.id]);

  useEffect(() => {
    if (!previewAttachment) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewAttachment(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewAttachment]);

  useEffect(() => {
    if (!selectedRequest) return;
    if (shouldHandOffToWorkOrderCenter(selectedRequest)) {
      setAction('assign');
      setInternalNote('');
      setCommentBody('');
      setCommentFiles([]);
      setCommentVisibility('PUBLIC');
      return;
    }
    const nextActions = ACTIVE_ACTIONS_BY_STATUS[selectedRequest.main_status] || [];
    setAction((current) => {
      if (nextActions.length) return nextActions.includes(current) ? current : nextActions[0];
      return 'assign';
    });
    setInternalNote('');
    setCommentBody('');
    setCommentFiles([]);
    setCommentVisibility('PUBLIC');
    setShowAdvancedPurchaseFields(false);
    setShowPurchaseReceiptForm(false);
    setStockIssueForm((current) => ({
      ...current,
      partId: selectedRequest.part_id || current.partId,
      quantity: selectedRequest.desired_quantity ? String(selectedRequest.desired_quantity) : current.quantity,
      reason: current.reason || selectedRequest.title || '門市需求出庫',
      notes: '',
      idempotencyKey: newIdempotencyKey(),
    }));
    setPurchaseReviewForm((current) => ({
      ...current,
      approvedQuantity: selectedRequest.desired_quantity ? String(selectedRequest.desired_quantity) : current.approvedQuantity,
      approvedUnit: selectedRequest.desired_unit || current.approvedUnit,
      decisionNote: '',
      publicNote: '',
    }));
  }, [selectedRequest]);

  useEffect(() => {
    if (!selectedRequest || selectedRequest.intake_route !== 'STOCK_ISSUE') return;
    if (inventoryLocations.length || inventoryOptionsLoading) return;
    void loadInventoryOptions();
  }, [selectedRequest?.id, selectedRequest?.intake_route, inventoryLocations.length, inventoryOptionsLoading]);

  useEffect(() => {
    if (
      !selectedRequest ||
      selectedRequest.resource_type !== 'PART' ||
      !['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status)
    ) {
      return;
    }
    if (inventoryLocations.length || inventoryOptionsLoading) return;
    void loadInventoryOptions();
  }, [
    selectedRequest?.id,
    selectedRequest?.resource_type,
    selectedRequest?.main_status,
    inventoryLocations.length,
    inventoryOptionsLoading,
  ]);

  useEffect(() => {
    if (!selectedRequest || selectedRequest.intake_route !== 'PURCHASE_REVIEW') return;
    void loadPurchaseReviewOptions(selectedRequest.id);
  }, [selectedRequest?.id, selectedRequest?.intake_route]);

  useEffect(() => {
    if (!selectedRequest || selectedRequest.intake_route !== 'PURCHASE_REVIEW') return;
    if (purchaseReviewForm.decision !== 'PURCHASE') return;
    if (inventoryLocations.length || inventoryOptionsLoading) return;
    void loadInventoryOptions();
  }, [selectedRequest?.id, selectedRequest?.intake_route, purchaseReviewForm.decision, inventoryLocations.length, inventoryOptionsLoading]);

  function buildPayload() {
    if (action === 'accept') {
      return {
        action,
        intake_route: intakeRoute,
        assignee_role: assigneeRole,
        assignee_name: assigneeName,
        internal_note: internalNote,
      };
    }
    if (action === 'reject') {
      return {
        action,
        rejection_reason: rejectionReason,
        rejection_note: rejectionNote,
        internal_note: internalNote,
      };
    }
    if (action === 'request_supplement') {
      return {
        action,
        supplement_type: supplementType,
        supplement_note: supplementNote,
        internal_note: internalNote,
      };
    }
    if (action === 'update_progress' || action === 'request_store_confirmation') {
      return {
        action,
        internal_note: internalNote,
      };
    }
    return {
      action,
      assignee_role: assigneeRole,
      assignee_name: assigneeName,
      internal_note: internalNote,
    };
  }

  async function submitAction() {
    if (!selectedRequest || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(await fetch(`/api/general-affairs/requests/${selectedRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      }), '需求單處理失敗');

      setNotice('需求單處理完成');
      setRejectionNote('');
      setSupplementNote('');
      setInternalNote('');
      await refreshWorkspace();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '需求單處理失敗');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEquipmentOnboardingReview(task: EquipmentReviewTask, reviewAction: 'approve' | 'reject') {
    const note = equipmentReviewNote.trim();
    if (reviewAction === 'reject' && !note) {
      setError('退回重拍時必須填寫原因');
      window.alert('退回重拍時必須填寫原因');
      equipmentReviewNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => equipmentReviewNoteRef.current?.focus(), 150);
      return;
    }
    if (reviewAction === 'reject' && !rejectPrimaryPhoto && !rejectLabelPhoto) {
      setError('退回重拍時必須選擇要重補的照片');
      window.alert('退回重拍時必須選擇要重補的照片');
      equipmentReviewRejectScopeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setReviewSubmitting(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/equipment/${task.equipment.id}/onboarding-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: reviewAction,
            note,
            reject_required_primary_photo: reviewAction === 'reject' ? rejectPrimaryPhoto : false,
            reject_required_label_photo: reviewAction === 'reject' ? rejectLabelPhoto : false,
          }),
        }),
        '設備貼標複核失敗',
      );
      setEquipmentReviewNote('');
      setNotice(reviewAction === 'approve' ? '已完成設備建檔複核' : '已退回門市重拍指定照片');
      await refreshWorkspace();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '設備貼標複核失敗');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function submitStockIssue() {
    if (!selectedRequest || stockIssueSubmitting) return;
    setStockIssueSubmitting(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/stock-issue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: stockIssueForm.locationId,
            partId: stockIssueForm.partId,
            quantity: stockIssueForm.quantity,
            inputUnitType: stockIssueForm.inputUnitType,
            reason: stockIssueForm.reason,
            notes: stockIssueForm.notes,
            idempotencyKey: stockIssueForm.idempotencyKey,
          }),
        }),
        '需求單庫存出庫失敗',
      );
      setNotice('已建立需求單庫存出庫交易');
      setStockIssueForm((current) => ({
        ...current,
        notes: '',
        idempotencyKey: newIdempotencyKey(),
      }));
      await refreshWorkspace();
      await loadInventoryOptions();
      await loadTimelineForRequest(selectedRequest.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '需求單庫存出庫失敗');
    } finally {
      setStockIssueSubmitting(false);
    }
  }

  async function submitPurchaseReview(openTransferAfterSave = false) {
    if (!selectedRequest || purchaseReviewSubmitting) return;
    setPurchaseReviewSubmitting(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/purchase-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(purchaseReviewForm),
        }),
        '採購評估送出失敗',
      );
      setHasSavedPurchaseReview(true);
      setNotice('採購評估已儲存');
      await refreshWorkspace();
      await loadTimelineForRequest(selectedRequest.id);
      await loadPurchaseReviewOptions(selectedRequest.id);
      if (openTransferAfterSave) {
        window.location.assign(transferPrefillUrl);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '採購評估送出失敗');
    } finally {
      setPurchaseReviewSubmitting(false);
    }
  }

  async function submitPurchaseReceipt() {
    if (!selectedRequest || purchaseReceiptSubmitting) return;
    setPurchaseReceiptSubmitting(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/purchase-receipt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: purchaseReceiptForm.locationId,
            partId: purchaseReceiptForm.partId,
            quantity: purchaseReceiptForm.quantity,
            inputUnitType: purchaseReceiptForm.inputUnitType,
            reason: purchaseReceiptForm.reason,
            notes: purchaseReceiptForm.notes,
            requestStoreConfirmation: purchaseReceiptForm.requestStoreConfirmation,
            idempotencyKey: purchaseReceiptForm.idempotencyKey,
          }),
        }),
        '採購到貨入庫失敗',
      );
      setNotice('已建立採購到貨入庫交易');
      setPurchaseReceiptForm((current) => ({
        ...current,
        notes: '',
        idempotencyKey: newIdempotencyKey(),
      }));
      await refreshWorkspace();
      await loadInventoryOptions();
      await loadTimelineForRequest(selectedRequest.id);
      await loadPurchaseReviewOptions(selectedRequest.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '採購到貨入庫失敗');
    } finally {
      setPurchaseReceiptSubmitting(false);
    }
  }

  const workOrderHandoff = selectedRequest ? shouldHandOffToWorkOrderCenter(selectedRequest) : false;
  const stockIssueLocationParts = useMemo(
    () => inventoryLocationParts.filter((item) => item.location_id === stockIssueForm.locationId),
    [inventoryLocationParts, stockIssueForm.locationId],
  );
  const selectedStockIssueLocationPart = useMemo(
    () => inventoryLocationParts.find((item) => (
      item.location_id === stockIssueForm.locationId && item.part_id === stockIssueForm.partId
    )) || null,
    [inventoryLocationParts, stockIssueForm.locationId, stockIssueForm.partId],
  );
  const selectedStockIssuePart = selectedStockIssueLocationPart?.part || null;
  const selectedStockIssueBalance = Number(selectedStockIssueLocationPart?.currentBalance?.quantity_base || 0);
  useEffect(() => {
    if (
      stockIssueForm.inputUnitType === 'PURCHASE' &&
      selectedStockIssuePart &&
      (!selectedStockIssuePart.purchase_unit || !selectedStockIssuePart.purchase_to_base_rate)
    ) {
      setStockIssueForm((current) => ({ ...current, inputUnitType: 'BASE' }));
    }
  }, [selectedStockIssuePart?.id, selectedStockIssuePart?.purchase_unit, selectedStockIssuePart?.purchase_to_base_rate, stockIssueForm.inputUnitType]);
  const showStockIssuePanel = Boolean(
    selectedRequest &&
    selectedRequest.intake_route === 'STOCK_ISSUE' &&
    ['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status) &&
    !workOrderHandoff,
  );
  const canSubmitStockIssue = Boolean(
    showStockIssuePanel &&
    inventoryPartCatalogAccess &&
    stockIssueForm.locationId &&
    stockIssueForm.partId &&
    stockIssueForm.quantity &&
    Number(stockIssueForm.quantity) > 0 &&
    stockIssueForm.reason.trim(),
  );
  const partRequestWorkspace = useMemo(() => {
    if (
      !selectedRequest ||
      selectedRequest.resource_type !== 'PART' ||
      !['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status) ||
      workOrderHandoff
    ) {
      return null;
    }

    const desiredQuantity = Number(selectedRequest.desired_quantity || 0);
    const rows = selectedRequest.part_id
      ? inventoryLocationParts
        .filter((item) => item.part_id === selectedRequest.part_id)
        .map((item) => ({
          item,
          location: inventoryLocations.find((location) => location.id === item.location_id) || null,
          balance: locationPartBalance(item),
        }))
        .sort((a, b) => b.balance - a.balance)
      : [];
    const availableRows = rows.filter((row) => row.balance > 0);
    const totalAvailable = availableRows.reduce((sum, row) => sum + row.balance, 0);
    const primaryRow = availableRows[0] || null;
    const part = rows[0]?.item.part || selectedStockIssuePart || null;
    const unit = partRequestUnit(selectedRequest, part);
    const hasEnoughStock = desiredQuantity > 0 && totalAvailable >= desiredQuantity;
    const hasPartialStock = desiredQuantity > 0 && totalAvailable > 0 && totalAvailable < desiredQuantity;

    let recommendation = '先確認料件主檔與需求數量，再決定出庫、調撥或採購。';
    if (!selectedRequest.part_id) {
      recommendation = '這張需求尚未綁定料件主檔，建議先補料件或走採購評估記錄替代處理。';
    } else if (inventoryOptionsLoading) {
      recommendation = '正在更新庫存資料，稍後會依目前可用量提供建議。';
    } else if (!rows.length) {
      recommendation = '此料件尚未在任何庫存位置啟用，建議先建庫存位置料件設定或進入採購評估。';
    } else if (hasEnoughStock) {
      recommendation = `可優先從 ${inventoryLocationLabel(primaryRow?.location)} 出庫 ${numberText(Math.min(primaryRow?.balance || 0, desiredQuantity))} ${unit}。`;
    } else if (hasPartialStock) {
      recommendation = `目前可先處理 ${numberText(totalAvailable)} ${unit}，不足 ${numberText(desiredQuantity - totalAvailable)} ${unit} 建議評估調撥或採購。`;
    } else {
      recommendation = '目前查無可用庫存，建議直接進入採購評估，或確認其他門市是否可調撥。';
    }

    return {
      desiredQuantity,
      unit,
      rows,
      availableRows,
      totalAvailable,
      primaryRow,
      part,
      recommendation,
      hasEnoughStock,
      hasPartialStock,
    };
  }, [
    inventoryLocationParts,
    inventoryLocations,
    inventoryOptionsLoading,
    selectedRequest,
    selectedStockIssuePart,
    workOrderHandoff,
  ]);
  const showPurchaseReviewPanel = Boolean(
    selectedRequest &&
    selectedRequest.intake_route === 'PURCHASE_REVIEW' &&
    ['ACCEPTED', 'IN_PROGRESS'].includes(selectedRequest.main_status) &&
    !workOrderHandoff,
  );
  const purchaseDecisionNeedsVendor = purchaseReviewForm.decision === 'PURCHASE';
  const canSubmitPurchaseReview = Boolean(
    showPurchaseReviewPanel &&
    purchaseReviewForm.decision &&
    purchaseReviewForm.decisionNote.trim() &&
    (purchaseReviewForm.decision !== 'PURCHASE' || (purchaseReviewForm.approvedQuantity && Number(purchaseReviewForm.approvedQuantity) > 0)) &&
    (purchaseReviewForm.decision !== 'SUBSTITUTE' || purchaseReviewForm.substituteDescription.trim()) &&
    (purchaseReviewForm.decision !== 'REJECT' || purchaseReviewForm.publicNote.trim()),
  );
  const purchaseCostSummary = useMemo(() => {
    const estimated = Number(purchaseReviewForm.estimatedAmount || 0);
    const quoted = Number(purchaseReviewForm.quotedAmount || 0);
    const negotiated = Number(purchaseReviewForm.negotiatedAmount || 0);
    const final = Number(purchaseReviewForm.finalAmount || 0);
    const recognized = final || negotiated || quoted || estimated || 0;
    const vendor = purchaseReviewForm.vendorName.trim()
      || purchaseVendors.find((vendorItem) => vendorItem.id === purchaseReviewForm.vendorId)?.name
      || '尚未指定';
    return {
      estimated,
      quoted,
      negotiated,
      final,
      recognized,
      vendor,
      hasAmount: [estimated, quoted, negotiated, final].some((amount) => amount > 0),
    };
  }, [
    purchaseReviewForm.estimatedAmount,
    purchaseReviewForm.finalAmount,
    purchaseReviewForm.negotiatedAmount,
    purchaseReviewForm.quotedAmount,
    purchaseReviewForm.vendorId,
    purchaseReviewForm.vendorName,
    purchaseVendors,
  ]);
  const purchaseReceiptLocationParts = useMemo(
    () => inventoryLocationParts.filter((item) => item.location_id === purchaseReceiptForm.locationId),
    [inventoryLocationParts, purchaseReceiptForm.locationId],
  );
  const selectedPurchaseReceiptLocationPart = useMemo(
    () => inventoryLocationParts.find((item) => (
      item.location_id === purchaseReceiptForm.locationId && item.part_id === purchaseReceiptForm.partId
    )) || null,
    [inventoryLocationParts, purchaseReceiptForm.locationId, purchaseReceiptForm.partId],
  );
  const selectedPurchaseReceiptPart = selectedPurchaseReceiptLocationPart?.part || null;
  useEffect(() => {
    if (
      purchaseReceiptForm.inputUnitType === 'PURCHASE' &&
      selectedPurchaseReceiptPart &&
      (!selectedPurchaseReceiptPart.purchase_unit || !selectedPurchaseReceiptPart.purchase_to_base_rate)
    ) {
      setPurchaseReceiptForm((current) => ({ ...current, inputUnitType: 'BASE' }));
    }
  }, [selectedPurchaseReceiptPart?.id, selectedPurchaseReceiptPart?.purchase_unit, selectedPurchaseReceiptPart?.purchase_to_base_rate, purchaseReceiptForm.inputUnitType]);
  const showPurchaseReceiptPanel = Boolean(
    showPurchaseReviewPanel &&
    purchaseReviewForm.decision === 'PURCHASE' &&
    hasSavedPurchaseReview,
  );
  const renderPurchaseReviewPanel = Boolean(
    showPurchaseReviewPanel &&
    !partRequestWorkspace,
  );
  const renderStockIssuePanel = Boolean(
    showStockIssuePanel &&
    !partRequestWorkspace,
  );
  const canSubmitPurchaseReceipt = Boolean(
    showPurchaseReceiptPanel &&
    inventoryPartCatalogAccess &&
    purchaseReceiptForm.locationId &&
    purchaseReceiptForm.partId &&
    purchaseReceiptForm.quantity &&
    Number(purchaseReceiptForm.quantity) > 0 &&
    purchaseReceiptForm.reason.trim(),
  );
  const actionNeedsNote = action === 'reject' || action === 'request_supplement';
  const canSubmit = Boolean(selectedRequest) && (
    action === 'accept'
      ? Boolean(intakeRoute && assigneeRole)
      : action === 'reject'
        ? Boolean(rejectionReason && rejectionNote.trim())
      : action === 'request_supplement'
        ? Boolean(supplementType && supplementNote.trim())
        : Boolean(assigneeRole)
  );
  const submitBlockReason = (() => {
    if (!selectedRequest) return '';
    if (action === 'accept' && !intakeRoute) return '請選擇後續處理流程';
    if (action === 'accept' && !assigneeRole) return '請選擇由總務或工務處理';
    if (action === 'reject' && !rejectionReason) return '請選擇不處理的原因';
    if (action === 'reject' && !rejectionNote.trim()) return '請填寫給門市看的說明';
    if (action === 'request_supplement' && !supplementType) return '請選擇缺少的資料';
    if (action === 'request_supplement' && !supplementNote.trim()) return '請填寫要門市補充的內容';
    return '';
  })();
  const requestSnapshot = selectedRequest ? getRequestFriendlySnapshot(selectedRequest) : null;
  const selectedSceneDescription = selectedRequest ? requestListSceneDescription(selectedRequest) : '';
  const hasRequestExtraDetails = Boolean(selectedRequest && (
    selectedRequest.desired_quantity
    || selectedRequest.desired_spec
    || selectedRequest.impact_description
  ));
  const sceneImageCount = attachments.filter(isImageAttachment).length;
  const sceneImageAttachments = attachments.filter(isImageAttachment).slice(0, 3);
  const actionOptions: Array<{ value: IntakeAction; label: string; icon: LucideIcon }> = [
    { value: 'accept', label: '受理', icon: ClipboardCheck },
    { value: 'update_progress', label: '處理中', icon: Send },
    { value: 'request_store_confirmation', label: '送門市確認', icon: CheckCircle2 },
    { value: 'request_supplement', label: '補資料', icon: RotateCcw },
    { value: 'reject', label: '駁回', icon: XCircle },
    { value: 'assign', label: '轉派', icon: UserCog },
  ];
  const primaryActionOptions = actionOptions.filter((item) => (
    item.value === 'accept' ||
    item.value === 'update_progress' ||
    item.value === 'request_store_confirmation'
  ) && availableActions.includes(item.value));
  const secondaryActionOptions = actionOptions.filter((item) => (
    item.value === 'request_supplement' ||
    item.value === 'reject' ||
    item.value === 'assign'
  ) && availableActions.includes(item.value));
  const displayActions: IntakeAction[] = availableActions.filter((item) => item !== 'assign');
  const visibleActionOptions = actionOptions.filter((item) => displayActions.includes(item.value));
  const transferPrefillUrl = selectedRequest ? buildTransferPrefillUrl(selectedRequest, partRequestWorkspace) : '';
  return (
    <div className="mx-auto max-w-[1536px]">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '總務需求工作台' },
        ]}
        title="總務需求工作台"
        primaryAction={(
          <button
            type="button"
            onClick={() => void refreshWorkspace()}
            title="重新整理"
            aria-label="重新整理工作台"
            className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading || loadingEquipmentReviewTasks ? 'animate-spin' : ''}`} />
          </button>
        )}
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="fixed right-4 top-20 z-50 flex max-w-sm items-center gap-2 rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="工作焦點">
          {[
            {
              key: '' as WorkFocusFilter,
              title: '全部',
              value: summary.total,
              icon: ClipboardList,
              tone: 'slate',
            },
            {
              key: 'NEEDS_INTAKE' as WorkFocusFilter,
              title: '先接新單',
              value: summary.pending + summary.review,
              icon: ClipboardCheck,
              tone: 'orange',
            },
            {
              key: 'STORE_REPLY' as WorkFocusFilter,
              title: '門市有回覆',
              value: summary.storeReplies,
              icon: MessageSquare,
              tone: 'amber',
            },
            {
              key: 'PART_HANDLING' as WorkFocusFilter,
              title: '料件處理',
              value: summary.partHandling,
              icon: PackageCheck,
              tone: 'blue',
            },
            {
              key: 'WAITING_CONFIRMATION' as WorkFocusFilter,
              title: '等門市確認',
              value: summary.waitingConfirmation,
              icon: CheckCircle2,
              tone: 'emerald',
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = focusFilter === item.key && (item.key !== '' || !status);
            const toneClass = active
              ? 'border-slate-900 text-slate-950'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800';
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setFocusFilter(item.key);
                  setStatus('');
                }}
                className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-left transition ${toneClass}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap text-sm font-bold">{item.title}</span>
                <span className={`min-w-6 rounded px-1.5 py-0.5 text-center text-xs font-black ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {item.value}
                </span>
              </button>
            );
          })}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(720px,860px)]">
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-3 py-3">
            <div className="flex min-w-0 gap-2">
              <select
                value={status}
                onChange={(event) => {
                  setFocusFilter('');
                  setStatus(event.target.value);
                }}
                aria-label="案件狀態"
                className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value || 'all'} value={filter.value}>
                    {filter.label}（{statusCounts[filter.value] || 0}）
                  </option>
                ))}
              </select>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 sm:w-56"
                placeholder="搜尋單號、門市、需求"
              />
            </div>
          </div>
          {loading || loadingEquipmentReviewTasks ? (
            <div className="flex h-44 items-center justify-center gap-2 text-sm text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              載入中
            </div>
          ) : workItems.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-sm text-slate-500">目前沒有符合條件的工作項目</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workItems.map((item) => {
                if (item.kind === 'equipment_review') {
                  const task = item.task;
                  const selected = selectedKind === 'equipment_review' && selectedId === task.id;
                  return (
                    <button
                      key={`equipment-review-${task.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedKind('equipment_review');
                        setSelectedId(task.id);
                      }}
                      className={`w-full px-4 py-3 text-left hover:bg-orange-50 ${selected ? 'bg-orange-50' : 'bg-white'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-black text-slate-950">{taskStoreLabel(task)}</div>
                        <div className="shrink-0 text-xs text-slate-500">{formatDateTime(task.updated_at)}</div>
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-slate-900">{task.equipment.name || '未命名設備'}</div>
                      <div className="mt-1 truncate text-xs leading-5 text-slate-500">{taskLocationLabel(task)}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">待總務複核</span>
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">設備貼標</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold text-slate-400">
                          {task.equipment.asset_code || '尚未編號'}
                        </span>
                      </div>
                    </button>
                  );
                }

                const request = item.request;
                const sceneDescription = requestListSceneDescription(request);
                const listTitle = requestListTitle(request);
                const selected = selectedKind === 'request' && selectedRequest?.id === request.id;
                return (
                  <button
                    key={`request-${request.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedKind('request');
                      setSelectedId(request.id);
                    }}
                    className={`w-full px-4 py-3 text-left hover:bg-orange-50 ${selected ? 'bg-orange-50' : 'bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-black text-slate-950">{storeLabel(request)}</div>
                      <div className={`shrink-0 text-xs ${request.store_reply_pending ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                        {formatDateTime(request.store_reply_pending && request.last_store_comment_at
                          ? request.last_store_comment_at
                          : request.created_at)}
                      </div>
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900">{listTitle}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{sceneDescription}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        {requestNextStepLabel(request)}
                      </span>
                      {request.store_reply_pending && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          <MessageSquare className="h-3 w-3" />
                          未讀留言 {request.unread_store_comment_count || 1} 則
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[11px] font-semibold text-slate-400">{request.request_no}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="rounded-md border border-slate-200 bg-white shadow-sm">
          {!selectedRequest && !selectedEquipmentReviewTask ? (
            <div className="flex h-72 items-center justify-center p-6 text-center">
              <div>
                <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-bold text-slate-900">先從左邊選一張單</div>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  選取後，右側會只顯示這張單現在需要做的下一步。
                </p>
              </div>
            </div>
          ) : selectedEquipmentReviewTask ? (
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-semibold text-slate-500">{selectedEquipmentReviewTask.equipment.asset_code || '尚未編號'}</div>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">{selectedEquipmentReviewTask.equipment.name || '未命名設備'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{taskStoreLabel(selectedEquipmentReviewTask)} / {taskLocationLabel(selectedEquipmentReviewTask)}</p>
                </div>
                <span className="shrink-0 rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">待總務複核</span>
              </div>

              <div className="mt-4 grid gap-3 text-sm 2xl:grid-cols-[minmax(0,1fr)_360px] 2xl:items-start">
                <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-orange-800">
                  <div className="text-sm font-bold text-orange-900">設備貼標照片待複核</div>
                  <p className="mt-1 text-xs leading-5">
                    請確認設備照片與 QR 標籤貼附位置是否清楚、是否對應同一台設備。確認正確後完成建檔；若不清楚或貼錯，請退回門市重拍。
                  </p>
                </div>

                <div className="grid gap-3">
                  {[
                    { label: '設備照片', image: selectedEquipmentReviewTask.equipment.primary_image },
                    { label: '貼標位置照片', image: selectedEquipmentReviewTask.equipment.label_position_image },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="text-xs font-semibold text-slate-500">{item.label}</div>
                      <div className="mt-2 flex min-h-44 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        {item.image?.signed_url ? (
                          <button
                            type="button"
                            onClick={() => setPreviewAttachment(item.image!)}
                            className="flex w-full items-center justify-center"
                          >
                            <img src={item.image.signed_url} alt={item.image.file_name || item.label} className="max-h-72 w-full object-contain" />
                          </button>
                        ) : (
                          <div className="text-xs text-slate-500">尚未取得{item.label}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedEquipmentReviewTask.equipment.onboarding_review_note && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-700">
                    <div className="text-xs font-semibold text-slate-500">最近複核說明</div>
                    <div className="mt-1 whitespace-pre-wrap">{selectedEquipmentReviewTask.equipment.onboarding_review_note}</div>
                  </div>
                )}

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-500">複核說明 / 退回原因</div>
                  <textarea
                    ref={equipmentReviewNoteRef}
                    value={equipmentReviewNote}
                    onChange={(event) => setEquipmentReviewNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="退回重拍時必填；完成建檔時可選填。"
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                  <div className="mt-3 text-xs font-semibold text-slate-500">退回重補項目</div>
                  <div ref={equipmentReviewRejectScopeRef} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={rejectPrimaryPhoto}
                        onChange={(event) => setRejectPrimaryPhoto(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                      設備照片
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={rejectLabelPhoto}
                        onChange={(event) => setRejectLabelPhoto(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                      />
                      貼標位置照片
                    </label>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void submitEquipmentOnboardingReview(selectedEquipmentReviewTask, 'approve')}
                    disabled={reviewSubmitting}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {reviewSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    照片正確，完成建檔
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitEquipmentOnboardingReview(selectedEquipmentReviewTask, 'reject')}
                    disabled={reviewSubmitting}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {reviewSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    退回重拍
                  </button>
                </div>
              </div>
            </div>
          ) : selectedRequest ? (
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{requestListTitle(selectedRequest)}</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {storeLabel(selectedRequest)} · {resourceLabel(selectedRequest)} · <span className="font-mono">{selectedRequest.request_no}</span>
                  </p>
                </div>
                <span className="shrink-0 rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                  {STATUS_LABELS[selectedRequest.main_status] || selectedRequest.main_status}
                </span>
              </div>

              <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="line-clamp-3 text-sm font-semibold leading-6 text-slate-900">
                    {selectedSceneDescription}
                  </div>
                </div>
                {(loadingAttachments || sceneImageAttachments.length > 0) && (
                <div className="flex items-center gap-2 md:justify-end">
                  {loadingAttachments ? (
                    <div className="inline-flex h-14 min-w-24 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      照片
                    </div>
                  ) : sceneImageAttachments.length > 0 ? (
                    <>
                      {sceneImageAttachments.map((attachment) => (
                        <button
                          key={`scene-${attachment.id}`}
                          type="button"
                          onClick={() => setPreviewAttachment(attachment)}
                          className="h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
                        >
                          <img
                            src={attachment.signed_url || ''}
                            alt={attachment.file_name || '現場照片'}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                      {sceneImageCount > sceneImageAttachments.length && (
                        <span className="inline-flex h-14 min-w-14 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600">
                          +{sceneImageCount - sceneImageAttachments.length}
                        </span>
                      )}
                    </>
                  ) : null}
                </div>
                )}
              </div>

              {requestSnapshot && displayActions.length === 0 && (
                <div className={[
                  'mt-3 rounded-md border px-3 py-2',
                  requestSnapshot.tone === 'amber'
                    ? 'border-amber-200 bg-amber-50'
                    : requestSnapshot.tone === 'orange'
                      ? 'border-orange-200 bg-orange-50'
                      : requestSnapshot.tone === 'blue'
                        ? 'border-blue-200 bg-blue-50'
                        : requestSnapshot.tone === 'emerald'
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-slate-50',
                ].join(' ')}
                >
                  <div className="flex items-start gap-2 text-sm font-semibold leading-6 text-slate-800">
                    <Timer className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
                    <div>
                      <span className="text-xs font-black text-slate-500">下一步</span>
                      <span className="ml-2">{requestSnapshot.gaNext}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-3 text-sm 2xl:grid-cols-[minmax(0,1fr)_420px] 2xl:items-start">
                {selectedRequest.store_reply_pending && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold">
                        門市有新留言{selectedRequest.unread_store_comment_count ? ` ${selectedRequest.unread_store_comment_count} 則` : ''}
                      </div>
                      <div className="truncate text-[11px] text-amber-700">{formatDateTime(selectedRequest.last_store_comment_at)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const panel = document.getElementById(`request-comments-${selectedRequest.id}`) as HTMLDetailsElement | null;
                        if (!panel) return;
                        panel.open = true;
                        const firstUnread = comments.find((comment) => (
                          comment.source_context === 'STORE_TRACKING' && !comment.read_at
                        ));
                        window.requestAnimationFrame(() => {
                          const target = firstUnread
                            ? document.getElementById(`request-comment-${firstUnread.id}`)
                            : panel;
                          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        });
                      }}
                      className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
                    >
                      查看留言
                    </button>
                  </div>
                )}
                {partRequestWorkspace && <PartFulfillmentRequestBridge requestId={selectedRequest.id} />}
                {workOrderHandoff ? (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900 2xl:sticky 2xl:top-4 2xl:col-start-2 2xl:row-span-10 2xl:row-start-1">
                    <div className="flex items-start gap-2">
                      <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-bold">此需求已建立維修工單</div>
                        <p className="mt-1 text-xs font-semibold leading-5 text-blue-800">
                          後續處理請至工單中心更新。總務需求工作台保留原始需求、照片與留言，避免同一件維修在兩個地方都能編輯。
                        </p>
                        <a
                          href={`/general-affairs/work-orders?workOrderId=${encodeURIComponent(selectedRequest.maintenance_request_id || '')}`}
                          className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                        >
                          前往工單中心
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                ) : partRequestWorkspace && availableActions.length > 0 ? (
                  <div className="rounded-md border border-slate-200 bg-white p-3 2xl:sticky 2xl:top-4 2xl:col-start-2 2xl:row-span-10 2xl:row-start-1">
                    <div className="text-sm font-bold text-slate-900">這張需求你要怎麼收尾？</div>

                    <div className="mt-3 grid gap-2">
                      {primaryActionOptions.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setAction(item.value)}
                            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold ${action === item.value ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                          >
                            <Icon className="h-4 w-4" />
                            {item.value === 'update_progress' ? '我已開始處理' : item.label}
                          </button>
                        );
                      })}
                    </div>

                    {secondaryActionOptions.some((item) => item.value === 'request_supplement') && (
                      <button
                        type="button"
                        onClick={() => setAction('request_supplement')}
                        className={`mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold ${action === 'request_supplement' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        請門市補資料
                      </button>
                    )}

                    {action === 'request_supplement' && (
                      <div className="mt-3 grid gap-3 rounded-md border border-amber-100 bg-amber-50 p-3">
                        <label className="block text-sm font-medium text-amber-900">
                          補資料類型
                          <select
                            value={supplementType}
                            onChange={(event) => setSupplementType(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                          >
                            {SUPPLEMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-amber-900">
                          要門市補什麼？
                          <textarea
                            value={supplementNote}
                            onChange={(event) => setSupplementNote(event.target.value)}
                            className="mt-1 min-h-24 w-full rounded-md border border-amber-200 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                            placeholder="例如：請補實際缺少數量、使用位置或照片"
                          />
                        </label>
                      </div>
                    )}

                    {(action === 'update_progress' || action === 'request_store_confirmation') && (
                      <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-800">
                        {getActionHint(action)}
                      </div>
                    )}

                    <label className="mt-3 block text-sm font-medium text-slate-700">
                      備註
                      <textarea
                        value={internalNote}
                        onChange={(event) => setInternalNote(event.target.value)}
                        className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        placeholder="選填，只有內部看得到"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void submitAction()}
                      disabled={!canSubmit || submitting}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {submitting ? '處理中' : getActionLabel(action)}
                    </button>
                  </div>
                ) : displayActions.length > 0 ? (
                  <div className="rounded-md border border-slate-200 bg-white p-3 2xl:sticky 2xl:top-4 2xl:col-start-2 2xl:row-span-10 2xl:row-start-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-900">這張需求你要怎麼處理？</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {visibleActionOptions.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setAction(item.value)}
                            className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-bold transition ${action === item.value ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    {action === 'accept' && (
                      <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <label className="block text-sm font-medium text-slate-700">
                          後續處理
                          <select
                            value={intakeRoute}
                            onChange={(event) => setIntakeRoute(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          >
                            {INTAKE_ROUTES.map((route) => <option key={route.value} value={route.value}>{route.label}</option>)}
                          </select>
                        </label>
                        <div>
                          <div className="text-sm font-medium text-slate-700">承辦單位</div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {ASSIGNEE_ROLES.map((role) => (
                              <button
                                key={role.value}
                                type="button"
                                onClick={() => setAssigneeRole(role.value)}
                                className={`min-h-10 rounded-md border px-3 text-sm font-bold ${assigneeRole === role.value ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                              >
                                {role.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {action === 'reject' && (
                      <div className="mt-3 grid gap-3 rounded-md border border-red-100 bg-red-50 p-3">
                        <label className="block text-sm font-medium text-red-900">
                          為什麼不處理？
                          <select
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border border-red-200 bg-white px-3 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                          >
                            {REJECTION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-red-900">
                          <span className="flex items-center justify-between gap-2">
                            <span>給門市看的說明</span>
                            <span className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-red-700">門市看得到</span>
                          </span>
                          <textarea
                            value={rejectionNote}
                            onChange={(event) => setRejectionNote(event.target.value)}
                            className="mt-1 min-h-24 w-full rounded-md border border-red-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                            placeholder="例如：這項目不屬於總務處理，請改由原申請流程提出。"
                          />
                        </label>
                      </div>
                    )}

                    {action === 'request_supplement' && (
                      <div className="mt-3 grid gap-3 rounded-md border border-amber-100 bg-amber-50 p-3">
                        <label className="block text-sm font-medium text-amber-900">
                          少了哪種資料？
                          <select
                            value={supplementType}
                            onChange={(event) => setSupplementType(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                          >
                            {SUPPLEMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                        </label>
                        <label className="block text-sm font-medium text-amber-900">
                          <span className="flex items-center justify-between gap-2">
                            <span>要門市補什麼？</span>
                            <span className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-amber-700">門市看得到</span>
                          </span>
                          <textarea
                            value={supplementNote}
                            onChange={(event) => setSupplementNote(event.target.value)}
                            className="mt-1 min-h-24 w-full rounded-md border border-amber-200 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                            placeholder="例如：請補一張設備正面照片，並拍到型號貼紙。"
                          />
                        </label>
                      </div>
                    )}

                    <details className="group mt-3 rounded-md border border-slate-200 bg-white">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        <MessageSquare className="h-4 w-4" />
                        新增內部備註
                        {internalNote.trim() && <span className="ml-auto text-xs font-bold text-emerald-600">已填寫</span>}
                      </summary>
                      <div className="border-t border-slate-100 p-3">
                        <textarea
                          value={internalNote}
                          onChange={(event) => setInternalNote(event.target.value)}
                          className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          placeholder={actionNeedsNote ? '可補充內部判斷' : '只有內部人員看得到'}
                        />
                      </div>
                    </details>

                    {submitBlockReason && (
                      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-amber-700">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {submitBlockReason}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void submitAction()}
                      disabled={!canSubmit || submitting}
                      title={submitBlockReason || undefined}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {submitting ? '處理中' : getSubmitActionLabel(action, assigneeRole)}
                    </button>
                  </div>
                ) : null}
                {renderPurchaseReviewPanel && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2 font-bold">
                          <ShoppingCart className="h-4 w-4" />
                          採購資料
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectedRequest && void loadPurchaseReviewOptions(selectedRequest.id)}
                        title="更新採購資料"
                        aria-label="更新採購資料"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-amber-200 bg-white text-amber-700 hover:bg-amber-100"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${purchaseReviewLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {!partRequestWorkspace && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs font-bold text-amber-900">這張單要怎麼處理？</div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                      {PURCHASE_REVIEW_DECISIONS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setPurchaseReviewForm((current) => ({ ...current, decision: item.value }))}
                          className={`inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-bold ${purchaseReviewForm.decision === item.value ? 'border-amber-500 bg-white text-amber-800 shadow-sm' : 'border-amber-200 bg-amber-100/60 text-amber-700 hover:bg-white'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                      </div>
                    </div>
                    )}

                    {purchaseReviewForm.decision === 'TRANSFER' && (
                      <div className="mt-3 rounded-md border border-blue-200 bg-white p-3 text-sm text-blue-900">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-bold">建立調撥單</div>
                            <p className="mt-1 text-xs font-semibold text-blue-700">已帶入料件、數量與門市</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void submitPurchaseReview(true)}
                            disabled={!canSubmitPurchaseReview || purchaseReviewSubmitting}
                            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {purchaseReviewSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            {purchaseReviewSubmitting ? '儲存中' : '儲存並建立調撥單'}
                          </button>
                        </div>
                      </div>
                    )}

                    {purchaseReviewForm.decision !== 'TRANSFER' && (
                    <>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <label className="block text-xs font-bold text-amber-900">
                        核准數量
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={purchaseReviewForm.approvedQuantity}
                          onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, approvedQuantity: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          placeholder={purchaseReviewForm.decision === 'PURCHASE' ? '進入採購時必填' : '選填'}
                        />
                      </label>
                      <label className="block text-xs font-bold text-amber-900">
                        核准單位
                        <input
                          value={purchaseReviewForm.approvedUnit}
                          onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, approvedUnit: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          placeholder="例如：個、組、箱"
                        />
                      </label>
                    </div>

                    {purchaseReviewForm.decision === 'PURCHASE' && (
                      <>
                        {(purchaseCostSummary.hasAmount || showAdvancedPurchaseFields) && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <div className="text-xs font-black text-amber-900">採購成本追蹤</div>
                              <div className="mt-1 text-xl font-black text-slate-950">{currencyText(purchaseCostSummary.recognized)}</div>
                              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                                目前認列金額會依序採用實際採購、議價後、報價、預估金額；後續可用來統計本月採購成本。
                              </p>
                            </div>
                            <div className="grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2 lg:min-w-[360px]">
                              <div className="rounded-md bg-slate-50 px-3 py-2">
                                <div className="text-slate-400">供應商</div>
                                <div className="mt-1 truncate text-slate-900">{purchaseCostSummary.vendor}</div>
                              </div>
                              <div className="rounded-md bg-slate-50 px-3 py-2">
                                <div className="text-slate-400">預計到貨</div>
                                <div className="mt-1 text-slate-900">{purchaseReviewForm.expectedDeliveryDate || '-'}</div>
                              </div>
                              <div className="rounded-md bg-slate-50 px-3 py-2">
                                <div className="text-slate-400">報價 / 議價</div>
                                <div className="mt-1 text-slate-900">{currencyText(purchaseReviewForm.quotedAmount)} / {currencyText(purchaseReviewForm.negotiatedAmount)}</div>
                              </div>
                              <div className="rounded-md bg-slate-50 px-3 py-2">
                                <div className="text-slate-400">實際採購</div>
                                <div className="mt-1 text-slate-900">{currencyText(purchaseReviewForm.finalAmount)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowAdvancedPurchaseFields((current) => !current)}
                          className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
                        >
                          <ShoppingCart className="h-3.5 w-3.5" />
                          {showAdvancedPurchaseFields ? '收起採購資料' : '填寫供應商 / 金額 / 交期'}
                        </button>
                      </>
                    )}

                    {purchaseReviewForm.decision === 'PURCHASE' && showAdvancedPurchaseFields && (
                      <div className="mt-3 grid gap-3 rounded-md border border-amber-200 bg-white p-3 lg:grid-cols-2">
                        <label className="block text-xs font-bold text-amber-900">
                          供應商 / 廠商
                          <select
                            value={purchaseReviewForm.vendorId}
                            onChange={(event) => {
                              const vendor = purchaseVendors.find((item) => item.id === event.target.value) || null;
                              setPurchaseReviewForm((current) => ({
                                ...current,
                                vendorId: event.target.value,
                                vendorName: vendor?.name || current.vendorName,
                              }));
                            }}
                            disabled={purchaseReviewLoading}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100"
                          >
                            <option value="">{purchaseReviewLoading ? '載入廠商中...' : '未選擇，改填文字供應商'}</option>
                            {purchaseVendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.id}>{purchaseVendorLabel(vendor)}</option>
                            ))}
                          </select>
                        </label>
                        {!purchaseReviewForm.vendorId && (
                        <label className="block text-xs font-bold text-amber-900">
                          文字供應商
                          <input
                            value={purchaseReviewForm.vendorName}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, vendorName: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            placeholder={purchaseDecisionNeedsVendor ? '可填網購平台、原廠或臨時供應商' : '選填'}
                          />
                        </label>
                        )}
                        <label className="block text-xs font-bold text-amber-900">
                          預估金額
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={purchaseReviewForm.estimatedAmount}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, estimatedAmount: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <details className="rounded-md border border-amber-100 bg-amber-50/50 lg:col-span-2">
                          <summary className="flex min-h-10 cursor-pointer list-none items-center px-3 text-xs font-bold text-amber-800 hover:bg-amber-50">
                            更多採購資料
                          </summary>
                          <div className="grid gap-3 border-t border-amber-100 p-3 lg:grid-cols-2">
                        <label className="block text-xs font-bold text-amber-900">
                          報價金額
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={purchaseReviewForm.quotedAmount}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, quotedAmount: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          議價後金額
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={purchaseReviewForm.negotiatedAmount}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, negotiatedAmount: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          實際採購金額
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={purchaseReviewForm.finalAmount}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, finalAmount: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          預計到貨日
                          <input
                            type="date"
                            value={purchaseReviewForm.expectedDeliveryDate}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, expectedDeliveryDate: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          交期天數
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={purchaseReviewForm.quoteLeadTimeDays}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, quoteLeadTimeDays: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          到貨 / 入庫方式
                          <select
                            value={purchaseReviewForm.deliveryMethod}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, deliveryMethod: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          >
                            <option value="總務採購後配送">總務採購後配送</option>
                            <option value="廠商直送門市">廠商直送門市</option>
                            <option value="入庫總部">入庫總部</option>
                            <option value="入庫指定門市">入庫指定門市</option>
                            <option value="其他">其他</option>
                          </select>
                        </label>
                        <label className="block text-xs font-bold text-amber-900">
                          預計入庫位置
                          <select
                            value={purchaseReviewForm.receivingLocationId}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, receivingLocationId: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          >
                            <option value="">暫不指定</option>
                            {purchaseReceivingLocations.map((location) => (
                              <option key={location.id} value={location.id}>{inventoryLocationLabel(location)}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs font-bold text-amber-900 lg:col-span-2">
                          詢價 / 比價 / 議價備註
                          <textarea
                            value={purchaseReviewForm.quoteNotes}
                            onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, quoteNotes: event.target.value }))}
                            className="mt-1 min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            placeholder="可記錄詢價對象、比價結果、議價過程或跳過詢比議原因"
                          />
                        </label>
                          </div>
                        </details>
                      </div>
                    )}

                    {showPurchaseReceiptPanel && (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                              <PackageCheck className="h-4 w-4" />
                              採購到貨後
                            </div>
                            <p className="mt-1 text-xs font-semibold leading-5 text-emerald-800">
                              等商品真的到貨，再建立入庫交易。
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowPurchaseReceiptForm((current) => !current)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            {showPurchaseReceiptForm ? '收起入庫表單' : '建立到貨入庫'}
                          </button>
                        </div>
                      </div>
                    )}

                    {showPurchaseReceiptPanel && showPurchaseReceiptForm && (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-bold">
                              <PackageCheck className="h-4 w-4" />
                              採購到貨入庫
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadInventoryOptions()}
                            title="更新庫存"
                            aria-label="更新入庫選項"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${inventoryOptionsLoading ? 'animate-spin' : ''}`} />
                          </button>
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <label className="block text-xs font-bold text-emerald-900">
                            入庫位置
                            <select
                              value={purchaseReceiptForm.locationId}
                              onChange={(event) => {
                                const nextLocationId = event.target.value;
                                const nextLocationParts = inventoryLocationParts.filter((item) => item.location_id === nextLocationId);
                                const nextLocationPart = nextLocationParts.find((item) => item.part_id === selectedRequest.part_id)
                                  || nextLocationParts[0];
                                setPurchaseReceiptForm((current) => ({
                                  ...current,
                                  locationId: nextLocationId,
                                  partId: nextLocationPart?.part_id || '',
                                  inputUnitType: (nextLocationPart?.preferred_issue_unit_type === 'PURCHASE' ? 'PURCHASE' : 'BASE'),
                                }));
                              }}
                              disabled={inventoryOptionsLoading}
                              className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
                            >
                              <option value="">{inventoryOptionsLoading ? '載入庫存位置中...' : '請選擇入庫位置'}</option>
                              {inventoryLocations.map((location) => (
                                <option key={location.id} value={location.id}>{inventoryLocationLabel(location)}</option>
                              ))}
                            </select>
                          </label>

                          {selectedRequest.part_id ? (
                          <div className="block text-xs font-bold text-emerald-900">
                            入庫料件
                            <div className="mt-1 flex min-h-10 items-center rounded-md border border-emerald-100 bg-white px-3 text-sm font-semibold text-slate-800">
                              {inventoryPartLabel(selectedPurchaseReceiptPart || partRequestWorkspace?.part || null)}
                            </div>
                          </div>
                          ) : (
                          <label className="block text-xs font-bold text-emerald-900">
                            入庫料件
                            <select
                              value={purchaseReceiptForm.partId}
                              onChange={(event) => {
                                const nextPartId = event.target.value;
                                const nextLocationPart = purchaseReceiptLocationParts.find((item) => item.part_id === nextPartId);
                                setPurchaseReceiptForm((current) => ({
                                  ...current,
                                  partId: nextPartId,
                                  inputUnitType: (nextLocationPart?.preferred_issue_unit_type === 'PURCHASE' ? 'PURCHASE' : 'BASE'),
                                }));
                              }}
                              disabled={!purchaseReceiptForm.locationId || inventoryOptionsLoading}
                              className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
                            >
                              <option value="">{purchaseReceiptForm.locationId ? '請選擇料件' : '請先選入庫位置'}</option>
                              {purchaseReceiptLocationParts.map((item) => (
                                <option key={item.id} value={item.part_id}>{inventoryPartLabel(item.part)}</option>
                              ))}
                            </select>
                          </label>
                          )}

                          <label className="block text-xs font-bold text-emerald-900">
                            實收數量
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={purchaseReceiptForm.quantity}
                              onChange={(event) => setPurchaseReceiptForm((current) => ({ ...current, quantity: event.target.value }))}
                              className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                              placeholder="請輸入實際收到數量"
                            />
                          </label>

                          <label className="block text-xs font-bold text-emerald-900">
                            單位
                            <select
                              value={purchaseReceiptForm.inputUnitType}
                              onChange={(event) => setPurchaseReceiptForm((current) => ({ ...current, inputUnitType: event.target.value as 'BASE' | 'PURCHASE' }))}
                              className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            >
                              <option value="BASE">基本單位{selectedPurchaseReceiptPart?.base_unit ? `｜${selectedPurchaseReceiptPart.base_unit}` : ''}</option>
                              {selectedPurchaseReceiptPart?.purchase_unit && selectedPurchaseReceiptPart?.purchase_to_base_rate && (
                                <option value="PURCHASE">採購單位｜{selectedPurchaseReceiptPart.purchase_unit}</option>
                              )}
                            </select>
                          </label>
                        </div>

                        <details className="mt-3 rounded-md border border-emerald-100 bg-white">
                          <summary className="flex min-h-10 cursor-pointer list-none items-center px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50">
                            入庫原因 / 備註
                          </summary>
                          <div className="grid gap-3 border-t border-emerald-100 p-3 lg:grid-cols-2">
                            <label className="block text-xs font-bold text-emerald-900">
                              入庫原因
                              <input
                                value={purchaseReceiptForm.reason}
                                onChange={(event) => setPurchaseReceiptForm((current) => ({ ...current, reason: event.target.value }))}
                                className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                placeholder="例如：採購到貨入庫"
                              />
                            </label>
                            <label className="block text-xs font-bold text-emerald-900">
                              入庫備註
                              <input
                                value={purchaseReceiptForm.notes}
                                onChange={(event) => setPurchaseReceiptForm((current) => ({ ...current, notes: event.target.value }))}
                                className="mt-1 h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                placeholder="選填，可填發票、配送或驗收資訊"
                              />
                            </label>
                          </div>
                        </details>

                        {selectedPurchaseReceiptPart && (
                          <div className="mt-3 rounded-md border border-emerald-100 bg-white p-3 text-xs font-semibold leading-5 text-slate-700">
                            入庫基本單位：{selectedPurchaseReceiptPart.base_unit}
                            {selectedPurchaseReceiptPart.purchase_unit && selectedPurchaseReceiptPart.purchase_to_base_rate
                              ? `；採購單位換算：1 ${selectedPurchaseReceiptPart.purchase_unit} = ${numberText(selectedPurchaseReceiptPart.purchase_to_base_rate)} ${selectedPurchaseReceiptPart.base_unit}`
                              : ''}
                          </div>
                        )}

                        <label className="mt-3 flex items-center gap-2 rounded-md border border-emerald-100 bg-white p-3 text-xs font-bold text-emerald-900">
                          <input
                            type="checkbox"
                            checked={purchaseReceiptForm.requestStoreConfirmation}
                            onChange={(event) => setPurchaseReceiptForm((current) => ({ ...current, requestStoreConfirmation: event.target.checked }))}
                            className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          入庫後送門市確認收貨或使用結果
                        </label>

                        <button
                          type="button"
                          onClick={() => void submitPurchaseReceipt()}
                          disabled={!canSubmitPurchaseReceipt || purchaseReceiptSubmitting}
                          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {purchaseReceiptSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                          {purchaseReceiptSubmitting ? '建立入庫中' : '確認入庫'}
                        </button>
                      </div>
                    )}

                    {purchaseReviewForm.decision === 'SUBSTITUTE' && (
                      <label className="mt-3 block text-xs font-bold text-amber-900">
                        替代品說明
                        <textarea
                          value={purchaseReviewForm.substituteDescription}
                          onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, substituteDescription: event.target.value }))}
                          className="mt-1 min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                          placeholder="請說明提供的替代品、差異與處理方式"
                        />
                      </label>
                    )}

                    <label className="mt-3 block text-xs font-bold text-amber-900">
                      為什麼這樣處理？
                      <textarea
                        value={purchaseReviewForm.decisionNote}
                        onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, decisionNote: event.target.value }))}
                        className="mt-1 min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                        placeholder="必填，例如：目前沒有庫存，先採購 1 個給門市使用"
                      />
                    </label>

                    <label className="mt-3 block text-xs font-bold text-amber-900">
                      給門市看的說明
                      <textarea
                        value={purchaseReviewForm.publicNote}
                        onChange={(event) => setPurchaseReviewForm((current) => ({ ...current, publicNote: event.target.value }))}
                        className="mt-1 min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                        placeholder={purchaseReviewForm.decision === 'REJECT' ? '駁回時必填，門市會看到這段說明' : '選填，會同步寫入門市可見進度'}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void submitPurchaseReview()}
                      disabled={!canSubmitPurchaseReview || purchaseReviewSubmitting}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {purchaseReviewSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                      {purchaseReviewSubmitting
                        ? '儲存中'
                        : purchaseReviewForm.decision === 'PURCHASE'
                          ? (hasSavedPurchaseReview ? '更新採購資料' : '確認進入採購')
                          : '儲存處理結果'}
                    </button>
                    </>
                    )}
                  </div>
                )}
                {renderStockIssuePanel && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2 font-bold">
                          <PackageCheck className="h-4 w-4" />
                          出庫資料
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadInventoryOptions()}
                        title="更新庫存"
                        aria-label="更新庫存"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-blue-200 bg-white text-blue-700 hover:bg-blue-100"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${inventoryOptionsLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {!inventoryPartCatalogAccess && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
                        缺少料件查看權限，無法載入可出庫料件。
                      </div>
                    )}

                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <label className="block text-xs font-bold text-blue-900">
                        從哪裡拿？
                        <select
                          value={stockIssueForm.locationId}
                          onChange={(event) => {
                            const nextLocationId = event.target.value;
                            const nextLocationParts = inventoryLocationParts.filter((item) => item.location_id === nextLocationId);
                            const nextLocationPart = nextLocationParts.find((item) => item.part_id === selectedRequest.part_id)
                              || nextLocationParts[0];
                            setStockIssueForm((current) => ({
                              ...current,
                              locationId: nextLocationId,
                              partId: nextLocationPart?.part_id || '',
                              inputUnitType: (nextLocationPart?.preferred_issue_unit_type === 'PURCHASE' ? 'PURCHASE' : 'BASE'),
                            }));
                          }}
                          disabled={inventoryOptionsLoading}
                          className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                        >
                          <option value="">{inventoryOptionsLoading ? '載入庫存位置中...' : '請選擇來源位置'}</option>
                          {inventoryLocations.map((location) => (
                            <option key={location.id} value={location.id}>{inventoryLocationLabel(location)}</option>
                          ))}
                        </select>
                      </label>

                      {selectedRequest.part_id ? (
                      <div className="block text-xs font-bold text-blue-900">
                        料件
                        <div className="mt-1 flex min-h-10 items-center rounded-md border border-blue-100 bg-white px-3 text-sm font-semibold text-slate-800">
                          {inventoryPartLabel(selectedStockIssuePart || partRequestWorkspace?.part || null)}
                        </div>
                      </div>
                      ) : (
                      <label className="block text-xs font-bold text-blue-900">
                        料件
                        <select
                          value={stockIssueForm.partId}
                          onChange={(event) => {
                            const nextPartId = event.target.value;
                            const nextLocationPart = stockIssueLocationParts.find((item) => item.part_id === nextPartId);
                            setStockIssueForm((current) => ({
                              ...current,
                              partId: nextPartId,
                              inputUnitType: (nextLocationPart?.preferred_issue_unit_type === 'PURCHASE' ? 'PURCHASE' : 'BASE'),
                            }));
                          }}
                          disabled={!stockIssueForm.locationId || inventoryOptionsLoading}
                          className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                        >
                          <option value="">{stockIssueForm.locationId ? '請選擇料件' : '請先選來源位置'}</option>
                          {stockIssueLocationParts.map((item) => (
                            <option key={item.id} value={item.part_id}>{inventoryPartLabel(item.part)}</option>
                          ))}
                        </select>
                      </label>
                      )}

                      <label className="block text-xs font-bold text-blue-900">
                        這次出多少？
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={stockIssueForm.quantity}
                          onChange={(event) => setStockIssueForm((current) => ({ ...current, quantity: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          placeholder="請輸入出庫數量"
                        />
                      </label>

                      <label className="block text-xs font-bold text-blue-900">
                        單位
                        <select
                          value={stockIssueForm.inputUnitType}
                          onChange={(event) => setStockIssueForm((current) => ({ ...current, inputUnitType: event.target.value as 'BASE' | 'PURCHASE' }))}
                          className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="BASE">基本單位{selectedStockIssuePart?.base_unit ? `｜${selectedStockIssuePart.base_unit}` : ''}</option>
                          {selectedStockIssuePart?.purchase_unit && selectedStockIssuePart?.purchase_to_base_rate && (
                            <option value="PURCHASE">採購單位｜{selectedStockIssuePart.purchase_unit}</option>
                          )}
                        </select>
                      </label>
                    </div>

                    <details className="mt-3 rounded-md border border-blue-100 bg-white">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center px-3 text-xs font-bold text-blue-800 hover:bg-blue-50">
                        出庫原因 / 備註
                      </summary>
                      <div className="grid gap-3 border-t border-blue-100 p-3 lg:grid-cols-2">
                        <label className="block text-xs font-bold text-blue-900">
                          出庫原因
                          <input
                            value={stockIssueForm.reason}
                            onChange={(event) => setStockIssueForm((current) => ({ ...current, reason: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            placeholder="例如：門市需要補充"
                          />
                        </label>
                        <label className="block text-xs font-bold text-blue-900">
                          備註
                          <input
                            value={stockIssueForm.notes}
                            onChange={(event) => setStockIssueForm((current) => ({ ...current, notes: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            placeholder="選填，例如：隨下次配送帶去"
                          />
                        </label>
                      </div>
                    </details>

                    {selectedStockIssueLocationPart && (
                      <div className="mt-3 rounded-md border border-blue-100 bg-white p-3 text-xs font-semibold leading-5 text-slate-700">
                        目前庫存量：{numberText(selectedStockIssueBalance)} {selectedStockIssuePart?.base_unit || ''}
                        {selectedStockIssuePart?.purchase_unit && selectedStockIssuePart?.purchase_to_base_rate
                          ? `；採購單位換算：1 ${selectedStockIssuePart.purchase_unit} = ${numberText(selectedStockIssuePart.purchase_to_base_rate)} ${selectedStockIssuePart.base_unit}`
                          : ''}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void submitStockIssue()}
                      disabled={!canSubmitStockIssue || stockIssueSubmitting}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {stockIssueSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                      {stockIssueSubmitting ? '建立出庫中' : '確認出庫'}
                    </button>
                  </div>
                )}
                {hasRequestExtraDetails && (
                <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer list-none text-sm font-black text-slate-900">
                    需求補充
                  </summary>
                  <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-700">
                    {selectedRequest.request_type === 'PURCHASE_SUPPLEMENT' && (
                      <div>
                        <span className="font-semibold text-slate-900">希望數量：</span>
                        <span>{selectedRequest.desired_quantity || '-'} {selectedRequest.desired_unit || ''}</span>
                        {selectedRequest.desired_spec && <span className="ml-2 whitespace-pre-wrap text-slate-500">{selectedRequest.desired_spec}</span>}
                      </div>
                    )}
                    {selectedRequest.impact_description && (
                      <div>
                        <span className="font-semibold text-slate-900">影響：</span>
                        <span className="whitespace-pre-wrap">{selectedRequest.impact_description}</span>
                      </div>
                    )}
                  </div>
                </details>
                )}
                {selectedRequest.maintenance_request_id && !workOrderHandoff && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    已建立維修工單，可至工單中心追蹤派工與處理紀錄。
                  </div>
                )}
                <details
                  id={`request-comments-${selectedRequest.id}`}
                  className="rounded-md border border-slate-200 bg-white p-3"
                >
                  <summary className="cursor-pointer list-none text-sm font-bold text-slate-900">
                    查證資料與留言
                    {attachments.length > 0 && (
                      <span className="ml-2 text-xs font-semibold text-slate-500">附件 {attachments.length}</span>
                    )}
                    {events.length + comments.length > 0 && (
                      <span className="ml-2 text-xs font-semibold text-slate-500">紀錄 {events.length + comments.length}</span>
                    )}
                  </summary>
                  <div className="mt-3 grid gap-3">
                {(loadingAttachments || attachments.length > 0) && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Paperclip className="h-3.5 w-3.5" />
                    附件 / 照片
                  </div>
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    {loadingAttachments ? (
                      <div className="flex h-20 items-center justify-center gap-2 text-xs text-slate-500">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        載入附件中
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {attachments.map((attachment) => {
                          const isImage = isImageAttachment(attachment);
                          const body = (
                            <>
                              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-100">
                                {isImage && attachment.signed_url ? (
                                  <img src={attachment.signed_url} alt={attachment.file_name} className="h-full w-full object-cover" />
                                ) : attachment.content_type === 'application/pdf' ? (
                                  <FileText className="h-6 w-6 text-red-500" />
                                ) : (
                                  <Image className="h-6 w-6 text-slate-400" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-slate-800">{attachment.file_name}</span>
                                <span className="mt-1 block text-xs text-slate-500">
                                  {[attachment.purpose, formatFileSize(attachment.size_bytes), formatDateTime(attachment.uploaded_at)].filter(Boolean).join(' / ')}
                                </span>
                              </span>
                              {attachment.signed_url && <ExternalLink className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-orange-600" />}
                            </>
                          );

                          if (isImage && attachment.signed_url) {
                            return (
                              <button
                                key={attachment.id}
                                type="button"
                                onClick={() => setPreviewAttachment(attachment)}
                                className="group flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-left text-sm hover:border-orange-200 hover:bg-orange-50"
                              >
                                {body}
                              </button>
                            );
                          }

                          return (
                            <a
                              key={attachment.id}
                              href={attachment.signed_url || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="group flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-sm hover:border-orange-200 hover:bg-orange-50"
                            >
                              {body}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                )}
                {(loadingTimeline || events.length + comments.length > 0) && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Timer className="h-3.5 w-3.5" />
                    處理紀錄
                  </div>
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    {loadingTimeline ? (
                      <div className="flex h-20 items-center justify-center gap-2 text-xs text-slate-500">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        載入紀錄中
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {events.map((event) => (
                          <div key={`event-${event.id}`} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-800">{event.title}</div>
                              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${event.visibility === 'INTERNAL' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                {visibilityLabel(event.visibility)}
                              </span>
                            </div>
                            {event.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{event.description}</p>}
                            <div className="mt-2 text-[11px] text-slate-400">
                              {[event.created_by_name, formatDateTime(event.created_at)].filter(Boolean).join(' / ')}
                            </div>
                          </div>
                        ))}
                        {comments.map((comment) => (
                          <div
                            key={`comment-${comment.id}`}
                            id={`request-comment-${comment.id}`}
                            className={[
                              'scroll-mt-24 rounded-md border p-3',
                              comment.source_context === 'STORE_TRACKING' && !comment.read_at
                                ? 'border-amber-300 bg-amber-50/70 shadow-sm'
                                : 'border-orange-100 bg-white',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800">
                                <MessageSquare className="h-3.5 w-3.5 text-orange-500" />
                                留言
                                {comment.source_context === 'STORE_TRACKING' && !comment.read_at && (
                                  <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">未讀</span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {comment.source_context === 'STORE_TRACKING'
                                  && !comment.read_at && (
                                  <button
                                    type="button"
                                    onClick={() => void markStoreReplyRead(comment.id)}
                                    disabled={Boolean(markingStoreReplyReadId)}
                                    className="inline-flex h-7 items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {markingStoreReplyReadId === comment.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    標記已閱讀
                                  </button>
                                )}
                                {(comment.can_edit || comment.can_delete) && editingCommentId !== comment.id && (
                                  <>
                                    {comment.can_edit && (
                                      <button
                                        type="button"
                                        onClick={() => startEditComment(comment)}
                                        className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        編輯
                                      </button>
                                    )}
                                    {comment.can_delete && (
                                      <button
                                        type="button"
                                        onClick={() => void deleteComment(comment.id)}
                                        disabled={commentMutatingId === comment.id}
                                        className="inline-flex h-7 items-center gap-1 rounded border border-red-200 px-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        刪除
                                      </button>
                                    )}
                                  </>
                                )}
                                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${comment.visibility === 'INTERNAL' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {visibilityLabel(comment.visibility)}
                                </span>
                              </div>
                            </div>
                            {editingCommentId === comment.id ? (
                              <div className="mt-2">
                                <textarea
                                  value={editingCommentBody}
                                  onChange={(event) => setEditingCommentBody(event.target.value)}
                                  rows={3}
                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                                />
                                <div className="mt-2 flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void updateComment(comment.id)}
                                    disabled={commentMutatingId === comment.id || !editingCommentBody.trim()}
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                                  >
                                    {commentMutatingId === comment.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                                    儲存
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId('');
                                      setEditingCommentBody('');
                                    }}
                                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{comment.body}</p>
                            )}
                            {comment.attachments && comment.attachments.length > 0 && (
                              <div className="mt-2 grid gap-1">
                                {comment.attachments.map((attachment) => {
                                  const isImage = isImageAttachment(attachment);
                                  if (isImage && attachment.signed_url) {
                                    return (
                                      <button
                                        key={attachment.id}
                                        type="button"
                                        onClick={() => setPreviewAttachment(attachment)}
                                        className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-1.5 text-left text-xs text-slate-600 hover:border-orange-200 hover:bg-orange-50"
                                      >
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
                                          <img src={attachment.signed_url || ''} alt={attachment.file_name} className="h-full w-full object-cover" />
                                        </span>
                                        <span className="truncate">{attachment.file_name}</span>
                                      </button>
                                    );
                                  }
                                  return (
                                    <a
                                      key={attachment.id}
                                      href={attachment.signed_url || '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:border-orange-200 hover:bg-orange-50"
                                    >
                                      <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                                      <span className="truncate">{attachment.file_name}</span>
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                            <div className="mt-2 text-[11px] text-slate-400">
                              {[comment.created_by_name, formatDateTime(comment.created_at), comment.edited_at ? '已編輯' : null].filter(Boolean).join(' / ')}
                            </div>
                            {comment.read_at && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                {comment.read_by_name || '總務人員'}已閱讀 / {formatDateTime(comment.read_at)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                )}
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <MessageSquare className="h-3.5 w-3.5" />
                      新增留言 / 備註
                    </div>
                    <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                      {[
                        { value: 'PUBLIC' as const, label: '公開' },
                        { value: 'INTERNAL' as const, label: '內部' },
                      ].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setCommentVisibility(item.value)}
                          className={`h-7 rounded px-2 text-xs font-semibold ${commentVisibility === item.value ? 'bg-white text-orange-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder={commentVisibility === 'INTERNAL' ? '填寫總務內部備註' : '填寫門市端看得到的回覆'}
                  />
                  <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                    <Paperclip className="h-4 w-4" />
                    選擇留言附件
                    <input
                      key={`${selectedRequest.id}-ga-comment-${commentFiles.length}`}
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(event) => setCommentFiles(Array.from(event.target.files || []))}
                    />
                  </label>
                  {commentFiles.length > 0 && (
                    <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                      已選擇 {commentFiles.length} 個附件：{commentFiles.map((file) => file.name).join('、')}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void submitComment()}
                    disabled={commentSubmitting || !commentBody.trim()}
                    className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {commentSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {commentSubmitting ? '送出中' : commentVisibility === 'INTERNAL' ? '新增內部備註' : '新增公開留言'}
                  </button>
                </div>
                  </div>
                </details>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      {previewAttachment?.signed_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="附件照片預覽"
          onClick={() => setPreviewAttachment(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewAttachment(null)}
              className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white"
              aria-label="關閉照片預覽"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={previewAttachment.signed_url}
              alt={previewAttachment.file_name}
              className="max-h-[88vh] max-w-[92vw] rounded-md bg-white object-contain shadow-2xl"
            />
            <div className="mt-2 rounded-md bg-white/95 px-3 py-2 text-sm text-slate-700 shadow">
              {previewAttachment.file_name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
