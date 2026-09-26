'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Box,
  Briefcase,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  CalendarDays,
  Copy,
  Download,
  Filter,
  Folder,
  Globe,
  Home,
  ImagePlus,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  Paperclip,
  Pencil,
  Phone,
  Printer,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShoppingCart,
  Star,
  Tags,
  Trash2,
  Upload,
  User,
  Warehouse,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import {
  MAINTENANCE_PROGRESS_STAGE_LABELS,
  normalizeMaintenanceStatus,
  normalizeProgressStage,
  type LegacyMaintenanceStatus,
  type MaintenanceProgressStage,
  type MaintenanceTicketStatus,
} from '@/lib/maintenance/status';
import GeneralAffairsDashboardClient from '@/components/general-affairs/dashboard/GeneralAffairsDashboardClient';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import {
  GeneralAffairsErrorState,
  GeneralAffairsLoadingState,
  GeneralAffairsPermissionDeniedState,
} from '@/components/general-affairs/GeneralAffairsPageState';
import {
  GeneralAffairsFormPage,
  GeneralAffairsListPage,
} from '@/components/general-affairs/GeneralAffairsPageTemplates';
import ResourceAttachmentPanel from '@/components/general-affairs/attachments/ResourceAttachmentPanel';
import {
  MAINTENANCE_STATUS_DEFINITION_BY_CODE,
  MAINTENANCE_STATUS_STEPS,
} from '@/components/general-affairs/maintenance/status';
import {
  GA_MAINTENANCE_REQUEST_CREATE,
  GA_MAINTENANCE_REQUEST_VIEW_ALL,
  GA_MAINTENANCE_REQUEST_UPDATE,
} from '@/lib/general-affairs/maintenance-permissions';

type MaintenanceStatus = MaintenanceTicketStatus;
type MaintenanceStatusValue = MaintenanceTicketStatus | LegacyMaintenanceStatus;
type ResourceType = 'equipment' | 'facility' | 'material';
type ServiceSection = 'home' | 'maintenance' | 'work-orders' | 'equipment' | 'facilities' | 'vendors' | 'parts' | 'part-requests';
type MaintenanceView = 'new' | 'mine';
type ReportResourceFilter = 'all' | ResourceType;
type WorkOrderFocusFilter = 'all' | 'store_rejected' | 'arrange' | 'vendor' | 'parts' | 'store_confirmation' | 'completed';
type VendorView = 'list' | 'categories' | 'regions' | 'stats' | 'purchases';
type VendorFormStep = 'basic' | 'services' | 'contacts' | 'cooperation' | 'attachments';
type VendorStatus = 'active' | 'paused' | 'inactive';
type VendorCategoryStatus = 'active' | 'inactive';
type VendorRegionStatus = 'active' | 'inactive' | 'archived';

type PurchaseAnalysisRank = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

type PurchaseAnalysisSummary = {
  yearMonth: string;
  totalAmount: number;
  purchaseCount: number;
  amountFilledCount: number;
  missingAmountCount: number;
  topStores: PurchaseAnalysisRank[];
  topVendors: PurchaseAnalysisRank[];
};

const MODULE_NOT_AVAILABLE_MESSAGE = '此功能尚未在目前測試環境開放。';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
};

type MaintenanceRequest = {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  reporter_name: string;
  status: MaintenanceStatusValue;
  progress_stage?: MaintenanceProgressStage | null;
  accepted_at?: string | null;
  accepted_by?: string | null;
  assignee_name?: string | null;
  handling_method?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  completion_method?: string | null;
  completion_requested_at?: string | null;
  completion_requested_by?: string | null;
  unresolved_reason?: string | null;
  priority: string | null;
  resource_type?: ResourceType | null;
  issue_type?: string | null;
  location?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  reported_at: string;
  ga_service_request_id?: string | null;
  store?: StoreOption | null;
};

type MaintenanceUpdate = {
  id: string;
  request_id: string;
  status: MaintenanceStatusValue;
  progress_stage?: MaintenanceProgressStage | null;
  visibility?: 'PUBLIC' | 'INTERNAL';
  notes: string;
  progress_date: string;
  updated_by_name: string;
  created_at: string;
  photos?: MaintenancePhoto[];
};

type MaintenancePhoto = {
  id: string;
  request_id?: string;
  update_id?: string;
  storage_path: string;
  signed_url?: string | null;
  file_name: string;
  content_type?: string | null;
  source_label?: string;
  photo_type?: 'before' | 'progress' | 'after' | 'other';
  created_at: string;
};

const imageFileNamePattern = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

function isImageLikeAttachment(fileName?: string | null, contentType?: string | null) {
  return Boolean(contentType?.startsWith('image/') || (fileName && imageFileNamePattern.test(fileName)));
}

type VendorCategory = {
  id: string;
  name: string;
  code: string;
  parent_id: string | null;
  description: string | null;
  icon_key: string | null;
  status: VendorCategoryStatus;
  sort_order: number;
  common_items: string[] | null;
};

type VendorRegion = {
  id: string;
  name: string;
  code: string;
  parent_id: string | null;
  region_type: 'country' | 'region' | 'city' | 'district';
  description: string | null;
  included_locations: string[] | null;
  status: VendorRegionStatus;
  sort_order: number;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: 'company' | 'studio' | 'personal';
  tax_id: string | null;
  alias: string | null;
  founded_date: string | null;
  status: VendorStatus;
  phone: string | null;
  fax: string | null;
  website: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  service_city: string | null;
  service_district: string | null;
  service_address: string | null;
  same_service_address: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  line_id: string | null;
  email: string | null;
  description: string | null;
  service_capability_note: string | null;
  billing_title: string | null;
  billing_address: string | null;
  invoice_type: string | null;
  payment_terms: string | null;
  payment_methods: string[] | null;
  accounting_notes: string | null;
  cooperation_start_date: string | null;
  contract_end_date: string | null;
  contract_required: boolean;
  preferred_vendor: boolean;
  cooperation_notes: string | null;
  attachment_names: string[] | null;
  tags: string[] | null;
  brands: string[] | null;
  equipment_types: string[] | null;
  service_category_ids: string[] | null;
  service_region_ids: string[] | null;
  rating: number;
  review_count: number;
  work_order_count: number;
  monthly_order_count: number;
  total_amount: number;
  avg_days: number;
};

const serviceNavItems: Array<{ key: ServiceSection; label: string; icon: any }> = [
  { key: 'home', label: '服務首頁', icon: Home },
  { key: 'maintenance', label: '維修回報', icon: Wrench },
  { key: 'work-orders', label: '工單中心', icon: ClipboardList },
  { key: 'vendors', label: '廠商管理', icon: Briefcase },
];

const resourceTypes: Array<{
  key: ResourceType;
  label: string;
  hint: string;
  icon: any;
  issueTypes: string[];
}> = [
  {
    key: 'equipment',
    label: '設備',
    hint: '有型號、序號或維修紀錄',
    icon: Wrench,
    issueTypes: ['不冷 / 冷度不足', '無法開機', '異音 / 異味', '漏水 / 滲水', '畫面異常', '其他設備問題'],
  },
  {
    key: 'facility',
    label: '設施',
    hint: '建築、固定設施與空間',
    icon: Building2,
    issueTypes: ['門窗異常', '照明異常', '水電異常', '牆面 / 地板損壞', '招牌異常', '其他設施問題'],
  },
  {
    key: 'material',
    label: '料件 / 耗材',
    hint: '零件、耗材與維修物品申請',
    icon: Box,
    issueTypes: ['耗材不足', '零件更換', '規格確認', '補件申請', '其他料件需求'],
  },
];

const maintenanceStatusIcons = {
  clock: Clock3,
  check: CheckCircle2,
  settings: Settings,
};

const statusMeta: Record<MaintenanceStatus, { label: string; tone: string; dot: string; icon: any }> = Object.fromEntries(
  Object.entries(MAINTENANCE_STATUS_DEFINITION_BY_CODE).map(([code, definition]) => [
    code,
    {
      label: definition.label,
      tone: definition.tone.badge,
      dot: definition.tone.dot,
      icon: maintenanceStatusIcons[definition.tone.iconKey],
    },
  ]),
) as Record<MaintenanceStatus, { label: string; tone: string; dot: string; icon: any }>;

const progressSteps: Array<{ status: MaintenanceStatus; label: string }> = MAINTENANCE_STATUS_STEPS;

const reportStatusFilters: Array<{
  key: 'all' | MaintenanceStatus;
  label: string;
  helper: string;
  icon: any;
  iconTone: string;
  badgeTone: string;
}> = [
  {
    key: 'all',
    label: '全部工單',
    helper: '查看全部',
    icon: Wrench,
    iconTone: 'bg-blue-50 text-blue-600 ring-blue-100',
    badgeTone: 'bg-blue-50 text-blue-700',
  },
  {
    key: 'UNACCEPTED',
    label: '未受理',
    helper: '等待總務受理',
    icon: Clock3,
    iconTone: 'bg-amber-50 text-amber-600 ring-amber-100',
    badgeTone: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'ACCEPTED',
    label: '已受理',
    helper: '已進入總務處理',
    icon: CheckCircle2,
    iconTone: 'bg-sky-50 text-sky-600 ring-sky-100',
    badgeTone: 'bg-sky-50 text-sky-700',
  },
  {
    key: 'PROCESSING',
    label: '處理中',
    helper: '顯示目前進度',
    icon: Settings,
    iconTone: 'bg-orange-50 text-orange-600 ring-orange-100',
    badgeTone: 'bg-orange-50 text-orange-700',
  },
  {
    key: 'COMPLETED',
    label: '已完成',
    helper: '查看歷史',
    icon: CheckCircle2,
    iconTone: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    badgeTone: 'bg-emerald-50 text-emerald-700',
  },
];

const workOrderStatusFilters = reportStatusFilters.filter((filter) => filter.key !== 'UNACCEPTED');

const workOrderFocusFilters: Array<{
  key: WorkOrderFocusFilter;
  label: string;
  helper: string;
  icon: any;
  tone: string;
  activeTone: string;
}> = [
  {
    key: 'all',
    label: '全部工單',
    helper: '先看整體',
    icon: ClipboardList,
    tone: 'border-slate-200 bg-white text-slate-700',
    activeTone: 'border-slate-300 bg-slate-100 text-slate-950 ring-slate-200',
  },
  {
    key: 'store_rejected',
    label: '門市退回',
    helper: '門市說還沒好',
    icon: AlertCircle,
    tone: 'border-red-100 bg-red-50 text-red-800',
    activeTone: 'border-red-300 bg-red-100 text-red-950 ring-red-200',
  },
  {
    key: 'arrange',
    label: '待安排',
    helper: '先決定怎麼處理',
    icon: Settings,
    tone: 'border-blue-100 bg-blue-50 text-blue-800',
    activeTone: 'border-blue-300 bg-blue-100 text-blue-950 ring-blue-200',
  },
  {
    key: 'vendor',
    label: '廠商 / 施工',
    helper: '追廠商、報價、到場',
    icon: Briefcase,
    tone: 'border-sky-100 bg-sky-50 text-sky-800',
    activeTone: 'border-sky-300 bg-sky-100 text-sky-950 ring-sky-200',
  },
  {
    key: 'parts',
    label: '維修待料件',
    helper: '缺料、等調撥或採購',
    icon: Package,
    tone: 'border-indigo-100 bg-indigo-50 text-indigo-800',
    activeTone: 'border-indigo-300 bg-indigo-100 text-indigo-950 ring-indigo-200',
  },
  {
    key: 'store_confirmation',
    label: '等門市確認',
    helper: '已處理，等回覆',
    icon: CheckCircle2,
    tone: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    activeTone: 'border-emerald-300 bg-emerald-100 text-emerald-950 ring-emerald-200',
  },
  {
    key: 'completed',
    label: '已完成',
    helper: '查歷史紀錄',
    icon: CheckCircle2,
    tone: 'border-slate-200 bg-slate-50 text-slate-600',
    activeTone: 'border-slate-300 bg-slate-100 text-slate-950 ring-slate-200',
  },
];

const reportResourceFilters: Array<{
  key: ReportResourceFilter;
  label: string;
  helper: string;
  icon: any;
}> = [
  { key: 'all', label: '全部類型', helper: '設備、設施、料件/耗材', icon: ClipboardList },
  { key: 'equipment', label: '設備', helper: '門市設備故障或異常', icon: Settings },
  { key: 'facility', label: '設施', helper: '門市設施修繕', icon: Building2 },
  { key: 'material', label: '料件/耗材', helper: '料件或耗材需求', icon: Package },
];

const workOrderHandlingOptions = [
  '內部自行處理',
  '廠商處理',
  '原廠 / 保固',
  '等待料件',
  '暫停等待確認',
  '其他',
];

const workOrderQuickActions: Array<{
  label: string;
  helper: string;
  icon: any;
  action: 'SAVE_PROGRESS' | 'REQUEST_COMPLETION' | 'FORCE_CLOSE';
  progressStage: MaintenanceProgressStage;
  handlingMethod: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  notes: string;
  forceCloseReason?: string;
}> = [
  {
    label: '出庫',
    helper: '從庫存準備物品給門市',
    icon: Warehouse,
    action: 'SAVE_PROGRESS',
    progressStage: 'WAITING_PARTS',
    handlingMethod: '內部自行處理',
    visibility: 'PUBLIC',
    notes: '總務已接手，正在準備物品，完成出庫後會再更新進度。',
  },
  {
    label: '調撥',
    helper: '從其他位置調物品過來',
    icon: RefreshCw,
    action: 'SAVE_PROGRESS',
    progressStage: 'PARTS_IN_TRANSIT',
    handlingMethod: '等待料件',
    visibility: 'PUBLIC',
    notes: '總務已安排調撥，物品送達後會請門市確認收貨。',
  },
  {
    label: '採購',
    helper: '庫存不足，需採買或估價',
    icon: ClipboardList,
    action: 'SAVE_PROGRESS',
    progressStage: 'WAITING_INTERNAL_APPROVAL',
    handlingMethod: '等待料件',
    visibility: 'PUBLIC',
    notes: '總務已進入採購評估，確認品項、價格與到貨方式後會更新進度。',
  },
  {
    label: '派工',
    helper: '安排內部人員或廠商處理',
    icon: Briefcase,
    action: 'SAVE_PROGRESS',
    progressStage: 'WAITING_VENDOR_VISIT',
    handlingMethod: '廠商處理',
    visibility: 'PUBLIC',
    notes: '總務已安排人員處理，後續會依到場或處理結果更新進度。',
  },
  {
    label: '補資料',
    helper: '請門市補照片或說明',
    icon: AlertCircle,
    action: 'SAVE_PROGRESS',
    progressStage: 'WAITING_STORE_INFO',
    handlingMethod: '暫停等待確認',
    visibility: 'PUBLIC',
    notes: '請門市補充照片或說明，總務收到後會繼續處理。',
  },
  {
    label: '駁回',
    helper: '不符合處理範圍或暫不處理',
    icon: XCircle,
    action: 'FORCE_CLOSE',
    progressStage: 'OTHER',
    handlingMethod: '其他',
    visibility: 'PUBLIC',
    notes: '總務已檢視此需求，判斷暫不進行後續處理。',
    forceCloseReason: '總務判斷此需求不符合處理範圍或暫不進行後續處理。',
  },
];

const vendorViewItems: Array<{ key: VendorView; label: string; icon: any }> = [
  { key: 'list', label: '廠商列表', icon: Briefcase },
  { key: 'purchases', label: '採購分析', icon: BarChart3 },
  { key: 'categories', label: '服務分類管理', icon: Tags },
  { key: 'regions', label: '服務區域管理', icon: MapPin },
  { key: 'stats', label: '合作記錄統計', icon: BarChart3 },
];

const vendorFormSteps: Array<{ key: VendorFormStep; label: string }> = [
  { key: 'basic', label: '基本資料' },
  { key: 'services', label: '服務項目與區域' },
  { key: 'contacts', label: '聯絡人與帳務' },
  { key: 'cooperation', label: '合作與備註' },
  { key: 'attachments', label: '附件檔案' },
];

const defaultBrandSeeds = ['DAIKIN 大金', '國際牌 Panasonic', '日立 HITACHI', '三菱電機 MITSUBISHI', '東元 TECO', '格力 GREE', '聲寶 SAMPO', '禾聯 HERAN'];

const emptyVendorForm = {
  name: '',
  vendorType: 'company' as Vendor['vendor_type'],
  taxId: '',
  alias: '',
  foundedDate: '',
  status: 'active' as VendorStatus,
  phone: '',
  fax: '',
  website: '',
  city: '',
  district: '',
  address: '',
  sameServiceAddress: true,
  serviceCity: '',
  serviceDistrict: '',
  serviceAddress: '',
  contactName: '',
  contactPhone: '',
  lineId: '',
  email: '',
  description: '',
  serviceCapabilityNote: '',
  cooperationNotes: '',
  tags: '',
  categoryIds: [] as string[],
  regionIds: [] as string[],
  brands: [] as string[],
  equipmentTypes: [] as string[],
  billingTitle: '',
  billingAddress: '',
  invoiceType: '二聯式',
  paymentTerms: '月結30天',
  paymentMethods: [] as string[],
  accountingNotes: '',
  cooperationStartDate: '',
  contractEndDate: '',
  contractRequired: true,
  preferredVendor: true,
};

const emptyCategoryForm = {
  parentId: '',
  name: '',
  code: '',
  description: '',
  iconKey: 'wrench',
  status: 'active' as VendorCategoryStatus,
  sortOrder: 10,
  commonItems: '',
};

const emptyRegionForm = {
  parentId: '',
  name: '',
  code: '',
  regionType: 'city' as VendorRegion['region_type'],
  description: '',
  status: 'active' as VendorRegionStatus,
  sortOrder: 10,
  includedLocations: '',
};

const getDateTimeLabel = (value: string | null | undefined) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const getDateInTaipei = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const formatPurchaseAmount = (value: number) => new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
}).format(value || 0);

const workOrderStoreLabel = (request: MaintenanceRequest) => {
  const store = request.store;
  return [store?.store_code, store?.store_name].filter(Boolean).join(' ') || '未指定門市';
};

const buildWorkOrderTransferUrl = (request: MaintenanceRequest) => {
  const params = new URLSearchParams();
  params.set('reason', `工單調撥：${request.title}`);
  params.set('notes', `來源工單：${request.id}｜${workOrderStoreLabel(request)}｜${request.location || '未填位置'}`);
  return `/general-affairs/inventory/transfers?${params.toString()}`;
};

const getDefaultReportStartDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

const getNormalizedStatus = (status: MaintenanceStatusValue | null | undefined): MaintenanceStatus =>
  normalizeMaintenanceStatus(status) || 'UNACCEPTED';

const getNormalizedStage = (stage: MaintenanceProgressStage | string | null | undefined) =>
  normalizeProgressStage(stage) || null;

const getWorkOrderFocusKey = (request: Pick<MaintenanceRequest, 'status' | 'progress_stage'>): WorkOrderFocusFilter => {
  const status = getNormalizedStatus(request.status);
  const stage = getNormalizedStage(request.progress_stage);

  if (status === 'COMPLETED') return 'completed';
  if (stage === 'REOPENED') return 'store_rejected';
  if (stage === 'WAITING_STORE_CONFIRMATION') return 'store_confirmation';
  if (['WAITING_PARTS', 'PARTS_IN_TRANSIT'].includes(stage || '')) return 'parts';
  if (['SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING'].includes(stage || '')) return 'vendor';
  return 'arrange';
};

export type GeneralAffairsServiceCenterInitialView = {
  section?: Extract<ServiceSection, 'maintenance' | 'work-orders' | 'part-requests' | 'vendors'>;
  maintenanceView?: MaintenanceView;
  resourceFilter?: ReportResourceFilter;
  vendorView?: VendorView;
};

type GeneralAffairsServiceCenterPageRouteProps = {
  initialView?: GeneralAffairsServiceCenterInitialView;
};

export default function GeneralAffairsServiceCenterPageRoute({ initialView }: GeneralAffairsServiceCenterPageRouteProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">載入總務服務中心...</div>}>
      <GeneralAffairsServiceCenterPage initialView={initialView} />
    </Suspense>
  );
}

