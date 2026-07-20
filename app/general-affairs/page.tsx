'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  FileText,
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
  Search,
  Send,
  Settings,
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
  MAINTENANCE_STATUS_LABELS,
  normalizeMaintenanceStatus,
  normalizeProgressStage,
  type LegacyMaintenanceStatus,
  type MaintenanceProgressStage,
  type MaintenanceTicketStatus,
} from '@/lib/maintenance/status';

type MaintenanceStatus = MaintenanceTicketStatus;
type MaintenanceStatusValue = MaintenanceTicketStatus | LegacyMaintenanceStatus;
type ResourceType = 'equipment' | 'facility' | 'material';
type ServiceSection = 'home' | 'maintenance' | 'work-orders' | 'equipment' | 'facilities' | 'vendors' | 'parts';
type MaintenanceView = 'new' | 'mine';
type VendorView = 'list' | 'categories' | 'regions' | 'stats';
type VendorFormStep = 'basic' | 'services' | 'contacts' | 'cooperation' | 'attachments';
type VendorStatus = 'active' | 'paused' | 'inactive';
type VendorCategoryStatus = 'active' | 'inactive';
type VendorRegionStatus = 'active' | 'inactive' | 'archived';

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
  contact_name?: string | null;
  contact_phone?: string | null;
  reported_at: string;
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
  photo_type?: 'before' | 'progress' | 'after' | 'other';
  created_at: string;
};

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
  { key: 'equipment', label: '設備管理', icon: Settings },
  { key: 'facilities', label: '設施管理', icon: Building2 },
  { key: 'vendors', label: '廠商管理', icon: Briefcase },
  { key: 'parts', label: '料件中心', icon: Warehouse },
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

