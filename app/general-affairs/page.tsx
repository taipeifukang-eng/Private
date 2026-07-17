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
  ChevronRight,
  ClipboardList,
  Clock3,
  CalendarDays,
  Download,
  FileText,
  Filter,
  Folder,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Star,
  Tags,
  Trash2,
  User,
  Warehouse,
  Wrench,
  XCircle,
} from 'lucide-react';

type MaintenanceStatus = 'pending' | 'in_progress' | 'completed' | 'closed';
type ResourceType = 'equipment' | 'facility' | 'material';
type ServiceSection = 'maintenance' | 'work-orders' | 'equipment' | 'facilities' | 'vendors' | 'parts';
type MaintenanceView = 'new' | 'mine';
type VendorView = 'list' | 'categories' | 'regions' | 'stats';
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
  status: MaintenanceStatus;
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
  status: MaintenanceStatus;
  notes: string;
  progress_date: string;
  updated_by_name: string;
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
  pending: { label: '等待處理', tone: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', icon: Clock3 },
  in_progress: { label: '處理中', tone: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', icon: Settings },
  completed: { label: '已完成', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
  closed: { label: '已結案', tone: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', icon: XCircle },
};

const progressSteps: Array<{ status: MaintenanceStatus; label: string }> = [
  { status: 'pending', label: '提出回報' },
  { status: 'in_progress', label: '總務處理' },
  { status: 'completed', label: '完成結果' },
  { status: 'closed', label: '完成結案' },
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
    key: 'in_progress',
    label: '處理中',
    helper: '總務處理中',
    icon: Settings,
    iconTone: 'bg-orange-50 text-orange-600 ring-orange-100',
    badgeTone: 'bg-orange-50 text-orange-700',
  },
  {
    key: 'pending',
    label: '等待處理',
    helper: '已受理待處理',
    icon: Clock3,
    iconTone: 'bg-amber-50 text-amber-600 ring-amber-100',
    badgeTone: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'completed',
    label: '已完成',
    helper: '查看歷史',
    icon: CheckCircle2,
    iconTone: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    badgeTone: 'bg-emerald-50 text-emerald-700',
  },
  {
    key: 'closed',
    label: '已結案',
    helper: '已結案工單',
    icon: XCircle,
    iconTone: 'bg-slate-100 text-slate-500 ring-slate-200',
    badgeTone: 'bg-slate-100 text-slate-600',
  },
];

const vendorViewItems: Array<{ key: VendorView; label: string; icon: any }> = [
  { key: 'list', label: '廠商列表', icon: Briefcase },
  { key: 'categories', label: '服務分類管理', icon: Tags },
  { key: 'regions', label: '服務區域管理', icon: MapPin },
  { key: 'stats', label: '合作記錄統計', icon: BarChart3 },
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
  tags: '',
  categoryIds: [] as string[],
  regionIds: [] as string[],
  brands: [] as string[],
  equipmentTypes: [] as string[],
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

export default function GeneralAffairsServiceCenterPage() {
  const supabase = createClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<ServiceSection>('maintenance');
  const [maintenanceExpanded, setMaintenanceExpanded] = useState(true);
  const [maintenanceView, setMaintenanceView] = useState<MaintenanceView>('new');
  const [vendorExpanded, setVendorExpanded] = useState(true);
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
  const [statusFilter, setStatusFilter] = useState<'all' | MaintenanceStatus>('all');
  const [reportStartDate, setReportStartDate] = useState(getDefaultReportStartDate);
  const [reportEndDate, setReportEndDate] = useState(getDateInTaipei);
  const [searchText, setSearchText] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [savingWorkOrderUpdate, setSavingWorkOrderUpdate] = useState(false);
  const [workOrderUpdateForm, setWorkOrderUpdateForm] = useState({
    status: 'in_progress' as MaintenanceStatus,
    progressDate: getDateInTaipei(),
    notes: '',
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
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
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
      acc.all += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { all: 0, pending: 0, in_progress: 0, completed: 0, closed: 0 } as Record<'all' | MaintenanceStatus, number>);
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false;
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
      setVendorForm(emptyVendorForm);
      setIsVendorFormOpen(false);
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
      const { error } = await supabase.from('ga_service_categories').insert({
        name: categoryForm.name.trim(),
        code: categoryForm.code.trim().toUpperCase(),
        parent_id: categoryForm.parentId || null,
        description: categoryForm.description.trim() || null,
        icon_key: categoryForm.iconKey,
        status: categoryForm.status,
        sort_order: Number(categoryForm.sortOrder || 10),
        common_items: commonItems,
      });
      if (error) throw error;
      setCategoryForm(emptyCategoryForm);
      setIsCategoryFormOpen(false);
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
    if (!loadingInitial && (maintenanceView === 'mine' || activeSection === 'work-orders')) {
      loadReports();
    }
  }, [activeSection, loadingInitial, maintenanceView, loadReports]);

  useEffect(() => {
    if (!loadingInitial && activeSection === 'vendors' && canAccessService) {
      loadVendorManagementData();
    }
  }, [activeSection, canAccessService, loadingInitial, loadVendorManagementData]);

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
          status: workOrderUpdateForm.status,
          notes: workOrderUpdateForm.notes.trim(),
          progress_date: workOrderUpdateForm.progressDate,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '更新工單進度失敗');
      }
      setWorkOrderUpdateForm({
        status: workOrderUpdateForm.status === 'closed' ? 'closed' : 'in_progress',
        progressDate: getDateInTaipei(),
        notes: '',
      });
      await loadReports();
      alert('工單進度已更新');
    } catch (error: any) {
      alert(`更新失敗：${error.message || error}`);
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
    const currentIndex = progressSteps.findIndex((step) => step.status === request.status);
    const updates = updatesByRequestId.get(request.id) || [];
    const latest = updates[0];
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
          {latest ? `${latest.notes}｜${getDateTimeLabel(latest.progress_date)}` : statusMeta[request.status].label}
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
                const meta = statusMeta[request.status] || statusMeta.pending;
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
                      </td>
                      <td className="px-4 py-4">{renderProgress(request)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{getDateTimeLabel(request.reported_at)}</td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => setExpandedReportId(expanded ? null : request.id)}
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
                            <div className="rounded-lg border border-slate-200 bg-white p-4">
                              <div className="text-sm font-bold text-slate-900">工單處理紀錄</div>
                              <div className="mt-4 space-y-3">
                                {updates.length === 0 ? (
                                  <div className="text-sm text-slate-500">尚無總務更新紀錄</div>
                                ) : updates.map((update) => {
                                  const updateMeta = statusMeta[update.status] || statusMeta.pending;
                                  return (
                                    <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${updateMeta.tone}`}>{updateMeta.label}</span>
                                        <span className="text-xs text-slate-500">{getDateTimeLabel(update.progress_date)}｜{update.updated_by_name}</span>
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.notes}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                              <div className="font-bold text-slate-900">聯絡與門市資訊</div>
                              <div className="mt-3 space-y-2 text-slate-600">
                                <div>門市：{request.store ? `${request.store.store_code} ${request.store.store_name}` : '-'}</div>
                                <div>聯絡人：{request.contact_name || request.reporter_name || '-'}</div>
                                <div>電話：{request.contact_phone || '-'}</div>
                                <div>回報者：{request.reporter_name}</div>
                              </div>
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

          <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1fr)_390px]">
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
                    const meta = statusMeta[request.status] || statusMeta.pending;
                    const latest = (updatesByRequestId.get(request.id) || [])[0];
                    const active = selectedWorkOrder?.id === request.id;
                    return (
                      <tr
                        key={request.id}
                        onClick={() => setSelectedWorkOrderId(request.id)}
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
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold text-slate-500">目前選取</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{selectedWorkOrder.title}</div>
                    <div className="mt-2 text-sm text-slate-600">{selectedWorkOrder.store ? `${selectedWorkOrder.store.store_code} ${selectedWorkOrder.store.store_name}` : '-'}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div>聯絡人：<span className="font-semibold text-slate-700">{selectedWorkOrder.contact_name || selectedWorkOrder.reporter_name || '-'}</span></div>
                      <div>電話：<span className="font-semibold text-slate-700">{selectedWorkOrder.contact_phone || '-'}</span></div>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selectedWorkOrder.description || '-'}</div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-950">新增處理進度</div>
                    <div className="mt-3 space-y-3">
                      <label className="block text-sm font-semibold text-slate-700">
                        工單狀態
                        <select
                          value={workOrderUpdateForm.status}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, status: event.target.value as MaintenanceStatus })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        >
                          {progressSteps.map((step) => <option key={step.status} value={step.status}>{statusMeta[step.status].label}</option>)}
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
                        const meta = statusMeta[update.status] || statusMeta.pending;
                        return (
                          <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
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

  const renderVendorList = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {renderVendorHeader('廠商列表', '管理合作廠商資料、服務項目與聯絡資訊，並追蹤廠商服務績效', '新增廠商', () => setIsVendorFormOpen(true))}
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
      {isVendorFormOpen ? renderVendorFormPanel() : (
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
      )}
    </div>
  );

  const renderVendorCategories = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {renderVendorHeader('服務分類管理', '管理服務分類項目，供廠商設定服務能力與工單分類使用', '新增分類', () => setIsCategoryFormOpen(true))}
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
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500"><tr><th className="px-4 py-3">分類名稱</th><th className="px-4 py-3">分類代碼</th><th className="px-4 py-3">上層分類</th><th className="px-4 py-3">包含項目數</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">排序</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {vendorCategories.map((category) => (
                <tr key={category.id}>
                  <td className="px-4 py-3 font-bold text-slate-900"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded bg-blue-50 text-blue-600"><Folder size={15} /></span>{category.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{category.code}</td>
                  <td className="px-4 py-3 text-slate-600">{category.parent_id ? getCategoryName(category.parent_id) : '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{category.common_items?.length || 0}</td>
                  <td className="px-4 py-3">{renderVendorStatusBadge(category.status, 'setting')}</td>
                  <td className="px-4 py-3 text-slate-600">{category.sort_order}</td>
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

  const renderVendorFormPanel = () => (
    <aside className={`rounded-lg border border-slate-200 bg-white p-5 ${isVendorFormOpen ? '' : 'hidden xl:block'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-950">新增廠商</h2>
        {isVendorFormOpen && <button type="button" onClick={() => setIsVendorFormOpen(false)} className="text-slate-400 hover:text-slate-700">×</button>}
      </div>
      {!isVendorFormOpen ? (
        <div className="mt-8 text-center text-sm text-slate-500">點選「新增廠商」建立合作廠商資料</div>
      ) : (
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">廠商名稱 *<input value={vendorForm.name} onChange={(event) => setVendorForm({ ...vendorForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500" placeholder="請輸入廠商名稱" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">廠商類型<select value={vendorForm.vendorType} onChange={(event) => setVendorForm({ ...vendorForm, vendorType: event.target.value as Vendor['vendor_type'] })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="company">公司</option><option value="studio">工作室</option><option value="personal">個人工作室</option></select></label>
            <label className="block text-sm font-semibold text-slate-700">合作狀態<select value={vendorForm.status} onChange={(event) => setVendorForm({ ...vendorForm, status: event.target.value as VendorStatus })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="active">合作中</option><option value="paused">暫停合作</option><option value="inactive">已停用</option></select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">統一編號<input value={vendorForm.taxId} onChange={(event) => setVendorForm({ ...vendorForm, taxId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">品牌名稱 / 別名<input value={vendorForm.alias} onChange={(event) => setVendorForm({ ...vendorForm, alias: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">聯絡人<input value={vendorForm.contactName} onChange={(event) => setVendorForm({ ...vendorForm, contactName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">聯絡電話<input value={vendorForm.contactPhone} onChange={(event) => setVendorForm({ ...vendorForm, contactPhone: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">電子郵件<input value={vendorForm.email} onChange={(event) => setVendorForm({ ...vendorForm, email: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">公司地址<input value={vendorForm.address} onChange={(event) => setVendorForm({ ...vendorForm, address: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <div>
            <div className="text-sm font-semibold text-slate-700">服務分類</div>
            <div className="mt-2 grid grid-cols-2 gap-2">{vendorCategories.map((category) => <label key={category.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vendorForm.categoryIds.includes(category.id)} onChange={() => toggleVendorFormArray('categoryIds', category.id)} />{category.name}</label>)}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-700">服務區域</div>
            <div className="mt-2 grid grid-cols-2 gap-2">{vendorRegions.map((region) => <label key={region.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vendorForm.regionIds.includes(region.id)} onChange={() => toggleVendorFormArray('regionIds', region.id)} />{region.name}</label>)}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-700">熟悉品牌 / 品項</div>
            <div className="mt-2 grid grid-cols-2 gap-2">{defaultBrandSeeds.slice(0, 8).map((brand) => <label key={brand} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vendorForm.brands.includes(brand)} onChange={() => toggleVendorFormArray('brands', brand)} />{brand}</label>)}</div>
          </div>
          <textarea value={vendorForm.description} onChange={(event) => setVendorForm({ ...vendorForm, description: event.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="公司簡介 / 備註" />
          <button type="button" onClick={saveVendor} disabled={savingVendor} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{savingVendor ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}儲存廠商</button>
        </div>
      )}
    </aside>
  );

  const renderCategoryFormPanel = () => (
    <aside className={`rounded-lg border border-slate-200 bg-white p-5 ${isCategoryFormOpen ? '' : 'hidden xl:block'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-950">新增服務分類</h2>
        {isCategoryFormOpen && <button type="button" onClick={() => setIsCategoryFormOpen(false)} className="text-slate-400 hover:text-slate-700">×</button>}
      </div>
      {!isCategoryFormOpen ? <div className="mt-8 text-center text-sm text-slate-500">點選「新增分類」建立分類</div> : (
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">上層分類<select value={categoryForm.parentId} onChange={(event) => setCategoryForm({ ...categoryForm, parentId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">無（頂層分類）</option>{vendorCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="block text-sm font-semibold text-slate-700">分類名稱 *<input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">分類代碼 *<input value={categoryForm.code} onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="英文大寫，2-10碼" /></label>
          <textarea value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="分類描述（選填）" />
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700">狀態<select value={categoryForm.status} onChange={(event) => setCategoryForm({ ...categoryForm, status: event.target.value as VendorCategoryStatus })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="active">啟用中</option><option value="inactive">停用中</option></select></label><label className="block text-sm font-semibold text-slate-700">排序<input type="number" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm({ ...categoryForm, sortOrder: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label></div>
          <label className="block text-sm font-semibold text-slate-700">常見服務項目<input value={categoryForm.commonItems} onChange={(event) => setCategoryForm({ ...categoryForm, commonItems: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="以逗號分隔，例如：冷氣維修,冷氣保養" /></label>
          <button type="button" onClick={saveVendorCategory} disabled={savingCategory} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{savingCategory ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}儲存分類</button>
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
                        setActiveSection('maintenance');
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
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${maintenanceView === 'new' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
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
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${maintenanceView === 'mine' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
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
                        setActiveSection('vendors');
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
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${vendorView === viewItem.key ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
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
    </div>
  );
}