function GeneralAffairsServiceCenterPage({ initialView }: GeneralAffairsServiceCenterPageRouteProps) {
  const router = useRouter();
  const routeSearchParams = useSearchParams();
  const routeSearchKey = routeSearchParams.toString();
  const supabase = createClient();
  const workOrderUpdatePanelRef = useRef<HTMLDivElement>(null);
  const autoPreparedWorkOrderIdRef = useRef<string | null>(null);
  const [activeSection, setActiveSection] = useState<ServiceSection>('home');
  const [maintenanceExpanded, setMaintenanceExpanded] = useState(false);
  const [maintenanceView, setMaintenanceView] = useState<MaintenanceView>('new');
  const [vendorExpanded, setVendorExpanded] = useState(false);
  const [vendorView, setVendorView] = useState<VendorView>('list');
  const [reportStep, setReportStep] = useState(1);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingReports, setLoadingReports] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  const [canAccessService, setCanAccessService] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canUpdateWorkOrders, setCanUpdateWorkOrders] = useState(false);
  const [canForceCloseWorkOrders, setCanForceCloseWorkOrders] = useState(false);
  const [canAccessInventory, setCanAccessInventory] = useState(false);
  const [canAccessInventoryLocations, setCanAccessInventoryLocations] = useState(false);
  const [canAccessEquipment, setCanAccessEquipment] = useState(false);
  const [canAccessFacilities, setCanAccessFacilities] = useState(false);
  const [canAccessParts, setCanAccessParts] = useState(false);
  const [canAccessVendors, setCanAccessVendors] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [reportStoreId, setReportStoreId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [updatesByRequestId, setUpdatesByRequestId] = useState<Map<string, MaintenanceUpdate[]>>(new Map());
  const [requestPhotosById, setRequestPhotosById] = useState<Map<string, MaintenancePhoto[]>>(new Map());
  const [photoLoadingIds, setPhotoLoadingIds] = useState<Set<string>>(new Set());
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | MaintenanceStatus>('all');
  const [reportResourceFilter, setReportResourceFilter] = useState<ReportResourceFilter>('all');
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(10);
  const [selectedReportDetailId, setSelectedReportDetailId] = useState<string | null>(null);
  const [progressStageOptions, setProgressStageOptions] = useState<Array<{ code: MaintenanceProgressStage; name: string }>>(
    Object.entries(MAINTENANCE_PROGRESS_STAGE_LABELS).map(([code, name]) => ({ code: code as MaintenanceProgressStage, name }))
  );
  const [reportStartDate, setReportStartDate] = useState(getDefaultReportStartDate);
  const [reportEndDate, setReportEndDate] = useState(getDateInTaipei);
  const [searchText, setSearchText] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [workOrderFocusFilter, setWorkOrderFocusFilter] = useState<WorkOrderFocusFilter>('all');
  const [savingWorkOrderUpdate, setSavingWorkOrderUpdate] = useState(false);
  const [workOrderUpdateNotice, setWorkOrderUpdateNotice] = useState<{
    type: 'success' | 'error';
    kind?: 'progress' | 'confirmation';
    title: string;
    body: string;
  } | null>(null);
  const [showAdvancedWorkOrderUpdate, setShowAdvancedWorkOrderUpdate] = useState(false);
  const [workOrderUpdateForm, setWorkOrderUpdateForm] = useState({
    action: 'SAVE_PROGRESS' as 'SAVE_PROGRESS' | 'REQUEST_COMPLETION' | 'FORCE_CLOSE',
    progressStage: 'INITIAL_REVIEW' as MaintenanceProgressStage,
    visibility: 'PUBLIC' as 'PUBLIC' | 'INTERNAL',
    progressDate: getDateInTaipei(),
    assigneeName: '',
    handlingMethod: '',
    notes: '',
    forceCloseReason: '',
  });
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorCategories, setVendorCategories] = useState<VendorCategory[]>([]);
  const [vendorRegions, setVendorRegions] = useState<VendorRegion[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorStatusFilter, setVendorStatusFilter] = useState<'all' | VendorStatus>('all');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState('');
  const [vendorRegionFilter, setVendorRegionFilter] = useState('');
  const [purchaseAnalysisMonth, setPurchaseAnalysisMonth] = useState(() => getDateInTaipei().slice(0, 7));
  const [purchaseAnalysis, setPurchaseAnalysis] = useState<PurchaseAnalysisSummary | null>(null);
  const [purchaseAnalysisLoading, setPurchaseAnalysisLoading] = useState(false);
  const [purchaseAnalysisError, setPurchaseAnalysisError] = useState('');
  const [isVendorFormOpen, setIsVendorFormOpen] = useState(false);
  const [isCategoryFormOpen, setIsCategoryFormOpen] = useState(false);
  const [isRegionFormOpen, setIsRegionFormOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [vendorFormStep, setVendorFormStep] = useState<VendorFormStep>('basic');
  const [vendorAttachmentNames, setVendorAttachmentNames] = useState<string[]>([]);
  const [expandedRegionIds, setExpandedRegionIds] = useState<string[]>([]);
  const [regionSearch, setRegionSearch] = useState('');
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [vendorTagInput, setVendorTagInput] = useState('');
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryCommonItemInput, setCategoryCommonItemInput] = useState('');
  const [regionForm, setRegionForm] = useState(emptyRegionForm);
  const [form, setForm] = useState({
    resourceType: 'equipment' as ResourceType,
    itemName: '',
    issueType: resourceTypes[0].issueTypes[0],
    description: '',
    contactName: '',
    contactPhone: '',
    note: '',
  });
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);

  const activeResource = resourceTypes.find((item) => item.key === form.resourceType) || resourceTypes[0];
  const selectedStore = stores.find((store) => store.id === reportStoreId) || null;
  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) || vendors[0] || null;
  const canAccessMaintenanceModule = canSubmit || canViewAll || canUpdateWorkOrders;
  const visibleServiceNavItems = useMemo(
    () => serviceNavItems.filter((item) => {
      if (item.key === 'maintenance' || item.key === 'work-orders') return canAccessMaintenanceModule;
      if (item.key === 'vendors') return canAccessVendors;
      return true;
    }),
    [canAccessMaintenanceModule, canAccessVendors]
  );

  const getCategoryName = (categoryId: string) =>
    vendorCategories.find((category) => category.id === categoryId)?.name || categoryId;

  const getRegionName = (regionId: string) =>
    vendorRegions.find((region) => region.id === regionId)?.name || regionId;

  const getRegionLabel = (regionId: string) => {
    const region = vendorRegions.find((item) => item.id === regionId);
    if (!region) return regionId;
    if (region.region_type !== 'district' || !region.parent_id) return region.name;
    const city = vendorRegions.find((item) => item.id === region.parent_id);
    return city ? `${city.name} ${region.name}` : region.name;
  };

  const regionChildrenMap = useMemo(() => {
    const map = new Map<string | null, VendorRegion[]>();
    vendorRegions.forEach((region) => {
      const key = region.parent_id || null;
      map.set(key, [...(map.get(key) || []), region]);
    });
    map.forEach((regions) => regions.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name, 'zh-TW')));
    return map;
  }, [vendorRegions]);

  const getRegionChildren = (parentId: string | null) => regionChildrenMap.get(parentId) || [];

  const getRegionDescendantIds = (regionId: string): string[] => {
    const children = getRegionChildren(regionId);
    return children.flatMap((child) => [child.id, ...getRegionDescendantIds(child.id)]);
  };

  const getRegionAncestorIds = (region: VendorRegion): string[] => {
    const result: string[] = [];
    let parentId = region.parent_id;
    while (parentId) {
      result.push(parentId);
      parentId = vendorRegions.find((item) => item.id === parentId)?.parent_id || null;
    }
    return result;
  };

  const selectedRegionLabels = useMemo(() => vendorForm.regionIds.map(getRegionLabel), [vendorForm.regionIds, vendorRegions]);

  const regionMatchesSearch = (region: VendorRegion, keyword: string): boolean => {
    if (!keyword) return true;
    const haystack = [region.name, region.code, region.description, ...(region.included_locations || [])].join(' ').toLowerCase();
    if (haystack.includes(keyword)) return true;
    return getRegionChildren(region.id).some((child) => regionMatchesSearch(child, keyword));
  };

  const toggleVendorRegionSelection = (region: VendorRegion) => {
    setVendorForm((current) => {
      const selected = current.regionIds.includes(region.id);
      const descendants = getRegionDescendantIds(region.id);
      const ancestors = getRegionAncestorIds(region);
      const nextIds = selected
        ? current.regionIds.filter((id) => id !== region.id)
        : [...current.regionIds.filter((id) => id !== region.id && !descendants.includes(id) && !ancestors.includes(id)), region.id];
      return { ...current, regionIds: nextIds };
    });
  };

  const removeVendorRegionSelection = (regionId: string) => {
    setVendorForm((current) => ({ ...current, regionIds: current.regionIds.filter((id) => id !== regionId) }));
  };

  const toggleExpandedRegion = (regionId: string) => {
    setExpandedRegionIds((current) => current.includes(regionId) ? current.filter((id) => id !== regionId) : [...current, regionId]);
  };

  const vendorStats = useMemo(() => {
    const active = vendors.filter((vendor) => vendor.status === 'active').length;
    const paused = vendors.filter((vendor) => vendor.status === 'paused').length;
    const inactive = vendors.filter((vendor) => vendor.status === 'inactive').length;
    const totalWorkOrders = vendors.reduce((sum, vendor) => sum + Number(vendor.work_order_count || 0), 0);
    const completedWorkOrders = Math.round(totalWorkOrders * 0.86);
    const totalAmount = vendors.reduce((sum, vendor) => sum + Number(vendor.total_amount || 0), 0);
    const ratedVendors = vendors.filter((vendor) => Number(vendor.rating || 0) > 0);
    const avgRating = ratedVendors.length
      ? ratedVendors.reduce((sum, vendor) => sum + Number(vendor.rating || 0), 0) / ratedVendors.length
      : 0;
    const avgDays = ratedVendors.length
      ? ratedVendors.reduce((sum, vendor) => sum + Number(vendor.avg_days || 0), 0) / ratedVendors.length
      : 0;

    return { active, paused, inactive, totalWorkOrders, completedWorkOrders, totalAmount, avgRating, avgDays };
  }, [vendors]);

  const categoryStats = useMemo(() => {
    const active = vendorCategories.filter((category) => category.status === 'active').length;
    const inactive = vendorCategories.filter((category) => category.status === 'inactive').length;
    const recent = vendorCategories.filter((category) => Number(category.sort_order || 0) <= 2).length;
    return { active, inactive, recent };
  }, [vendorCategories]);

  const regionStats = useMemo(() => {
    const active = vendorRegions.filter((region) => region.status === 'active').length;
    const inactive = vendorRegions.filter((region) => region.status === 'inactive').length;
    const archived = vendorRegions.filter((region) => region.status === 'archived').length;
    return { active, inactive, archived };
  }, [vendorRegions]);

  const filteredVendors = useMemo(() => {
    const keyword = vendorSearch.trim().toLowerCase();
    return vendors.filter((vendor) => {
      if (vendorStatusFilter !== 'all' && vendor.status !== vendorStatusFilter) return false;
      if (vendorCategoryFilter && !(vendor.service_category_ids || []).includes(vendorCategoryFilter)) return false;
      if (vendorRegionFilter && !(vendor.service_region_ids || []).includes(vendorRegionFilter)) return false;
      if (!keyword) return true;
      return [
        vendor.name,
        vendor.alias,
        vendor.contact_name,
        vendor.contact_phone,
        vendor.phone,
        vendor.email,
        ...(vendor.tags || []),
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [vendorCategoryFilter, vendorRegionFilter, vendorSearch, vendorStatusFilter, vendors]);

  const toggleVendorFormArray = (key: 'categoryIds' | 'regionIds' | 'brands' | 'equipmentTypes', value: string) => {
    setVendorForm((current) => {
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  const toggleVendorPaymentMethod = (value: string) => {
    setVendorForm((current) => ({
      ...current,
      paymentMethods: current.paymentMethods.includes(value)
        ? current.paymentMethods.filter((item) => item !== value)
        : [...current.paymentMethods, value],
    }));
  };

  const getVendorTags = () =>
    vendorForm.tags.split(',').map((item) => item.trim()).filter(Boolean);

  const addVendorTag = () => {
    const nextTag = vendorTagInput.trim();
    if (!nextTag) return;
    const currentTags = getVendorTags();
    if (currentTags.includes(nextTag)) {
      setVendorTagInput('');
      return;
    }
    setVendorForm((current) => ({
      ...current,
      tags: [...currentTags, nextTag].join(','),
    }));
    setVendorTagInput('');
  };

  const removeVendorTag = (target: string) => {
    setVendorForm((current) => ({
      ...current,
      tags: current.tags.split(',').map((item) => item.trim()).filter((item) => item && item !== target).join(','),
    }));
  };

  const openVendorForm = () => {
    setVendorForm(emptyVendorForm);
    setVendorTagInput('');
    setVendorFormStep('basic');
    setVendorAttachmentNames([]);
    setIsVendorFormOpen(true);
  };

  const closeVendorForm = () => {
    setVendorForm(emptyVendorForm);
    setVendorTagInput('');
    setVendorFormStep('basic');
    setVendorAttachmentNames([]);
    setIsVendorFormOpen(false);
  };

  const goNextVendorFormStep = () => {
    const currentIndex = vendorFormSteps.findIndex((step) => step.key === vendorFormStep);
    const nextStep = vendorFormSteps[currentIndex + 1];
    if (nextStep) setVendorFormStep(nextStep.key);
  };

  const goPreviousVendorFormStep = () => {
    const currentIndex = vendorFormSteps.findIndex((step) => step.key === vendorFormStep);
    const previousStep = vendorFormSteps[currentIndex - 1];
    if (previousStep) setVendorFormStep(previousStep.key);
  };

  const openNewCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryCommonItemInput('');
    setIsCategoryFormOpen(true);
  };

  const openEditCategoryForm = (category: VendorCategory) => {
    setEditingCategoryId(category.id);
    setCategoryForm({
      parentId: category.parent_id || '',
      name: category.name || '',
      code: category.code || '',
      description: category.description || '',
      iconKey: category.icon_key || 'wrench',
      status: category.status || 'active',
      sortOrder: Number(category.sort_order || 10),
      commonItems: (category.common_items || []).join(','),
    });
    setCategoryCommonItemInput('');
    setIsCategoryFormOpen(true);
  };

  const closeCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryCommonItemInput('');
    setIsCategoryFormOpen(false);
  };

  const getCategoryCommonItems = () =>
    categoryForm.commonItems.split(',').map((item) => item.trim()).filter(Boolean);

  const addCategoryCommonItem = () => {
    const nextItem = categoryCommonItemInput.trim();
    if (!nextItem) return;
    const currentItems = getCategoryCommonItems();
    if (currentItems.includes(nextItem)) {
      setCategoryCommonItemInput('');
      return;
    }
    setCategoryForm((current) => ({
      ...current,
      commonItems: [...currentItems, nextItem].join(','),
    }));
    setCategoryCommonItemInput('');
  };

  const removeCategoryCommonItem = (target: string) => {
    setCategoryForm((current) => ({
      ...current,
      commonItems: current.commonItems.split(',').map((item) => item.trim()).filter((item) => item && item !== target).join(','),
    }));
  };

  const updateReportStartDate = (value: string) => {
    setReportStartDate(value);
    if (value && reportEndDate && value > reportEndDate) {
      setReportEndDate(value);
    }
  };

  const updateReportEndDate = (value: string) => {
    setReportEndDate(value);
    if (value && reportStartDate && value < reportStartDate) {
      setReportStartDate(value);
    }
  };

  const scopedReportRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return requests.filter((request) => {
      if (reportResourceFilter !== 'all' && request.resource_type !== reportResourceFilter) return false;
      if (!keyword) return true;
      return [
        `WO-${request.id.slice(0, 8).toUpperCase()}`,
        request.title,
        request.description,
        request.issue_type,
        request.contact_name,
        request.reporter_name,
        request.store?.store_code,
        request.store?.store_name,
        resourceTypes.find((resource) => resource.key === request.resource_type)?.label,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [requests, reportResourceFilter, searchText]);

  const statusCounts = useMemo(() => {
    return scopedReportRows.reduce((acc, row) => {
      const status = getNormalizedStatus(row.status);
      acc.all += 1;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { all: 0, UNACCEPTED: 0, ACCEPTED: 0, PROCESSING: 0, COMPLETED: 0 } as Record<'all' | MaintenanceStatus, number>);
  }, [scopedReportRows]);

  const workOrderScopedRows = useMemo(() => {
    return scopedReportRows.filter((request) => getNormalizedStatus(request.status) !== 'UNACCEPTED');
  }, [scopedReportRows]);

  const workOrderStatusCounts = useMemo(() => {
    return workOrderScopedRows.reduce((acc, row) => {
      const status = getNormalizedStatus(row.status);
      acc.all += 1;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { all: 0, UNACCEPTED: 0, ACCEPTED: 0, PROCESSING: 0, COMPLETED: 0 } as Record<'all' | MaintenanceStatus, number>);
  }, [workOrderScopedRows]);

  const workOrderFocusCounts = useMemo(() => {
    return workOrderScopedRows.reduce((acc, row) => {
      const focus = getWorkOrderFocusKey(row);
      acc.all += 1;
      acc[focus] = (acc[focus] || 0) + 1;
      return acc;
    }, {
      all: 0,
      store_rejected: 0,
      arrange: 0,
      vendor: 0,
      parts: 0,
      store_confirmation: 0,
      completed: 0,
    } as Record<WorkOrderFocusFilter, number>);
  }, [workOrderScopedRows]);

  const filteredRequests = useMemo(() => {
    const sourceRows = activeSection === 'work-orders' ? workOrderScopedRows : scopedReportRows;
    return sourceRows.filter((request) => {
      const normalizedStatus = getNormalizedStatus(request.status);
      const effectiveStatusFilter = activeSection === 'work-orders' && statusFilter === 'UNACCEPTED' ? 'all' : statusFilter;
      if (effectiveStatusFilter !== 'all' && normalizedStatus !== effectiveStatusFilter) return false;
      if (activeSection === 'work-orders' && workOrderFocusFilter !== 'all' && getWorkOrderFocusKey(request) !== workOrderFocusFilter) return false;
      return true;
    });
  }, [activeSection, scopedReportRows, statusFilter, workOrderFocusFilter, workOrderScopedRows]);

  const reportTotalPages = Math.max(1, Math.ceil(filteredRequests.length / reportPageSize));
  const pagedReportRows = useMemo(() => {
    const safePage = Math.min(Math.max(reportPage, 1), reportTotalPages);
    const start = (safePage - 1) * reportPageSize;
    return filteredRequests.slice(start, start + reportPageSize);
  }, [filteredRequests, reportPage, reportPageSize, reportTotalPages]);

  const checkPermission = async (permissionCode: string) => {
    const res = await fetch('/api/permissions/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionCode }),
    });
    const json = await res.json();
    return Boolean(json.allowed);
  };

  const checkServiceAccess = async () => {
    const res = await fetch('/api/general-affairs/access', { cache: 'no-store' });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.allowed);
  };

  const loadVendorManagementData = useCallback(async () => {
    setLoadingVendors(true);
    try {
      const [vendorRes, categoryRes, regionRes] = await Promise.all([
        supabase.from('ga_vendors').select('*').order('created_at', { ascending: false }),
        supabase.from('ga_service_categories').select('*').order('sort_order').order('name'),
        supabase.from('ga_service_regions').select('*').order('sort_order').order('name'),
      ]);

      if (vendorRes.error) throw vendorRes.error;
      if (categoryRes.error) throw categoryRes.error;
      if (regionRes.error) throw regionRes.error;

      const nextVendors = (vendorRes.data || []) as Vendor[];
      setVendors(nextVendors);
      setVendorCategories((categoryRes.data || []) as VendorCategory[]);
      setVendorRegions((regionRes.data || []) as VendorRegion[]);
      setSelectedVendorId((current) => current || nextVendors[0]?.id || null);
    } catch (error) {
      console.warn('Vendor management module is unavailable in the current DEV schema.', error);
      alert(MODULE_NOT_AVAILABLE_MESSAGE);
    } finally {
      setLoadingVendors(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPurchaseAnalysis = useCallback(async () => {
    setPurchaseAnalysisLoading(true);
    setPurchaseAnalysisError('');
    try {
      const response = await fetch(`/api/general-affairs/purchase-reviews/cost-summary?yearMonth=${encodeURIComponent(purchaseAnalysisMonth)}`, {
        cache: 'no-store',
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.success === false) {
        throw new Error(String(json?.error || '採購分析載入失敗'));
      }
      setPurchaseAnalysis(json.data as PurchaseAnalysisSummary);
    } catch (error) {
      setPurchaseAnalysis(null);
      setPurchaseAnalysisError(error instanceof Error ? error.message : '採購分析載入失敗');
    } finally {
      setPurchaseAnalysisLoading(false);
    }
  }, [purchaseAnalysisMonth]);

  useEffect(() => {
    if (activeSection !== 'vendors' || vendorView !== 'purchases' || purchaseAnalysis || purchaseAnalysisLoading || purchaseAnalysisError) return;
    void loadPurchaseAnalysis();
  }, [activeSection, loadPurchaseAnalysis, purchaseAnalysis, purchaseAnalysisError, purchaseAnalysisLoading, vendorView]);

  const saveVendor = async () => {
    if (!vendorForm.name.trim()) {
      alert('請輸入廠商名稱');
      return;
    }
    setSavingVendor(true);
    try {
      const tags = vendorForm.tags.split(',').map((item) => item.trim()).filter(Boolean);
      const payload = {
        name: vendorForm.name.trim(),
        vendor_type: vendorForm.vendorType,
        tax_id: vendorForm.taxId.trim() || null,
        alias: vendorForm.alias.trim() || null,
        founded_date: vendorForm.foundedDate || null,
        status: vendorForm.status,
        phone: vendorForm.phone.trim() || null,
        fax: vendorForm.fax.trim() || null,
        website: vendorForm.website.trim() || null,
        city: vendorForm.city.trim() || null,
        district: vendorForm.district.trim() || null,
        address: vendorForm.address.trim() || null,
        service_city: (vendorForm.sameServiceAddress ? vendorForm.city : vendorForm.serviceCity).trim() || null,
        service_district: (vendorForm.sameServiceAddress ? vendorForm.district : vendorForm.serviceDistrict).trim() || null,
        service_address: (vendorForm.sameServiceAddress ? vendorForm.address : vendorForm.serviceAddress).trim() || null,
        same_service_address: vendorForm.sameServiceAddress,
        contact_name: vendorForm.contactName.trim() || null,
        contact_phone: vendorForm.contactPhone.trim() || null,
        line_id: vendorForm.lineId.trim() || null,
        email: vendorForm.email.trim() || null,
        description: vendorForm.description.trim() || null,
        service_capability_note: vendorForm.serviceCapabilityNote.trim() || null,
        billing_title: vendorForm.billingTitle.trim() || null,
        billing_address: vendorForm.billingAddress.trim() || null,
        invoice_type: vendorForm.invoiceType || null,
        payment_terms: vendorForm.paymentTerms || null,
        payment_methods: vendorForm.paymentMethods,
        accounting_notes: vendorForm.accountingNotes.trim() || null,
        cooperation_start_date: vendorForm.cooperationStartDate || null,
        contract_end_date: vendorForm.contractEndDate || null,
        contract_required: vendorForm.contractRequired,
        preferred_vendor: vendorForm.preferredVendor,
        cooperation_notes: vendorForm.cooperationNotes.trim() || null,
        attachment_names: vendorAttachmentNames,
        tags,
        brands: vendorForm.brands,
        equipment_types: vendorForm.equipmentTypes,
        service_category_ids: vendorForm.categoryIds,
        service_region_ids: vendorForm.regionIds,
        rating: 0,
        review_count: 0,
        work_order_count: 0,
        monthly_order_count: 0,
      };

      const { error } = await supabase.from('ga_vendors').insert(payload);
      if (error) throw error;
      closeVendorForm();
      await loadVendorManagementData();
    } catch (error) {
      console.warn('Vendor save is unavailable in the current DEV schema.', error);
      alert(MODULE_NOT_AVAILABLE_MESSAGE);
    } finally {
      setSavingVendor(false);
    }
  };

  const saveVendorCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.code.trim()) {
      alert('請輸入分類名稱與分類代碼');
      return;
    }
    setSavingCategory(true);
    try {
      const commonItems = categoryForm.commonItems.split(',').map((item) => item.trim()).filter(Boolean);
      const payload = {
        name: categoryForm.name.trim(),
        code: categoryForm.code.trim().toUpperCase(),
        parent_id: categoryForm.parentId || null,
        description: categoryForm.description.trim() || null,
        icon_key: categoryForm.iconKey,
        status: categoryForm.status,
        sort_order: Number(categoryForm.sortOrder || 10),
        common_items: commonItems,
      };
      const { error } = editingCategoryId
        ? await supabase.from('ga_service_categories').update(payload).eq('id', editingCategoryId)
        : await supabase.from('ga_service_categories').insert(payload);
      if (error) throw error;
      closeCategoryForm();
      await loadVendorManagementData();
    } catch (error) {
      console.warn('Vendor category save is unavailable in the current DEV schema.', error);
      alert(MODULE_NOT_AVAILABLE_MESSAGE);
    } finally {
      setSavingCategory(false);
    }
  };

  const saveVendorRegion = async () => {
    if (!regionForm.name.trim() || !regionForm.code.trim()) {
      alert('請輸入區域名稱與區域代碼');
      return;
    }
    setSavingRegion(true);
    try {
      const includedLocations = regionForm.includedLocations.split(',').map((item) => item.trim()).filter(Boolean);
      const { error } = await supabase.from('ga_service_regions').insert({
        name: regionForm.name.trim(),
        code: regionForm.code.trim().toUpperCase(),
        parent_id: regionForm.parentId || null,
        region_type: regionForm.regionType,
        description: regionForm.description.trim() || null,
        status: regionForm.status,
        sort_order: Number(regionForm.sortOrder || 10),
        included_locations: includedLocations,
      });
      if (error) throw error;
      setRegionForm(emptyRegionForm);
      setIsRegionFormOpen(false);
      await loadVendorManagementData();
    } catch (error) {
      console.warn('Vendor region save is unavailable in the current DEV schema.', error);
      alert(MODULE_NOT_AVAILABLE_MESSAGE);
    } finally {
      setSavingRegion(false);
    }
  };

  const loadReports = useCallback(async () => {
    if (!selectedStoreId && !canViewAll) return;
    setLoadingReports(true);
    setMaintenanceError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (selectedStoreId) params.set('store_id', selectedStoreId);
      if (activeSection !== 'work-orders') {
        if (reportStartDate) params.set('start_date', reportStartDate);
        if (reportEndDate) params.set('end_date', reportEndDate);
      }
      params.set('source', 'general_affairs');
      const res = await fetch(`/api/maintenance-requests?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '載入維修回報失敗');
      }
      const rows = (json.data || []) as MaintenanceRequest[];
      setRequests(rows);

      const updatePairs = await Promise.all(rows.slice(0, 30).map(async (request) => {
        const updateRes = await fetch(`/api/maintenance-updates?request_id=${request.id}`);
        const updateJson = await updateRes.json();
        return [request.id, updateJson.success ? updateJson.data || [] : []] as const;
      }));
      setUpdatesByRequestId(new Map(updatePairs));
    } catch (error: any) {
      setMaintenanceError(error.message || '載入維修回報失敗');
      setRequests([]);
      setUpdatesByRequestId(new Map());
    } finally {
      setLoadingReports(false);
    }
  }, [activeSection, canViewAll, reportEndDate, reportStartDate, selectedStoreId]);

  const loadRequestPhotos = useCallback(async (requestId: string, serviceRequestId?: string | null) => {
    if (!requestId) return;
    setPhotoLoadingIds((current) => new Set(current).add(requestId));
    try {
      const [maintenanceResult, serviceRequestAttachmentResult, serviceRequestDetailResult] = await Promise.all([
        fetch(`/api/maintenance-photos?request_id=${requestId}`)
          .then(async (res) => ({ res, json: await res.json().catch(() => ({})) })),
        serviceRequestId
          ? fetch(`/api/general-affairs/attachments?resourceType=SERVICE_REQUEST&resourceId=${serviceRequestId}`)
            .then(async (res) => ({ res, json: await res.json().catch(() => ({})) }))
          : Promise.resolve(null),
        serviceRequestId
          ? fetch(`/api/general-affairs/requests/${serviceRequestId}`)
            .then(async (res) => ({ res, json: await res.json().catch(() => ({})) }))
          : Promise.resolve(null),
      ]);

      const maintenancePhotos: MaintenancePhoto[] =
        maintenanceResult.res.ok && maintenanceResult.json.success ? maintenanceResult.json.data || [] : [];
      const serviceRequestPhotos: MaintenancePhoto[] =
        serviceRequestAttachmentResult?.res.ok && serviceRequestAttachmentResult.json.success
          ? (serviceRequestAttachmentResult.json.data || []).map((attachment: any) => ({
            id: `service-request-${attachment.id}`,
            request_id: requestId,
            storage_path: attachment.storage_path,
            signed_url: attachment.signed_url || null,
            file_name: attachment.file_name || '門市附件',
            content_type: attachment.content_type || null,
            source_label: '門市需求附件',
            photo_type: 'other',
            created_at: attachment.uploaded_at || attachment.created_at || '',
          }))
          : [];
      const serviceRequestCommentPhotos: MaintenancePhoto[] =
        serviceRequestDetailResult?.res.ok && serviceRequestDetailResult.json.success
          ? (serviceRequestDetailResult.json.comments || []).flatMap((comment: any) =>
            (comment.attachments || []).map((attachment: any) => ({
              id: `service-request-comment-${attachment.id}`,
              request_id: requestId,
              storage_path: attachment.storage_path,
              signed_url: attachment.signed_url || null,
              file_name: attachment.file_name || '留言附件',
              content_type: attachment.content_type || null,
              source_label: '留言附件',
              photo_type: 'other',
              created_at: attachment.uploaded_at || attachment.created_at || comment.created_at || '',
            })),
          )
          : [];

      setRequestPhotosById((current) => {
        const next = new Map(current);
        next.set(requestId, [...serviceRequestPhotos, ...serviceRequestCommentPhotos, ...maintenancePhotos]);
        return next;
      });
    } catch (error) {
      console.warn('載入維修附件失敗', error);
    } finally {
      setPhotoLoadingIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }, []);

  const openLightbox = (urls: string[], index: number) => {
    setLightboxPhotos(urls);
    setLightboxIndex(index);
  };

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setLightboxPhotos([]);
  }, []);

  const prevLightbox = useCallback(() => {
    setLightboxIndex((current) => (
      current !== null && lightboxPhotos.length > 0
        ? (current - 1 + lightboxPhotos.length) % lightboxPhotos.length
        : current
    ));
  }, [lightboxPhotos.length]);

  const nextLightbox = useCallback(() => {
    setLightboxIndex((current) => (
      current !== null && lightboxPhotos.length > 0
        ? (current + 1) % lightboxPhotos.length
        : current
    ));
  }, [lightboxPhotos.length]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextLightbox();
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') prevLightbox();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeLightbox, lightboxIndex, nextLightbox, prevLightbox]);

  const loadProgressStages = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance-progress-stages');
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        const rows = json.data
          .map((row: any) => {
            const code = normalizeProgressStage(row.code);
            return code ? { code, name: String(row.name || MAINTENANCE_PROGRESS_STAGE_LABELS[code]) } : null;
          })
          .filter(Boolean) as Array<{ code: MaintenanceProgressStage; name: string }>;
        if (rows.length > 0) setProgressStageOptions(rows);
      }
    } catch (error) {
      console.warn('載入維修進度階段失敗，使用預設選項', error);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingInitial(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [
          accessAllowed,
          submitAllowed,
          viewAllAllowed,
          updateAllowed,
          forceCloseAllowed,
          inventoryBalanceViewAllowed,
          inventoryTransactionViewAllowed,
          inventoryTransactionManageAllowed,
          inventoryLocationViewAllowed,
          inventoryLocationManageAllowed,
          equipmentViewAllowed,
          equipmentManageAllowed,
          facilityViewAllowed,
          facilityManageAllowed,
          partViewAllowed,
          partManageAllowed,
          vendorViewAllowed,
          vendorManageAllowed,
          serviceCategoryViewAllowed,
          serviceCategoryManageAllowed,
          serviceRegionViewAllowed,
          serviceRegionManageAllowed,
          cooperationRecordViewAllowed,
          profileRes,
        ] = await Promise.all([
          checkServiceAccess(),
          checkPermission(GA_MAINTENANCE_REQUEST_CREATE),
          checkPermission(GA_MAINTENANCE_REQUEST_VIEW_ALL),
          checkPermission(GA_MAINTENANCE_REQUEST_UPDATE),
          checkPermission('general_affairs.service_center.force_close'),
          checkPermission('general_affairs.inventory_balance.view'),
          checkPermission('general_affairs.inventory_transaction.view'),
          checkPermission('general_affairs.inventory_transaction.manage'),
          checkPermission('general_affairs.inventory_location.view'),
          checkPermission('general_affairs.inventory_location.manage'),
          checkPermission('general_affairs.equipment.view'),
          checkPermission('general_affairs.equipment.manage'),
          checkPermission('general_affairs.facility.view'),
          checkPermission('general_affairs.facility.manage'),
          checkPermission('general_affairs.part.view'),
          checkPermission('general_affairs.part.manage'),
          checkPermission('general_affairs.vendor.view'),
          checkPermission('general_affairs.vendor.manage'),
          checkPermission('general_affairs.service_category.view'),
          checkPermission('general_affairs.service_category.manage'),
          checkPermission('general_affairs.service_region.view'),
          checkPermission('general_affairs.service_region.manage'),
          checkPermission('general_affairs.cooperation_record.view'),
          supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        ]);

        const name = profileRes.data?.full_name || user.email || '';
        setProfileName(name);
        setForm((current) => ({ ...current, contactName: current.contactName || name }));
        setCanAccessService(accessAllowed);
        setCanSubmit(submitAllowed || viewAllAllowed);
        setCanViewAll(viewAllAllowed);
        setCanUpdateWorkOrders(updateAllowed || viewAllAllowed);
        setCanForceCloseWorkOrders(forceCloseAllowed);
        setCanAccessInventory(
          inventoryBalanceViewAllowed ||
          inventoryTransactionViewAllowed ||
          inventoryTransactionManageAllowed
        );
        setCanAccessInventoryLocations(inventoryLocationViewAllowed || inventoryLocationManageAllowed);
        setCanAccessEquipment(equipmentViewAllowed || equipmentManageAllowed);
        setCanAccessFacilities(facilityViewAllowed || facilityManageAllowed);
        setCanAccessParts(partViewAllowed || partManageAllowed);
        setCanAccessVendors(
          vendorViewAllowed ||
          vendorManageAllowed ||
          serviceCategoryViewAllowed ||
          serviceCategoryManageAllowed ||
          serviceRegionViewAllowed ||
          serviceRegionManageAllowed ||
          cooperationRecordViewAllowed
        );

        if (viewAllAllowed) {
          const { data } = await supabase
            .from('stores')
            .select('id, store_code, store_name')
            .eq('is_active', true)
            .order('store_code');
          const allStores = (data || []) as StoreOption[];
          setStores(allStores);
          setSelectedStoreId('');
          setReportStoreId(allStores[0]?.id || '');
        } else {
          const res = await fetch('/api/user/managed-stores');
          const json = await res.json();
          const managedStores = (json.stores || []) as StoreOption[];
          setStores(managedStores);
          setSelectedStoreId(managedStores[0]?.id || '');
          setReportStoreId(managedStores[0]?.id || '');
        }
      } finally {
        setLoadingInitial(false);
      }
    })();

    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingInitial && (activeSection === 'maintenance' || activeSection === 'work-orders' || activeSection === 'part-requests')) {
      loadReports();
    }
  }, [activeSection, loadingInitial, maintenanceView, loadReports]);

  useEffect(() => {
    setReportPage(1);
  }, [reportResourceFilter, reportStartDate, reportEndDate, searchText, selectedStoreId, statusFilter, workOrderFocusFilter]);

  useEffect(() => {
    if (activeSection === 'work-orders' && statusFilter === 'UNACCEPTED') {
      setStatusFilter('all');
    }
  }, [activeSection, statusFilter]);

  useEffect(() => {
    if (loadingInitial) return;
    if (initialView?.section) {
      if (initialView.section === 'maintenance' && canAccessMaintenanceModule) {
        setActiveSection('maintenance');
        setMaintenanceExpanded(true);
        setMaintenanceView(initialView.maintenanceView === 'mine' || !canSubmit ? 'mine' : 'new');
        setReportResourceFilter(initialView.resourceFilter || 'all');
        return;
      }

      if (initialView.section === 'work-orders' && canAccessMaintenanceModule) {
        const searchParams = new URLSearchParams(routeSearchKey);
        const workOrderId = searchParams.get('workOrderId');
        setActiveSection('work-orders');
        setMaintenanceExpanded(true);
        if (workOrderId) {
          setSelectedWorkOrderId(workOrderId);
          setStatusFilter('all');
        }
        return;
      }

      if (initialView.section === 'part-requests' && canAccessMaintenanceModule) {
        const wantsNewPartRequest = initialView.maintenanceView === 'new' && canSubmit;
        setActiveSection('part-requests');
        setMaintenanceExpanded(true);
        setMaintenanceView(wantsNewPartRequest ? 'new' : 'mine');
        setReportResourceFilter('material');
        if (wantsNewPartRequest) {
          const materialResource = resourceTypes.find((item) => item.key === 'material') || resourceTypes[0];
          setForm((current) => ({
            ...current,
            resourceType: 'material',
            issueType: materialResource.issueTypes[0],
          }));
        }
        return;
      }

      if (initialView.section === 'vendors' && canAccessVendors) {
        setActiveSection('vendors');
        setVendorExpanded(true);
        if (initialView.vendorView && vendorViewItems.some((item) => item.key === initialView.vendorView)) {
          setVendorView(initialView.vendorView);
        }
        return;
      }
    }

    const searchParams = new URLSearchParams(routeSearchKey);
    const section = searchParams.get('section');
    const action = searchParams.get('action');
    const view = searchParams.get('view') as MaintenanceView | null;
    const tab = searchParams.get('tab') as VendorView | null;
    const workOrderId = searchParams.get('workOrderId');
    if ((section === 'maintenance' || section === 'work-orders') && canAccessMaintenanceModule) {
      setActiveSection(section);
      setMaintenanceExpanded(true);
      if (section === 'work-orders' && workOrderId) {
        setSelectedWorkOrderId(workOrderId);
        setStatusFilter('all');
      }
      if (section === 'maintenance') {
        setMaintenanceView(view === 'mine' || !canSubmit ? 'mine' : 'new');
      }
      return;
    }
    if (section === 'part-requests') {
      if (canAccessMaintenanceModule) {
        setActiveSection('part-requests');
        setMaintenanceExpanded(true);
        const wantsNewPartRequest = view === 'new' && canSubmit;
        setMaintenanceView(wantsNewPartRequest ? 'new' : 'mine');
        setReportResourceFilter('material');
        if (wantsNewPartRequest) {
          const materialResource = resourceTypes.find((item) => item.key === 'material') || resourceTypes[0];
          setForm((current) => ({
            ...current,
            resourceType: 'material',
            issueType: materialResource.issueTypes[0],
          }));
        }
      }
      return;
    }
    if (section === 'vendors' && canAccessVendors) {
      setActiveSection('vendors');
      setVendorExpanded(true);
      if (tab && vendorViewItems.some((item) => item.key === tab)) {
        setVendorView(tab);
      }
    }
  }, [canAccessMaintenanceModule, canAccessVendors, canSubmit, initialView, loadingInitial, routeSearchKey]);

  useEffect(() => {
    if (!loadingInitial && activeSection === 'vendors' && canAccessService) {
      loadVendorManagementData();
    }
  }, [activeSection, canAccessService, loadingInitial, loadVendorManagementData]);

  useEffect(() => {
    if (activeSection !== 'work-orders') return;
    const targetRequest = selectedWorkOrderId
      ? filteredRequests.find((request) => request.id === selectedWorkOrderId)
      : filteredRequests[0];
    if (!targetRequest || requestPhotosById.has(targetRequest.id) || photoLoadingIds.has(targetRequest.id)) return;
    void loadRequestPhotos(targetRequest.id, targetRequest.ga_service_request_id);
  }, [activeSection, filteredRequests, loadRequestPhotos, photoLoadingIds, requestPhotosById, selectedWorkOrderId]);

  useEffect(() => {
    if (activeSection !== 'work-orders' || loadingReports) return;
    filteredRequests.slice(0, 8).forEach((request) => {
      if (requestPhotosById.has(request.id) || photoLoadingIds.has(request.id)) return;
      void loadRequestPhotos(request.id, request.ga_service_request_id);
    });
  }, [activeSection, filteredRequests, loadRequestPhotos, loadingReports, photoLoadingIds, requestPhotosById]);

  const setResourceType = (resourceType: ResourceType) => {
    const nextResource = resourceTypes.find((item) => item.key === resourceType) || resourceTypes[0];
    setForm((current) => ({
      ...current,
      resourceType,
      issueType: nextResource.issueTypes[0],
    }));
  };

  const isSupportedReportPhoto = (file: File) => {
    const lowerName = file.name.toLowerCase();
    return file.type.startsWith('image/') || lowerName.endsWith('.heic') || lowerName.endsWith('.heif');
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const validFiles = selectedFiles.filter(isSupportedReportPhoto);

    if (selectedFiles.length > 0 && validFiles.length === 0) {
      alert('請選擇 JPG、PNG、HEIC 或其他圖片檔案');
      return;
    }

    setPhotos((current) => {
      const next = [...current];
      validFiles.forEach((file) => {
        if (next.length >= 5) return;
        next.push({ file, preview: URL.createObjectURL(file) });
      });
      return next;
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((_, idx) => idx !== index);
    });
  };

  const canGoNext = () => {
    if (reportStep === 1) {
      return Boolean(reportStoreId && form.resourceType && form.itemName.trim() && form.issueType && form.contactName.trim() && form.contactPhone.trim());
    }
    if (reportStep === 2) return Boolean(form.description.trim());
    return true;
  };

  const resetForm = (defaultResourceType: ResourceType = 'equipment') => {
    const defaultResource = resourceTypes.find((item) => item.key === defaultResourceType) || resourceTypes[0];
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setReportStep(1);
    setForm({
      resourceType: defaultResource.key,
      itemName: '',
      issueType: defaultResource.issueTypes[0],
      description: '',
      contactName: profileName,
      contactPhone: '',
      note: '',
    });
  };

  const submitWorkOrderUpdate = async (requestId: string) => {
    if (!canUpdateWorkOrders) {
      alert('沒有更新工單進度權限');
      return;
    }
    if (!workOrderUpdateForm.notes.trim()) {
      alert('請填寫處理內容');
      return;
    }
    if (workOrderUpdateForm.action === 'FORCE_CLOSE' && !workOrderUpdateForm.forceCloseReason.trim()) {
      alert('請填寫駁回或不處理原因');
      return;
    }

    setSavingWorkOrderUpdate(true);
    setWorkOrderUpdateNotice(null);
    const submittedAction = workOrderUpdateForm.action;
    try {
      const res = await fetch('/api/maintenance-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          action: workOrderUpdateForm.action,
          progress_stage: workOrderUpdateForm.action === 'REQUEST_COMPLETION'
            ? 'WAITING_STORE_CONFIRMATION'
            : workOrderUpdateForm.progressStage,
          visibility: workOrderUpdateForm.action === 'REQUEST_COMPLETION' ? 'PUBLIC' : workOrderUpdateForm.visibility,
          notes: workOrderUpdateForm.notes.trim(),
          progress_date: workOrderUpdateForm.progressDate,
          assignee_name: workOrderUpdateForm.assigneeName.trim() || undefined,
          handling_method: workOrderUpdateForm.handlingMethod.trim() || undefined,
          force_close_reason: workOrderUpdateForm.forceCloseReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '更新工單進度失敗');
      }
      setWorkOrderUpdateForm({
        action: 'SAVE_PROGRESS',
        progressStage: 'INITIAL_REVIEW',
        visibility: 'PUBLIC',
        progressDate: getDateInTaipei(),
        assigneeName: '',
        handlingMethod: '',
        notes: '',
        forceCloseReason: '',
      });
      setShowAdvancedWorkOrderUpdate(false);
      await loadReports();
      setWorkOrderUpdateNotice(submittedAction === 'REQUEST_COMPLETION'
        ? {
            type: 'success',
            kind: 'confirmation',
            title: '已送門市確認',
            body: '這張工單已交給店長確認，店長會在我的追蹤 / 待確認中心看到。',
          }
        : {
            type: 'success',
            kind: 'progress',
            title: '處理進度已儲存',
            body: '這張工單仍在處理中，後續可再更新進度或送門市確認。',
          });
    } catch (error: any) {
      setWorkOrderUpdateNotice({
        type: 'error',
        title: '工單更新失敗',
        body: String(error.message || error || '請稍後再試'),
      });
    } finally {
      setSavingWorkOrderUpdate(false);
    }
  };

  const submitStoreCompletionResponse = async (requestId: string, action: 'STORE_CONFIRM_COMPLETE' | 'REPORT_UNRESOLVED') => {
    const notes = action === 'STORE_CONFIRM_COMPLETE'
      ? '門市確認處理完成'
      : window.prompt('請填寫仍有問題的原因');
    if (!notes?.trim()) return;

    setSavingWorkOrderUpdate(true);
    try {
      const res = await fetch('/api/maintenance-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          action,
          notes: notes.trim(),
          progress_date: getDateInTaipei(),
          visibility: 'PUBLIC',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '更新確認結果失敗');
      }
      await loadReports();
      alert(action === 'STORE_CONFIRM_COMPLETE' ? '已確認完成' : '已送出仍有問題');
    } catch (error: any) {
      alert(`送出失敗：${error.message || error}`);
    } finally {
      setSavingWorkOrderUpdate(false);
    }
  };

  const submitReport = async () => {
    if (!canSubmit) {
      alert('沒有新增維修回報權限');
      return;
    }
    if (!reportStoreId || !form.itemName.trim() || !form.description.trim() || !form.contactName.trim() || !form.contactPhone.trim()) {
      alert('請完成必要欄位');
      return;
    }

    setSubmitting(true);
    try {
      const description = [
        form.description.trim(),
        form.note.trim() ? `補充資料：${form.note.trim()}` : '',
      ].filter(Boolean).join('\n\n');

      const res = await fetch('/api/maintenance-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: reportStoreId,
          title: form.itemName.trim(),
          description,
          resource_type: form.resourceType,
          issue_type: form.issueType,
          contact_name: form.contactName.trim(),
          contact_phone: form.contactPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '送出維修回報失敗');
      }

      if (photos.length > 0 && json.data?.id) {
        const formData = new FormData();
        formData.append('request_id', json.data.id);
        formData.append('photo_type', 'before');
        photos.forEach((photo) => formData.append('files', photo.file));
        const photoRes = await fetch('/api/maintenance-photos', { method: 'POST', body: formData });
        const photoJson = await photoRes.json();
        if (!photoJson.success) {
          alert(`回報已建立，但照片上傳失敗：${photoJson.error || '未知錯誤'}`);
        }
      }

      const submittedMaterialRequest = form.resourceType === 'material';
      alert(submittedMaterialRequest ? '料件申請已送出' : '維修回報已送出');
      resetForm(submittedMaterialRequest ? 'material' : 'equipment');
      await loadReports();
      setActiveSection(submittedMaterialRequest && activeSection === 'part-requests' ? 'part-requests' : 'maintenance');
      setMaintenanceExpanded(true);
      setMaintenanceView('mine');
      setReportResourceFilter(submittedMaterialRequest ? 'material' : 'all');
    } catch (error: any) {
      alert(`送出失敗：${error.message || error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderProgress = (request: MaintenanceRequest) => {
    const normalizedStatus = getNormalizedStatus(request.status);
    const currentIndex = progressSteps.findIndex((step) => step.status === normalizedStatus);
    const updates = updatesByRequestId.get(request.id) || [];
    const latest = updates[0];
    const stageLabel = getNormalizedStage(request.progress_stage)
      ? MAINTENANCE_PROGRESS_STAGE_LABELS[getNormalizedStage(request.progress_stage)!]
      : null;
    return (
      <div className="space-y-2">
        <div className="flex min-w-[180px] items-center gap-1.5">
          {progressSteps.map((step, index) => {
            const complete = index <= Math.max(currentIndex, 0);
            return (
              <div key={step.status} className="flex items-center">
                <div className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold ${
                  complete ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-300 bg-white text-slate-400'
                }`}>
                  {index + 1}
                </div>
                {index < progressSteps.length - 1 && (
                  <div className={`h-0.5 w-6 ${index < currentIndex ? 'bg-orange-400' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-xs text-slate-500">
          {latest
            ? `${latest.notes}｜${getDateTimeLabel(latest.progress_date)}`
            : stageLabel || statusMeta[normalizedStatus].label}
        </div>
      </div>
    );
  };

  const renderReportDateFilter = (label = '回報日期') => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
      <CalendarDays size={16} className="text-orange-500" />
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        type="date"
        value={reportStartDate}
        max={reportEndDate || undefined}
        onChange={(event) => updateReportStartDate(event.target.value)}
        className="rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
      />
      <span className="text-xs font-semibold text-orange-400">至</span>
      <input
        type="date"
        value={reportEndDate}
        min={reportStartDate || undefined}
        onChange={(event) => updateReportEndDate(event.target.value)}
        className="rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
      />
    </div>
  );

  const renderRequestAttachments = (requestId: string) => {
    const requestPhotos = requestPhotosById.get(requestId) || [];
    const updatePhotos = (updatesByRequestId.get(requestId) || [])
      .flatMap((update) => (update.photos || []).map((photo) => ({
        ...photo,
        file_name: photo.file_name || '處理附件',
      })));
    const allPhotos = [
      ...requestPhotos.filter((photo) => photo.signed_url && isImageLikeAttachment(photo.file_name, photo.content_type)),
      ...updatePhotos.filter((photo) => photo.signed_url && isImageLikeAttachment(photo.file_name, photo.content_type)),
    ];
    const urls = allPhotos.map((photo) => photo.signed_url!).filter(Boolean);
    const loading = photoLoadingIds.has(requestId);

    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-bold text-slate-900">相關附件</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">門市上傳照片與處理進度附件集中存放</div>
          </div>
          <button
            type="button"
            onClick={() => loadRequestPhotos(requestId)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            重新載入
          </button>
        </div>

        {loading ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
            <Loader2 className="mx-auto mb-2 animate-spin text-orange-500" size={18} />
            載入附件中
          </div>
        ) : allPhotos.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
            尚無附件或照片
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {requestPhotos.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-black text-slate-500">門市回報附件</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {requestPhotos.filter((photo) => photo.signed_url).map((photo) => {
                    const index = urls.indexOf(photo.signed_url!);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => openLightbox(urls, index)}
                        className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left"
                        title={photo.file_name}
                      >
                        <img src={photo.signed_url || ''} alt={photo.file_name} className="aspect-square w-full object-cover transition group-hover:scale-105" />
                        <div className="truncate px-2 py-1 text-[11px] font-semibold text-slate-500">{photo.file_name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {updatePhotos.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-black text-slate-500">處理進度附件</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {updatePhotos.filter((photo) => photo.signed_url).map((photo) => {
                    const index = urls.indexOf(photo.signed_url!);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => openLightbox(urls, index)}
                        className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left"
                        title={photo.file_name}
                      >
                        <img src={photo.signed_url || ''} alt={photo.file_name} className="aspect-square w-full object-cover transition group-hover:scale-105" />
                        <div className="truncate px-2 py-1 text-[11px] font-semibold text-slate-500">{photo.file_name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const getWorkOrderCode = (request: MaintenanceRequest) => `WO-${request.id.slice(0, 8).toUpperCase()}`;

  const getPriorityLabel = (priority: string | null | undefined) => {
    if (!priority || priority === 'normal') return '一般';
    if (priority === 'urgent' || priority === 'high') return '急件';
    if (priority === 'low') return '低';
    return priority;
  };

  const getResourceLabel = (resourceType: ResourceType | null | undefined) =>
    resourceTypes.find((resource) => resource.key === resourceType)?.label || '維修項目';

  const getRequestPhotoGroups = (requestId: string) => {
    const requestPhotos = requestPhotosById.get(requestId) || [];
    const updatePhotos = (updatesByRequestId.get(requestId) || [])
      .flatMap((update) => (update.photos || []).map((photo) => ({
        ...photo,
        file_name: photo.file_name || '處理附件',
      })));
    const allPhotos = [
      ...requestPhotos.filter((photo) => photo.signed_url),
      ...updatePhotos.filter((photo) => photo.signed_url),
    ];
    return {
      requestPhotos,
      updatePhotos,
      allPhotos,
      urls: allPhotos.map((photo) => photo.signed_url!).filter(Boolean),
    };
  };

  const getWorkOrderSourceLabel = (request: MaintenanceRequest) =>
    request.ga_service_request_id ? '總務需求分流' : '維修回報';

  const getWorkOrderStageLabel = (request: MaintenanceRequest) => {
    const normalizedStage = getNormalizedStage(request.progress_stage);
    return normalizedStage ? MAINTENANCE_PROGRESS_STAGE_LABELS[normalizedStage] : statusMeta[getNormalizedStatus(request.status)].label;
  };

  const getWorkOrderStoreLabel = (request: MaintenanceRequest) =>
    request.store ? `${request.store.store_code} ${request.store.store_name}` : '-';

  const getWorkOrderNextStepInfo = (request: MaintenanceRequest) => {
    const status = getNormalizedStatus(request.status);
    const stage = getNormalizedStage(request.progress_stage);

    if (status === 'UNACCEPTED') {
      return {
        title: '尚未成立維修派工',
        body: '這是舊維修回報或尚未分流資料，應回總務需求工作台完成受理與分流，不在工單中心處理。',
        action: '回需求工作台',
        tone: 'border-slate-200 bg-slate-50 text-slate-700',
        icon: AlertCircle,
      };
    }

    if (stage === 'WAITING_STORE_CONFIRMATION') {
      return {
        title: '等待門市確認結果',
        body: '總務已送出完成確認，先等門市回覆；若門市回報仍有問題，案件會回到處理中。',
        action: '查看回覆',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        icon: CheckCircle2,
      };
    }

    if (status === 'COMPLETED') {
      return {
        title: '工單已完成',
        body: '可回頭查看照片、處理紀錄與門市確認結果，作為後續維修紀錄。',
        action: '查看紀錄',
        tone: 'border-slate-200 bg-slate-50 text-slate-700',
        icon: CheckCircle2,
      };
    }

    if (stage === 'WAITING_STORE_INFO') {
      return {
        title: '等門市補資料',
        body: '先不要安排派工，待門市補上說明或照片後再判斷後續處理。',
        action: '追蹤補件',
        tone: 'border-amber-200 bg-amber-50 text-amber-800',
        icon: AlertCircle,
      };
    }

    if (['SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING'].includes(stage || '')) {
      return {
        title: '追蹤廠商或施工進度',
        body: '確認廠商回覆、報價、到場時間或處理結果；有新進度時更新工單，門市即可看到公開進度。',
        action: '更新進度',
        tone: 'border-sky-200 bg-sky-50 text-sky-800',
        icon: Briefcase,
      };
    }

    if (['WAITING_PARTS', 'PARTS_IN_TRANSIT'].includes(stage || '')) {
      return {
        title: '處理料件或調撥',
        body: '確認需要的料件來源，完成出庫、調撥或採購後再安排後續維修。',
        action: '更新料件進度',
        tone: 'border-blue-200 bg-blue-50 text-blue-800',
        icon: Package,
      };
    }

    return {
      title: '安排下一步處理',
      body: '這張工單已接手，請依實際情況更新處理方式、承辦人與目前進度。',
      action: '新增處理紀錄',
      tone: 'border-blue-200 bg-blue-50 text-blue-800',
      icon: Settings,
    };
  };

  const getRecommendedWorkOrderQuickActions = (request: MaintenanceRequest) => {
    const status = getNormalizedStatus(request.status);
    const stage = getNormalizedStage(request.progress_stage);
    if (status === 'COMPLETED') return [];
    if (stage === 'WAITING_STORE_CONFIRMATION') {
      return workOrderQuickActions.filter((action) => action.progressStage === 'WAITING_STORE_CONFIRMATION');
    }
    if (['WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING'].includes(stage || '')) {
      return [
        ...workOrderQuickActions.filter((action) => ['WAITING_VENDOR_VISIT', 'WAITING_VENDOR_QUOTE', 'WAITING_STORE_CONFIRMATION'].includes(action.progressStage)),
        ...workOrderQuickActions.filter((action) => !['WAITING_VENDOR_VISIT', 'WAITING_VENDOR_QUOTE', 'WAITING_STORE_CONFIRMATION'].includes(action.progressStage)),
      ];
    }
    if (['WAITING_PARTS', 'PARTS_IN_TRANSIT'].includes(stage || '')) {
      return [
        ...workOrderQuickActions.filter((action) => ['WAITING_PARTS', 'WAITING_VENDOR_VISIT', 'WAITING_STORE_CONFIRMATION'].includes(action.progressStage)),
        ...workOrderQuickActions.filter((action) => !['WAITING_PARTS', 'WAITING_VENDOR_VISIT', 'WAITING_STORE_CONFIRMATION'].includes(action.progressStage)),
      ];
    }
    return workOrderQuickActions;
  };

  useEffect(() => {
    if (activeSection !== 'work-orders') return;
    const targetWorkOrder = selectedWorkOrderId
      ? filteredRequests.find((request) => request.id === selectedWorkOrderId)
      : filteredRequests[0];
    if (!targetWorkOrder || autoPreparedWorkOrderIdRef.current === targetWorkOrder.id) return;

    autoPreparedWorkOrderIdRef.current = targetWorkOrder.id;
    const recommendedAction = getRecommendedWorkOrderQuickActions(targetWorkOrder)[0];
    setShowAdvancedWorkOrderUpdate(false);

    if (!recommendedAction) {
      setWorkOrderUpdateForm((current) => ({
        ...current,
        action: 'SAVE_PROGRESS',
        progressStage: getNormalizedStage(targetWorkOrder.progress_stage) || 'INITIAL_REVIEW',
        visibility: 'PUBLIC',
        handlingMethod: '',
        notes: '',
        forceCloseReason: '',
      }));
      return;
    }

    setWorkOrderUpdateForm((current) => ({
      ...current,
      action: recommendedAction.action,
      progressStage: recommendedAction.progressStage,
      handlingMethod: recommendedAction.handlingMethod,
      visibility: recommendedAction.visibility,
      notes: recommendedAction.notes,
      forceCloseReason: recommendedAction.forceCloseReason || '',
    }));
  }, [activeSection, filteredRequests, selectedWorkOrderId]);

  const applyWorkOrderQuickAction = (quickAction: (typeof workOrderQuickActions)[number]) => {
    setWorkOrderUpdateForm((current) => ({
      ...current,
      action: quickAction.action,
      progressStage: quickAction.progressStage,
      handlingMethod: quickAction.handlingMethod,
      visibility: quickAction.visibility,
      notes: quickAction.notes,
      forceCloseReason: quickAction.forceCloseReason || (quickAction.action === 'REQUEST_COMPLETION' ? '' : current.forceCloseReason),
    }));
    setShowAdvancedWorkOrderUpdate(false);
    requestAnimationFrame(() => workOrderUpdatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const applyWorkOrderCompletionRequest = () => {
    setWorkOrderUpdateForm((current) => ({
      ...current,
      action: 'REQUEST_COMPLETION',
      progressStage: 'WAITING_STORE_CONFIRMATION',
      visibility: 'PUBLIC',
      notes: current.notes.trim() || '總務已完成處理，請門市確認現場結果是否已恢復正常。',
    }));
    setShowAdvancedWorkOrderUpdate(false);
    requestAnimationFrame(() => workOrderUpdatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const applyWorkOrderProgressSaveMode = (request?: MaintenanceRequest | null) => {
    setWorkOrderUpdateForm((current) => ({
      ...current,
      action: 'SAVE_PROGRESS',
      progressStage: current.progressStage === 'WAITING_STORE_CONFIRMATION'
        ? getNormalizedStage(request?.progress_stage) || 'INTERNAL_HANDLING'
        : current.progressStage,
      visibility: current.visibility || 'PUBLIC',
    }));
  };

  const jumpToWorkOrderFocus = (focus: WorkOrderFocusFilter, status: 'all' | MaintenanceStatus = 'PROCESSING') => {
    setWorkOrderFocusFilter(focus);
    setStatusFilter(status);
    setReportPage(1);
  };

  const applyWorkOrderReworkFromStoreProblem = (request: MaintenanceRequest) => {
    setWorkOrderUpdateForm((current) => ({
      ...current,
      action: 'SAVE_PROGRESS',
      progressStage: 'REOPENED',
      visibility: 'PUBLIC',
      handlingMethod: current.handlingMethod || '內部自行處理',
      notes: request.unresolved_reason
        ? `門市回報仍有問題，總務重新處理：${request.unresolved_reason}`
        : '門市回報仍有問題，總務重新處理。',
      forceCloseReason: '',
    }));
    setShowAdvancedWorkOrderUpdate(false);
    requestAnimationFrame(() => workOrderUpdatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const renderDetailField = (label: string, value: string | null | undefined) => (
    <div>
      <div className="text-[11px] font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value || '-'}</div>
    </div>
  );

  const renderWorkOrderAttachmentStrip = (request: MaintenanceRequest) => {
    const { allPhotos, urls } = getRequestPhotoGroups(request.id);
    const loading = photoLoadingIds.has(request.id);

    return (
      <section className="border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">相關附件 ({allPhotos.length})</h3>
          <button
            type="button"
            onClick={() => loadRequestPhotos(request.id, request.ga_service_request_id)}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-orange-600 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
            重新載入
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {allPhotos.slice(0, 7).map((photo, photoIndex) => (
            <button
              key={`${photo.id}-${photoIndex}`}
              type="button"
              onClick={() => openLightbox(urls, photoIndex)}
              className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              title={photo.file_name}
            >
              <img src={photo.signed_url || ''} alt={photo.file_name} className="h-full w-full object-cover transition group-hover:scale-105" />
              {photo.source_label && (
                <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-black text-slate-600 shadow-sm">
                  {photo.source_label}
                </span>
              )}
              <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm">
                <X size={12} />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadRequestPhotos(request.id, request.ga_service_request_id)}
            disabled={loading}
            className="grid aspect-square place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-center text-xs font-bold text-slate-500 hover:border-orange-300 hover:text-orange-600 disabled:opacity-50"
          >
            <span>
              <Plus className="mx-auto mb-1" size={18} />
              上傳檔案
              <span className="mt-1 block text-[10px] font-semibold text-slate-400">圖片 / 影片 / 檔案</span>
            </span>
          </button>
        </div>
      </section>
    );
  };

  const renderWorkOrderTimeline = (request: MaintenanceRequest, updates: MaintenanceUpdate[]) => {
    const timelineItems = [
      {
        id: `${request.id}-created`,
        label: '店長發起工單',
        actor: request.reporter_name || request.contact_name || '門市',
        note: '建立工單並上傳照片',
        date: request.reported_at,
        icon: CheckCircle2,
        tone: 'bg-orange-500 text-white',
      },
      ...updates.map((update) => {
        const updateStage = getNormalizedStage(update.progress_stage);
        const updateStatus = getNormalizedStatus(update.status);
        return {
          id: update.id,
          label: updateStage ? MAINTENANCE_PROGRESS_STAGE_LABELS[updateStage] : statusMeta[updateStatus].label,
          actor: update.updated_by_name,
          note: update.notes,
          date: update.progress_date,
          icon: statusMeta[updateStatus].icon,
          tone: update.visibility === 'INTERNAL' ? 'bg-slate-600 text-white' : `${statusMeta[updateStatus].dot} text-white`,
        };
      }),
    ];

    return (
      <section className="border-t border-slate-200 pt-4">
        <h3 className="mb-4 text-sm font-black text-slate-900">處理進度</h3>
        <div className="space-y-0">
          {timelineItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="grid grid-cols-[24px_minmax(0,1fr)_72px] gap-3">
                <div className="flex flex-col items-center">
                  <span className={`grid h-5 w-5 place-items-center rounded-full ${item.tone}`}>
                    <Icon size={12} />
                  </span>
                  {index < timelineItems.length - 1 && <span className="mt-1 h-full min-h-[48px] w-px bg-slate-200" />}
                </div>
                <div className="pb-5">
                  <div className="text-sm font-bold text-slate-900">{item.label}</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">{item.actor}</div>
                  <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.note || '-'}</div>
                </div>
                <div className="pt-0.5 text-right text-xs font-semibold text-slate-500">{getDateTimeLabel(item.date)}</div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const openSection = (section: ServiceSection, options?: { maintenanceView?: MaintenanceView; status?: 'all' | MaintenanceStatus }) => {
    if (section === 'home') {
      setActiveSection(section);
      return;
    }
    if ((section === 'maintenance' || section === 'work-orders') && canAccessMaintenanceModule) {
      setActiveSection(section);
      setMaintenanceExpanded(true);
      if (options?.maintenanceView) setMaintenanceView(options.maintenanceView);
      if (options?.status) setStatusFilter(options.status);
      return;
    }
    if (section === 'vendors' && canAccessVendors) {
      setActiveSection('vendors');
      setVendorExpanded(true);
      return;
    }
    if (section === 'equipment') {
      router.push('/general-affairs/equipment');
      return;
    }
    if (section === 'facilities') {
      router.push('/general-affairs/facilities');
      return;
    }
    if (section === 'parts') {
      router.push('/general-affairs/parts');
      return;
    }
    if (section === 'part-requests') {
      if (canAccessMaintenanceModule) {
        setActiveSection('part-requests');
        setMaintenanceExpanded(true);
        setMaintenanceView('mine');
        setReportResourceFilter('material');
      }
      return;
    }
    alert(MODULE_NOT_AVAILABLE_MESSAGE);
  };

  const renderHomeDashboard = () => {
    return (
      <GeneralAffairsDashboardClient
        profileName={profileName}
        canAccessMaintenanceModule={canAccessMaintenanceModule}
        canAccessInventory={canAccessInventory}
        canAccessInventoryLocations={canAccessInventoryLocations}
        canAccessEquipment={canAccessEquipment}
        canAccessFacilities={canAccessFacilities}
        canAccessParts={canAccessParts}
        canAccessVendors={canAccessVendors}
      />
    );

    const unavailableModules: string[] = [];
    const maintenanceModules = [
      {
        title: '維修回報',
        description: '門市可建立維修回報並查看自己管理門市的處理進度。',
        action: canSubmit ? '新增維修回報' : '查看我的回報',
        icon: Wrench,
        onClick: () => openSection('maintenance', { maintenanceView: canSubmit ? 'new' : 'mine' }),
        canAccess: canAccessMaintenanceModule,
      },
      {
        title: '工單中心',
        description: '查看維修工單清單與處理紀錄；進度更新仍依工單權限控制。',
        action: '進入工單中心',
        icon: ClipboardList,
        onClick: () => openSection('work-orders'),
        canAccess: canAccessMaintenanceModule,
      },
    ];
    const vendorModule = {
      title: '廠商管理',
      description: '管理合作廠商、服務分類、服務區域與合作統計資料。',
      action: '進入廠商管理',
      icon: Briefcase,
      onClick: () => openSection('vendors'),
      canAccess: canAccessVendors,
    };
    const masterModules = [
      {
        title: '設備管理',
        description: '管理門市設備主檔、狀態、保固摘要與資產代碼。',
        href: '/general-affairs/equipment',
        action: '進入設備管理',
        icon: Settings,
        canAccess: canAccessEquipment,
      },
      {
        title: '設施管理',
        description: '管理門市固定設施、區域、重要度與狀態。',
        href: '/general-affairs/facilities',
        action: '進入設施管理',
        icon: Building2,
        canAccess: canAccessFacilities,
      },
      {
        title: '料件中心',
        description: '管理料件主檔、單位換算與相容性基礎資料。',
        href: '/general-affairs/parts',
        action: '進入料件中心',
        icon: Warehouse,
        canAccess: canAccessParts,
      },
    ];

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-500">首頁 / 總務服務中心</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">總務服務中心</h1>
            <p className="mt-1 text-sm text-slate-500">
              目前測試環境只開放已完成資料庫與 API 驗收的功能，尚未建置的模組會先隱藏或標示未開放。
            </p>
          </div>
          {canAccessInventory && (
            <button
              type="button"
              onClick={() => router.push('/general-affairs/inventory')}
              className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"
            >
              <Package size={16} />
              前往庫存管理
            </button>
          )}
          {canSubmit && (
            <button
              type="button"
              onClick={() => openSection('maintenance', { maintenanceView: 'new' })}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-700 hover:bg-orange-50"
            >
              <Plus size={16} />
              新增維修回報
            </button>
          )}
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          {maintenanceModules.map((module) => {
            const Icon = module.icon;
            return (
              <div key={module.title} className="rounded-lg border border-orange-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-600">
                    <Icon size={22} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-slate-950">{module.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{module.description}</p>
                    {module.canAccess ? (
                      <button
                        type="button"
                        onClick={module.onClick}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"
                      >
                        {module.action}
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                        目前帳號沒有維修或工單查看權限。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {(() => {
            const VendorIcon = vendorModule.icon;
            return (
              <div className="rounded-lg border border-blue-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                    <VendorIcon size={22} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-slate-950">{vendorModule.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{vendorModule.description}</p>
                    {vendorModule.canAccess ? (
                      <button
                        type="button"
                        onClick={vendorModule.onClick}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                      >
                        {vendorModule.action}
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                        目前帳號沒有總務服務中心權限。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="rounded-lg border border-emerald-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <Package size={22} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-950">庫存管理</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  庫存位置、位置料件設定、庫存餘額與交易流水已完成 DEV 驗收，可進行入庫、出庫、調增與調減測試。
                </p>
                {canAccessInventory ? (
                  <button
                    type="button"
                    onClick={() => router.push('/general-affairs/inventory')}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    進入庫存管理
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                    目前帳號沒有庫存管理查看權限。
                  </div>
                )}
              </div>
            </div>
          </div>

          {unavailableModules.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                  <AlertCircle size={22} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-slate-950">尚未開放模組</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    下列功能尚未納入目前 DEV schema，不會在本頁提供可操作入口，避免出現原始資料庫錯誤。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {unavailableModules.map((label) => (
                      <span key={label} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">已開放主檔</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                下列頁面已具備 DEV schema、API 與基本 UI，實際可見資料仍依權限與 RLS 範圍顯示。
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {masterModules.map((module) => {
              const Icon = module.icon;
              return (
                <div key={module.href} className="flex min-h-[190px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-orange-600 ring-1 ring-orange-100">
                    <Icon size={20} />
                  </span>
                  <h3 className="mt-3 font-black text-slate-950">{module.title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-slate-500">{module.description}</p>
                  {module.canAccess ? (
                    <button
                      type="button"
                      onClick={() => router.push(module.href)}
                      className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                      {module.action}
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                      目前帳號沒有此主檔查看權限。
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-black text-slate-950">目前 DEV 開放原則</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ['已完成才顯示', '只有資料表、API、RLS 與 UI 已完成驗收的功能會顯示入口。'],
              ['未完成不送出', '尚未建置的模組不提供新增、儲存、暫存等操作。'],
              ['安全仍在後端', '導覽隱藏只改善體驗；頁面、API 與 RLS 權限檢查仍需保留。'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg bg-slate-50 p-4">
                <div className="font-black text-slate-800">{title}</div>
                <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderLegacyHomeDashboard = () => {
    const isAffairsView = canUpdateWorkOrders || canViewAll;
    const currentMonth = getDateInTaipei().slice(0, 7);
    const counts = requests.reduce((acc, request) => {
      const status = getNormalizedStatus(request.status);
      const stage = getNormalizedStage(request.progress_stage);
      acc.status[status] = (acc.status[status] || 0) + 1;
      if (stage) acc.stage[stage] = (acc.stage[stage] || 0) + 1;
      if (status === 'COMPLETED' && request.reported_at?.slice(0, 7) === currentMonth) acc.monthCompleted += 1;
      return acc;
    }, {
      status: { UNACCEPTED: 0, ACCEPTED: 0, PROCESSING: 0, COMPLETED: 0 } as Record<MaintenanceStatus, number>,
      stage: {} as Partial<Record<MaintenanceProgressStage, number>>,
      monthCompleted: 0,
    });

    const storeTodoRows = requests
      .filter((request) => ['WAITING_STORE_INFO', 'WAITING_STORE_CONFIRMATION', 'WAITING_VENDOR_VISIT'].includes(getNormalizedStage(request.progress_stage) || ''))
      .slice(0, 5)
      .map((request) => {
        const stage = getNormalizedStage(request.progress_stage);
        return {
          task: stage === 'WAITING_STORE_CONFIRMATION' ? '確認完成' : stage === 'WAITING_STORE_INFO' ? '補充資料' : '回覆時間',
          item: request.title,
          store: request.store ? `${request.store.store_code} ${request.store.store_name}` : '-',
          status: stage === 'WAITING_STORE_CONFIRMATION' ? '總務已送出完成確認' : stage === 'WAITING_STORE_INFO' ? '總務要求補充照片或說明' : '需確認廠商可到場時段',
          action: stage === 'WAITING_STORE_CONFIRMATION' ? '確認結果' : stage === 'WAITING_STORE_INFO' ? '補充資料' : '回覆',
        };
      });

    const affairsTodoRows = requests
      .filter((request) => {
        const status = getNormalizedStatus(request.status);
        const stage = getNormalizedStage(request.progress_stage);
        return status === 'UNACCEPTED' || ['INITIAL_REVIEW', 'SEARCHING_VENDOR', 'WAITING_VENDOR_QUOTE', 'WAITING_PARTS', 'VENDOR_WORKING'].includes(stage || '');
      })
      .slice(0, 6)
      .map((request) => {
        const status = getNormalizedStatus(request.status);
        const stage = getNormalizedStage(request.progress_stage);
        const task = status === 'UNACCEPTED'
          ? '受理工單'
          : stage === 'WAITING_VENDOR_QUOTE'
            ? '審視報價'
            : stage === 'WAITING_PARTS'
              ? '調撥料件'
              : stage === 'SEARCHING_VENDOR'
                ? '選擇廠商'
                : stage === 'VENDOR_WORKING'
                  ? '確認處理結果'
                  : '處理進度';
        return {
          task,
          item: request.title,
          store: request.store ? `${request.store.store_code} ${request.store.store_name}` : '-',
          status: status === 'UNACCEPTED' ? '尚未受理' : stage ? MAINTENANCE_PROGRESS_STAGE_LABELS[stage] : statusMeta[status].label,
          action: task === '受理工單' ? '開始處理' : '查看工單',
        };
      });

    const recentRows = requests
      .map((request) => {
        const updates = updatesByRequestId.get(request.id) || [];
        const latest = updates[0];
        const stage = getNormalizedStage(request.progress_stage);
        return {
          id: request.id,
          title: request.title,
          store: request.store ? `${request.store.store_code} ${request.store.store_name}` : '-',
          stageLabel: stage ? MAINTENANCE_PROGRESS_STAGE_LABELS[stage] : statusMeta[getNormalizedStatus(request.status)].label,
          at: latest?.progress_date || request.reported_at,
          note: latest?.notes || request.description || '尚無處理紀錄',
        };
      })
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 5);

    const todoCards = isAffairsView
      ? [
          { label: '新進待處理', value: counts.status.UNACCEPTED, helper: '尚未受理', icon: Clock3, tone: 'border-orange-200 bg-orange-50 text-orange-700', target: 'UNACCEPTED' as MaintenanceStatus },
          { label: '門市退回', value: counts.stage.REOPENED || 0, helper: '門市說還沒好', icon: AlertCircle, tone: 'border-red-200 bg-red-50 text-red-700', target: 'PROCESSING' as MaintenanceStatus },
          { label: '處理中', value: counts.status.PROCESSING, helper: '目前執行案件', icon: Settings, tone: 'border-blue-200 bg-blue-50 text-blue-700', target: 'PROCESSING' as MaintenanceStatus },
          { label: '等待外部回覆', value: (counts.stage.WAITING_VENDOR_REPLY || 0) + (counts.stage.WAITING_VENDOR_QUOTE || 0) + (counts.stage.WAITING_PARTS || 0), helper: '廠商／報價／料件', icon: Briefcase, tone: 'border-sky-200 bg-sky-50 text-sky-700', target: 'PROCESSING' as MaintenanceStatus },
          { label: '完成待確認', value: counts.stage.WAITING_STORE_CONFIRMATION || 0, helper: '等待門市確認', icon: CheckCircle2, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', target: 'PROCESSING' as MaintenanceStatus },
          { label: '待調撥料件', value: counts.stage.WAITING_PARTS || 0, helper: '尚未完成出庫', icon: Package, tone: 'border-amber-200 bg-amber-50 text-amber-700', target: 'PROCESSING' as MaintenanceStatus },
        ]
      : [
          { label: '處理中的回報', value: counts.status.PROCESSING, helper: '總務處理中', icon: Settings, tone: 'border-blue-200 bg-blue-50 text-blue-700', target: 'PROCESSING' as MaintenanceStatus },
          { label: '等待我補充', value: counts.stage.WAITING_STORE_INFO || 0, helper: '需補照片或說明', icon: AlertCircle, tone: 'border-orange-300 bg-orange-50 text-orange-700 ring-2 ring-orange-100', target: 'PROCESSING' as MaintenanceStatus },
          { label: '完成待確認', value: counts.stage.WAITING_STORE_CONFIRMATION || 0, helper: '請確認維修結果', icon: CheckCircle2, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-100', target: 'PROCESSING' as MaintenanceStatus },
          { label: '本月已完成', value: counts.monthCompleted, helper: '查看歷史紀錄', icon: CalendarDays, tone: 'border-slate-200 bg-white text-slate-700', target: 'COMPLETED' as MaintenanceStatus },
        ];

    const stageSummary: Array<{ stage: MaintenanceProgressStage; label: string }> = [
      { stage: 'INITIAL_REVIEW', label: '待總務受理' },
      { stage: 'WAITING_STORE_INFO', label: '待門市補充' },
      { stage: 'WAITING_VENDOR_REPLY', label: '等待廠商回覆' },
      { stage: 'WAITING_VENDOR_VISIT', label: '已預約到場' },
      { stage: 'WAITING_VENDOR_QUOTE', label: '等待報價' },
      { stage: 'WAITING_PARTS', label: '等待料件' },
      { stage: 'VENDOR_WORKING', label: '維修施工中' },
      { stage: 'REOPENED', label: '門市退回' },
      { stage: 'WAITING_STORE_CONFIRMATION', label: '完成待確認' },
    ];

    const quickLinks = isAffairsView
      ? [
          ['維修回報', 'maintenance', Wrench],
          ['工單中心', 'work-orders', ClipboardList],
          ['設備管理', 'equipment', Settings],
          ['設施管理', 'facilities', Building2],
          ['料件中心', 'parts', Warehouse],
          ['廠商管理', 'vendors', Briefcase],
        ] as Array<[string, ServiceSection, any]>
      : [
          ['新增維修', 'maintenance', Wrench],
          ['我的回報', 'maintenance', ClipboardList],
          ['門市設備', 'equipment', Settings],
        ] as Array<[string, ServiceSection, any]>;
    const futureInfoCards: Array<{
      title: string;
      description: string;
      icon: any;
      section: ServiceSection;
      action: string;
    }> = [
      {
        title: '今日／本週到場安排',
        description: '待廠商派工、到場時間與行程資料建立後，這裡會顯示近期到場排程。',
        icon: CalendarDays,
        section: 'work-orders',
        action: '查看工單',
      },
      {
        title: '料件/耗材回報',
        description: '料件與耗材需求統一由維修回報建立，並在我的回報使用資源類型篩選追蹤。',
        icon: Package,
        section: 'maintenance',
        action: '查看我的回報',
      },
      {
        title: '設備與設施提醒',
        description: '待設備與設施主檔完成後，這裡會顯示保固、重複維修與資料缺漏提醒。',
        icon: Settings,
        section: 'equipment',
        action: '前往設備管理',
      },
      {
        title: '廠商待辦與合作動態',
        description: '待廠商派工與合作紀錄串接後，這裡會顯示待回覆、報價與施工回報。',
        icon: Briefcase,
        section: 'vendors',
        action: '前往廠商管理',
      },
    ];

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-950">總務服務中心</h1>
            <p className="mt-1 text-sm text-slate-500">提出門市需求、追蹤工單進度及查詢設備與料件資訊</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(canSubmit || isAffairsView) && (
              <button type="button" onClick={() => openSection('maintenance', { maintenanceView: 'new' })} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">
                <Plus size={16} />
                {isAffairsView ? '建立工單' : '新增維修回報'}
              </button>
            )}
            {isAffairsView && (
              <button type="button" onClick={() => openSection('parts')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Plus size={16} />
                新增料件
              </button>
            )}
            {isAffairsView && (
              <button type="button" onClick={() => openSection('equipment')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Plus size={16} />
                新增設備
              </button>
            )}
          </div>
        </div>

        <div className={`grid gap-3 ${isAffairsView ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
          {todoCards.map((card) => {
            const Icon = card.icon;
            return (
              <button key={card.label} type="button" onClick={() => openSection('work-orders', { status: card.target })} className={`rounded-lg border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${card.tone}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white/80"><Icon size={20} /></span>
                  <span className="text-3xl font-black">{card.value}</span>
                </div>
                <div className="mt-3 text-sm font-black">{card.label}</div>
                <div className="mt-1 text-xs font-semibold opacity-80">{card.helper}</div>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">需要我處理</h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">{isAffairsView ? '依總務應採取行動排序' : '只顯示需要門市回覆或確認的案件'}</p>
              </div>
              <button type="button" onClick={() => openSection('work-orders')} className="text-xs font-bold text-orange-600 hover:text-orange-700">進入工單中心</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">待辦事項</th>
                    <th className="px-4 py-3">工單／項目</th>
                    {isAffairsView && <th className="px-4 py-3">門市</th>}
                    <th className="px-4 py-3">目前狀況</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(isAffairsView ? affairsTodoRows : storeTodoRows).length === 0 ? (
                    <tr><td colSpan={isAffairsView ? 5 : 4} className="px-4 py-8 text-center text-sm text-slate-500">目前沒有需要立即處理的案件</td></tr>
                  ) : (isAffairsView ? affairsTodoRows : storeTodoRows).map((row, index) => (
                    <tr key={`${row.item}-${index}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-black text-orange-700">{row.task}</span></td>
                      <td className="px-4 py-3 font-bold text-slate-900">{row.item}</td>
                      {isAffairsView && <td className="px-4 py-3 text-slate-600">{row.store}</td>}
                      <td className="px-4 py-3 text-slate-600">{row.status}</td>
                      <td className="px-4 py-3"><button type="button" onClick={() => openSection('work-orders')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">{row.action}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-black text-slate-950">最近更新的工單</h2>
              <div className="flex gap-1 text-xs font-bold text-slate-500">
                {['全部更新', '維修', '料件', '完成'].map((item) => <span key={item} className="rounded-full px-2 py-1 hover:bg-slate-100">{item}</span>)}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {recentRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">目前沒有近期更新</div>
              ) : recentRows.map((row) => (
                <button key={row.id} type="button" onClick={() => openSection('maintenance', { maintenanceView: 'mine' })} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-400">WO-{row.id.slice(0, 8).toUpperCase()}</div>
                      <div className="mt-1 truncate font-black text-slate-900">{row.title}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{row.store}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{row.stageLabel}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{getDateTimeLabel(row.at)}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-700">{row.note}</div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-black text-slate-950">工單狀況總覽</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {stageSummary.map((row) => (
                <button key={row.stage} type="button" onClick={() => openSection('work-orders', { status: row.stage === 'INITIAL_REVIEW' ? 'UNACCEPTED' : 'PROCESSING' })} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-orange-200 hover:bg-orange-50">
                  <span className="text-sm font-bold text-slate-700">{row.label}</span>
                  <span className="text-lg font-black text-slate-950">{row.stage === 'INITIAL_REVIEW' ? counts.status.UNACCEPTED : counts.stage[row.stage] || 0}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {isAffairsView && (
          <div className="grid gap-4 xl:grid-cols-4">
            {futureInfoCards.map((card) => {
              const Icon = card.icon;
              return (
                <section key={card.title} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500">
                      <Icon size={20} />
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">待資料來源</span>
                  </div>
                  <h2 className="mt-4 text-base font-black text-slate-950">{card.title}</h2>
                  <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-500">{card.description}</p>
                  <button
                    type="button"
                    onClick={() => openSection(card.section)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
                  >
                    {card.action}
                    <ChevronRight size={14} />
                  </button>
                </section>
              );
            })}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-black text-slate-950">快速入口</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            {quickLinks.map(([label, section, Icon]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  openSection(section, label === '我的回報' ? { maintenanceView: 'mine' } : label === '新增維修' ? { maintenanceView: 'new' } : undefined);
                }}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-left hover:border-orange-200 hover:bg-orange-50"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon size={18} /></span>
                <span className="text-sm font-black text-slate-800">{label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderNewReport = () => {
    const isMaterialRequest = form.resourceType === 'material';
    const isPartRequestEntry = activeSection === 'part-requests';
    const pageTitle = isPartRequestEntry ? '新增料件申請' : '新增回報';
    const pageDescription = isPartRequestEntry
      ? '請填寫門市、料件或耗材需求、用途與急迫程度；送出後可在我的料件申請追蹤處理進度。'
      : '請填寫門市、關聯資源與問題內容；若需求為料件或耗材，請在基本資訊選擇資源類型「料件 / 耗材」。';
    const backLabel = isPartRequestEntry ? '回我的料件申請' : '回我的回報';

    return (
    <GeneralAffairsFormPage
      header={(
        <GeneralAffairsPageHeader
          breadcrumbs={[
            { label: '首頁', href: '/' },
            { label: '總務服務中心', href: '/general-affairs' },
            { label: isPartRequestEntry ? '我的申請' : '維修回報' },
            { label: pageTitle },
          ]}
          title={pageTitle}
          description={pageDescription}
          secondaryActions={[
            <button
              key="back"
              type="button"
              onClick={() => {
                setMaintenanceView('mine');
                setReportResourceFilter(isPartRequestEntry ? 'material' : 'all');
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={16} />
              {backLabel}
            </button>,
          ]}
        />
      )}
    >
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-5 py-5">
          <div className="mb-6 grid grid-cols-4 gap-3">
            {['基本資訊', '問題描述', '補充資料', '確認送出'].map((label, index) => {
              const step = index + 1;
              const active = reportStep === step;
              const done = reportStep > step;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setReportStep(step)}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left"
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${
                    active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {done ? <CheckCircle2 size={16} /> : step}
                  </span>
                  <span className={`hidden text-sm font-semibold sm:block ${active ? 'text-slate-950' : 'text-slate-500'}`}>{label}</span>
                </button>
              );
            })}
          </div>

          {reportStep === 1 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                發生門市 *
                <select
                  value={reportStoreId}
                  onChange={(event) => setReportStoreId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {!reportStoreId && <option value="">請選擇門市</option>}
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.store_code} - {store.store_name}</option>
                  ))}
                </select>
              </label>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-700">資源類型 *</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(isPartRequestEntry ? resourceTypes.filter((resource) => resource.key === 'material') : resourceTypes).map((resource) => {
                    const Icon = resource.icon;
                    const active = form.resourceType === resource.key;
                    return (
                      <button
                        key={resource.key}
                        type="button"
                        onClick={() => setResourceType(resource.key)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          active ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon size={22} className={active ? 'text-orange-600' : 'text-slate-400'} />
                        <div className="mt-2 text-sm font-bold">{resource.label}</div>
                        <div className="mt-1 text-xs leading-5">{resource.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                {isMaterialRequest ? '料件 / 需求名稱 *' : '設備 / 項目名稱 *'}
                <input
                  value={form.itemName}
                  onChange={(event) => setForm({ ...form, itemName: event.target.value })}
                  placeholder={isMaterialRequest ? '例如：濾網、門市耗材、維修零件' : '例如：冷氣A、電動門、POS主機1'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                問題類型 *
                <select
                  value={form.issueType}
                  onChange={(event) => setForm({ ...form, issueType: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {activeResource.issueTypes.map((issue) => <option key={issue}>{issue}</option>)}
                </select>
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                聯絡人 *
                <div className="relative">
                  <User size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    value={form.contactName}
                    onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                    placeholder="預設店長，可改由同仁負責"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                聯絡電話 *
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    value={form.contactPhone}
                    onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                    placeholder="請填可聯繫電話"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </label>
            </div>
          )}

          {reportStep === 2 && (
            <div className="space-y-4">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                問題描述 *
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  rows={9}
                  placeholder={isMaterialRequest ? '請描述用途、需求數量、目前庫存狀況、是否急用...' : '請描述發生位置、異常狀況、是否影響營運、已嘗試處理方式...'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>
            </div>
          )}

          {reportStep === 3 && (
            <div className="space-y-5">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                備註
                <textarea
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  rows={4}
                  placeholder="其他補充說明..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-700">照片（最多 5 張）</div>
                <div className="grid gap-3 sm:grid-cols-5">
                  {photos.map((photo, index) => (
                    <div key={photo.preview} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      <img src={photo.preview} alt={`維修照片 ${index + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white text-slate-600 shadow"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <label
                      htmlFor="maintenance-report-photo-input"
                      className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-orange-300 bg-orange-50 text-sm font-semibold text-orange-700 transition-colors hover:bg-orange-100"
                    >
                      <ImagePlus size={24} />
                      <span className="mt-2">新增照片</span>
                    </label>
                  )}
                </div>
                <p className="text-xs font-normal text-slate-500">支援 JPG、PNG、HEIC 等圖片格式；可重複選擇同一張照片。</p>
                <input
                  id="maintenance-report-photo-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addPhotos(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            </div>
          )}

          {reportStep === 4 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="text-xs text-slate-500">門市</div><div className="font-semibold text-slate-900">{selectedStore ? `${selectedStore.store_code} ${selectedStore.store_name}` : '-'}</div></div>
                <div><div className="text-xs text-slate-500">資源類型</div><div className="font-semibold text-slate-900">{activeResource.label}</div></div>
                <div><div className="text-xs text-slate-500">設備 / 項目</div><div className="font-semibold text-slate-900">{form.itemName || '-'}</div></div>
                <div><div className="text-xs text-slate-500">問題類型</div><div className="font-semibold text-slate-900">{form.issueType || '-'}</div></div>
                <div><div className="text-xs text-slate-500">聯絡人</div><div className="font-semibold text-slate-900">{form.contactName || '-'}</div></div>
                <div><div className="text-xs text-slate-500">聯絡電話</div><div className="font-semibold text-slate-900">{form.contactPhone || '-'}</div></div>
              </div>
              <div className="mt-4">
                <div className="text-xs text-slate-500">問題描述</div>
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">{form.description || '-'}</div>
              </div>
              <div className="mt-4 text-sm text-slate-500">照片：{photos.length} 張</div>
            </div>
          )}

          <div className="mt-6 flex justify-between border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setReportStep((step) => Math.max(1, step - 1))}
              disabled={reportStep === 1}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowLeft size={16} />
              上一步
            </button>
            {reportStep < 4 ? (
              <button
                type="button"
                onClick={() => canGoNext() ? setReportStep((step) => Math.min(4, step + 1)) : alert('請先完成本步驟必要欄位')}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
              >
                下一步
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submitReport}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {isPartRequestEntry ? '送出料件申請' : '送出回報'}
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-slate-900">如何選擇資源類型？</h3>
          <div className="mt-4 space-y-3">
            {resourceTypes.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex gap-3">
                  <Icon size={22} className="mt-0.5 text-orange-500" />
                  <div>
                    <div className="text-sm font-bold text-slate-800">{item.label}</div>
                    <div className="text-xs leading-5 text-slate-500">{item.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-slate-900">回報流程</h3>
          <div className="mt-4 space-y-4">
            {progressSteps.map((step, index) => (
              <div key={step.status} className="flex gap-3">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-orange-50 text-sm font-bold text-orange-600">{index + 1}</div>
                <div>
                  <div className="text-sm font-bold text-slate-800">{step.label}</div>
                  <div className="text-xs text-slate-500">{index === 0 ? '填寫問題並送出' : index === 1 ? '總務建立安排處理' : index === 2 ? '完成維修或處理結果' : '完成驗收與結案'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
    </GeneralAffairsFormPage>
    );
  };

  const renderMyReports = () => {
    const isPartRequestEntry = activeSection === 'part-requests';
    const pageTitle = isPartRequestEntry ? '我的料件申請' : '我的回報';
    const pageDescription = isPartRequestEntry
      ? '查看您或所屬門市提出的料件／耗材需求，以及總務處理進度。'
      : '查看您或所屬門市提出的設備、設施與料件／耗材回報及處理進度';
    const createLabel = isPartRequestEntry ? '新增料件申請' : '新增回報';
    const safeReportPage = Math.min(Math.max(reportPage, 1), reportTotalPages);
    const selectedReport = selectedReportDetailId
      ? requests.find((request) => request.id === selectedReportDetailId) || null
      : null;
    const selectedReportUpdates = selectedReport
      ? (updatesByRequestId.get(selectedReport.id) || []).filter((update) => update.visibility !== 'INTERNAL')
      : [];
    const selectedReportStatus = selectedReport ? getNormalizedStatus(selectedReport.status) : null;
    const selectedReportStage = selectedReport ? getNormalizedStage(selectedReport.progress_stage) : null;
    const selectedReportMeta = selectedReportStatus ? statusMeta[selectedReportStatus] : null;
    const SelectedReportStatusIcon = selectedReportMeta?.icon || ClipboardList;
    const clearFilters = () => {
      setStatusFilter('all');
      setReportResourceFilter(isPartRequestEntry ? 'material' : 'all');
      setSearchText('');
      setReportStartDate(getDefaultReportStartDate());
      setReportEndDate(getDateInTaipei());
      if (canViewAll) setSelectedStoreId('');
    };
    const openReportDetail = (request: MaintenanceRequest) => {
      setSelectedReportDetailId(request.id);
      if (!requestPhotosById.has(request.id)) {
        void loadRequestPhotos(request.id, request.ga_service_request_id);
      }
    };
    const renderResourceThumbnail = (request: MaintenanceRequest) => {
      const requestPhoto = (requestPhotosById.get(request.id) || []).find((photo) => photo.signed_url);
      const ResourceIcon = resourceTypes.find((resource) => resource.key === request.resource_type)?.icon || ClipboardList;

      if (requestPhoto?.signed_url) {
        return (
          <img
            src={requestPhoto.signed_url}
            alt={request.title}
            className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
          />
        );
      }

      return (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
          <ResourceIcon size={20} />
        </span>
      );
    };

    return (
      <GeneralAffairsListPage
        header={(
          <GeneralAffairsPageHeader
            breadcrumbs={[
              { label: '首頁', href: '/' },
              { label: '總務服務中心', href: '/general-affairs' },
              { label: isPartRequestEntry ? '我的申請' : '維修回報' },
              { label: pageTitle },
            ]}
            title={pageTitle}
            description={pageDescription}
            primaryAction={canSubmit ? (
              <button
                type="button"
                onClick={() => {
                  setMaintenanceView('new');
                  if (isPartRequestEntry) {
                    const materialResource = resourceTypes.find((item) => item.key === 'material') || resourceTypes[0];
                    setForm((current) => ({
                      ...current,
                      resourceType: 'material',
                      issueType: materialResource.issueTypes[0],
                    }));
                    setReportResourceFilter('material');
                  }
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
              >
                <Plus size={16} />
                {createLabel}
              </button>
            ) : undefined}
          />
        )}
      >
        <div className="space-y-4">
          {maintenanceError && (
            <GeneralAffairsErrorState
              title="我的回報載入失敗"
              description={maintenanceError}
              action={(
                <button
                  type="button"
                  onClick={loadReports}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  重新載入
                </button>
              )}
            />
          )}

          <div className="overflow-x-auto border-b border-slate-200">
            <div className="flex min-w-max items-center gap-7 px-1">
              {reportStatusFilters.map((filter) => {
                const Icon = filter.icon;
                const isActive = statusFilter === filter.key;

                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setStatusFilter(filter.key)}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-bold transition-colors ${
                      isActive
                        ? 'border-orange-500 text-orange-600'
                        : 'border-transparent text-slate-500 hover:border-orange-200 hover:text-slate-800'
                    }`}
                  >
                    <Icon size={16} strokeWidth={2.4} />
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {reportStatusFilters.map((filter) => {
              const Icon = filter.icon;
              const isActive = statusFilter === filter.key;

              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setStatusFilter(filter.key)}
                  className={`min-h-[116px] rounded-lg border bg-white p-4 text-left transition-all hover:border-orange-200 hover:shadow-sm ${
                    isActive ? 'border-orange-300 ring-2 ring-orange-100' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold ${filter.badgeTone}`}>
                        {filter.label}
                      </div>
                      <div className="mt-3 text-2xl font-black leading-none text-slate-950">{statusCounts[filter.key]}</div>
                      <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">{filter.helper}</div>
                    </div>
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ${filter.iconTone}`}>
                      <Icon size={20} strokeWidth={2.4} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
              {renderReportDateFilter('回報日期')}
              <label className="grid gap-1 text-xs font-bold text-slate-500">
                工單／資源類型
                <select
                  value={reportResourceFilter}
                  onChange={(event) => setReportResourceFilter(event.target.value as ReportResourceFilter)}
                  disabled={isPartRequestEntry}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {(isPartRequestEntry ? reportResourceFilters.filter((filter) => filter.key === 'material') : reportResourceFilters).map((filter) => (
                    <option key={filter.key} value={filter.key}>{filter.label}</option>
                  ))}
                </select>
                {isPartRequestEntry && <span className="text-[11px] font-semibold text-slate-400">料件申請固定顯示料件 / 耗材</span>}
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">
                狀態
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as 'all' | MaintenanceStatus)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {reportStatusFilters.map((filter) => (
                    <option key={filter.key} value={filter.key}>{filter.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">
                門市
                <select
                  value={selectedStoreId}
                  onChange={(event) => setSelectedStoreId(event.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {canViewAll && <option value="">全部門市</option>}
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                  ))}
                </select>
              </label>
              <label className="relative min-w-[240px] flex-1">
                <span className="mb-1 block text-xs font-bold text-slate-500">關鍵字</span>
                <Search size={16} className="absolute left-3 top-[33px] text-slate-400" />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜尋工單、資源名稱、問題描述"
                  className="h-10 w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>
              <button
                type="button"
                onClick={loadReports}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
              >
                <Filter size={16} />
                查詢
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <X size={16} />
                清除條件
              </button>
            </div>

            <div className="hidden lg:block">
              <div className="overflow-auto">
                <table className="w-full min-w-[1180px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">工單編號</th>
                      <th className="px-4 py-3">資源／項目</th>
                      <th className="px-4 py-3">問題描述</th>
                      <th className="px-4 py-3">緊急程度</th>
                      <th className="px-4 py-3">目前狀態</th>
                      <th className="px-4 py-3">處理進度</th>
                      <th className="px-4 py-3">建立時間</th>
                      <th className="px-4 py-3">預計完成</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingReports ? (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
                    ) : filteredRequests.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">目前沒有符合條件的回報</td></tr>
                    ) : pagedReportRows.map((request) => {
                      const normalizedStatus = getNormalizedStatus(request.status);
                      const normalizedStage = getNormalizedStage(request.progress_stage);
                      const stageLabel = normalizedStage ? MAINTENANCE_PROGRESS_STAGE_LABELS[normalizedStage] : null;
                      const meta = statusMeta[normalizedStatus];
                      const StatusIcon = meta.icon;
                      return (
                        <tr key={request.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{getWorkOrderCode(request)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              {renderResourceThumbnail(request)}
                              <div className="min-w-0">
                                <div className="truncate font-bold text-slate-900">{request.title}</div>
                                <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                                  {getResourceLabel(request.resource_type)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-[280px] px-4 py-4">
                            <div className="font-semibold text-slate-800">{request.issue_type || '回報事項'}</div>
                            <div className="mt-1 line-clamp-2 text-slate-600" title={request.description || ''}>{request.description || '-'}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-700">{getPriorityLabel(request.priority)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${meta.tone}`}>
                              <StatusIcon size={13} />
                              {meta.label}
                            </span>
                            {normalizedStatus === 'PROCESSING' && stageLabel && (
                              <div className="mt-1 text-xs font-semibold text-slate-500">{stageLabel}</div>
                            )}
                          </td>
                          <td className="px-4 py-4">{renderProgress(request)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-600">{getDateTimeLabel(request.reported_at)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-500">{request.completed_at ? getDateTimeLabel(request.completed_at) : '-'}</td>
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() => openReportDetail(request)}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                              查看詳情
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 p-3 lg:hidden">
              {loadingReports ? (
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                  <Loader2 className="mx-auto mb-2 animate-spin text-orange-500" />
                  載入中
                </div>
              ) : filteredRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  目前沒有符合條件的回報
                </div>
              ) : pagedReportRows.map((request) => {
                const normalizedStatus = getNormalizedStatus(request.status);
                const meta = statusMeta[normalizedStatus];
                const StatusIcon = meta.icon;
                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => openReportDetail(request)}
                    className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-slate-500">{getWorkOrderCode(request)}</div>
                        <div className="mt-1 text-base font-black text-slate-950">{request.title}</div>
                        <div className="mt-1 text-xs font-bold text-slate-500">{getResourceLabel(request.resource_type)}</div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${meta.tone}`}>
                        <StatusIcon size={13} />
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{request.description || '-'}</div>
                    <div className="mt-3">{renderProgress(request)}</div>
                    <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
                      <span>{getDateTimeLabel(request.reported_at)}</span>
                      <span className="text-orange-600">查看詳情</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <div>
                共 <span className="font-bold text-slate-900">{filteredRequests.length}</span> 筆，第 {safeReportPage} / {reportTotalPages} 頁
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={reportPageSize}
                  onChange={(event) => {
                    setReportPageSize(Number(event.target.value));
                    setReportPage(1);
                  }}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {[10, 20, 50].map((size) => (
                    <option key={size} value={size}>每頁 {size} 筆</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setReportPage((current) => Math.max(1, current - 1))}
                  disabled={safeReportPage <= 1}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                  上一頁
                </button>
                <button
                  type="button"
                  onClick={() => setReportPage((current) => Math.min(reportTotalPages, current + 1))}
                  disabled={safeReportPage >= reportTotalPages}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  下一頁
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {selectedReport && selectedReportMeta && (
            <div className="fixed inset-0 z-50 bg-slate-950/30">
              <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-500">工單詳情 / {getWorkOrderCode(selectedReport)}</div>
                    <h2 className="mt-1 text-xl font-black text-slate-950">{selectedReport.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReportDetailId(null)}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                    aria-label="關閉詳情"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                    {renderDetailField('門市', selectedReport.store ? `${selectedReport.store.store_code} ${selectedReport.store.store_name}` : '-')}
                    {renderDetailField('回報人', selectedReport.reporter_name)}
                    {renderDetailField('資源類型', getResourceLabel(selectedReport.resource_type))}
                    {renderDetailField('發生位置 / 項目', selectedReport.title)}
                    {renderDetailField('聯絡人', selectedReport.contact_name || selectedReport.reporter_name)}
                    {renderDetailField('電話', selectedReport.contact_phone)}
                    {renderDetailField('建立時間', getDateTimeLabel(selectedReport.reported_at))}
                    {renderDetailField('最近更新', selectedReport.completed_at ? getDateTimeLabel(selectedReport.completed_at) : getDateTimeLabel(selectedReport.reported_at))}
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${selectedReportMeta.tone}`}>
                        <SelectedReportStatusIcon size={13} />
                        {selectedReportMeta.label}
                      </span>
                      {selectedReportStage && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                          {MAINTENANCE_PROGRESS_STAGE_LABELS[selectedReportStage]}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReport.description || '-'}</div>
                  </section>

                  {renderWorkOrderTimeline(selectedReport, selectedReportUpdates)}
                  {renderRequestAttachments(selectedReport.id)}
                  <ResourceAttachmentPanel
                    resourceType="MAINTENANCE_REQUEST"
                    resourceId={selectedReport.id}
                    canManage={canSubmit || canUpdateWorkOrders}
                    title="回報共用附件"
                    emptyLabel="尚未上傳回報共用附件"
                  />

                  {selectedReportStage === 'WAITING_STORE_CONFIRMATION' && selectedReportStatus === 'PROCESSING' && (
                    <section className="grid gap-2 rounded-lg border border-orange-200 bg-orange-50 p-4 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => submitStoreCompletionResponse(selectedReport.id, 'STORE_CONFIRM_COMPLETE')}
                        disabled={savingWorkOrderUpdate}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={16} />
                        確認完成
                      </button>
                      <button
                        type="button"
                        onClick={() => submitStoreCompletionResponse(selectedReport.id, 'REPORT_UNRESOLVED')}
                        disabled={savingWorkOrderUpdate}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                      >
                        <AlertCircle size={16} />
                        仍有問題
                      </button>
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </GeneralAffairsListPage>
    );
  };

  const renderPartRequestRecords = () => renderMyReports();

  const renderWorkOrderCenter = () => {
    const selectedWorkOrder = filteredRequests.find((request) => request.id === selectedWorkOrderId) || filteredRequests[0] || null;
    const selectedUpdates = selectedWorkOrder ? updatesByRequestId.get(selectedWorkOrder.id) || [] : [];
    const selectedQuickAction = workOrderQuickActions.find((quickAction) =>
      quickAction.action === workOrderUpdateForm.action &&
      quickAction.progressStage === workOrderUpdateForm.progressStage &&
      quickAction.handlingMethod === workOrderUpdateForm.handlingMethod
    ) || null;
    const SelectedQuickActionIcon = selectedQuickAction?.icon || ClipboardList;

    return (
      <GeneralAffairsListPage
        header={(
          <GeneralAffairsPageHeader
            breadcrumbs={[{ label: '首頁', href: '/' }, { label: '總務服務中心', href: '/general-affairs' }, { label: '工單中心' }]}
            title="工單中心"
            description="受理後的維修派工會集中到這裡，依下一步安排內部處理、廠商施工與門市確認。"
            primaryAction={(
              <button
                type="button"
                onClick={loadReports}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
              >
                <Filter size={16} />
                重新整理
              </button>
            )}
          />
        )}
      >
      <div className="space-y-4">

        {!canUpdateWorkOrders && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            目前帳號可以查看總務服務中心，但沒有工單進度更新權限。
          </div>
        )}

        {maintenanceError && (
          <GeneralAffairsErrorState
            title="工單中心載入失敗"
            description={maintenanceError}
            action={(
              <button
                type="button"
                onClick={loadReports}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
              >
                重新載入
              </button>
            )}
          />
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200">
            <div className="grid gap-3 p-4 lg:grid-cols-[auto_minmax(220px,280px)_minmax(170px,210px)_minmax(280px,1fr)] lg:items-center">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
                預設顯示近期工單，不用受日期篩選影響
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                門市
                <select
                  value={selectedStoreId}
                  onChange={(event) => {
                    setSelectedStoreId(event.target.value);
                    setSelectedWorkOrderId(null);
                    setWorkOrderFocusFilter('all');
                  }}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {canViewAll && <option value="">全部門市</option>}
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                狀態
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as 'all' | MaintenanceStatus);
                    setWorkOrderFocusFilter('all');
                    setSelectedWorkOrderId(null);
                  }}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {workOrderStatusFilters.map((filter) => (
                    <option key={filter.key} value={filter.key}>
                      {filter.label} ({workOrderStatusCounts[filter.key] || 0})
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative">
                <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  value={searchText}
                  onChange={(event) => {
                    setSearchText(event.target.value);
                    setSelectedWorkOrderId(null);
                  }}
                  placeholder="搜尋工單、設備名稱、問題描述"
                  className="h-10 w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>
            </div>

            <div className="border-t border-slate-100 px-4 py-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-slate-950">今天先處理什麼</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">用總務工作語言分流，不用先理解每個系統狀態。</div>
                </div>
                {workOrderFocusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => {
                      setWorkOrderFocusFilter('all');
                      setSelectedWorkOrderId(null);
                    }}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    清除焦點
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                {workOrderFocusFilters.map((filter) => {
                  const Icon = filter.icon;
                  const isActive = workOrderFocusFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => {
                        setWorkOrderFocusFilter(filter.key);
                        setStatusFilter('all');
                        setSelectedWorkOrderId(null);
                      }}
                      className={`min-h-[86px] rounded-lg border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
                        isActive ? `${filter.activeTone} ring-2` : filter.tone
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80">
                          <Icon size={16} />
                        </span>
                        <span className="text-lg font-black">{workOrderFocusCounts[filter.key] || 0}</span>
                      </div>
                      <div className="mt-2 text-sm font-black">{filter.label}</div>
                      <div className="mt-0.5 text-xs font-semibold opacity-75">{filter.helper}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-black text-slate-950">待處理工單</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">先看門市、問題與下一步，再點選右側處理。</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{filteredRequests.length} 件</span>
              </div>
              <div className="max-h-[720px] overflow-auto p-3">
                {loadingReports ? (
                  <div className="grid min-h-[220px] place-items-center text-center text-sm text-slate-500">
                    <span><Loader2 className="mx-auto mb-2 animate-spin" />載入工單中</span>
                  </div>
                ) : filteredRequests.length === 0 ? (
                  <div className="grid min-h-[220px] place-items-center text-center text-sm text-slate-500">目前沒有符合條件的工單</div>
                ) : (
                  <div className="space-y-2">
                    {filteredRequests.map((request) => {
                      const normalizedStatus = getNormalizedStatus(request.status);
                      const meta = statusMeta[normalizedStatus];
                      const latest = (updatesByRequestId.get(request.id) || [])[0];
                      const active = selectedWorkOrder?.id === request.id;
                      const nextStep = getWorkOrderNextStepInfo(request);
                      const NextIcon = nextStep.icon;
                      const loadedPhotos = requestPhotosById.get(request.id);
                      const photoCount = loadedPhotos?.filter((photo) => photo.signed_url).length || 0;
                      const loadingPhotos = photoLoadingIds.has(request.id);
                      return (
                        <button
                          key={request.id}
                          type="button"
                          onClick={() => {
                            setSelectedWorkOrderId(request.id);
                            if (!requestPhotosById.has(request.id)) {
                              void loadRequestPhotos(request.id, request.ga_service_request_id);
                            }
                          }}
                          className={`w-full rounded-lg border p-4 text-left transition hover:border-orange-200 hover:bg-orange-50/40 ${
                            active ? 'border-orange-300 bg-orange-50 shadow-sm' : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[11px] font-bold text-slate-500">{getWorkOrderCode(request)}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.tone}`}>{meta.label}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{getWorkOrderSourceLabel(request)}</span>
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                  loadingPhotos
                                    ? 'bg-slate-100 text-slate-500'
                                    : photoCount > 0
                                      ? 'bg-orange-100 text-orange-700'
                                      : 'bg-slate-50 text-slate-400'
                                }`}>
                                  <Camera size={11} />
                                  {loadingPhotos ? '照片載入中' : photoCount > 0 ? `${photoCount} 張照片` : '無照片'}
                                </span>
                              </div>
                              <div className="mt-2 font-black text-slate-950">{getWorkOrderStoreLabel(request)}</div>
                              <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-800">{request.title}</div>
                              <div className="mt-2 grid gap-1 text-xs font-semibold text-slate-500">
                                <div className="line-clamp-1">現場：{request.location || '未填寫位置'}</div>
                                <div className="line-clamp-1">問題：{request.issue_type || getResourceLabel(request.resource_type)}</div>
                                {request.description && <div className="line-clamp-2 rounded-md bg-slate-50 px-2 py-1 leading-5 text-slate-600">需求：{request.description}</div>}
                              </div>
                            </div>
                            <div className="whitespace-nowrap text-xs font-semibold text-slate-500">{getDateTimeLabel(request.reported_at)}</div>
                          </div>
                          <div className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs font-semibold leading-5 ${nextStep.tone}`}>
                            <NextIcon size={15} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="font-black">{nextStep.title}</div>
                              <div className="line-clamp-1">{latest?.notes || getWorkOrderStageLabel(request)}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              {selectedWorkOrder ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                      <h2 className="text-sm font-black text-slate-950">工單詳情</h2>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => window.print()}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          <Printer size={13} />
                          列印
                        </button>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(getWorkOrderCode(selectedWorkOrder))}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          <Copy size={13} />
                          複製工單
                        </button>
                        <button
                          type="button"
                          disabled={!canUpdateWorkOrders}
                          onClick={() => workOrderUpdatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                          className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          <Pencil size={13} />
                          編輯
                        </button>
                      </div>
                    </div>

                      <div className="space-y-4 p-4">
                        {(() => {
                          const currentStatus = getNormalizedStatus(selectedWorkOrder.status);
                          const currentStage = getNormalizedStage(selectedWorkOrder.progress_stage);
                          const CurrentIcon = statusMeta[currentStatus].icon;
                          const { allPhotos, urls } = getRequestPhotoGroups(selectedWorkOrder.id);
                          const previewPhoto = allPhotos[0];
                          const nextStep = getWorkOrderNextStepInfo(selectedWorkOrder);
                          const NextIcon = nextStep.icon;
                          return (
                          <>
                            <section className="rounded-lg border border-orange-200 bg-orange-50/50 p-4">
                              <div className="mb-3 grid gap-2 rounded-md bg-white/85 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
                                <div>
                                  <div className="text-sm font-black text-orange-950">先看這三件事：需求、照片、下一步</div>
                                  <div className="mt-1 text-xs font-black uppercase tracking-wide text-orange-700">目前要做什麼</div>
                                  <div className={`mt-2 inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs font-black ${nextStep.tone}`}>
                                    <NextIcon size={14} className="shrink-0" />
                                    <span className="truncate">下一步：{nextStep.title}</span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => workOrderUpdatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                  disabled={!canUpdateWorkOrders || getNormalizedStatus(selectedWorkOrder.status) === 'COMPLETED'}
                                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-orange-600 px-3 text-xs font-black text-white hover:bg-orange-700 disabled:bg-slate-300"
                                >
                                  <Send size={13} />
                                  直接處理
                                </button>
                              </div>
                              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
                                      <MapPin size={13} />
                                      現場狀況總覽
                                    </span>
                                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-black ${statusMeta[currentStatus].tone}`}>
                                      <CurrentIcon size={13} />
                                      {statusMeta[currentStatus].label}
                                    </span>
                                    <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">{getPriorityLabel(selectedWorkOrder.priority)}</span>
                                  </div>
                                  <h3 className="mt-3 break-words text-lg font-black leading-7 text-slate-950">{selectedWorkOrder.title}</h3>
                                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                    <div className="rounded-md bg-white/80 p-3">
                                      <div className="text-xs font-bold text-slate-500">門市</div>
                                      <div className="mt-1 font-black text-slate-900">{selectedWorkOrder.store ? `${selectedWorkOrder.store.store_code} ${selectedWorkOrder.store.store_name}` : '-'}</div>
                                    </div>
                                    <div className="rounded-md bg-white/80 p-3">
                                      <div className="text-xs font-bold text-slate-500">發生位置</div>
                                      <div className="mt-1 font-black text-slate-900">{selectedWorkOrder.location || '-'}</div>
                                    </div>
                                    <div className="rounded-md bg-white/80 p-3">
                                      <div className="text-xs font-bold text-slate-500">問題類型</div>
                                      <div className="mt-1 font-black text-slate-900">{selectedWorkOrder.issue_type || getResourceLabel(selectedWorkOrder.resource_type)}</div>
                                    </div>
                                    <div className="rounded-md bg-white/80 p-3">
                                      <div className="text-xs font-bold text-slate-500">聯絡窗口</div>
                                      <div className="mt-1 font-black text-slate-900">{selectedWorkOrder.contact_name || selectedWorkOrder.reporter_name || '-'}</div>
                                      <div className="mt-0.5 text-xs font-semibold text-slate-500">{selectedWorkOrder.contact_phone || '-'}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 rounded-md bg-white p-3">
                                    <div className="text-xs font-bold text-slate-500">門市描述</div>
                                    <div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{selectedWorkOrder.description || '-'}</div>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-orange-100 bg-white p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-xs font-black text-orange-700">現場照片</div>
                                    <div className="text-xs font-bold text-slate-400">{allPhotos.length} 張</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => previewPhoto && openLightbox(urls, 0)}
                                    disabled={!previewPhoto}
                                    className="group relative grid aspect-[4/3] w-full place-items-center rounded-md disabled:cursor-default"
                                  >
                                    {allPhotos.length > 1 && (
                                      <>
                                        <span className="absolute inset-0 translate-x-2 translate-y-2 rounded-md border border-orange-100 bg-orange-50 shadow-sm" />
                                        <span className="absolute inset-0 translate-x-1 translate-y-1 rounded-md border border-orange-200 bg-white shadow-sm" />
                                      </>
                                    )}
                                    <span className="relative z-10 grid h-full w-full place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                    {previewPhoto ? (
                                      <img src={previewPhoto.signed_url || ''} alt={previewPhoto.file_name} className="h-full w-full object-cover transition group-hover:scale-105" />
                                    ) : (
                                      <span className="text-center text-xs font-semibold leading-5 text-slate-400">
                                        尚無照片
                                      </span>
                                    )}
                                    </span>
                                    {allPhotos.length > 1 && (
                                      <span className="absolute bottom-2 right-2 z-20 rounded-full bg-slate-950/80 px-2.5 py-1 text-xs font-black text-white shadow">
                                        +{allPhotos.length - 1}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => previewPhoto && openLightbox(urls, 0)}
                                    disabled={!previewPhoto}
                                    className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-3 text-xs font-black text-white hover:bg-orange-700 disabled:bg-slate-300"
                                  >
                                    <Camera size={14} />
                                    {allPhotos.length > 1 ? `看全部 ${allPhotos.length} 張照片` : '先看現場照片'}
                                  </button>
                                </div>
                              </div>
                            </section>

                            <details className="rounded-lg border border-slate-200 bg-white">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-slate-900">
                                <span className="inline-flex items-center gap-2">
                                  <Camera size={16} />
                                  照片與附件
                                </span>
                                <span className="text-xs font-bold text-slate-500">{allPhotos.length} 張照片</span>
                              </summary>
                              <div className="border-t border-slate-100 p-4">
                                {renderWorkOrderAttachmentStrip(selectedWorkOrder)}
                                <div className="mt-4">
                                  <ResourceAttachmentPanel
                                    resourceType="MAINTENANCE_REQUEST"
                                    resourceId={selectedWorkOrder.id}
                                    canManage={canUpdateWorkOrders}
                                    title="工單共用附件"
                                    emptyLabel="尚未上傳工單共用附件"
                                  />
                                </div>
                              </div>
                            </details>

                            <details className="rounded-lg border border-slate-200 bg-white">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-slate-900">
                                <span className="inline-flex items-center gap-2">
                                  <Wrench size={16} />
                                  設備 / 項目線索
                                </span>
                                <span className="text-xs font-bold text-slate-500">{getResourceLabel(selectedWorkOrder.resource_type)}</span>
                              </summary>
                              <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-4 border-t border-slate-100 p-4">
                                <button
                                  type="button"
                                  onClick={() => previewPhoto && openLightbox(urls, 0)}
                                  disabled={!previewPhoto}
                                  className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 disabled:cursor-default"
                                >
                                  {previewPhoto ? (
                                    <img src={previewPhoto.signed_url || ''} alt={previewPhoto.file_name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="grid h-full place-items-center text-slate-400">
                                      <Camera size={26} />
                                    </span>
                                  )}
                                </button>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-base font-black text-slate-900">{selectedWorkOrder.title}</div>
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">資源詳情待主檔關聯流程完成後開放</span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs font-semibold leading-5 text-slate-600 sm:grid-cols-2">
                                    <div>類別：{getResourceLabel(selectedWorkOrder.resource_type)}</div>
                                    <div>來源：{getWorkOrderSourceLabel(selectedWorkOrder)}</div>
                                    <div>序號：-</div>
                                    <div>品牌：-</div>
                                    <div className="sm:col-span-2">門市填寫位置：{selectedWorkOrder.location || '-'}</div>
                                  </div>
                                </div>
                              </div>
                            </details>

                            <details className="rounded-lg border border-blue-100 bg-blue-50">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-blue-900">
                                <span className="inline-flex items-center gap-2">
                                  <ClipboardList size={16} />
                                  目前處理狀態
                                </span>
                                <span className="text-xs font-bold text-blue-700">{getWorkOrderStageLabel(selectedWorkOrder)}</span>
                              </summary>
                              <div className="grid grid-cols-1 gap-2 border-t border-blue-100 p-4 text-sm sm:grid-cols-2">
                                {selectedWorkOrder.completion_method === 'STORE_CONFIRMED' && (
                                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 sm:col-span-2">
                                    <div className="flex items-start gap-2">
                                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                      <div>
                                        <div className="text-xs font-black text-emerald-700">門市回覆結果</div>
                                        <div className="mt-1 font-black text-emerald-950">門市已確認完成</div>
                                        <p className="mt-1 text-xs font-semibold leading-5 text-emerald-800">
                                          這張工單已由門市確認完成，後續可作為維修紀錄查詢。
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {selectedWorkOrder.unresolved_reason && (
                                  <div className="rounded-md border border-red-200 bg-red-50 p-3 sm:col-span-2">
                                    <div className="flex items-start gap-2">
                                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                                      <div>
                                        <div className="text-xs font-black text-red-700">門市回覆結果</div>
                                        <div className="mt-1 font-black text-red-950">門市回報仍有問題</div>
                                        <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-red-800">
                                          {selectedWorkOrder.unresolved_reason}
                                        </p>
                                        {getNormalizedStatus(selectedWorkOrder.status) !== 'COMPLETED' && (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              onClick={() => applyWorkOrderReworkFromStoreProblem(selectedWorkOrder)}
                                              disabled={!canUpdateWorkOrders}
                                              className="inline-flex h-8 items-center gap-2 rounded-md bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                                            >
                                              <Wrench size={14} />
                                              重新處理這張工單
                                            </button>
                                            <button
                                              type="button"
                                              onClick={applyWorkOrderCompletionRequest}
                                              disabled={!canUpdateWorkOrders}
                                              className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                            >
                                              <CheckCircle2 size={14} />
                                              已處理好，再送門市確認
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <div className="rounded-md bg-white/80 p-3">
                                  <div className="text-xs font-bold text-slate-500">目前階段</div>
                                  <div className="mt-1 font-black text-slate-900">{getWorkOrderStageLabel(selectedWorkOrder)}</div>
                                </div>
                                <div className="rounded-md bg-white/80 p-3">
                                  <div className="text-xs font-bold text-slate-500">建立時間</div>
                                  <div className="mt-1 font-black text-slate-900">{getDateTimeLabel(selectedWorkOrder.reported_at)}</div>
                                </div>
                                <div className="rounded-md bg-white/80 p-3">
                                  <div className="text-xs font-bold text-slate-500">工單編號</div>
                                  <button
                                    type="button"
                                    onClick={() => void navigator.clipboard?.writeText(getWorkOrderCode(selectedWorkOrder))}
                                    className="mt-1 inline-flex items-center gap-1 font-mono font-black text-slate-900 hover:text-orange-600"
                                  >
                                    {getWorkOrderCode(selectedWorkOrder)}
                                    <Copy size={13} />
                                  </button>
                                </div>
                                <div className="rounded-md bg-white/80 p-3">
                                  <div className="text-xs font-bold text-slate-500">實際完成</div>
                                  <div className="mt-1 font-black text-slate-900">{getDateTimeLabel(selectedWorkOrder.completed_at)}</div>
                                </div>
                              </div>
                            </details>

                            <details className="rounded-lg border border-slate-200 bg-white">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-slate-900">
                                <span className="inline-flex items-center gap-2">
                                  <Clock3 size={16} />
                                  處理紀錄
                                </span>
                                <span className="text-xs font-bold text-slate-500">{selectedUpdates.length} 筆</span>
                              </summary>
                              <div className="border-t border-slate-100 p-4">
                                {renderWorkOrderTimeline(selectedWorkOrder, selectedUpdates)}
                              </div>
                            </details>
                          </>
                        );
                      })()}
                  </div>
                  </div>

                  <div ref={workOrderUpdatePanelRef} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div>
                      <div className="font-bold text-slate-950">這張單你要怎麼處理？</div>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">選一個最接近的動作，系統會自動帶入階段與門市看得懂的進度文字。</p>
                    </div>
                    {workOrderUpdateNotice && (
                      <div className={`mt-4 rounded-lg border p-3 ${
                        workOrderUpdateNotice.type === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-red-200 bg-red-50 text-red-900'
                      }`}>
                        <div className="flex items-start gap-2">
                          {workOrderUpdateNotice.type === 'success'
                            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                          <div>
                            <div className="text-sm font-black">{workOrderUpdateNotice.title}</div>
                            <p className="mt-1 text-xs font-semibold leading-5 opacity-85">{workOrderUpdateNotice.body}</p>
                            {workOrderUpdateNotice.type === 'success' && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {workOrderUpdateNotice.kind === 'confirmation' ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => jumpToWorkOrderFocus('store_confirmation', 'PROCESSING')}
                                      className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
                                    >
                                      <CheckCircle2 size={14} />
                                      查看等待門市確認
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => router.push('/general-affairs/reports/mine')}
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                                    >
                                      <ClipboardList size={14} />
                                      開啟我的追蹤
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => jumpToWorkOrderFocus('all', 'PROCESSING')}
                                      className="inline-flex h-8 items-center gap-2 rounded-md bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700"
                                    >
                                      <Settings size={14} />
                                      繼續看處理中
                                    </button>
                                    <button
                                      type="button"
                                      onClick={loadReports}
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-orange-200 bg-white px-3 text-xs font-bold text-orange-800 hover:bg-orange-100"
                                    >
                                      <RefreshCw size={14} />
                                      重新整理
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {getNormalizedStatus(selectedWorkOrder.status) !== 'COMPLETED' && getNormalizedStage(selectedWorkOrder.progress_stage) === 'WAITING_STORE_CONFIRMATION' ? (
                      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                          <div>
                            <div className="font-black">已送門市確認，等待門市回覆</div>
                            <p className="mt-1 text-xs font-semibold leading-5 text-emerald-800">
                              這張工單目前不需要在工單中心再新增處理動作。門市確認完成後會自動結案；若門市回報有問題，系統會退回處理中並重新出現在待處理工單。
                            </p>
                            <div className="mt-3 grid gap-2 rounded-md border border-emerald-200 bg-white/80 p-3 text-xs font-bold text-emerald-900 sm:grid-cols-3">
                              <div>
                                <div className="text-emerald-600">店長看到的位置</div>
                                <div className="mt-1">我的追蹤 / 待確認中心</div>
                              </div>
                              <div>
                                <div className="text-emerald-600">店長要做的事</div>
                                <div className="mt-1">確認完成或回報有問題</div>
                              </div>
                              <div>
                                <div className="text-emerald-600">總務現在狀態</div>
                                <div className="mt-1">等待門市回覆</div>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={loadReports}
                                className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                              >
                                <RefreshCw size={14} />
                                重新整理回覆狀態
                              </button>
                              <button
                                type="button"
                                onClick={() => router.push('/general-affairs/reports/mine')}
                                className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
                              >
                                <ClipboardList size={14} />
                                前往我的追蹤確認
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : getNormalizedStatus(selectedWorkOrder.status) !== 'COMPLETED' ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {getRecommendedWorkOrderQuickActions(selectedWorkOrder)
                          .filter((quickAction) => quickAction.action !== 'FORCE_CLOSE' || canForceCloseWorkOrders)
                          .slice(0, 6)
                          .map((quickAction) => {
                          const QuickIcon = quickAction.icon;
                          const activeQuickAction =
                            workOrderUpdateForm.action === quickAction.action &&
                            workOrderUpdateForm.progressStage === quickAction.progressStage &&
                            workOrderUpdateForm.handlingMethod === quickAction.handlingMethod;
                          return (
                            <button
                              key={quickAction.label}
                              type="button"
                              onClick={() => applyWorkOrderQuickAction(quickAction)}
                              disabled={!canUpdateWorkOrders}
                              className={`rounded-lg border p-3 text-left transition hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50 ${
                                activeQuickAction ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-100' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                                <QuickIcon size={16} className={activeQuickAction ? 'text-orange-600' : 'text-slate-500'} />
                                {quickAction.label}
                              </div>
                              <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">{quickAction.helper}</div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {getNormalizedStatus(selectedWorkOrder.status) !== 'COMPLETED' && getNormalizedStage(selectedWorkOrder.progress_stage) !== 'WAITING_STORE_CONFIRMATION' && (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-orange-100 bg-orange-50/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-orange-700">已選下一步</div>
                            <div className="mt-1 text-sm font-black text-slate-950">
                              {selectedQuickAction?.label || (workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                                ? '送門市確認'
                                : workOrderUpdateForm.action === 'FORCE_CLOSE'
                                  ? '駁回'
                                  : MAINTENANCE_PROGRESS_STAGE_LABELS[workOrderUpdateForm.progressStage] || '新增處理進度')}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-bold">
                            <span className="rounded-md bg-white px-2 py-1 text-slate-600 ring-1 ring-orange-100">
                              {workOrderUpdateForm.visibility === 'PUBLIC' ? '門市看得到' : '僅內部紀錄'}
                            </span>
                            {workOrderUpdateForm.handlingMethod && (
                              <span className="rounded-md bg-white px-2 py-1 text-slate-600 ring-1 ring-orange-100">{workOrderUpdateForm.handlingMethod}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {selectedQuickAction && ['出庫', '調撥', '採購', '派工'].includes(selectedQuickAction.label) && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <div className="flex items-start gap-3">
                            <SelectedQuickActionIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-black text-blue-950">
                                {selectedQuickAction.label === '出庫' && '出庫作業'}
                                {selectedQuickAction.label === '調撥' && '調撥作業'}
                                {selectedQuickAction.label === '採購' && '採購評估作業'}
                                {selectedQuickAction.label === '派工' && '派工處理'}
                              </div>
                              <p className="mt-1 text-xs font-semibold leading-5 text-blue-800">
                                {selectedQuickAction.label === '出庫' && '先確認庫存與品項，完成出庫後再回到這張工單儲存進度或送門市確認。'}
                                {selectedQuickAction.label === '調撥' && '建立調撥單時會先記錄來源與目的，來源交出後扣庫存，目的確認收貨後才入庫。'}
                                {selectedQuickAction.label === '採購' && '採購需要在需求工作台記錄評估、廠商、金額與到貨入庫，方便後續成本追蹤。'}
                                {selectedQuickAction.label === '派工' && '安排人員聯繫或到場只是處理中；確認已設定完成、現場恢復後，請改送門市確認。'}
                              </p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {selectedQuickAction.label === '出庫' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => router.push('/general-affairs/inventory')}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                                    >
                                      <Warehouse size={14} />
                                      前往庫存出庫
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowAdvancedWorkOrderUpdate(true)}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-800 hover:bg-blue-100"
                                    >
                                      <ClipboardList size={14} />
                                      只先記錄進度
                                    </button>
                                  </>
                                )}
                                {selectedQuickAction.label === '調撥' && selectedWorkOrder && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => router.push(buildWorkOrderTransferUrl(selectedWorkOrder))}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                                    >
                                      <RefreshCw size={14} />
                                      建立調撥單
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => router.push('/general-affairs/inventory')}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-800 hover:bg-blue-100"
                                    >
                                      <Package size={14} />
                                      先查可調撥庫存
                                    </button>
                                  </>
                                )}
                                {selectedQuickAction.label === '採購' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => router.push('/general-affairs/requests')}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                                    >
                                      <ClipboardList size={14} />
                                      前往採購評估
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => router.push('/general-affairs/vendors')}
                                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-800 hover:bg-blue-100"
                                    >
                                      <Briefcase size={14} />
                                      查詢廠商資料
                                    </button>
                                  </>
                                )}
                                {selectedQuickAction.label === '派工' && (
                                  <div className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-blue-800 sm:col-span-2">
                                    請在下方「這次要送出什麼？」選擇只是更新處理進度，或處理好了要送門市確認。
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {workOrderUpdateForm.action === 'FORCE_CLOSE' && (
                        <label className="block text-sm font-semibold text-slate-700">
                          駁回原因
                          <input
                            value={workOrderUpdateForm.forceCloseReason}
                            onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, forceCloseReason: event.target.value })}
                            disabled={!canUpdateWorkOrders}
                            placeholder="請填寫駁回或不處理原因"
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                          />
                        </label>
                      )}
                      <label className="block text-sm font-semibold text-slate-700">
                        {workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                          ? '完成說明（店長會看到）'
                          : workOrderUpdateForm.visibility === 'PUBLIC'
                            ? '進度說明（店長會看到）'
                            : '內部處理備註'}
                        <textarea
                          value={workOrderUpdateForm.notes}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, notes: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          rows={4}
                          placeholder={workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                            ? '請寫清楚已完成什麼、店長要確認什麼，例如：已協助設定印表機連線，請確認其他電腦是否可正常列印。'
                            : '請寫目前處理到哪裡，例如：已安排資訊人員聯繫門市設定處理，後續會依處理結果更新進度。'}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-black text-slate-500">送出前確認</div>
                        <div className="mt-2 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2">
                          <div className="flex items-center gap-2">
                            {workOrderUpdateForm.notes.trim() ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-amber-600" />}
                            {workOrderUpdateForm.notes.trim()
                              ? workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                                ? '完成說明已填寫'
                                : '進度說明已填寫'
                              : workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                                ? '請先填寫完成說明'
                                : '請先填寫進度說明'}
                          </div>
                          <div className="flex items-center gap-2">
                            {workOrderUpdateForm.visibility === 'PUBLIC' || workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                              ? <CheckCircle2 size={15} className="text-emerald-600" />
                              : <AlertCircle size={15} className="text-slate-500" />}
                            {workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                              ? '會送門市確認'
                              : workOrderUpdateForm.visibility === 'PUBLIC'
                                ? '門市看得到這段進度'
                                : '這段只留內部紀錄'}
                          </div>
                          {workOrderUpdateForm.action === 'FORCE_CLOSE' && (
                            <div className="flex items-center gap-2 sm:col-span-2">
                              {workOrderUpdateForm.forceCloseReason.trim() ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-red-600" />}
                              {workOrderUpdateForm.forceCloseReason.trim() ? '駁回原因已填寫' : '駁回需填寫原因'}
                            </div>
                          )}
                        </div>
                      </div>
                      {workOrderUpdateForm.action !== 'FORCE_CLOSE' && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-sm font-black text-slate-900">這次要送出什麼？</div>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                            還在處理就選左邊；現場已處理好、要讓店長確認才選右邊。
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => applyWorkOrderProgressSaveMode(selectedWorkOrder)}
                              disabled={!canUpdateWorkOrders}
                              className={`rounded-lg border p-3 text-left transition disabled:opacity-50 ${
                                workOrderUpdateForm.action !== 'REQUEST_COMPLETION'
                                  ? 'border-orange-300 bg-orange-50 text-orange-950 ring-2 ring-orange-100'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2 text-sm font-black">
                                <Send size={15} />
                                只是更新處理進度
                              </div>
                              <div className="mt-1 text-xs font-semibold leading-5 opacity-80">
                                例如已安排人員聯繫、等待廠商、還在處理中。
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={applyWorkOrderCompletionRequest}
                              disabled={!canUpdateWorkOrders}
                              className={`rounded-lg border p-3 text-left transition disabled:opacity-50 ${
                                workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-100'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2 text-sm font-black">
                                <CheckCircle2 size={15} />
                                處理好了，送門市確認
                              </div>
                              <div className="mt-1 text-xs font-semibold leading-5 opacity-80">
                                店長會在我的追蹤確認完成或回報問題。
                              </div>
                            </button>
                          </div>
                          {workOrderUpdateForm.action === 'REQUEST_COMPLETION' && (
                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                              <div className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                <div className="min-w-0">
                                  <div className="text-xs font-black text-emerald-800">送門市確認前再確認</div>
                                  <div className="mt-2 grid gap-2 text-xs font-bold text-emerald-900 sm:grid-cols-3">
                                    <div className="rounded-md bg-white/80 px-2 py-2">
                                      <div className="text-emerald-600">店長會看到</div>
                                      <div className="mt-1">待確認中心</div>
                                    </div>
                                    <div className="rounded-md bg-white/80 px-2 py-2">
                                      <div className="text-emerald-600">店長可以選</div>
                                      <div className="mt-1">確認完成 / 回報問題</div>
                                    </div>
                                    <div className="rounded-md bg-white/80 px-2 py-2">
                                      <div className="text-emerald-600">工單會變成</div>
                                      <div className="mt-1">等待門市回覆</div>
                                    </div>
                                  </div>
                                  <p className="mt-2 text-xs font-semibold leading-5 text-emerald-800">
                                    請確認處理內容已寫清楚，店長會依這段文字判斷是否完成。
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowAdvancedWorkOrderUpdate((value) => !value)}
                        className="inline-flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <span>進階設定：階段、承辦人、可見性、日期</span>
                        <ChevronDown size={15} className={`transition ${showAdvancedWorkOrderUpdate ? 'rotate-180' : ''}`} />
                      </button>
                      {showAdvancedWorkOrderUpdate && (
                        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                          <label className="block text-sm font-semibold text-slate-700">
                            處理動作
                            <select
                              value={workOrderUpdateForm.action}
                              onChange={(event) => setWorkOrderUpdateForm({
                                ...workOrderUpdateForm,
                                action: event.target.value as typeof workOrderUpdateForm.action,
                                progressStage: event.target.value === 'REQUEST_COMPLETION' ? 'WAITING_STORE_CONFIRMATION' : workOrderUpdateForm.progressStage,
                                visibility: event.target.value === 'REQUEST_COMPLETION' ? 'PUBLIC' : workOrderUpdateForm.visibility,
                              })}
                              disabled={!canUpdateWorkOrders}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            >
                              <option value="SAVE_PROGRESS">新增處理進度</option>
                              <option value="REQUEST_COMPLETION">處理完成，請門市確認</option>
                              {canForceCloseWorkOrders && <option value="FORCE_CLOSE">駁回 / 強制結案</option>}
                            </select>
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            目前處理進度
                            <select
                              value={workOrderUpdateForm.progressStage}
                              onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, progressStage: event.target.value as MaintenanceProgressStage })}
                              disabled={!canUpdateWorkOrders || workOrderUpdateForm.action === 'REQUEST_COMPLETION'}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            >
                              {progressStageOptions.map((stage) => <option key={stage.code} value={stage.code}>{stage.name}</option>)}
                            </select>
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            處理方式
                            <select
                              value={workOrderUpdateForm.handlingMethod}
                              onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, handlingMethod: event.target.value })}
                              disabled={!canUpdateWorkOrders}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            >
                              <option value="">請選擇處理方式</option>
                              {workOrderHandlingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            紀錄可見性
                            <select
                              value={workOrderUpdateForm.visibility}
                              onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, visibility: event.target.value as 'PUBLIC' | 'INTERNAL' })}
                              disabled={!canUpdateWorkOrders || workOrderUpdateForm.action === 'REQUEST_COMPLETION'}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            >
                              <option value="PUBLIC">公開進度</option>
                              <option value="INTERNAL">內部備註</option>
                            </select>
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            承辦人
                            <input
                              value={workOrderUpdateForm.assigneeName}
                              onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, assigneeName: event.target.value })}
                              disabled={!canUpdateWorkOrders}
                              placeholder="請輸入承辦人姓名"
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            />
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            紀錄日期
                            <input
                              type="date"
                              value={workOrderUpdateForm.progressDate}
                              onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, progressDate: event.target.value })}
                              disabled={!canUpdateWorkOrders}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                            />
                          </label>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => submitWorkOrderUpdate(selectedWorkOrder.id)}
                        disabled={!canUpdateWorkOrders || !workOrderUpdateForm.notes.trim() || (workOrderUpdateForm.action === 'FORCE_CLOSE' && (!canForceCloseWorkOrders || !workOrderUpdateForm.forceCloseReason.trim())) || savingWorkOrderUpdate}
                        className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                          workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : workOrderUpdateForm.action === 'FORCE_CLOSE'
                              ? 'bg-red-600 hover:bg-red-700'
                              : 'bg-orange-500 hover:bg-orange-600'
                        }`}
                      >
                        {savingWorkOrderUpdate ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        {workOrderUpdateForm.action === 'REQUEST_COMPLETION'
                          ? '送出：請門市確認'
                          : workOrderUpdateForm.action === 'FORCE_CLOSE'
                            ? '送出：駁回'
                            : '送出：儲存處理進度'}
                      </button>
                    </div>
                    )}
                  </div>

                </div>
              ) : (
                <div className="grid h-full min-h-[360px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  請先選擇左側工單
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
      </GeneralAffairsListPage>
    );
  };

  const renderVendorStatusBadge = (status: VendorStatus | VendorCategoryStatus | VendorRegionStatus, scope: 'vendor' | 'setting' = 'vendor') => {
    const meta: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      paused: 'bg-orange-50 text-orange-700 border-orange-200',
      inactive: 'bg-slate-100 text-slate-600 border-slate-200',
      archived: 'bg-slate-100 text-slate-500 border-slate-200',
    };
    const label: Record<string, string> = {
      active: scope === 'vendor' ? '合作中' : '啟用中',
      paused: '暫停合作',
      inactive: scope === 'vendor' ? '已停用' : '停用中',
      archived: '已歸檔',
    };
    return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta[status] || meta.inactive}`}>{label[status] || status}</span>;
  };

  const renderVendorHeader = (title: string, description: string, actionLabel?: string, onAction?: () => void) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-sm text-slate-500">廠商管理 / {title}</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex gap-2">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Plus size={16} />
            {actionLabel}
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download size={16} />
          匯出Excel
        </button>
      </div>
    </div>
  );

  const renderVendorDashboardCards = () => (
    <div className="grid gap-3 md:grid-cols-4">
      {[
        { label: '全部廠商', value: vendors.length, helper: '查看全部', icon: Tags, tone: 'bg-blue-50 text-blue-600' },
        { label: '合作中', value: vendorStats.active, helper: vendors.length ? `${Math.round((vendorStats.active / vendors.length) * 100)}%` : '0%', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' },
        { label: '暫停合作', value: vendorStats.paused, helper: vendors.length ? `${Math.round((vendorStats.paused / Math.max(vendors.length, 1)) * 100)}%` : '0%', icon: Clock3, tone: 'bg-amber-50 text-amber-600' },
        { label: '已停用', value: vendorStats.inactive, helper: vendors.length ? `${Math.round((vendorStats.inactive / Math.max(vendors.length, 1)) * 100)}%` : '0%', icon: XCircle, tone: 'bg-red-50 text-red-600' },
      ].map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-full ${card.tone}`}>
                <Icon size={20} />
              </span>
              <div>
                <div className="text-xs font-bold text-slate-500">{card.label}</div>
                <div className="mt-1 text-2xl font-black text-slate-950">{card.value}</div>
                <div className="mt-1 text-xs text-slate-500">{card.helper}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderVendorList = () => {
    if (isVendorFormOpen) return renderVendorFormPanel();

    return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {renderVendorHeader('廠商列表', '管理合作廠商資料、服務項目與聯絡資訊，並追蹤廠商服務績效', '新增廠商', openVendorForm)}
        {renderVendorDashboardCards()}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <label className="relative min-w-[260px] flex-1">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                value={vendorSearch}
                onChange={(event) => setVendorSearch(event.target.value)}
                placeholder="搜尋廠商名稱 / 聯絡人 / 電話"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <select value={vendorCategoryFilter} onChange={(event) => setVendorCategoryFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500">
              <option value="">服務分類：全部</option>
              {vendorCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select value={vendorRegionFilter} onChange={(event) => setVendorRegionFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500">
              <option value="">服務區域：全部</option>
              {vendorRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
            <select value={vendorStatusFilter} onChange={(event) => setVendorStatusFilter(event.target.value as any)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500">
              <option value="all">合作狀態：全部</option>
              <option value="active">合作中</option>
              <option value="paused">暫停合作</option>
              <option value="inactive">已停用</option>
            </select>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-4 py-3">廠商名稱</th>
                  <th className="px-4 py-3">服務分類</th>
                  <th className="px-4 py-3">服務區域</th>
                  <th className="px-4 py-3">聯絡人 / 手機</th>
                  <th className="px-4 py-3">合作狀態</th>
                  <th className="px-4 py-3">近期工單</th>
                  <th className="px-4 py-3">評價</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingVendors ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
                ) : filteredVendors.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">目前沒有符合條件的廠商</td></tr>
                ) : filteredVendors.map((vendor) => (
                  <tr key={vendor.id} className={`cursor-pointer hover:bg-slate-50 ${selectedVendorId === vendor.id ? 'bg-orange-50/60' : ''}`} onClick={() => setSelectedVendorId(vendor.id)}>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-blue-600"><Briefcase size={18} /></span>
                        <div>
                          <div className="font-bold text-slate-900">{vendor.name}</div>
                          <div className="text-xs text-slate-500">{vendor.alias || vendor.tax_id || '未填統一編號'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{(vendor.service_category_ids || []).slice(0, 2).map(getCategoryName).join('、') || '-'}</td>
                    <td className="px-4 py-4 text-slate-600">{(vendor.service_region_ids || []).slice(0, 2).map(getRegionName).join('、') || '-'}</td>
                    <td className="px-4 py-4"><div>{vendor.contact_name || '-'}</div><div className="text-xs text-slate-500">{vendor.contact_phone || vendor.phone || '-'}</div></td>
                    <td className="px-4 py-4">{renderVendorStatusBadge(vendor.status)}</td>
                    <td className="px-4 py-4 text-slate-600">{vendor.work_order_count || 0} 件<div className="text-xs">本月 {vendor.monthly_order_count || 0} 件</div></td>
                    <td className="px-4 py-4"><span className="inline-flex items-center gap-1 text-amber-600"><Star size={14} fill="currentColor" />{Number(vendor.rating || 0).toFixed(1)}</span><div className="text-xs text-slate-500">({vendor.review_count || 0})</div></td>
                    <td className="px-4 py-4"><button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 hover:bg-slate-50"><MoreHorizontal size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <aside className="rounded-lg border border-slate-200 bg-white p-5">
        {selectedVendor ? (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">{selectedVendor.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedVendor.description || '尚未填寫廠商簡介'}</p>
              </div>
              {renderVendorStatusBadge(selectedVendor.status)}
            </div>
            <div className="mt-5 grid gap-3 text-sm">
              {[
                ['廠商類型', selectedVendor.vendor_type === 'company' ? '公司' : selectedVendor.vendor_type === 'studio' ? '工作室' : '個人工作室'],
                ['統一編號', selectedVendor.tax_id || '-'],
                ['聯絡人', selectedVendor.contact_name || '-'],
                ['聯絡電話', selectedVendor.contact_phone || selectedVendor.phone || '-'],
                ['LINE ID', selectedVendor.line_id || '-'],
                ['電子郵件', selectedVendor.email || '-'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <span className="font-semibold text-slate-500">{label}</span>
                  <span className="text-right text-slate-800">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-3">
              <div>
                <div className="text-xs font-bold text-slate-500">服務分類</div>
                <div className="mt-2 flex flex-wrap gap-2">{(selectedVendor.service_category_ids || []).map((id) => <span key={id} className="rounded bg-slate-100 px-2 py-1 text-xs">{getCategoryName(id)}</span>)}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">服務區域</div>
                <div className="mt-2 flex flex-wrap gap-2">{(selectedVendor.service_region_ids || []).map((id) => <span key={id} className="rounded bg-slate-100 px-2 py-1 text-xs">{getRegionName(id)}</span>)}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">熟悉品牌</div>
                <div className="mt-2 flex flex-wrap gap-2">{(selectedVendor.brands || []).map((brand) => <span key={brand} className="rounded bg-slate-100 px-2 py-1 text-xs">{brand}</span>)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[320px] place-items-center text-center text-sm text-slate-500">選擇廠商查看詳細資料</div>
        )}
      </aside>
    </div>
    );
  };

  const renderVendorCategories = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {renderVendorHeader('服務分類管理', '管理服務分類項目，供廠商設定服務能力與工單分類使用', '新增分類', openNewCategoryForm)}
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ['全部分類', vendorCategories.length, Folder, 'bg-blue-50 text-blue-600'],
            ['啟用中', categoryStats.active, CheckCircle2, 'bg-emerald-50 text-emerald-600'],
            ['停用中', categoryStats.inactive, XCircle, 'bg-red-50 text-red-600'],
            ['近期新增', categoryStats.recent, Tags, 'bg-slate-100 text-slate-600'],
          ].map(([label, value, Icon, tone]: any) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-full ${tone}`}><Icon size={20} /></span><div><div className="text-xs font-bold text-slate-500">{label}</div><div className="text-2xl font-black">{value}</div></div></div></div>)}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500"><tr><th className="px-4 py-3">分類名稱</th><th className="px-4 py-3">分類代碼</th><th className="px-4 py-3">上層分類</th><th className="px-4 py-3">包含項目數</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">排序</th><th className="px-4 py-3">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {vendorCategories.map((category) => (
                <tr key={category.id}>
                  <td className="px-4 py-3 font-bold text-slate-900"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded bg-blue-50 text-blue-600"><Folder size={15} /></span>{category.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{category.code}</td>
                  <td className="px-4 py-3 text-slate-600">{category.parent_id ? getCategoryName(category.parent_id) : '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{category.common_items?.length || 0}</td>
                  <td className="px-4 py-3">{renderVendorStatusBadge(category.status, 'setting')}</td>
                  <td className="px-4 py-3 text-slate-600">{category.sort_order}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openEditCategoryForm(category)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-orange-600"
                    >
                      <Pencil size={14} />
                      編輯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {renderCategoryFormPanel()}
    </div>
  );

  const renderVendorRegions = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {renderVendorHeader('服務區域管理', '管理服務區域，供廠商設定可服務範圍使用', '新增服務區域', () => setIsRegionFormOpen(true))}
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ['全部區域', vendorRegions.length, Globe, 'bg-blue-50 text-blue-600'],
            ['啟用中', regionStats.active, CheckCircle2, 'bg-emerald-50 text-emerald-600'],
            ['停用中', regionStats.inactive, Clock3, 'bg-orange-50 text-orange-600'],
            ['已歸檔', regionStats.archived, Warehouse, 'bg-slate-100 text-slate-600'],
          ].map(([label, value, Icon, tone]: any) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-full ${tone}`}><Icon size={20} /></span><div><div className="text-xs font-bold text-slate-500">{label}</div><div className="text-2xl font-black">{value}</div></div></div></div>)}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500"><tr><th className="px-4 py-3">區域名稱</th><th className="px-4 py-3">區域代碼</th><th className="px-4 py-3">類型</th><th className="px-4 py-3">包含範圍</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">廠商使用數</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {vendorRegions.map((region) => (
                <tr key={region.id}>
                  <td className="px-4 py-3 font-bold text-slate-900"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded bg-blue-50 text-blue-600"><MapPin size={15} /></span>{region.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{region.code}</td>
                  <td className="px-4 py-3 text-slate-600">{region.region_type}</td>
                  <td className="px-4 py-3 text-slate-600">{(region.included_locations || []).slice(0, 4).join('、') || '-'}</td>
                  <td className="px-4 py-3">{renderVendorStatusBadge(region.status, 'setting')}</td>
                  <td className="px-4 py-3 text-slate-600">{vendors.filter((vendor) => (vendor.service_region_ids || []).includes(region.id)).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {renderRegionFormPanel()}
    </div>
  );

  const renderPurchaseAnalysis = () => {
    const totalAmount = purchaseAnalysis?.totalAmount || 0;
    const completeness = purchaseAnalysis?.purchaseCount
      ? Math.round((purchaseAnalysis.amountFilledCount / purchaseAnalysis.purchaseCount) * 100)
      : 0;
    const renderRanking = (title: string, rows: PurchaseAnalysisRank[]) => (
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">{title}</div>
        <div className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">這個月份尚無資料</div>
          ) : rows.map((item, index) => (
            <div key={item.key} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
              <span className="font-black text-slate-400">{index + 1}</span>
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-900">{item.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{item.count} 筆</div>
              </div>
              <div className="text-right">
                <div className="font-black text-slate-950">{formatPurchaseAmount(item.amount)}</div>
                <div className="mt-0.5 text-xs text-slate-500">占 {totalAmount ? Math.round((item.amount / totalAmount) * 100) : 0}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">廠商管理 / 採購分析</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">採購分析</h1>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-bold text-slate-500">
              年月
              <input
                type="month"
                value={purchaseAnalysisMonth}
                onChange={(event) => setPurchaseAnalysisMonth(event.target.value)}
                className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadPurchaseAnalysis()}
              disabled={purchaseAnalysisLoading || !purchaseAnalysisMonth}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {purchaseAnalysisLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              查詢
            </button>
          </div>
        </div>

        {purchaseAnalysisError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{purchaseAnalysisError}</div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['採購總額', formatPurchaseAmount(totalAmount), ShoppingCart, 'bg-orange-50 text-orange-600'],
            ['採購筆數', `${purchaseAnalysis?.purchaseCount || 0} 筆`, ClipboardList, 'bg-blue-50 text-blue-600'],
            ['金額完整度', `${completeness}%`, CheckCircle2, completeness === 100 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'],
          ].map(([label, value, Icon, tone]: any) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-md ${tone}`}><Icon size={20} /></span>
                <div>
                  <div className="text-xs font-bold text-slate-500">{label}</div>
                  <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {purchaseAnalysis && purchaseAnalysis.missingAmountCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            <AlertCircle size={17} />
            尚有 {purchaseAnalysis.missingAmountCount} 筆未填金額
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {renderRanking('門市採購金額', purchaseAnalysis?.topStores || [])}
          {renderRanking('廠商採購金額', purchaseAnalysis?.topVendors || [])}
        </div>
      </div>
    );
  };

  const renderVendorStats = () => {
    const topVendors = [...vendors].sort((a, b) => Number(b.work_order_count || 0) - Number(a.work_order_count || 0)).slice(0, 5);
    const categoryUsage = vendorCategories.map((category) => ({
      category,
      count: vendors.filter((vendor) => (vendor.service_category_ids || []).includes(category.id)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 6);
    const regionUsage = vendorRegions.map((region) => ({
      region,
      count: vendors.filter((vendor) => (vendor.service_region_ids || []).includes(region.id)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 6);

    return (
      <div className="space-y-4">
        {renderVendorHeader('合作記錄統計', '統計廠商合作表現與歷史服務記錄，協助評估與管理合作效能')}
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          {[
            ['合作廠商總數', `${vendors.length} 家`, `合作中 ${vendorStats.active} / 暫停 ${vendorStats.paused}`, Briefcase, 'bg-blue-50 text-blue-600'],
            ['工單總數', `${vendorStats.totalWorkOrders} 件`, `已完成 ${vendorStats.completedWorkOrders} 件`, ClipboardList, 'bg-emerald-50 text-emerald-600'],
            ['已完成工單', `${vendorStats.completedWorkOrders} 件`, `完成率 ${vendorStats.totalWorkOrders ? Math.round((vendorStats.completedWorkOrders / vendorStats.totalWorkOrders) * 100) : 0}%`, CheckCircle2, 'bg-green-50 text-green-600'],
            ['總維修金額', `$${Number(vendorStats.totalAmount || 0).toLocaleString()}`, '依廠商資料統計', Package, 'bg-orange-50 text-orange-600'],
            ['平均處理天數', `${vendorStats.avgDays.toFixed(1)} 天`, '依廠商資料統計', Clock3, 'bg-blue-50 text-blue-600'],
            ['滿意度平均分數', `${vendorStats.avgRating.toFixed(1)} / 5`, '依廠商評分統計', Star, 'bg-amber-50 text-amber-600'],
          ].map(([label, value, helper, Icon, tone]: any) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
              <span className={`grid h-10 w-10 place-items-center rounded-full ${tone}`}><Icon size={20} /></span>
              <div className="mt-3 text-xs font-bold text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{helper}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-black text-slate-950">廠商合作績效排名</h2>
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500"><tr><th className="px-3 py-2">排名</th><th className="px-3 py-2">廠商名稱</th><th className="px-3 py-2">工單數</th><th className="px-3 py-2">總金額</th><th className="px-3 py-2">平均天數</th><th className="px-3 py-2">滿意度</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {topVendors.map((vendor, index) => (
                    <tr key={vendor.id}>
                      <td className="px-3 py-3 font-black text-orange-600">{index + 1}</td>
                      <td className="px-3 py-3 font-bold text-slate-900">{vendor.name}</td>
                      <td className="px-3 py-3">{vendor.work_order_count || 0}</td>
                      <td className="px-3 py-3">${Number(vendor.total_amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-3">{Number(vendor.avg_days || 0).toFixed(1)} 天</td>
                      <td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-amber-600"><Star size={14} fill="currentColor" />{Number(vendor.rating || 0).toFixed(1)}</span></td>
                    </tr>
                  ))}
                  {topVendors.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">尚無合作統計資料</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-black text-slate-950">服務分類統計</h3>
              <div className="mt-4 space-y-3">
                {categoryUsage.map(({ category, count }) => (
                  <div key={category.id}>
                    <div className="flex justify-between text-sm"><span>{category.name}</span><span className="font-bold">{count}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-500" style={{ width: `${vendors.length ? Math.max(8, (count / vendors.length) * 100) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-black text-slate-950">服務區域統計</h3>
              <div className="mt-4 space-y-3">
                {regionUsage.map(({ region, count }) => (
                  <div key={region.id}>
                    <div className="flex justify-between text-sm"><span>{region.name}</span><span className="font-bold">{count}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-orange-500" style={{ width: `${vendors.length ? Math.max(8, (count / vendors.length) * 100) : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderVendorRegionTree = (regions: VendorRegion[], level = 0) => {
    const keyword = regionSearch.trim().toLowerCase();
    return regions
      .filter((region) => region.status === 'active' && regionMatchesSearch(region, keyword))
      .map((region) => {
        const children = getRegionChildren(region.id).filter((child) => child.status === 'active' && regionMatchesSearch(child, keyword));
        const hasChildren = children.length > 0;
        const expanded = expandedRegionIds.includes(region.id) || Boolean(keyword);
        const selected = vendorForm.regionIds.includes(region.id);
        const descendantSelected = getRegionDescendantIds(region.id).some((id) => vendorForm.regionIds.includes(id));

        return (
          <div key={region.id}>
            <div
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${selected ? 'bg-orange-50 text-orange-700' : descendantSelected ? 'bg-slate-50 text-slate-800' : 'text-slate-700 hover:bg-slate-50'}`}
              style={{ paddingLeft: `${8 + level * 18}px` }}
            >
              {hasChildren ? (
                <button type="button" onClick={() => toggleExpandedRegion(region.id)} className="grid h-6 w-6 place-items-center rounded hover:bg-white">
                  <ChevronRight size={15} className={expanded ? 'rotate-90' : ''} />
                </button>
              ) : (
                <span className="h-6 w-6" />
              )}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleVendorRegionSelection(region)}
                />
                <span className="truncate font-semibold">{region.name}</span>
                {region.region_type === 'city' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">全縣市</span>}
              </label>
              {hasChildren && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{children.length}</span>}
            </div>
            {hasChildren && expanded && (
              <div className="mt-1 space-y-1">
                {renderVendorRegionTree(children, level + 1)}
              </div>
            )}
          </div>
        );
      });
  };

  const renderVendorFormPanel = () => {
    const currentStepIndex = vendorFormSteps.findIndex((step) => step.key === vendorFormStep);
    const isLastStep = vendorFormStep === 'attachments';
    const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-sm font-semibold text-slate-500">廠商管理 / 廠商列表 / 新增廠商</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">新增廠商</h1>
            <p className="mt-1 text-sm text-slate-500">建立新的合作廠商資料</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={closeVendorForm} className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
            <button type="button" onClick={saveVendor} disabled={savingVendor || !vendorForm.name.trim()} className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">暫存</button>
            {isLastStep ? (
              <button type="button" onClick={saveVendor} disabled={savingVendor} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                {savingVendor ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                完成新增
              </button>
            ) : (
              <button type="button" onClick={goNextVendorFormStep} className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600">下一步</button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="grid gap-2 border-b border-slate-200 p-4 md:grid-cols-5">
            {vendorFormSteps.map((step, index) => {
              const active = vendorFormStep === step.key;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setVendorFormStep(step.key)}
                  className={`flex items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm font-bold ${active ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${active ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>{index + 1}</span>
                  {step.label}
                </button>
              );
            })}
          </div>

          <div className="p-5">
            {vendorFormStep === 'basic' && (
              <div className="grid gap-5">
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="mb-4 font-black text-slate-950">基本資訊</h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="text-sm font-semibold text-slate-700">廠商名稱 *<input value={vendorForm.name} onChange={(event) => setVendorForm({ ...vendorForm, name: event.target.value })} className={inputClass} placeholder="請輸入廠商名稱" /></label>
                    <label className="text-sm font-semibold text-slate-700">廠商類型 *<select value={vendorForm.vendorType} onChange={(event) => setVendorForm({ ...vendorForm, vendorType: event.target.value as Vendor['vendor_type'] })} className={inputClass}><option value="company">公司</option><option value="studio">工作室</option><option value="personal">個人工作室</option></select></label>
                    <label className="text-sm font-semibold text-slate-700">統一編號<input value={vendorForm.taxId} onChange={(event) => setVendorForm({ ...vendorForm, taxId: event.target.value })} className={inputClass} placeholder="請輸入統一編號" /></label>
                    <label className="text-sm font-semibold text-slate-700">品牌名稱 / 別名<input value={vendorForm.alias} onChange={(event) => setVendorForm({ ...vendorForm, alias: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">成立日期<input type="date" value={vendorForm.foundedDate} onChange={(event) => setVendorForm({ ...vendorForm, foundedDate: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">合作狀態 *<select value={vendorForm.status} onChange={(event) => setVendorForm({ ...vendorForm, status: event.target.value as VendorStatus })} className={inputClass}><option value="active">合作中</option><option value="paused">暫停合作</option><option value="inactive">已停用</option></select></label>
                    <label className="text-sm font-semibold text-slate-700">公司電話<input value={vendorForm.phone} onChange={(event) => setVendorForm({ ...vendorForm, phone: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">傳真號碼<input value={vendorForm.fax} onChange={(event) => setVendorForm({ ...vendorForm, fax: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">公司網站<input value={vendorForm.website} onChange={(event) => setVendorForm({ ...vendorForm, website: event.target.value })} className={inputClass} placeholder="https://..." /></label>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-[160px_160px_minmax(0,1fr)]">
                    <label className="text-sm font-semibold text-slate-700">公司縣市<input value={vendorForm.city} onChange={(event) => setVendorForm({ ...vendorForm, city: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">公司區域<input value={vendorForm.district} onChange={(event) => setVendorForm({ ...vendorForm, district: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">詳細地址<input value={vendorForm.address} onChange={(event) => setVendorForm({ ...vendorForm, address: event.target.value })} className={inputClass} /></label>
                  </div>
                  <div className="mt-4">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={vendorForm.sameServiceAddress} onChange={(event) => setVendorForm({ ...vendorForm, sameServiceAddress: event.target.checked })} />服務據點同公司地址</label>
                    {!vendorForm.sameServiceAddress && (
                      <div className="mt-3 grid gap-4 md:grid-cols-[160px_160px_minmax(0,1fr)]">
                        <input value={vendorForm.serviceCity} onChange={(event) => setVendorForm({ ...vendorForm, serviceCity: event.target.value })} className={inputClass} placeholder="服務縣市" />
                        <input value={vendorForm.serviceDistrict} onChange={(event) => setVendorForm({ ...vendorForm, serviceDistrict: event.target.value })} className={inputClass} placeholder="服務區域" />
                        <input value={vendorForm.serviceAddress} onChange={(event) => setVendorForm({ ...vendorForm, serviceAddress: event.target.value })} className={inputClass} placeholder="服務地址" />
                      </div>
                    )}
                  </div>
                  <label className="mt-4 block text-sm font-semibold text-slate-700">公司簡介<textarea value={vendorForm.description} onChange={(event) => setVendorForm({ ...vendorForm, description: event.target.value })} rows={4} className={inputClass} placeholder="請輸入公司簡介、主要服務內容或特色..." /></label>
                  <div className="mt-4 block text-sm font-semibold text-slate-700">
                    標籤
                    <input
                      value={vendorTagInput}
                      onChange={(event) => setVendorTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addVendorTag();
                        }
                      }}
                      className={inputClass}
                      placeholder="請輸入標籤後按 Enter 新增"
                    />
                    <div className="mt-1 text-xs font-normal text-slate-500">可加入廠商特色、服務範圍或管理用關鍵字。</div>
                    {getVendorTags().length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {getVendorTags().map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeVendorTag(tag)}
                              className="text-slate-400 hover:text-slate-700"
                              aria-label={`移除${tag}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {vendorFormStep === 'services' && (
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">服務項目設定</h2>
                  <div className="mt-4 max-h-[420px] space-y-3 overflow-auto pr-2">
                    {vendorCategories.map((category) => (
                      <label key={category.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${vendorForm.categoryIds.includes(category.id) ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-700'}`}>
                        <span className="flex items-center gap-2"><input type="checkbox" checked={vendorForm.categoryIds.includes(category.id)} onChange={() => toggleVendorFormArray('categoryIds', category.id)} />{category.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{category.common_items?.length || 0}</span>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="space-y-5">
                  <div className="rounded-lg border border-slate-200 p-5">
                    <h2 className="font-black text-slate-950">已選擇的服務項目（{vendorForm.categoryIds.length}）</h2>
                    <div className="mt-3 space-y-2">
                      {vendorForm.categoryIds.length === 0 ? <div className="text-sm text-slate-500">尚未選擇服務分類</div> : vendorForm.categoryIds.map((id) => (
                        <div key={id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                          {getCategoryName(id)}
                          <button type="button" onClick={() => toggleVendorFormArray('categoryIds', id)} className="text-slate-400 hover:text-slate-700">×</button>
                        </div>
                      ))}
                    </div>
                    <label className="mt-4 block text-sm font-semibold text-slate-700">服務能力說明<textarea value={vendorForm.serviceCapabilityNote} onChange={(event) => setVendorForm({ ...vendorForm, serviceCapabilityNote: event.target.value })} rows={4} className={inputClass} placeholder="請描述廠商的服務特色、專長、設備或服務能力等..." /></label>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-black text-slate-950">服務區域設定</h2>
                        <p className="mt-1 text-sm text-slate-500">可選擇整個縣市，或展開到行政區精準設定。</p>
                      </div>
                      {vendorForm.regionIds.length > 0 && (
                        <button type="button" onClick={() => setVendorForm({ ...vendorForm, regionIds: [] })} className="text-sm font-semibold text-orange-600 hover:text-orange-700">清除全部</button>
                      )}
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="rounded-lg border border-slate-200">
                        <div className="border-b border-slate-200 p-3">
                          <label className="relative block">
                            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                            <input
                              value={regionSearch}
                              onChange={(event) => setRegionSearch(event.target.value)}
                              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                              placeholder="搜尋縣市或行政區"
                            />
                          </label>
                        </div>
                        <div className="max-h-[420px] space-y-1 overflow-auto p-2">
                          {renderVendorRegionTree(getRegionChildren(null))}
                        </div>
                      </div>
                      <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-slate-950">已選服務範圍</h3>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">{vendorForm.regionIds.length}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {vendorForm.regionIds.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">尚未選擇服務區域</div>
                          ) : vendorForm.regionIds.map((id) => (
                            <span key={id} className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                              {getRegionLabel(id)}
                              <button type="button" onClick={() => removeVendorRegionSelection(id)} className="text-slate-400 hover:text-slate-700">×</button>
                            </span>
                          ))}
                        </div>
                        {selectedRegionLabels.length > 0 && (
                          <div className="mt-4 rounded-lg bg-white p-3 text-xs leading-5 text-slate-500">
                            已選：{selectedRegionLabels.slice(0, 5).join('、')}{selectedRegionLabels.length > 5 ? ` 等 ${selectedRegionLabels.length} 個區域` : ''}
                          </div>
                        )}
                      </aside>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {vendorFormStep === 'contacts' && (
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">聯絡人資訊</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">主要聯絡人<input value={vendorForm.contactName} onChange={(event) => setVendorForm({ ...vendorForm, contactName: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">手機<input value={vendorForm.contactPhone} onChange={(event) => setVendorForm({ ...vendorForm, contactPhone: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">LINE ID<input value={vendorForm.lineId} onChange={(event) => setVendorForm({ ...vendorForm, lineId: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">Email<input value={vendorForm.email} onChange={(event) => setVendorForm({ ...vendorForm, email: event.target.value })} className={inputClass} /></label>
                  </div>
                </section>
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">帳務資訊</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">發票抬頭<input value={vendorForm.billingTitle} onChange={(event) => setVendorForm({ ...vendorForm, billingTitle: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">發票類型<select value={vendorForm.invoiceType} onChange={(event) => setVendorForm({ ...vendorForm, invoiceType: event.target.value })} className={inputClass}><option>二聯式</option><option>三聯式</option><option>電子發票</option></select></label>
                    <label className="text-sm font-semibold text-slate-700">付款條件<select value={vendorForm.paymentTerms} onChange={(event) => setVendorForm({ ...vendorForm, paymentTerms: event.target.value })} className={inputClass}><option>月結30天</option><option>月結45天</option><option>現結</option></select></label>
                    <label className="text-sm font-semibold text-slate-700">發票地址<input value={vendorForm.billingAddress} onChange={(event) => setVendorForm({ ...vendorForm, billingAddress: event.target.value })} className={inputClass} /></label>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold text-slate-700">付款方式</div>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {['匯款', '支票', '現金'].map((method) => <label key={method} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={vendorForm.paymentMethods.includes(method)} onChange={() => toggleVendorPaymentMethod(method)} />{method}</label>)}
                    </div>
                  </div>
                  <label className="mt-4 block text-sm font-semibold text-slate-700">帳務備註<textarea value={vendorForm.accountingNotes} onChange={(event) => setVendorForm({ ...vendorForm, accountingNotes: event.target.value })} rows={4} className={inputClass} placeholder="其他帳務注意事項..." /></label>
                </section>
              </div>
            )}

            {vendorFormStep === 'cooperation' && (
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">合作資訊</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">合作狀態<select value={vendorForm.status} onChange={(event) => setVendorForm({ ...vendorForm, status: event.target.value as VendorStatus })} className={inputClass}><option value="active">合作中</option><option value="paused">暫停合作</option><option value="inactive">已停用</option></select></label>
                    <label className="text-sm font-semibold text-slate-700">合作開始日期<input type="date" value={vendorForm.cooperationStartDate} onChange={(event) => setVendorForm({ ...vendorForm, cooperationStartDate: event.target.value })} className={inputClass} /></label>
                    <label className="text-sm font-semibold text-slate-700">合約到期日<input type="date" value={vendorForm.contractEndDate} onChange={(event) => setVendorForm({ ...vendorForm, contractEndDate: event.target.value })} className={inputClass} /></label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={vendorForm.preferredVendor} onChange={(event) => setVendorForm({ ...vendorForm, preferredVendor: event.target.checked })} />是否為優質廠商</label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={vendorForm.contractRequired} onChange={(event) => setVendorForm({ ...vendorForm, contractRequired: event.target.checked })} />是否需訂合約</label>
                  </div>
                  <label className="mt-4 block text-sm font-semibold text-slate-700">合作備註<textarea value={vendorForm.cooperationNotes} onChange={(event) => setVendorForm({ ...vendorForm, cooperationNotes: event.target.value })} rows={5} className={inputClass} placeholder="配合度、價格、回覆速度或合作注意事項..." /></label>
                </section>
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">內部評分與紀錄</h2>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    {['服務品質', '交期準確度', '價格合理度', '配合度', '整體評價'].map((label, idx) => <div key={label} className="flex items-center justify-between"><span>{label}</span><span className="text-amber-500">{'★'.repeat(idx === 1 || idx === 3 ? 5 : 4)}{'☆'.repeat(idx === 1 || idx === 3 ? 0 : 1)}</span></div>)}
                  </div>
                  <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">合作記錄會在廠商建立後，由後續工單與評價資料累積。</div>
                </section>
              </div>
            )}

            {vendorFormStep === 'attachments' && (
              <div className="space-y-5">
                <section className="rounded-lg border border-slate-200 p-5">
                  <h2 className="font-black text-slate-950">附件檔案上傳</h2>
                  <label className="mt-4 grid cursor-pointer place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500 hover:border-orange-300 hover:bg-orange-50/40">
                    <input type="file" multiple className="hidden" onChange={(event) => setVendorAttachmentNames(Array.from(event.target.files || []).map((file) => file.name))} />
                    <Upload className="mb-3 text-slate-400" />
                    <span className="font-bold text-slate-700">拖曳檔案到此處，或點擊上傳</span>
                    <span className="mt-2">支援 JPG、PNG、PDF、DOC、DOCX、XLS、XLSX、ZIP</span>
                  </label>
                </section>
                <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3 font-black text-slate-950">已選擇檔案（{vendorAttachmentNames.length}）</div>
                    <div className="divide-y divide-slate-100">
                      {vendorAttachmentNames.length === 0 ? <div className="px-4 py-8 text-center text-sm text-slate-500">尚未選擇檔案</div> : vendorAttachmentNames.map((name) => (
                        <div key={name} className="flex items-center justify-between px-4 py-3 text-sm">
                          <span className="inline-flex items-center gap-2 text-slate-700"><Paperclip size={16} />{name}</span>
                          <button type="button" onClick={() => setVendorAttachmentNames((current) => current.filter((item) => item !== name))} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-5">
                    <h3 className="font-black text-slate-950">文件分類</h3>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      {['營業證照', '合約文件', '廠商型錄', '保險證明', '帳務資料'].map((item) => <div key={item} className="rounded bg-slate-50 px-3 py-2">{item}</div>)}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={closeVendorForm} className="rounded-lg border border-slate-200 bg-white px-8 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
          {currentStepIndex > 0 && <button type="button" onClick={goPreviousVendorFormStep} className="rounded-lg border border-slate-200 bg-white px-8 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">上一步</button>}
          {isLastStep ? (
            <button type="button" onClick={saveVendor} disabled={savingVendor} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{savingVendor ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}完成新增</button>
          ) : (
            <button type="button" onClick={goNextVendorFormStep} className="rounded-lg bg-orange-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-orange-600">下一步</button>
          )}
        </div>
      </div>
    );
  };

  const renderCategoryFormPanel = () => (
    <aside className={`rounded-lg border border-slate-200 bg-white p-5 ${isCategoryFormOpen ? '' : 'hidden xl:block'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-950">{editingCategoryId ? '編輯服務分類' : '新增服務分類'}</h2>
        {isCategoryFormOpen && <button type="button" onClick={closeCategoryForm} className="text-slate-400 hover:text-slate-700">×</button>}
      </div>
      {!isCategoryFormOpen ? <div className="mt-8 text-center text-sm text-slate-500">點選「新增分類」建立分類</div> : (
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">上層分類<select value={categoryForm.parentId} onChange={(event) => setCategoryForm({ ...categoryForm, parentId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">無（頂層分類）</option>{vendorCategories.filter((category) => category.id !== editingCategoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="block text-sm font-semibold text-slate-700">分類名稱 *<input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">分類代碼 *<input value={categoryForm.code} onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="英文大寫，2-10碼" /></label>
          <textarea value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="分類描述（選填）" />
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700">狀態<select value={categoryForm.status} onChange={(event) => setCategoryForm({ ...categoryForm, status: event.target.value as VendorCategoryStatus })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="active">啟用中</option><option value="inactive">停用中</option></select></label><label className="block text-sm font-semibold text-slate-700">排序<input type="number" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label></div>
          <div className="block text-sm font-semibold text-slate-700">
            常見服務項目
            <input
              value={categoryCommonItemInput}
              onChange={(event) => setCategoryCommonItemInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCategoryCommonItem();
                }
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              placeholder="請輸入服務項目後按 Enter 新增"
            />
            <div className="mt-1 text-xs font-normal text-slate-500">可加入此分類下常見的服務項目，便於工單建立時選擇</div>
            {getCategoryCommonItems().length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {getCategoryCommonItems().map((item) => (
                  <span key={item} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {item}
                    <button
                      type="button"
                      onClick={() => removeCategoryCommonItem(item)}
                      className="text-slate-400 hover:text-slate-700"
                      aria-label={`移除${item}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={saveVendorCategory} disabled={savingCategory} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{savingCategory ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{editingCategoryId ? '更新分類' : '儲存分類'}</button>
        </div>
      )}
    </aside>
  );

  const renderRegionFormPanel = () => (
    <aside className={`rounded-lg border border-slate-200 bg-white p-5 ${isRegionFormOpen ? '' : 'hidden xl:block'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-950">新增服務區域</h2>
        {isRegionFormOpen && <button type="button" onClick={() => setIsRegionFormOpen(false)} className="text-slate-400 hover:text-slate-700">×</button>}
      </div>
      {!isRegionFormOpen ? <div className="mt-8 text-center text-sm text-slate-500">點選「新增服務區域」建立區域</div> : (
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">上層區域<select value={regionForm.parentId} onChange={(event) => setRegionForm({ ...regionForm, parentId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">無（頂層區域）</option>{vendorRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700">區域名稱 *<input value={regionForm.name} onChange={(event) => setRegionForm({ ...regionForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="block text-sm font-semibold text-slate-700">區域代碼 *<input value={regionForm.code} onChange={(event) => setRegionForm({ ...regionForm, code: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700">區域類型<select value={regionForm.regionType} onChange={(event) => setRegionForm({ ...regionForm, regionType: event.target.value as VendorRegion['region_type'] })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="country">國家</option><option value="region">區域</option><option value="city">縣市</option><option value="district">鄉鎮區域</option></select></label><label className="block text-sm font-semibold text-slate-700">狀態<select value={regionForm.status} onChange={(event) => setRegionForm({ ...regionForm, status: event.target.value as VendorRegionStatus })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="active">啟用中</option><option value="inactive">停用中</option><option value="archived">已歸檔</option></select></label></div>
          <label className="block text-sm font-semibold text-slate-700">包含範圍<input value={regionForm.includedLocations} onChange={(event) => setRegionForm({ ...regionForm, includedLocations: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="以逗號分隔，例如：台北市,新北市" /></label>
          <textarea value={regionForm.description} onChange={(event) => setRegionForm({ ...regionForm, description: event.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="區域描述（選填）" />
          <button type="button" onClick={saveVendorRegion} disabled={savingRegion} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{savingRegion ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}儲存區域</button>
        </div>
      )}
    </aside>
  );

  const renderVendorManagement = () => (
    <div className="space-y-4">
      <div className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max items-center gap-6 px-1">
          {vendorViewItems.map((item) => {
            const Icon = item.icon;
            const active = vendorView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setVendorView(item.key)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-bold transition-colors ${active ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:border-orange-200 hover:text-slate-800'}`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {vendorView === 'list' && renderVendorList()}
      {vendorView === 'purchases' && renderPurchaseAnalysis()}
      {vendorView === 'categories' && renderVendorCategories()}
      {vendorView === 'regions' && renderVendorRegions()}
      {vendorView === 'stats' && renderVendorStats()}
    </div>
  );

  const renderPlaceholder = (title: string, description: string, Icon: any) => (
    <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
      <Icon className="mx-auto h-12 w-12 text-orange-400" />
      <h1 className="mt-4 text-2xl font-bold text-slate-950">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{description}</p>
    </div>
  );

  const renderModuleUnavailable = (title: string) => (
    <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-slate-400" />
      <h1 className="mt-4 text-2xl font-bold text-slate-950">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{MODULE_NOT_AVAILABLE_MESSAGE}</p>
      <button
        type="button"
        onClick={() => setActiveSection('home')}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
      >
        <ArrowLeft size={16} />
        回到服務首頁
      </button>
    </div>
  );

  const renderMainContent = () => {
    if (loadingInitial) {
      return <GeneralAffairsLoadingState title="載入總務服務中心" description="正在取得總務服務中心權限與初始資料。" />;
    }

    if (!canAccessService) {
      return (
        <GeneralAffairsPermissionDeniedState
          title="目前帳號沒有總務服務中心權限"
          description="請確認角色權限設定，或聯絡系統管理員。"
          requiredPermission="general_affairs.service_center.access"
        />
      );
    }

    if (activeSection === 'home') return renderHomeDashboard();
    if (activeSection === 'maintenance') {
      if (!canAccessMaintenanceModule) return renderModuleUnavailable('維修回報');
      return maintenanceView === 'new' && canSubmit ? renderNewReport() : renderMyReports();
    }
    if (activeSection === 'work-orders') {
      if (!canAccessMaintenanceModule) return renderModuleUnavailable('工單中心');
      return renderWorkOrderCenter();
    }
    if (activeSection === 'equipment') return renderModuleUnavailable('設備管理');
    if (activeSection === 'facilities') return renderModuleUnavailable('設施管理');
    if (activeSection === 'vendors') {
      if (!canAccessVendors) return renderModuleUnavailable('廠商管理');
      return renderVendorManagement();
    }
    if (activeSection === 'part-requests') {
      if (!canAccessMaintenanceModule) return renderModuleUnavailable('料件申請紀錄');
      return maintenanceView === 'new' && canSubmit ? renderNewReport() : renderPartRequestRecords();
    }
    return renderModuleUnavailable('料件中心');
  };

  return (
    <div className="bg-slate-50">
      {renderMainContent()}

      {lightboxIndex !== null && lightboxPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white transition-colors hover:text-slate-300"
            aria-label="關閉附件預覽"
          >
            <X size={28} />
          </button>

          {lightboxPhotos.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                prevLightbox();
              }}
              className="absolute left-4 rounded-full bg-black/40 p-2 text-white transition-colors hover:text-slate-300"
              aria-label="上一張"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          <img
            src={lightboxPhotos[lightboxIndex]}
            alt={`維修附件 ${lightboxIndex + 1}`}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />

          {lightboxPhotos.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                nextLightbox();
              }}
              className="absolute right-4 rounded-full bg-black/40 p-2 text-white transition-colors hover:text-slate-300"
              aria-label="下一張"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {lightboxPhotos.length > 1 && (
            <div
              className="absolute bottom-4 left-1/2 w-[min(92vw,640px)] -translate-x-1/2 rounded-xl bg-black/55 p-3 text-center text-sm text-white"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="font-black">{lightboxIndex + 1} / {lightboxPhotos.length}</div>
              <div className="text-xs opacity-80">可點縮圖或用左右箭頭切換</div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {lightboxPhotos.map((photoUrl, photoIndex) => (
                  <button
                    key={`${photoUrl}-${photoIndex}`}
                    type="button"
                    onClick={() => setLightboxIndex(photoIndex)}
                    className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border transition ${
                      lightboxIndex === photoIndex ? 'border-white ring-2 ring-white/80' : 'border-white/20 opacity-70 hover:opacity-100'
                    }`}
                    aria-label={`查看第 ${photoIndex + 1} 張照片`}
                  >
                    <img src={photoUrl} alt={`縮圖 ${photoIndex + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