const statusMeta: Record<MaintenanceStatus, { label: string; tone: string; dot: string; icon: any }> = {
  UNACCEPTED: { label: MAINTENANCE_STATUS_LABELS.UNACCEPTED, tone: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', icon: Clock3 },
  ACCEPTED: { label: MAINTENANCE_STATUS_LABELS.ACCEPTED, tone: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500', icon: CheckCircle2 },
  PROCESSING: { label: MAINTENANCE_STATUS_LABELS.PROCESSING, tone: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', icon: Settings },
  COMPLETED: { label: MAINTENANCE_STATUS_LABELS.COMPLETED, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
};

const progressSteps: Array<{ status: MaintenanceStatus; label: string }> = [
  { status: 'UNACCEPTED', label: '提出回報' },
  { status: 'ACCEPTED', label: '總務受理' },
  { status: 'PROCESSING', label: '處理中' },
  { status: 'COMPLETED', label: '完成確認' },
];

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

const vendorViewItems: Array<{ key: VendorView; label: string; icon: any }> = [
  { key: 'list', label: '廠商列表', icon: Briefcase },
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

const getDefaultReportStartDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

const getNormalizedStatus = (status: MaintenanceStatusValue | null | undefined): MaintenanceStatus =>
  normalizeMaintenanceStatus(status) || 'UNACCEPTED';

const getNormalizedStage = (stage: MaintenanceProgressStage | string | null | undefined) =>
  normalizeProgressStage(stage) || null;

export default function GeneralAffairsServiceCenterPage() {
  const supabase = createClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const workOrderUpdatePanelRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<ServiceSection>('home');
  const [maintenanceExpanded, setMaintenanceExpanded] = useState(false);
  const [maintenanceView, setMaintenanceView] = useState<MaintenanceView>('new');
  const [vendorExpanded, setVendorExpanded] = useState(false);
  const [vendorView, setVendorView] = useState<VendorView>('list');
  const [reportStep, setReportStep] = useState(1);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  const [canAccessService, setCanAccessService] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canUpdateWorkOrders, setCanUpdateWorkOrders] = useState(false);
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
  const [progressStageOptions, setProgressStageOptions] = useState<Array<{ code: MaintenanceProgressStage; name: string }>>(
    Object.entries(MAINTENANCE_PROGRESS_STAGE_LABELS).map(([code, name]) => ({ code: code as MaintenanceProgressStage, name }))
  );
  const [reportStartDate, setReportStartDate] = useState(getDefaultReportStartDate);
  const [reportEndDate, setReportEndDate] = useState(getDateInTaipei);
  const [searchText, setSearchText] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [savingWorkOrderUpdate, setSavingWorkOrderUpdate] = useState(false);
  const [workOrderUpdateForm, setWorkOrderUpdateForm] = useState({
    action: 'SAVE_PROGRESS' as 'ACCEPT' | 'SAVE_PROGRESS' | 'REQUEST_COMPLETION' | 'FORCE_CLOSE',
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

  const statusCounts = useMemo(() => {
    return requests.reduce((acc, row) => {
      const status = getNormalizedStatus(row.status);
      acc.all += 1;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { all: 0, UNACCEPTED: 0, ACCEPTED: 0, PROCESSING: 0, COMPLETED: 0 } as Record<'all' | MaintenanceStatus, number>);
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return requests.filter((request) => {
      if (statusFilter !== 'all' && getNormalizedStatus(request.status) !== statusFilter) return false;
      if (!keyword) return true;
      return [
        request.title,
        request.description,
        request.issue_type,
        request.contact_name,
        request.store?.store_code,
        request.store?.store_name,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [requests, searchText, statusFilter]);

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
    } catch (error: any) {
      alert(`載入廠商管理資料失敗：${error.message || error}`);
    } finally {
      setLoadingVendors(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } catch (error: any) {
      alert(`儲存廠商失敗：${error.message || error}`);
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
    } catch (error: any) {
      alert(`儲存服務分類失敗：${error.message || error}`);
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
    } catch (error: any) {
      alert(`儲存服務區域失敗：${error.message || error}`);
    } finally {
      setSavingRegion(false);
    }
  };

  const loadReports = useCallback(async () => {
    if (!selectedStoreId && !canViewAll) return;
    setLoadingReports(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (selectedStoreId) params.set('store_id', selectedStoreId);
      if (reportStartDate) params.set('start_date', reportStartDate);
      if (reportEndDate) params.set('end_date', reportEndDate);
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
      alert(`載入維修回報失敗：${error.message || error}`);
      setRequests([]);
      setUpdatesByRequestId(new Map());
    } finally {
      setLoadingReports(false);
    }
  }, [canViewAll, reportEndDate, reportStartDate, selectedStoreId]);

  const loadRequestPhotos = useCallback(async (requestId: string) => {
    if (!requestId) return;
    setPhotoLoadingIds((current) => new Set(current).add(requestId));
    try {
      const res = await fetch(`/api/maintenance-photos?request_id=${requestId}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setRequestPhotosById((current) => {
          const next = new Map(current);
          next.set(requestId, json.data || []);
          return next;
        });
      }
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

        const [accessAllowed, submitAllowed, viewAllAllowed, updateAllowed, profileRes] = await Promise.all([
          checkServiceAccess(),
          checkPermission('cross_dept.maintenance.submit'),
          checkPermission('cross_dept.maintenance.view_all'),
          checkPermission('cross_dept.maintenance.update'),
          supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        ]);

        const name = profileRes.data?.full_name || user.email || '';
        setProfileName(name);
        setForm((current) => ({ ...current, contactName: current.contactName || name }));
        setCanAccessService(accessAllowed);
        setCanSubmit(submitAllowed || viewAllAllowed);
        setCanViewAll(viewAllAllowed);
        setCanUpdateWorkOrders(updateAllowed || viewAllAllowed);
        await loadProgressStages();

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
    if (!loadingInitial && (activeSection === 'home' || maintenanceView === 'mine' || activeSection === 'work-orders')) {
      loadReports();
    }
  }, [activeSection, loadingInitial, maintenanceView, loadReports]);

  useEffect(() => {
    if (!loadingInitial && activeSection === 'vendors' && canAccessService) {
      loadVendorManagementData();
    }
  }, [activeSection, canAccessService, loadingInitial, loadVendorManagementData]);

  useEffect(() => {
    if (activeSection !== 'work-orders') return;
    const targetId = selectedWorkOrderId || filteredRequests[0]?.id;
    if (!targetId || requestPhotosById.has(targetId) || photoLoadingIds.has(targetId)) return;
    void loadRequestPhotos(targetId);
  }, [activeSection, filteredRequests, loadRequestPhotos, photoLoadingIds, requestPhotosById, selectedWorkOrderId]);

  const setResourceType = (resourceType: ResourceType) => {
    const nextResource = resourceTypes.find((item) => item.key === resourceType) || resourceTypes[0];
    setForm((current) => ({
      ...current,
      resourceType,
      issueType: nextResource.issueTypes[0],
    }));
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotos((current) => {
      const next = [...current];
      Array.from(files).forEach((file) => {
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

  const resetForm = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setReportStep(1);
    setForm({
      resourceType: 'equipment',
      itemName: '',
      issueType: resourceTypes[0].issueTypes[0],
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

    setSavingWorkOrderUpdate(true);
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
          visibility: workOrderUpdateForm.visibility,
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
      await loadReports();
      alert('工單進度已更新');
    } catch (error: any) {
      alert(`更新失敗：${error.message || error}`);
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

      alert('維修回報已送出');
      resetForm();
      setMaintenanceView('mine');
      await loadReports();
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

  const renderReportDateFilter = () => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
      <CalendarDays size={16} className="text-orange-500" />
      <span className="text-sm font-semibold text-slate-700">回報日期</span>
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
      ...requestPhotos.filter((photo) => photo.signed_url),
      ...updatePhotos.filter((photo) => photo.signed_url),
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
            onClick={() => loadRequestPhotos(request.id)}
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
              <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm">
                <X size={12} />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadRequestPhotos(request.id)}
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

    if (getNormalizedStatus(request.status) !== 'COMPLETED') {
      timelineItems.push({
        id: `${request.id}-next`,
        label: '等待廠商到場',
        actor: request.assignee_name || '尚未指派',
        note: request.progress_stage ? `目前進度：${MAINTENANCE_PROGRESS_STAGE_LABELS[getNormalizedStage(request.progress_stage)!]}` : '預計時程待補',
        date: '',
        icon: Clock3,
        tone: 'bg-slate-100 text-slate-500',
      });
    }

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
    setActiveSection(section);
    if (options?.maintenanceView) setMaintenanceView(options.maintenanceView);
    if (options?.status) setStatusFilter(options.status);
  };

  const renderHomeDashboard = () => {
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
          status: status === 'UNACCEPTED' ? '尚未受理' : stage ? MAINTENANCE_PROGRESS_STAGE_LABELS[stage] : MAINTENANCE_STATUS_LABELS[status],
          action: task === '受理工單' ? '開始處理' : task === '選擇廠商' ? '指派廠商' : task === '審視報價' ? '查看報價' : task === '調撥料件' ? '處理調撥' : '查看',
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
          stageLabel: stage ? MAINTENANCE_PROGRESS_STAGE_LABELS[stage] : MAINTENANCE_STATUS_LABELS[getNormalizedStatus(request.status)],
          at: latest?.progress_date || request.reported_at,
          note: latest?.notes || request.description || '尚無處理紀錄',
        };
      })
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 5);

    const todoCards = isAffairsView
      ? [
          { label: '新進待處理', value: counts.status.UNACCEPTED, helper: '尚未受理', icon: Clock3, tone: 'border-orange-200 bg-orange-50 text-orange-700', target: 'UNACCEPTED' as MaintenanceStatus },
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
      { stage: 'WAITING_STORE_CONFIRMATION', label: '完成待確認' },
    ];

    const importantParts = [
      ['展裕30cm掛勾', '百福店需30個', '文德店有42個', '建立調撥'],
      ['中島架層板', '總倉剩2片', '多店使用', '查看庫存'],
      ['價格牌軌', '東湖店閒置20支', '東湖店', '確認數量'],
    ];
    const equipmentAlerts = [
      ['即將到期保固', '12台', '未來60天內'],
      ['重複維修設備', '5台', '近半年維修2次以上'],
      ['資料不完整設備', '18台', '缺照片、型號或序號'],
      ['待停用／汰換', '3台', '等待處理'],
    ];
    const vendorRows = [
      ['和泰冷氣工程行', '百福店冷氣A', '今日到場', '14:00–16:00'],
      ['大安水電工程行', '文德店漏水', '等待報價', '—'],
      ['潔淨病媒防治', '東湖店鼠患', '已安排巡檢', '07/22上午'],
    ];
    const visitRows = [
      ['今天 10:00', '東湖店｜自動門檢修', '永盛自動門'],
      ['今天 14:00', '百福店｜冷氣檢查', '和泰冷氣'],
      ['明天 上午', '文德店｜鼠害現場勘查', '潔淨病媒防治'],
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
          ['申請料件', 'parts', Package],
          ['料件申請紀錄', 'parts', FileText],
        ] as Array<[string, ServiceSection, any]>;

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
            <button type="button" onClick={() => openSection('parts')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <Plus size={16} />
              {isAffairsView ? '新增料件' : '申請料件'}
            </button>
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-black text-slate-950">今日／本週到場安排</h2>
            <div className="mt-4 space-y-3">
              {visitRows.map((row) => (
                <div key={row.join('-')} className="flex gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="w-20 shrink-0 text-xs font-black text-orange-600">{row[0]}</div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">{row[1]}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{row[2]}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">料件動態</h2>
              <button type="button" onClick={() => openSection('parts')} className="text-xs font-bold text-orange-600">料件中心</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ['待申請', '4'],
                ['庫存不足', '6'],
                ['閒置待確認', '12'],
                ['調撥中', '3'],
              ].map((row) => <div key={row[0]} className="rounded-lg bg-slate-50 px-2 py-3"><div className="text-lg font-black text-slate-950">{row[1]}</div><div className="text-[11px] font-bold text-slate-500">{row[0]}</div></div>)}
            </div>
            <div className="mt-3 space-y-2">
              {importantParts.map((row) => <div key={row[0]} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-slate-100 p-3 text-sm"><div><div className="font-bold text-slate-900">{row[0]}</div><div className="text-xs text-slate-500">{row[1]}｜{row[2]}</div></div><button type="button" className="text-xs font-bold text-orange-600">{row[3]}</button></div>)}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">設備與設施提醒</h2>
              <button type="button" onClick={() => openSection('equipment')} className="text-xs font-bold text-orange-600">設備管理</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {equipmentAlerts.map((row) => <div key={row[0]} className="rounded-lg border border-slate-100 p-3"><div className="text-xs font-bold text-slate-500">{row[0]}</div><div className="mt-1 text-xl font-black text-slate-950">{row[1]}</div><div className="mt-1 text-xs text-slate-500">{row[2]}</div></div>)}
            </div>
            <div className="mt-3 rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
              <div className="font-black">0014 百福店｜冷氣A</div>
              <div className="mt-1 text-xs font-semibold">近90天回報3次，建議檢查是否需汰換或保固處理</div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">廠商待辦與合作動態</h2>
              <button type="button" onClick={() => openSection('vendors')} className="text-xs font-bold text-orange-600">廠商管理</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ['待回覆', counts.stage.WAITING_VENDOR_REPLY || 0],
                ['今日到場', 4],
                ['報價待確認', counts.stage.WAITING_VENDOR_QUOTE || 0],
                ['施工待回報', counts.stage.VENDOR_WORKING || 0],
              ].map((row) => <div key={row[0]} className="rounded-lg bg-slate-50 px-2 py-3"><div className="text-lg font-black text-slate-950">{row[1]}</div><div className="text-[11px] font-bold text-slate-500">{row[0]}</div></div>)}
            </div>
            <div className="mt-3 space-y-2">
              {vendorRows.map((row) => <div key={row.join('-')} className="rounded-lg border border-slate-100 p-3 text-sm"><div className="font-bold text-slate-900">{row[0]}</div><div className="mt-1 text-xs text-slate-500">{row[1]}｜{row[2]}｜{row[3]}</div></div>)}
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-black text-slate-950">快速入口</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            {quickLinks.map(([label, section, Icon]) => (
              <button key={label} type="button" onClick={() => openSection(section, label === '我的回報' ? { maintenanceView: 'mine' } : label === '新增維修' ? { maintenanceView: 'new' } : undefined)} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-left hover:border-orange-200 hover:bg-orange-50">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon size={18} /></span>
                <span className="text-sm font-black text-slate-800">{label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderNewReport = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">維修回報 / 新增回報</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">新增維修回報</h1>
              <p className="mt-1 text-sm text-slate-500">請詳填以下資訊，以利總務人員派工處理</p>
            </div>
            <button
              type="button"
              onClick={() => setMaintenanceView('mine')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={16} />
              回我的回報
            </button>
          </div>
        </div>

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
                  {resourceTypes.map((resource) => {
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
                設備 / 項目名稱 *
                <input
                  value={form.itemName}
                  onChange={(event) => setForm({ ...form, itemName: event.target.value })}
                  placeholder="例如：冷氣A、電動門、POS主機1"
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
                  placeholder="請描述發生位置、異常狀況、是否影響營運、已嘗試處理方式..."
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
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-orange-300 bg-orange-50 text-sm font-semibold text-orange-700"
                    >
                      <ImagePlus size={24} />
                      <span className="mt-2">新增照片</span>
                    </button>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addPhotos(event.target.files);
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
                送出回報
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
  );

  const renderMyReports = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">維修回報 / 我的回報</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">我的回報</h1>
          <p className="mt-1 text-sm text-slate-500">查看您發起或所屬門市的維修工單與處理進度</p>
        </div>
        {renderReportDateFilter()}
      </div>

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

      <div className="grid gap-3 md:grid-cols-5">
        {reportStatusFilters.map((filter) => {
          const Icon = filter.icon;
          const isActive = statusFilter === filter.key;

          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatusFilter(filter.key)}
              className={`rounded-lg border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm ${
                isActive ? 'border-orange-200 ring-2 ring-orange-200' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ${filter.iconTone}`}>
                  <Icon size={20} strokeWidth={2.4} />
                </span>
                <div className="min-w-0">
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold ${filter.badgeTone}`}>
                    {filter.label}
                  </div>
                  <div className="mt-2 text-2xl font-bold leading-none text-slate-950">{statusCounts[filter.key]}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{filter.helper}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            回報門市
            <select
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            >
              {canViewAll && <option value="">全部門市</option>}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
              ))}
            </select>
          </label>
          <label className="relative min-w-[260px] flex-1">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜尋工單、設備名稱、問題描述"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <button
            type="button"
            onClick={loadReports}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Filter size={16} />
            查詢
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
              <tr>
                <th className="px-4 py-3">工單編號</th>
                <th className="px-4 py-3">設備 / 項目</th>
                <th className="px-4 py-3">問題描述</th>
                <th className="px-4 py-3">目前狀態</th>
                <th className="px-4 py-3">處理進度</th>
                <th className="px-4 py-3">建立時間</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingReports ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
              ) : filteredRequests.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">目前沒有符合條件的回報</td></tr>
              ) : filteredRequests.map((request) => {
                const normalizedStatus = getNormalizedStatus(request.status);
                const normalizedStage = getNormalizedStage(request.progress_stage);
                const stageLabel = normalizedStage ? MAINTENANCE_PROGRESS_STAGE_LABELS[normalizedStage] : null;
                const meta = statusMeta[normalizedStatus];
                const StatusIcon = meta.icon;
                const expanded = expandedReportId === request.id;
                const updates = updatesByRequestId.get(request.id) || [];
                return (
                  <Fragment key={request.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">WO-{request.id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-4 py-4">
                        <div className="font-bold text-slate-900">{request.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{request.issue_type || resourceTypes.find((r) => r.key === request.resource_type)?.label || '維修回報'}</div>
                      </td>
                      <td className="max-w-[260px] px-4 py-4">
                        <div className="line-clamp-2 text-slate-700">{request.description || '-'}</div>
                      </td>
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
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedReportId(expanded ? null : request.id);
                            if (!expanded && !requestPhotosById.has(request.id)) {
                              void loadRequestPhotos(request.id);
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          查看詳情
                          <ChevronRight size={14} className={expanded ? 'rotate-90' : ''} />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                            <div className="space-y-4">
                              <div className="rounded-lg border border-slate-200 bg-white p-4">
                                <div className="text-sm font-bold text-slate-900">工單處理紀錄</div>
                                <div className="mt-4 space-y-3">
                                  {updates.length === 0 ? (
                                    <div className="text-sm text-slate-500">尚無總務更新紀錄</div>
                                  ) : updates.map((update) => {
                                    const updateStatus = getNormalizedStatus(update.status);
                                    const updateStage = getNormalizedStage(update.progress_stage);
                                    const updateMeta = statusMeta[updateStatus];
                                    return (
                                      <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${updateMeta.tone}`}>{updateMeta.label}</span>
                                          {updateStage && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{MAINTENANCE_PROGRESS_STAGE_LABELS[updateStage]}</span>}
                                          {update.visibility === 'INTERNAL' && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-bold text-purple-700">內部</span>}
                                          <span className="text-xs text-slate-500">{getDateTimeLabel(update.progress_date)}｜{update.updated_by_name}</span>
                                        </div>
                                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.notes}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {renderRequestAttachments(request.id)}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                              <div className="font-bold text-slate-900">聯絡與門市資訊</div>
                              <div className="mt-3 space-y-2 text-slate-600">
                                <div>門市：{request.store ? `${request.store.store_code} ${request.store.store_name}` : '-'}</div>
                                <div>聯絡人：{request.contact_name || request.reporter_name || '-'}</div>
                                <div>電話：{request.contact_phone || '-'}</div>
                                <div>回報者：{request.reporter_name}</div>
                              </div>
                              {normalizedStage === 'WAITING_STORE_CONFIRMATION' && normalizedStatus === 'PROCESSING' && (
                                <div className="mt-4 grid gap-2">
                                  <button
                                    type="button"
                                    onClick={() => submitStoreCompletionResponse(request.id, 'STORE_CONFIRM_COMPLETE')}
                                    disabled={savingWorkOrderUpdate}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    <CheckCircle2 size={16} />
                                    確認完成
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => submitStoreCompletionResponse(request.id, 'REPORT_UNRESOLVED')}
                                    disabled={savingWorkOrderUpdate}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                                  >
                                    <AlertCircle size={16} />
                                    仍有問題
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderWorkOrderCenter = () => {
    const selectedWorkOrder = requests.find((request) => request.id === selectedWorkOrderId) || filteredRequests[0] || null;
    const selectedUpdates = selectedWorkOrder ? updatesByRequestId.get(selectedWorkOrder.id) || [] : [];

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">總務服務中心 / 工單中心</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">工單中心</h1>
            <p className="mt-1 text-sm text-slate-500">總務可在此編輯處理進度；門市「我的回報」會同步顯示這些紀錄。</p>
          </div>
          <button
            type="button"
            onClick={loadReports}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Filter size={16} />
            重新整理
          </button>
        </div>

        {!canUpdateWorkOrders && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            目前帳號可以查看總務服務中心，但沒有工單進度更新權限。
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              門市
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  setSelectedWorkOrderId(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              >
                {canViewAll && <option value="">全部門市</option>}
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                ))}
              </select>
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | MaintenanceStatus)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            >
              <option value="all">全部狀態</option>
              {progressSteps.map((step) => <option key={step.status} value={step.status}>{statusMeta[step.status].label}</option>)}
            </select>
            <label className="relative min-w-[260px] flex-1">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜尋工單、設備名稱、問題描述"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>
          </div>

          <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1fr)_500px]">
            <div className="overflow-auto border-r border-slate-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">工單</th>
                    <th className="px-4 py-3">門市</th>
                    <th className="px-4 py-3">問題</th>
                    <th className="px-4 py-3">狀態</th>
                    <th className="px-4 py-3">最近進度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingReports ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">目前沒有工單</td></tr>
                  ) : filteredRequests.map((request) => {
                    const normalizedStatus = getNormalizedStatus(request.status);
                    const normalizedStage = getNormalizedStage(request.progress_stage);
                    const meta = statusMeta[normalizedStatus];
                    const latest = (updatesByRequestId.get(request.id) || [])[0];
                    const active = selectedWorkOrder?.id === request.id;
                    return (
                      <tr
                        key={request.id}
                        onClick={() => {
                          setSelectedWorkOrderId(request.id);
                          if (!requestPhotosById.has(request.id)) {
                            void loadRequestPhotos(request.id);
                          }
                        }}
                        className={`cursor-pointer hover:bg-slate-50 ${active ? 'bg-orange-50/70' : ''}`}
                      >
                        <td className="px-4 py-4">
                          <div className="font-mono text-xs text-slate-500">WO-{request.id.slice(0, 8).toUpperCase()}</div>
                          <div className="mt-1 font-bold text-slate-950">{request.title}</div>
                        </td>
                        <td className="px-4 py-4 text-slate-600">{request.store ? `${request.store.store_code} ${request.store.store_name}` : '-'}</td>
                        <td className="max-w-[220px] px-4 py-4">
                          <div className="font-semibold text-slate-800">{request.issue_type || '-'}</div>
                          <div className="mt-1 line-clamp-1 text-xs text-slate-500">{request.description || '-'}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                          {normalizedStatus === 'PROCESSING' && normalizedStage && (
                            <div className="mt-1 text-xs font-semibold text-slate-500">{MAINTENANCE_PROGRESS_STAGE_LABELS[normalizedStage]}</div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500">
                          {latest ? (
                            <>
                              <div className="line-clamp-1 text-slate-700">{latest.notes}</div>
                              <div className="mt-1">{getDateTimeLabel(latest.progress_date)}</div>
                            </>
                          ) : '尚無處理紀錄'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <aside className="bg-slate-50 p-4">
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
                        return (
                          <>
                            <section className="rounded-lg border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="font-mono text-xl font-black text-slate-950">{getWorkOrderCode(selectedWorkOrder)}</div>
                                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-black ${statusMeta[currentStatus].tone}`}>
                                      <CurrentIcon size={13} />
                                      {statusMeta[currentStatus].label}
                                    </span>
                                    <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">{getPriorityLabel(selectedWorkOrder.priority)}</span>
                                  </div>
                                  <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                                    <div>建立時間：{getDateTimeLabel(selectedWorkOrder.reported_at)}</div>
                                    <div>預計完成：-</div>
                                    <div>來源：店長發起</div>
                                    <div>實際完成：{getDateTimeLabel(selectedWorkOrder.completed_at)}</div>
                                  </div>
                                </div>
                              </div>
                            </section>

                            <section className="border-t border-slate-200 pt-4">
                              <h3 className="mb-3 text-sm font-black text-slate-900">基本資訊</h3>
                              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                                {renderDetailField('門市', selectedWorkOrder.store ? `${selectedWorkOrder.store.store_code} - ${selectedWorkOrder.store.store_name}` : '-')}
                                {renderDetailField('發起人', selectedWorkOrder.reporter_name)}
                                {renderDetailField('聯絡電話', selectedWorkOrder.contact_phone)}
                                {renderDetailField('問題類型', selectedWorkOrder.issue_type)}
                                {renderDetailField('系統程度', getPriorityLabel(selectedWorkOrder.priority))}
                                {renderDetailField('聯絡人', selectedWorkOrder.contact_name || selectedWorkOrder.reporter_name)}
                              </div>
                            </section>

                            <section className="border-t border-slate-200 pt-4">
                              <h3 className="mb-3 text-sm font-black text-slate-900">設備 / 項目</h3>
                              <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-4">
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
                                    <button type="button" className="text-xs font-black text-blue-600 hover:text-blue-700">查看設備詳情</button>
                                  </div>
                                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs font-semibold leading-5 text-slate-600 sm:grid-cols-2">
                                    <div>類別：{getResourceLabel(selectedWorkOrder.resource_type)}</div>
                                    <div>序號：-</div>
                                    <div>品牌：-</div>
                                    <div>安裝日期：-</div>
                                    <div className="sm:col-span-2">安裝位置：-</div>
                                  </div>
                                </div>
                              </div>
                            </section>

                            <section className="border-t border-slate-200 pt-4">
                              <h3 className="mb-2 text-sm font-black text-slate-900">問題描述</h3>
                              <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedWorkOrder.description || '-'}</div>
                            </section>

                            {renderWorkOrderAttachmentStrip(selectedWorkOrder)}
                            {renderWorkOrderTimeline(selectedWorkOrder, selectedUpdates)}
                          </>
                        );
                      })()}
                  </div>
                  </div>

                  <div ref={workOrderUpdatePanelRef} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-950">新增處理進度</div>
                    <div className="mt-3 space-y-3">
                      {getNormalizedStatus(selectedWorkOrder.status) === 'UNACCEPTED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setWorkOrderUpdateForm((current) => ({
                              ...current,
                              action: 'ACCEPT',
                              progressStage: 'INITIAL_REVIEW',
                              notes: current.notes || '受理工單，進行初步評估',
                            }));
                          }}
                          disabled={!canUpdateWorkOrders}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                        >
                          <CheckCircle2 size={16} />
                          受理工單
                        </button>
                      )}
                      <label className="block text-sm font-semibold text-slate-700">
                        處理動作
                        <select
                          value={workOrderUpdateForm.action}
                          onChange={(event) => setWorkOrderUpdateForm({
                            ...workOrderUpdateForm,
                            action: event.target.value as typeof workOrderUpdateForm.action,
                            progressStage: event.target.value === 'REQUEST_COMPLETION' ? 'WAITING_STORE_CONFIRMATION' : workOrderUpdateForm.progressStage,
                          })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        >
                          <option value="ACCEPT">受理工單</option>
                          <option value="SAVE_PROGRESS">新增處理進度</option>
                          <option value="REQUEST_COMPLETION">處理完成，請門市確認</option>
                          <option value="FORCE_CLOSE">強制結案</option>
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        目前處理進度
                        <select
                          value={workOrderUpdateForm.progressStage}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, progressStage: event.target.value as MaintenanceProgressStage })}
                          disabled={!canUpdateWorkOrders || workOrderUpdateForm.action === 'REQUEST_COMPLETION'}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        >
                          {progressStageOptions.map((stage) => <option key={stage.code} value={stage.code}>{stage.name}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        承辦人
                        <input
                          value={workOrderUpdateForm.assigneeName}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, assigneeName: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          placeholder="請輸入承辦人姓名"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        處理方式
                        <input
                          value={workOrderUpdateForm.handlingMethod}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, handlingMethod: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          placeholder="例如：總務自行處理、廠商派工、等待料件"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        紀錄可見性
                        <select
                          value={workOrderUpdateForm.visibility}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, visibility: event.target.value as 'PUBLIC' | 'INTERNAL' })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        >
                          <option value="PUBLIC">公開進度</option>
                          <option value="INTERNAL">內部備註</option>
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        紀錄日期
                        <input
                          type="date"
                          value={workOrderUpdateForm.progressDate}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, progressDate: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      {workOrderUpdateForm.action === 'FORCE_CLOSE' && (
                        <label className="block text-sm font-semibold text-slate-700">
                          強制結案原因
                          <input
                            value={workOrderUpdateForm.forceCloseReason}
                            onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, forceCloseReason: event.target.value })}
                            disabled={!canUpdateWorkOrders}
                            placeholder="請填寫強制結案原因"
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                          />
                        </label>
                      )}
                      <label className="block text-sm font-semibold text-slate-700">
                        處理內容
                        <textarea
                          value={workOrderUpdateForm.notes}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, notes: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          rows={5}
                          placeholder="例如：已聯繫廠商、預計到店處理、已完成更換..."
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => submitWorkOrderUpdate(selectedWorkOrder.id)}
                        disabled={!canUpdateWorkOrders || savingWorkOrderUpdate}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                      >
                        {savingWorkOrderUpdate ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        儲存處理進度
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-950">處理紀錄</div>
                    <div className="mt-3 space-y-3">
                      {selectedUpdates.length === 0 ? (
                        <div className="text-sm text-slate-500">尚無處理紀錄</div>
                      ) : selectedUpdates.map((update) => {
                        const updateStatus = getNormalizedStatus(update.status);
                        const updateStage = getNormalizedStage(update.progress_stage);
                        const meta = statusMeta[updateStatus];
                        return (
                          <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                              {updateStage && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{MAINTENANCE_PROGRESS_STAGE_LABELS[updateStage]}</span>}
                              {update.visibility === 'INTERNAL' && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-bold text-purple-700">內部</span>}
                              <span className="text-xs text-slate-500">{getDateTimeLabel(update.progress_date)}｜{update.updated_by_name}</span>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.notes}</div>
                          </div>
                        );
                      })}
                    </div>
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

  const renderMainContent = () => {
    if (loadingInitial) {
      return (
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white">
          <div className="text-center text-slate-500">
            <Loader2 className="mx-auto mb-3 animate-spin text-orange-500" />
            載入總務服務中心
          </div>
        </div>
      );
    }

    if (!canAccessService) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <AlertCircle className="mb-3" />
          目前帳號沒有總務服務中心權限。
        </div>
      );
    }

    if (activeSection === 'home') return renderHomeDashboard();

    if (activeSection === 'maintenance') {
      if (!canSubmit && !canViewAll && !canUpdateWorkOrders) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
            <AlertCircle className="mb-3" />
            目前帳號已開啟總務服務中心入口，但尚未設定回報、查看或處理工單權限。
          </div>
        );
      }
      if (maintenanceView === 'new' && !canSubmit) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
            <AlertCircle className="mb-3" />
            目前帳號沒有新增維修回報權限。
          </div>
        );
      }
      return maintenanceView === 'new' ? renderNewReport() : renderMyReports();
    }
    if (activeSection === 'work-orders') return renderWorkOrderCenter();
    if (activeSection === 'equipment') return renderPlaceholder('設備管理', '後續可建立設備主檔、序號、保固與維修履歷。', Settings);
    if (activeSection === 'facilities') return renderPlaceholder('設施管理', '後續可管理門市固定設施、區域位置與巡檢紀錄。', Building2);
    if (activeSection === 'vendors') return renderVendorManagement();
    return renderPlaceholder('料件中心', '後續可管理料件庫存、申請、領用與補貨紀錄。', Package);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block">
          <div className="mb-4 px-2">
            <div className="text-xs font-bold uppercase tracking-wider text-orange-500">General Affairs</div>
            <div className="mt-1 text-lg font-black text-slate-950">總務服務中心</div>
          </div>
          <nav className="space-y-1">
            {serviceNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.key;
              if (item.key === 'maintenance') {
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setMaintenanceExpanded((value) => !value);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold ${
                        active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2"><Icon size={18} />{item.label}</span>
                      <ChevronDown size={16} className={maintenanceExpanded ? 'rotate-180' : ''} />
                    </button>
                    {maintenanceExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {canSubmit && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection('maintenance');
                              setMaintenanceView('new');
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${activeSection === 'maintenance' && maintenanceView === 'new' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
                          >
                            新增回報
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('maintenance');
                            setMaintenanceView('mine');
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${activeSection === 'maintenance' && maintenanceView === 'mine' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                          我的回報
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              if (item.key === 'vendors') {
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setVendorExpanded((value) => !value);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold ${
                        active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2"><Icon size={18} />{item.label}</span>
                      <ChevronDown size={16} className={vendorExpanded ? 'rotate-180' : ''} />
                    </button>
                    {vendorExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {vendorViewItems.map((viewItem) => {
                          const ViewIcon = viewItem.icon;
                          return (
                            <button
                              key={viewItem.key}
                              type="button"
                              onClick={() => {
                                setActiveSection('vendors');
                                setVendorView(viewItem.key);
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${activeSection === 'vendors' && vendorView === viewItem.key ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                              <ViewIcon size={15} />
                              {viewItem.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold ${
                    active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {serviceNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                    activeSection === item.key ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {activeSection === 'maintenance' && (
            <div className="mb-4 flex gap-2 lg:hidden">
              {canSubmit && (
                <button
                  type="button"
                  onClick={() => setMaintenanceView('new')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${maintenanceView === 'new' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}
                >
                  新增回報
                </button>
              )}
              <button
                type="button"
                onClick={() => setMaintenanceView('mine')}
                className={`rounded-lg px-3 py-2 text-sm font-bold ${maintenanceView === 'mine' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}
              >
                我的回報
              </button>
            </div>
          )}

          {renderMainContent()}
        </main>
      </div>

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
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-sm text-white">
              {lightboxIndex + 1} / {lightboxPhotos.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
